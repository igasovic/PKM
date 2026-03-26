#!/usr/bin/env bash
set -euo pipefail

RED=$'\033[31m'
RESET=$'\033[0m'

err() {
  if [[ -t 2 ]]; then
    printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2
  else
    printf '%s\n' "$*" >&2
  fi
}

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOWS_DIR="$REPO_DIR/src/n8n/workflows"
NODES_ROOT_DIR="$REPO_DIR/src/n8n/nodes"
PACKAGE_MANIFEST="$REPO_DIR/src/n8n/package.manifest.json"
RAW_DIR="$REPO_DIR/tmp/n8n-sync/raw"
PATCHED_RAW_DIR="$REPO_DIR/tmp/n8n-sync/patched"
MIN_JS_LINES="${MIN_JS_LINES:-50}"
PYTHON_BIN="${PYTHON_BIN:-}"
BUILD_PACKAGE_SCRIPT="$REPO_DIR/scripts/n8n/build_runtime_package.js"
BUILD_PACKAGE_RUNNER="$REPO_DIR/scripts/n8n/build_runtime_package.sh"
BUILD_RUNNERS_IMAGE_SCRIPT="$REPO_DIR/scripts/n8n/build_runners_image.sh"
RECREATE_STACK_SCRIPT="$REPO_DIR/scripts/n8n/recreate_stack.sh"

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
    err "Missing required command: $cmd"
    exit 1
  fi
}

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    err "Missing required file: $file"
    exit 1
  fi
}

if [[ "$MODE" != "pull" && "$MODE" != "push" && "$MODE" != "full" ]]; then
  err "Invalid mode: $MODE"
  usage
fi

if [[ "${#WORKFLOW_NAMES[@]}" -gt 0 && "$MODE" == "pull" ]]; then
  err "--workflow-name is only valid with --mode push|full"
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 && "$MODE" == "pull" ]]; then
  err "--dry-run is only valid with --mode push|full"
  exit 1
fi

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    err "Neither 'python3' nor 'python' is available in PATH."
    exit 1
  fi
fi

COMPOSE_FILE="${COMPOSE_FILE:-/home/igasovic/stack/docker-compose.yml}"
STACK_ROOT="$(cd "$(dirname "$COMPOSE_FILE")" && pwd)"

require_cmd docker
require_cmd jq
require_file "$REPO_DIR/scripts/n8n/export_workflows.sh"
require_file "$REPO_DIR/scripts/n8n/normalize_workflows.sh"
require_file "$REPO_DIR/scripts/n8n/rename_workflows_by_name.sh"
require_file "$REPO_DIR/scripts/n8n/sync_code_nodes.py"
require_file "$REPO_DIR/scripts/n8n/sync_nodes.py"
require_file "$BUILD_PACKAGE_SCRIPT"
require_file "$BUILD_PACKAGE_RUNNER"
require_file "$BUILD_RUNNERS_IMAGE_SCRIPT"
require_file "$RECREATE_STACK_SCRIPT"
require_file "$PACKAGE_MANIFEST"
require_file "$COMPOSE_FILE"

if ! docker ps --format '{{.Names}}' | grep -qx 'n8n'; then
  err "Container 'n8n' is not running."
  exit 1
fi

mkdir -p "$RAW_DIR" "$PATCHED_RAW_DIR" "$WORKFLOWS_DIR" "$NODES_ROOT_DIR"

validate_no_legacy_runtime_imports() {
  local workflows_dir="$1"
  local label="$2"
  "$PYTHON_BIN" - "$workflows_dir" "$label" <<'PY'
import json
import pathlib
import re
import sys

workflows_dir = pathlib.Path(sys.argv[1])
label = sys.argv[2]
package_node_prefix = "@igasovic/n8n-blocks/nodes/"
package_shared_prefix = "@igasovic/n8n-blocks/shared/"
forbidden = []

for wf in sorted(workflows_dir.glob("*.json")):
    try:
        data = json.loads(wf.read_text(encoding="utf-8"))
    except Exception:
        continue
    for node in data.get("nodes", []):
        js = (node.get("parameters") or {}).get("jsCode", "")
        if not isinstance(js, str):
            continue
        for match in re.finditer(r"""require\(\s*['"]([^'\"`]+)['"]\s*\)""", js):
            wrapper_path = match.group(1)
            if wrapper_path.startswith("/data/src/"):
                forbidden.append((wf.name, node.get("name"), wrapper_path))
            elif wrapper_path.startswith("/data/"):
                forbidden.append((wf.name, node.get("name"), wrapper_path))
            elif wrapper_path.startswith("@igasovic/n8n-blocks/"):
                if not (
                    wrapper_path.startswith(package_node_prefix)
                    or wrapper_path.startswith(package_shared_prefix)
                ):
                    forbidden.append((wf.name, node.get("name"), wrapper_path))
            elif wrapper_path.startswith("/"):
                forbidden.append((wf.name, node.get("name"), wrapper_path))

if forbidden:
    print(f"Forbidden runtime imports found in {label} workflows:", file=sys.stderr)
    for wf_name, node_name, wrapper_path in forbidden:
        print(f"- {wf_name} :: {node_name} -> {wrapper_path}", file=sys.stderr)
    sys.exit(1)
PY
}

validate_repo_workflows() {
  validate_no_legacy_runtime_imports "$WORKFLOWS_DIR" "repo"

  "$PYTHON_BIN" - "$WORKFLOWS_DIR" "$NODES_ROOT_DIR" "$PACKAGE_MANIFEST" <<'PY'
import json
import pathlib
import re
import sys

workflows_dir = pathlib.Path(sys.argv[1])
nodes_root_dir = pathlib.Path(sys.argv[2])
manifest_path = pathlib.Path(sys.argv[3])
missing = []
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
root_exports = manifest.get("rootExports", {}) if isinstance(manifest, dict) else {}

for wf in sorted(workflows_dir.glob("*.json")):
    data = json.loads(wf.read_text(encoding="utf-8"))
    for node in data.get("nodes", []):
        js = (node.get("parameters") or {}).get("jsCode", "")
        m = re.search(r"@igasovic/n8n-blocks/nodes/([^'\"`]+\.js)", js)
        if not m:
            root_match = re.search(
                r"""const\s*\{\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*require\(\s*['"]@igasovic/n8n-blocks['"]\s*\)""",
                js,
            )
            if not root_match:
                continue
            export_name = root_match.group(1)
            target = root_exports.get(export_name)
            if not target:
                missing.append((wf.name, node.get("name"), f"missing root export '{export_name}'"))
                continue
            rel_path = pathlib.Path(str(target).replace("\\", "/"))
            target_file = pathlib.Path(nodes_root_dir.parent, rel_path)
            if target_file.exists():
                continue
            workflow_dir = nodes_root_dir / rel_path.parent.name
            matches = list(workflow_dir.glob(f"{rel_path.stem}__*.js")) if workflow_dir.exists() else []
            if not matches:
                missing.append((wf.name, node.get("name"), f"missing root export target '{target}'"))
            continue
        rel_path = pathlib.Path(m.group(1))
        target = nodes_root_dir / rel_path
        if target.exists():
            continue
        workflow_dir = nodes_root_dir / rel_path.parent
        matches = list(workflow_dir.glob(f"{rel_path.stem}__*.js")) if workflow_dir.exists() else []
        if not matches:
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
  validate_no_legacy_runtime_imports "$live_validate_dir" "live"
}

build_runtime_package() {
  echo "[push 1/4] Build n8n runtime package"
  "$BUILD_PACKAGE_RUNNER"
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
    "$PACKAGE_MANIFEST"
    "$MIN_JS_LINES"
  )
  "${args[@]}"
  "$REPO_DIR/scripts/n8n/normalize_workflows.sh" "$WORKFLOWS_DIR"
  validate_repo_workflows
}

run_push() {
  validate_repo_workflows

  if [[ -z "${N8N_API_KEY:-}" ]]; then
    err "N8N_API_KEY is required for sync_nodes."
    err "^ export N8N_API_KEY='<your n8n api key>'"
    exit 1
  fi

  local args=(
    "$PYTHON_BIN" "$REPO_DIR/scripts/n8n/sync_nodes.py"
    "--workflows-dir" "$WORKFLOWS_DIR"
    "--nodes-root-dir" "$NODES_ROOT_DIR"
  )
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=("--dry-run")
  fi
  if [[ "${#WORKFLOW_NAMES[@]}" -gt 0 ]]; then
    local wf
    for wf in "${WORKFLOW_NAMES[@]}"; do
      args+=("--workflow-name" "$wf")
    done
  fi
  build_runtime_package
  if [[ "$DRY_RUN" -eq 0 ]]; then
    recreate_n8n_stack
  fi
  echo "[push 3/4] Patch repo workflows to n8n via API (in-place)"
  "${args[@]}"
}

recreate_n8n_stack() {
  echo "[push 2/4] Recreate n8n stack"
  SKIP_PACKAGE_BUILD=1 "$RECREATE_STACK_SCRIPT"
}

case "$MODE" in
  pull)
    run_pull
    ;;
  push)
    run_push
    if [[ "$DRY_RUN" -eq 0 ]]; then
      echo "[push 4/4] Validate live workflows"
      validate_live_workflows
    fi
    ;;
  full)
    run_pull
    run_push
    if [[ "$DRY_RUN" -eq 0 ]]; then
      echo "[push 4/4] Validate live workflows"
      validate_live_workflows
    fi
    ;;
esac

if [[ "$DO_COMMIT" -eq 1 ]]; then
  echo "[commit] Commit canonical n8n repo changes"
  local_paths=(src/n8n/workflows src/n8n/nodes)
  if [[ -d "$REPO_DIR/workflows" ]] || git -C "$REPO_DIR" ls-files --error-unmatch workflows >/dev/null 2>&1; then
    local_paths+=(workflows)
  fi

  if git -C "$REPO_DIR" diff --quiet -- "${local_paths[@]}"; then
    echo "No changes detected in src/n8n/workflows, src/n8n/nodes, or legacy workflows/; skipping commit."
  else
    git -C "$REPO_DIR" add -A "${local_paths[@]}"
    git -C "$REPO_DIR" commit -m "chore(n8n): sync workflows and code nodes"
    echo "Committed changes."
  fi
fi
