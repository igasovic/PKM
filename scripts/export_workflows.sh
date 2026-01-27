#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_DIR/workflows"

mkdir -p "$OUT_DIR"

# Export all workflows inside container (one file per workflow)
docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows

# Copy from container to repo
rm -rf "$OUT_DIR"/*
docker cp n8n:/tmp/workflows/. "$OUT_DIR/"

# Normalize for clean diffs
"$REPO_DIR/scripts/normalize_workflows.sh" "$OUT_DIR"

echo "Exported + normalized workflows into $OUT_DIR"
