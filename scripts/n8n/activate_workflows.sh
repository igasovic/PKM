#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-}"
if [[ -z "$DIR" ]]; then
  echo "Usage: activate_workflows.sh <raw_workflows_dir>" >&2
  exit 1
fi

if [[ ! -d "$DIR" ]]; then
  echo "Missing directory: $DIR" >&2
  exit 1
fi

activate_via_cli_publish() {
  local wid="$1"
  docker exec -u node n8n n8n publish:workflow --id="$wid"
}

activate_via_cli_update() {
  local wid="$1"
  docker exec -u node n8n n8n update:workflow --id="$wid" --active=true
}

activate_via_api() {
  local wid="$1"
  local base_url="${N8N_API_BASE_URL:-http://127.0.0.1:5678}"
  if [[ -z "${N8N_API_KEY:-}" ]]; then
    return 1
  fi
  curl -fsS -X PATCH "${base_url%/}/api/v1/workflows/$wid" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"active": true}' >/dev/null
}

MODE=""
if docker exec -u node n8n n8n publish:workflow --help >/dev/null 2>&1; then
  MODE="cli-publish"
elif docker exec -u node n8n n8n update:workflow --help >/dev/null 2>&1; then
  MODE="cli-update"
elif [[ -n "${N8N_API_KEY:-}" ]]; then
  MODE="api"
else
  echo "Cannot activate workflows automatically." >&2
  echo "Neither n8n CLI command 'update:workflow' is available nor N8N_API_KEY is set." >&2
  echo "Set N8N_API_KEY (and optional N8N_API_BASE_URL) or upgrade n8n CLI support." >&2
  exit 1
fi
echo "Activation mode: $MODE"

shopt -s nullglob
files=("$DIR"/*.json)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No JSON workflows found in $DIR"
  exit 0
fi

for f in "${files[@]}"; do
  wid="$(jq -r '.id // empty' "$f")"
  if [[ -z "$wid" ]]; then
    echo "Activation failed: missing .id in $(basename "$f")" >&2
    exit 1
  fi

  echo "Activating: $wid"
  if [[ "$MODE" == "cli-publish" ]]; then
    if ! out="$(activate_via_cli_publish "$wid" 2>&1)"; then
      echo "Activation failed for $wid (cli-publish):" >&2
      echo "$out" >&2
      exit 1
    fi
  elif [[ "$MODE" == "cli-update" ]]; then
    if ! out="$(activate_via_cli_update "$wid" 2>&1)"; then
      echo "Activation failed for $wid (cli-update):" >&2
      echo "$out" >&2
      exit 1
    fi
  else
    if ! out="$(activate_via_api "$wid" 2>&1)"; then
      echo "Activation failed for $wid (api):" >&2
      echo "$out" >&2
      exit 1
    fi
  fi
  echo "Activated: $wid"
done
