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

activate_via_cli() {
  local wid="$1"
  docker exec -u node n8n n8n update:workflow --id="$wid" --active=true >/dev/null
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
if docker exec -u node n8n n8n update:workflow --help >/dev/null 2>&1; then
  MODE="cli"
elif [[ -n "${N8N_API_KEY:-}" ]]; then
  MODE="api"
else
  echo "Cannot activate workflows automatically." >&2
  echo "Neither n8n CLI command 'update:workflow' is available nor N8N_API_KEY is set." >&2
  echo "Set N8N_API_KEY (and optional N8N_API_BASE_URL) or upgrade n8n CLI support." >&2
  exit 1
fi

shopt -s nullglob
files=("$DIR"/*.json)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No JSON workflows found in $DIR"
  exit 0
fi

for f in "${files[@]}"; do
  wid="$(basename "$f" .json | sed -E 's/^.*__//')"
  if [[ -z "$wid" ]]; then
    echo "Skipping activation (cannot derive workflow id): $(basename "$f")" >&2
    continue
  fi

  if [[ "$MODE" == "cli" ]]; then
    activate_via_cli "$wid"
  else
    activate_via_api "$wid"
  fi
  echo "Activated: $wid"
done
