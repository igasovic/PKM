#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-}"
if [[ -z "$DIR" ]]; then
  echo "Usage: import_workflows.sh <raw_workflows_dir> [workflow_name_to_recreate ...]" >&2
  exit 1
fi
shift || true

if [[ ! -d "$DIR" ]]; then
  echo "Missing directory: $DIR" >&2
  exit 1
fi
RECREATE_WORKFLOW_NAMES=("$@")

TMP_LIVE_DIR="$(mktemp -d)"
LIVE_MAP="$TMP_LIVE_DIR/live_workflows.tsv"
cleanup() {
  rm -rf "$TMP_LIVE_DIR"
}
trap cleanup EXIT

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

delete_via_cli() {
  local wid="$1"
  docker exec -u node n8n n8n delete:workflow --id="$wid"
}

delete_via_api() {
  local wid="$1"
  local base_url="${N8N_API_BASE_URL:-http://127.0.0.1:5678}"
  if [[ -z "${N8N_API_KEY:-}" ]]; then
    return 1
  fi
  curl -fsS -X DELETE "${base_url%/}/api/v1/workflows/$wid" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" >/dev/null
}

recreate_requested() {
  local wf_name="$1"
  local candidate
  for candidate in "${RECREATE_WORKFLOW_NAMES[@]}"; do
    if [[ "$candidate" == "$wf_name" ]]; then
      return 0
    fi
  done
  return 1
}

build_recreate_import_payload() {
  local src_file="$1"
  local out_file="$2"
  jq '
    del(
      .id,
      .versionId,
      .activeVersionId,
      .versionCounter,
      .createdAt,
      .updatedAt
    )
  ' "$src_file" >"$out_file"
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
build_live_workflow_map

DELETE_MODE="none"
if docker exec -u node n8n n8n delete:workflow --help >/dev/null 2>&1; then
  DELETE_MODE="cli-delete"
elif [[ -n "${N8N_API_KEY:-}" ]]; then
  DELETE_MODE="api"
fi
if [[ "${#RECREATE_WORKFLOW_NAMES[@]}" -gt 0 ]]; then
  echo "Recreate delete mode: $DELETE_MODE"
  if [[ "$DELETE_MODE" == "none" ]]; then
    echo "Cannot run recreate mode: no delete workflow mode available." >&2
    echo "Need n8n CLI 'delete:workflow' or N8N_API_KEY for API delete." >&2
    exit 1
  fi
fi

shopt -s nullglob
files=("$DIR"/*.json)
if [[ "${#files[@]}" -eq 0 ]]; then
  echo "No JSON workflows found in $DIR"
  exit 0
fi

for f in "${files[@]}"; do
  base="$(basename "$f")"
  wf_name="$(jq -r '.name // empty' "$f")"
  src_wid="$(jq -r '.id // empty' "$f")"
  live_wid="$(live_id_by_name "$wf_name")"
  wid="${live_wid:-$src_wid}"
  import_src="$f"
  remote="/tmp/$base"
  do_recreate=0

  if recreate_requested "$wf_name"; then
    do_recreate=1
    if [[ -z "$live_wid" ]]; then
      echo "Recreate requested, but live workflow not found by name: $wf_name (will import as new)." >&2
    else
      if [[ "$DELETE_MODE" == "none" ]]; then
        echo "Cannot recreate '$wf_name': no delete workflow mode available (need n8n delete:workflow CLI or N8N_API_KEY)." >&2
        exit 1
      fi
      echo "Recreating workflow: $wf_name (deleting live id: $live_wid; execution history will be lost)"
      if [[ "$DELETE_MODE" == "cli-delete" ]]; then
        if ! out="$(delete_via_cli "$live_wid" 2>&1)"; then
          echo "Delete failed for $wf_name ($live_wid):" >&2
          echo "$out" >&2
          exit 1
        fi
      else
        if ! out="$(delete_via_api "$live_wid" 2>&1)"; then
          echo "Delete failed for $wf_name ($live_wid) via api:" >&2
          echo "$out" >&2
          exit 1
        fi
      fi
    fi
    tmp_recreate="$TMP_LIVE_DIR/recreate.$base"
    build_recreate_import_payload "$f" "$tmp_recreate"
    import_src="$tmp_recreate"
    wid=""
  fi

  if [[ "$do_recreate" -eq 0 && -n "$live_wid" && -n "$src_wid" && "$live_wid" != "$src_wid" ]]; then
    tmp_file="$TMP_LIVE_DIR/import.$base"
    jq --arg wid "$live_wid" '.id = $wid' "$f" >"$tmp_file"
    import_src="$tmp_file"
    echo "ID remap: $base: $src_wid -> $live_wid"
  fi

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

  docker cp "$import_src" "n8n:$remote"
  docker exec -u node n8n n8n import:workflow --input="$remote"
  echo "Imported: $base"
done
