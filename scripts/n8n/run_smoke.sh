#!/usr/bin/env bash
set -euo pipefail

RED=$'\033[31m'
RESET=$'\033[0m'

err() {
  if [[ -t 2 ]]; then
    printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2
  else
    printf '%s\n' "$*" >&2
  fi
}

SMOKE_WORKFLOW_ID="${SMOKE_WORKFLOW_ID:-2DB1S0mq7UQN4U3InXRM0}"
GIT_PULL_MODE="${GIT_PULL_MODE:-none}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
N8N_API_BASE_URL="${N8N_API_BASE_URL:-http://127.0.0.1:5678}"
N8N_API_KEY="${N8N_API_KEY:-}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/n8n/run_smoke.sh

Environment overrides:
  SMOKE_WORKFLOW_ID   Default: 2DB1S0mq7UQN4U3InXRM0
  N8N_API_BASE_URL    Default: http://127.0.0.1:5678
  N8N_API_KEY         Required for API execution
  GIT_PULL_MODE       one of: none|ff-only|rebase
EOF
  exit "${1:-1}"
}

require_cmd() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    err "Missing required command: $bin"
    exit 1
  fi
}

run_git_pull() {
  case "$GIT_PULL_MODE" in
    none)
      echo "[smoke 1/3] Git pull skipped (GIT_PULL_MODE=none)."
      ;;
    ff-only)
      echo "[smoke 1/3] Updating repo (git pull --ff-only): $REPO_DIR"
      git -C "$REPO_DIR" pull --ff-only
      ;;
    rebase)
      echo "[smoke 1/3] Updating repo (git pull --rebase): $REPO_DIR"
      git -C "$REPO_DIR" pull --rebase
      ;;
    *)
      err "Unsupported GIT_PULL_MODE: $GIT_PULL_MODE (expected: none|ff-only|rebase)"
      exit 1
      ;;
  esac
}

wait_for_n8n_api() {
  echo "[smoke 2/3] Waiting for n8n API to be ready at $N8N_API_BASE_URL"
  for _ in $(seq 1 30); do
    local probe
    probe="$(
      curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
        -H "X-N8N-API-KEY: $N8N_API_KEY" \
        "$N8N_API_BASE_URL/api/v1/workflows?limit=1" 2>/dev/null || true
    )"
    if [[ "$probe" == "HTTP 200" ]]; then
      echo "n8n API is ready."
      return 0
    fi
    sleep 2
  done
  err "n8n API did not become ready in time."
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage 0
fi

require_cmd git
require_cmd curl

if [[ -z "$N8N_API_KEY" ]]; then
  err "N8N_API_KEY is required."
  err "^ export N8N_API_KEY='<your n8n api key>'"
  exit 1
fi

run_git_pull
wait_for_n8n_api

echo "[smoke 3/3] Execute smoke workflow $SMOKE_WORKFLOW_ID via API"
tmp_body="$(mktemp "${TMPDIR:-/tmp}/run_smoke.response.XXXXXX")"
trap 'rm -f "$tmp_body"' EXIT

status_code="$(
  curl -sS -o "$tmp_body" -w '%{http_code}' \
    -X POST \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    -H "Content-Type: application/json" \
    "$N8N_API_BASE_URL/api/v1/workflows/$SMOKE_WORKFLOW_ID/run" \
    --data '{}'
)"

if [[ "$status_code" =~ ^2[0-9][0-9]$ ]]; then
  echo "Smoke workflow trigger accepted (HTTP $status_code)."
  cat "$tmp_body"
  exit 0
fi

err "Smoke workflow trigger failed (HTTP $status_code)."
cat "$tmp_body" >&2
exit 1
