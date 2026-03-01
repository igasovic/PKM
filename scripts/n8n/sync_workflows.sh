#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOWS_DIR="$REPO_DIR/workflows"
JS_ROOT_DIR="$REPO_DIR/js/workflows"
RAW_DIR="$REPO_DIR/tmp/n8n-sync/raw"
PATCHED_RAW_DIR="$REPO_DIR/tmp/n8n-sync/patched"
MIN_JS_LINES="${MIN_JS_LINES:-50}"
DO_COMMIT=0

usage() {
  echo "Usage: sync_workflows.sh [--commit]" >&2
  exit 1
}

if [[ "${1:-}" == "--commit" ]]; then
  DO_COMMIT=1
  shift
fi
if [[ $# -ne 0 ]]; then
  usage
fi

ENV_DOC="$REPO_DIR/docs/env.md"
if [[ ! -f "$ENV_DOC" ]]; then
  echo "Missing docs/env.md; cannot validate n8n mount path." >&2
  exit 1
fi

if ! grep -F "/home/igasovic/repos/n8n-workflows" "$ENV_DOC" | grep -Fq "/data"; then
  echo "Mount path '/home/igasovic/repos/n8n-workflows -> /data' not found in docs/env.md." >&2
  echo "Stop and confirm mount path before updating wrapper paths." >&2
  exit 1
fi

mkdir -p "$RAW_DIR" "$PATCHED_RAW_DIR" "$WORKFLOWS_DIR" "$JS_ROOT_DIR"

echo "[1/7] Export + normalize workflows to repo"
"$REPO_DIR/scripts/n8n/export_workflows.sh"

echo "[2/7] Export raw workflows for patch/import cycle"
docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_raw_sync && mkdir -p /tmp/workflows_raw_sync'
docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_raw_sync
rm -rf "$RAW_DIR"/*
docker cp n8n:/tmp/workflows_raw_sync/. "$RAW_DIR/"
"$REPO_DIR/scripts/n8n/rename_workflows_by_name.sh" "$RAW_DIR"

echo "[3/7] Sync code nodes in repo (externalize >= ${MIN_JS_LINES} lines, inline short nodes)"
node "$REPO_DIR/scripts/n8n/sync_code_nodes.js" \
  "$RAW_DIR" \
  "$PATCHED_RAW_DIR" \
  "$WORKFLOWS_DIR" \
  "$JS_ROOT_DIR" \
  "$MIN_JS_LINES"
"$REPO_DIR/scripts/n8n/normalize_workflows.sh" "$WORKFLOWS_DIR"

echo "[4/7] Import patched raw workflows back to n8n (overwrite only, no deletes)"
"$REPO_DIR/scripts/n8n/import_workflows.sh" "$PATCHED_RAW_DIR"

echo "[5/7] Export + normalize workflows again after n8n import"
"$REPO_DIR/scripts/n8n/export_workflows.sh"

echo "[6/7] Recreate n8n container"
docker restart n8n >/dev/null
echo "n8n container restarted."

if [[ "$DO_COMMIT" -eq 1 ]]; then
  echo "[7/7] Commit workflow and node changes"
  if git -C "$REPO_DIR" diff --quiet -- workflows js/workflows; then
    echo "No changes detected in workflows/ or js/workflows; skipping commit."
  else
    git -C "$REPO_DIR" add workflows js/workflows
    git -C "$REPO_DIR" commit -m "chore(n8n): sync workflows and code nodes"
    echo "Committed changes."
  fi
else
  echo "[7/7] Commit skipped (pass --commit to enable)"
fi
