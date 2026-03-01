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

deactivate_via_cli_unpublish() {
  local wid="$1"
  docker exec -u node n8n n8n unpublish:workflow --id="$wid"
}

deactivate_via_cli_update() {
  local wid="$1"
  docker exec -u node n8n n8n update:workflow --id="$wid" --active=false
}

deactivate_via_api() {
  local wid="$1"
  local base_url="${N8N_API_BASE_URL:-http://127.0.0.1:5678}"
  if [[ -z "${N8N_API_KEY:-}" ]]; then
    return 1
  fi
  curl -fsS -X PATCH "${base_url%/}/api/v1/workflows/$wid" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"active": false}' >/dev/null
}

DEACT_MODE=""
if docker exec -u node n8n n8n unpublish:workflow --help >/dev/null 2>&1; then
  DEACT_MODE="cli-unpublish"
elif docker exec -u node n8n n8n update:workflow --help >/dev/null 2>&1; then
  DEACT_MODE="cli-update"
elif [[ -n "${N8N_API_KEY:-}" ]]; then
  DEACT_MODE="api"
else
  DEACT_MODE="none"
fi
echo "Pre-import deactivate mode: $DEACT_MODE"

shopt -s nullglob
files=("$DIR"/*.json)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No JSON workflows found in $DIR"
  exit 0
fi

for f in "${files[@]}"; do
  base="$(basename "$f")"
  wid="$(jq -r '.id // empty' "$f")"
  remote="/tmp/$base"

  if [[ -n "$wid" && "$DEACT_MODE" != "none" ]]; then
    echo "Pre-deactivating: $wid"
    if [[ "$DEACT_MODE" == "cli-unpublish" ]]; then
      if ! out="$(deactivate_via_cli_unpublish "$wid" 2>&1)"; then
        echo "Pre-deactivate failed for $wid (cli-unpublish), continuing to import." >&2
        echo "$out" >&2
      fi
    elif [[ "$DEACT_MODE" == "cli-update" ]]; then
      if ! out="$(deactivate_via_cli_update "$wid" 2>&1)"; then
        echo "Pre-deactivate failed for $wid (cli-update), continuing to import." >&2
        echo "$out" >&2
      fi
    else
      if ! out="$(deactivate_via_api "$wid" 2>&1)"; then
        echo "Pre-deactivate failed for $wid (api), continuing to import." >&2
        echo "$out" >&2
      fi
    fi
  fi

  docker cp "$f" "n8n:$remote"
  docker exec -u node n8n n8n import:workflow --input="$remote"
  echo "Imported: $base"
done
