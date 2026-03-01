#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-}"
if [[ -z "$DIR" ]]; then
  echo "Usage: import_workflows.sh <raw_workflows_dir>" >&2
  exit 1
fi

if [[ ! -d "$DIR" ]]; then
  echo "Missing directory: $DIR" >&2
  exit 1
fi

shopt -s nullglob
files=("$DIR"/*.json)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No JSON workflows found in $DIR"
  exit 0
fi

for f in "${files[@]}"; do
  base="$(basename "$f")"
  remote="/tmp/$base"
  docker cp "$f" "n8n:$remote"
  docker exec -u node n8n n8n import:workflow --input="$remote"
  echo "Imported: $base"
done
