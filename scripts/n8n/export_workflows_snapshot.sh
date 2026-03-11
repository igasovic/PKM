#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NORMALIZED_DIR="${1:-$REPO_DIR/src/n8n/workflows}"
RAW_DIR="${2:-$REPO_DIR/tmp/n8n-sync/raw}"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/n8n-snapshot.XXXXXX")"
TMP_EXPORT_DIR="$TMP_ROOT/export"
mkdir -p "$TMP_EXPORT_DIR"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$NORMALIZED_DIR" "$RAW_DIR"
rm -rf "$NORMALIZED_DIR"/* "$RAW_DIR"/*

# Export once from n8n.
docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_cfg_snapshot && mkdir -p /tmp/workflows_cfg_snapshot'
docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_cfg_snapshot

docker cp n8n:/tmp/workflows_cfg_snapshot/. "$TMP_EXPORT_DIR/"
cp -R "$TMP_EXPORT_DIR/." "$NORMALIZED_DIR/"
cp -R "$TMP_EXPORT_DIR/." "$RAW_DIR/"

# Keep IDs in raw, normalize only normalized tree.
"$REPO_DIR/scripts/n8n/rename_workflows_by_name.sh" "$RAW_DIR"
"$REPO_DIR/scripts/n8n/rename_workflows_by_name.sh" "$NORMALIZED_DIR"
"$REPO_DIR/scripts/n8n/normalize_workflows.sh" "$NORMALIZED_DIR"

echo "Exported one-shot n8n snapshot: normalized=$NORMALIZED_DIR raw=$RAW_DIR"
