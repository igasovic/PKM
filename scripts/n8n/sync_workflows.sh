#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOWS_DIR="$REPO_DIR/src/n8n/workflows"
NODES_ROOT_DIR="$REPO_DIR/src/n8n/nodes"
LEGACY_NODES_ROOT_DIR="$REPO_DIR/js/workflows"
RAW_DIR="$REPO_DIR/tmp/n8n-sync/raw"
PATCHED_RAW_DIR="$REPO_DIR/tmp/n8n-sync/patched"
MIN_JS_LINES="${MIN_JS_LINES:-50}"
PYTHON_BIN="${PYTHON_BIN:-}"

MODE="pull"
DO_COMMIT=0
DRY_RUN=0
WORKFLOW_NAMES=()

usage() {
  local exit_code="${1:-1}"
  cat >&2 <<EOF
Usage: sync_workflows.sh [options]

Options:
  --mode <pull|push|full>     Default: pull
    pull  Export from n8n -> normalize -> sync externalized nodes to repo
    push  Push repo workflows to n8n in-place via API patch
    full  pull + push
  --workflow-name "<name>"    Repeatable, push/full only (target specific workflows)
  --dry-run                   Push/full only (no API writes)
  --commit                    Commit repo changes after run
  -h, --help                  Show this help
EOF
  exit "$exit_code"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage 0
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --workflow-name)
      WORKFLOW_NAMES+=("${2:-}")
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --commit)
      DO_COMMIT=1
      shift
      ;;
    *)
      usage
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
}

if [[ "$MODE" != "pull" && "$MODE" != "push" && "$MODE" != "full" ]]; then
  echo "Invalid mode: $MODE" >&2
  usage
fi

if [[ "${#WORKFLOW_NAMES[@]}" -gt 0 && "$MODE" == "pull" ]]; then
  echo "--workflow-name is only valid with --mode push|full" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 && "$MODE" == "pull" ]]; then
  echo "--dry-run is only valid with --mode push|full" >&2
  exit 1
fi

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "Neither 'python3' nor 'python' is available in PATH." >&2
    exit 1
  fi
fi

COMPOSE_FILE="${COMPOSE_FILE:-/home/igasovic/stack/docker-compose.yml}"
EXPECTED_MOUNT="/home/igasovic/repos/n8n-workflows:/data:ro"

require_cmd docker
require_cmd jq
require_file "$REPO_DIR/scripts/n8n/export_workflows.sh"
require_file "$REPO_DIR/scripts/n8n/normalize_workflows.sh"
require_file "$REPO_DIR/scripts/n8n/rename_workflows_by_name.sh"
require_file "$REPO_DIR/scripts/n8n/sync_code_nodes.py"
require_file "$REPO_DIR/scripts/n8n/sync_nodes.py"
require_file "$COMPOSE_FILE"

if ! docker ps --format '{{.Names}}' | grep -qx 'n8n'; then
  echo "Container 'n8n' is not running." >&2
  exit 1
fi

N8N_BLOCK="$(awk '
  /^[[:space:]]{2}n8n:[[:space:]]*$/ {in_n8n=1; print; next}
  in_n8n && /^[[:space:]]{2}[a-zA-Z0-9_-]+:[[:space:]]*$/ {exit}
  in_n8n {print}
' "$COMPOSE_FILE")"

if [[ -z "$N8N_BLOCK" ]]; then
  echo "Service block 'n8n:' not found in $COMPOSE_FILE" >&2
  exit 1
fi

if ! printf '%s\n' "$N8N_BLOCK" | grep -Fq "$EXPECTED_MOUNT"; then
  echo "Required n8n mount '$EXPECTED_MOUNT' not found in $COMPOSE_FILE" >&2
  echo "Stop and confirm compose mount before updating wrapper paths." >&2
  exit 1
fi

mkdir -p "$RAW_DIR" "$PATCHED_RAW_DIR" "$WORKFLOWS_DIR" "$NODES_ROOT_DIR"

validate_repo_workflows() {
  if rg -n "/data/js/workflows/" "$WORKFLOWS_DIR" >/dev/null 2>&1; then
    echo "Legacy wrapper paths found in repo workflows ($WORKFLOWS_DIR):" >&2
    rg -n "/data/js/workflows/" "$WORKFLOWS_DIR" >&2
    exit 1
  fi

  "$PYTHON_BIN" - "$WORKFLOWS_DIR" "$NODES_ROOT_DIR" <<'PY'
import json
import pathlib
import re
import sys

workflows_dir = pathlib.Path(sys.argv[1])
nodes_root_dir = pathlib.Path(sys.argv[2])
missing = []

for wf in sorted(workflows_dir.glob("*.json")):
    data = json.loads(wf.read_text(encoding="utf-8"))
    for node in data.get("nodes", []):
        js = (node.get("parameters") or {}).get("jsCode", "")
        m = re.search(r"/data/src/n8n/nodes/([^'\"`]+\.js)", js)
        if m and not (nodes_root_dir / m.group(1)).exists():
            missing.append((wf.name, node.get("name"), m.group(1)))

if missing:
    print("Missing canonical wrapper targets in repo workflows:", file=sys.stderr)
    for wf_name, node_name, rel_path in missing:
        print(f"- {wf_name} :: {node_name} -> {rel_path}", file=sys.stderr)
    sys.exit(1)
PY
}

validate_live_workflows() {
  local live_validate_dir="$REPO_DIR/tmp/n8n-sync/live-validate"
  rm -rf "$live_validate_dir"
  mkdir -p "$live_validate_dir"

  docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_live_validate && mkdir -p /tmp/workflows_live_validate'
  docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_live_validate
  docker cp n8n:/tmp/workflows_live_validate/. "$live_validate_dir/"

  if rg -n "/data/js/workflows/" "$live_validate_dir" >/dev/null 2>&1; then
    echo "Legacy wrapper paths still present in live n8n workflows after push:" >&2
    rg -n "/data/js/workflows/" "$live_validate_dir" >&2
    exit 1
  fi
}

run_pull() {
  echo "[pull 1/3] Export + normalize workflows to repo"
  "$REPO_DIR/scripts/n8n/export_workflows.sh" "$WORKFLOWS_DIR"

  echo "[pull 2/3] Export raw workflows for patch/source lookup"
  docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_raw_sync && mkdir -p /tmp/workflows_raw_sync'
  docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_raw_sync
  rm -rf "$RAW_DIR"/*
  docker cp n8n:/tmp/workflows_raw_sync/. "$RAW_DIR/"
  "$REPO_DIR/scripts/n8n/rename_workflows_by_name.sh" "$RAW_DIR"

  echo "[pull 3/3] Sync code nodes into repo (canonical src/n8n/nodes)"
  local args=(
    "$PYTHON_BIN" "$REPO_DIR/scripts/n8n/sync_code_nodes.py"
    "$RAW_DIR"
    "$PATCHED_RAW_DIR"
    "$WORKFLOWS_DIR"
    "$NODES_ROOT_DIR"
    "$MIN_JS_LINES"
  )
  if [[ -d "$LEGACY_NODES_ROOT_DIR" ]]; then
    args+=("$LEGACY_NODES_ROOT_DIR")
  fi
  "${args[@]}"
  "$REPO_DIR/scripts/n8n/normalize_workflows.sh" "$WORKFLOWS_DIR"
  validate_repo_workflows
}

run_push() {
  validate_repo_workflows

  local args=(
    "$PYTHON_BIN" "$REPO_DIR/scripts/n8n/sync_nodes.py"
    "--workflows-dir" "$WORKFLOWS_DIR"
    "--nodes-root-dir" "$NODES_ROOT_DIR"
  )
  if [[ -d "$LEGACY_NODES_ROOT_DIR" ]]; then
    args+=("--legacy-nodes-root-dir" "$LEGACY_NODES_ROOT_DIR")
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=("--dry-run")
  fi
  if [[ "${#WORKFLOW_NAMES[@]}" -gt 0 ]]; then
    local wf
    for wf in "${WORKFLOW_NAMES[@]}"; do
      args+=("--workflow-name" "$wf")
    done
  fi
  echo "[push 1/1] Patch repo workflows to n8n via API (in-place)"
  "${args[@]}"
}

recreate_n8n() {
  echo "[push 2/2] Recreate n8n container"
  if command -v recreate >/dev/null 2>&1; then
    recreate n8n
  else
    docker restart n8n >/dev/null
    echo "n8n container restarted."
  fi
  echo "Waiting for n8n CLI to become ready..."
  for i in $(seq 1 30); do
    if docker exec -u node n8n n8n --help >/dev/null 2>&1; then
      echo "n8n CLI is ready."
      return 0
    fi
    sleep 2
  done
  echo "n8n did not become ready in time after restart." >&2
  exit 1
}

case "$MODE" in
  pull)
    run_pull
    ;;
  push)
    run_push
    recreate_n8n
    validate_live_workflows
    ;;
  full)
    run_pull
    run_push
    recreate_n8n
    validate_live_workflows
    ;;
esac

if [[ "$DO_COMMIT" -eq 1 ]]; then
  echo "[commit] Commit canonical n8n repo changes"
  local_paths=(src/n8n/workflows src/n8n/nodes js/workflows)
  if [[ -d "$REPO_DIR/workflows" ]] || git -C "$REPO_DIR" ls-files --error-unmatch workflows >/dev/null 2>&1; then
    local_paths+=(workflows)
  fi

  if git -C "$REPO_DIR" diff --quiet -- "${local_paths[@]}"; then
    echo "No changes detected in src/n8n/workflows, src/n8n/nodes, js/workflows, or legacy workflows/; skipping commit."
  else
    git -C "$REPO_DIR" add -A "${local_paths[@]}"
    git -C "$REPO_DIR" commit -m "chore(n8n): sync workflows and code nodes"
    echo "Committed changes."
  fi
fi
