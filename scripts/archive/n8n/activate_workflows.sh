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

TMP_LIVE_DIR="$(mktemp -d)"
LIVE_MAP="$TMP_LIVE_DIR/live_workflows.tsv"
cleanup() {
  rm -rf "$TMP_LIVE_DIR"
}
trap cleanup EXIT

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

build_live_workflow_map() {
  docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_live_sync && mkdir -p /tmp/workflows_live_sync'
  docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_live_sync >/dev/null
  docker cp n8n:/tmp/workflows_live_sync/. "$TMP_LIVE_DIR/"
  : >"$LIVE_MAP"
  shopt -s nullglob
  local f
  for f in "$TMP_LIVE_DIR"/*.json; do
    local name wid
    name="$(jq -r '.name // empty' "$f")"
    wid="$(jq -r '.id // empty' "$f")"
    if [[ -n "$name" && -n "$wid" && "$name" != "null" && "$wid" != "null" ]]; then
      printf '%s\t%s\n' "$name" "$wid" >>"$LIVE_MAP"
    fi
  done
}

live_id_by_name() {
  local wf_name="$1"
  awk -F '\t' -v n="$wf_name" '$1==n { print $2; exit }' "$LIVE_MAP"
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
build_live_workflow_map

shopt -s nullglob
files=("$DIR"/*.json)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No JSON workflows found in $DIR"
  exit 0
fi

activated=0
failed=0
for f in "${files[@]}"; do
  wf_name="$(jq -r '.name // empty' "$f")"
  src_wid="$(jq -r '.id // empty' "$f")"
  live_wid="$(live_id_by_name "$wf_name")"
  wid="${live_wid:-$src_wid}"
  if [[ -z "$wid" ]]; then
    echo "Activation failed: missing workflow id for $(basename "$f")" >&2
    failed=$((failed + 1))
    continue
  fi

  if [[ -n "$live_wid" && -n "$src_wid" && "$live_wid" != "$src_wid" ]]; then
    echo "Activation ID remap: $(basename "$f"): $src_wid -> $live_wid"
  fi

  echo "Activating: $wid"
  if [[ "$MODE" == "cli-publish" ]]; then
    if ! out="$(activate_via_cli_publish "$wid" 2>&1)"; then
      echo "Activation failed for $wid (cli-publish):" >&2
      echo "$out" >&2
      failed=$((failed + 1))
      continue
    fi
  elif [[ "$MODE" == "cli-update" ]]; then
    if ! out="$(activate_via_cli_update "$wid" 2>&1)"; then
      echo "Activation failed for $wid (cli-update):" >&2
      echo "$out" >&2
      failed=$((failed + 1))
      continue
    fi
  else
    if ! out="$(activate_via_api "$wid" 2>&1)"; then
      echo "Activation failed for $wid (api):" >&2
      echo "$out" >&2
      failed=$((failed + 1))
      continue
    fi
  fi
  echo "Activated: $wid"
  activated=$((activated + 1))
done

echo "Activation summary: activated=$activated failed=$failed total=${#files[@]}"
if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
