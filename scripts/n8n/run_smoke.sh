#!/usr/bin/env bash
set -euo pipefail

SMOKE_WORKFLOW_ID="${SMOKE_WORKFLOW_ID:-2DB1S0mq7UQN4U3InXRM0}"
N8N_CONTAINER_NAME="${N8N_CONTAINER_NAME:-n8n}"
DOCKER_USER="${DOCKER_USER:-node}"
GIT_PULL_MODE="${GIT_PULL_MODE:-none}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/n8n/run_smoke.sh

Environment overrides:
  SMOKE_WORKFLOW_ID   Default: 2DB1S0mq7UQN4U3InXRM0
  N8N_CONTAINER_NAME  Default: n8n
  DOCKER_USER         Default: node
  GIT_PULL_MODE       one of: none|ff-only|rebase
EOF
  exit "${1:-1}"
}

require_cmd() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required command: $bin" >&2
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
      echo "Unsupported GIT_PULL_MODE: $GIT_PULL_MODE (expected: none|ff-only|rebase)" >&2
      exit 1
      ;;
  esac
}

wait_for_n8n_cli() {
  echo "[smoke 2/3] Waiting for n8n CLI to be ready in container $N8N_CONTAINER_NAME"
  for _ in $(seq 1 30); do
    if docker exec -u "$DOCKER_USER" "$N8N_CONTAINER_NAME" n8n --help >/dev/null 2>&1; then
      echo "n8n CLI is ready."
      return 0
    fi
    sleep 2
  done
  echo "n8n CLI did not become ready in time." >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage 0
fi

require_cmd docker
require_cmd git

run_git_pull
wait_for_n8n_cli

echo "[smoke 3/3] Execute smoke workflow $SMOKE_WORKFLOW_ID"
exec docker exec -u "$DOCKER_USER" "$N8N_CONTAINER_NAME" n8n execute --id "$SMOKE_WORKFLOW_ID"
