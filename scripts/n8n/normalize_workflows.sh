#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-$REPO_DIR/src/n8n/workflows}"

shopt -s nullglob
for f in "$DIR"/*.json; do
  tmp="${f}.tmp"

  jq -S '
    del(
      .id,
      .versionId,
      .activeVersionId,
      .createdAt,
      .shared,
      .meta,
      .pinData,
      .updatedAt,
      .versionCounter,
      .versionMetadata
    )
  ' "$f" > "$tmp"

  mv "$tmp" "$f"
done

echo "Normalized workflows in $DIR"
