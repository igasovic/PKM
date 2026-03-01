#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-workflows}"

slugify () {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

shopt -s nullglob
for f in "$DIR"/*.json; do
  name="$(jq -r '.name // empty' "$f")"
  wid="$(jq -r '.id // empty' "$f")"

  if [[ -z "$name" || "$name" == "null" ]]; then
    echo "Skipping (no .name): $f"
    continue
  fi
  if [[ -z "$wid" || "$wid" == "null" ]]; then
    echo "Skipping (no .id): $f"
    continue
  fi

  base="$(slugify "$name")"
  if [[ -z "$base" ]]; then
    echo "Skipping (empty slug): $f"
    continue
  fi

  target="$DIR/${base}__${wid}.json"

  if [[ "$f" == "$target" ]]; then
    continue
  fi

  mv "$f" "$target"
  echo "Renamed: $(basename "$f") -> $(basename "$target")"
done
