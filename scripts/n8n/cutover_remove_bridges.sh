#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
BACKUP_LABEL="${BACKUP_LABEL:-daily}"
DO_COMMIT=0

usage() {
  cat >&2 <<EOF
Usage: cutover_remove_bridges.sh [--commit]

Steps:
  1) Run existing DB backup script (label: \$BACKUP_LABEL, default: daily)
  2) Snapshot live n8n workflows before cutover
  3) Run sync_workflows full cycle (pull + push + recreate + live validation)
  4) Remove local legacy bridge files under js/workflows
  5) Validate no /data/js/workflows references remain in repo workflows
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      DO_COMMIT=1
      shift
      ;;
    -h|--help)
      usage
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

require_cmd docker
require_cmd "$PYTHON_BIN"
require_cmd rg
require_file "$REPO_DIR/scripts/db/backup.sh"
require_file "$REPO_DIR/scripts/n8n/sync_workflows.sh"
require_file "$REPO_DIR/scripts/n8n/remove_legacy_bridges.py"

echo "[1/5] Running backup via existing script (scripts/db/backup.sh $BACKUP_LABEL)"
"$REPO_DIR/scripts/db/backup.sh" "$BACKUP_LABEL"

echo "[2/5] Snapshotting live n8n workflows before bridge cutover"
TS="$(date +%Y%m%d_%H%M%S)"
SNAP_DIR="$REPO_DIR/tmp/n8n-bridge-cutover/$TS/live-before"
mkdir -p "$SNAP_DIR"
docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_bridge_cutover_before && mkdir -p /tmp/workflows_bridge_cutover_before'
docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_bridge_cutover_before
docker cp n8n:/tmp/workflows_bridge_cutover_before/. "$SNAP_DIR/"
echo "Snapshot saved: $SNAP_DIR"

echo "[3/5] Running full sync cutover (pull + push + recreate + validate live)"
"$REPO_DIR/scripts/n8n/sync_workflows.sh" --mode full

echo "[4/5] Removing local legacy bridge files"
"$PYTHON_BIN" "$REPO_DIR/scripts/n8n/remove_legacy_bridges.py" "$REPO_DIR/js/workflows"

echo "[5/5] Validating repo workflows contain no legacy bridge references"
if rg -n "/data/js/workflows/" "$REPO_DIR/src/n8n/workflows" >/dev/null 2>&1; then
  echo "Legacy wrapper paths still found in repo workflows:" >&2
  rg -n "/data/js/workflows/" "$REPO_DIR/src/n8n/workflows" >&2
  exit 1
fi
echo "Bridge cutover validation passed."

if [[ "$DO_COMMIT" -eq 1 ]]; then
  echo "[commit] Committing cutover changes"
  git -C "$REPO_DIR" add -A src/n8n/workflows src/n8n/nodes js/workflows scripts/n8n docs
  git -C "$REPO_DIR" commit -m "chore(n8n): remove legacy js/workflows bridge cutover"
  echo "Committed."
fi
