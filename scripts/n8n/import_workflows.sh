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

deactivate_via_cli() {
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
if docker exec -u node n8n n8n update:workflow --help >/dev/null 2>&1; then
  DEACT_MODE="cli"
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
  wid="$(basename "$f" .json | sed -E 's/^.*__//')"
  remote="/tmp/$base"

  if [[ -n "$wid" && "$DEACT_MODE" != "none" ]]; then
    echo "Pre-deactivating: $wid"
    if [[ "$DEACT_MODE" == "cli" ]]; then
      if ! out="$(deactivate_via_cli "$wid" 2>&1)"; then
        echo "Pre-deactivate failed for $wid (cli), continuing to import." >&2
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
