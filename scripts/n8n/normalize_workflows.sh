#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-workflows}"

shopt -s nullglob
for f in "$DIR"/*.json; do
  tmp="${f}.tmp"

  jq -S '
    del(
      .id,
      .versionId,
      .meta,
      .pinData
    )
  ' "$f" > "$tmp"

  mv "$tmp" "$f"
done

echo "Normalized workflows in $DIR"
