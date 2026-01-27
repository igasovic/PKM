#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_DIR/workflows"

mkdir -p "$OUT_DIR"

# Export all workflows inside container
docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows

# Copy from container to repo
rm -rf "$OUT_DIR"/*
docker cp n8n:/tmp/workflows/. "$OUT_DIR/"

# Rename first (needs .id present in JSON)
"$REPO_DIR/scripts/rename_workflows_by_name.sh" "$OUT_DIR"

# Normalize after rename (strips .id and other noisy fields)
"$REPO_DIR/scripts/normalize_workflows.sh" "$OUT_DIR"

echo "Exported + renamed + normalized workflows into $OUT_DIR"
