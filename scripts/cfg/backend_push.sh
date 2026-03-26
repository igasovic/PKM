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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CFG_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
STACK_ROOT="${CFG_STACK_ROOT:-/home/igasovic/stack}"
COMPOSE_FILE="${CFG_COMPOSE_FILE:-$STACK_ROOT/docker-compose.yml}"
SERVICE="${CFG_BACKEND_SERVICE:-pkm-server}"
GIT_PULL_MODE="${CFG_BACKEND_GIT_PULL_MODE:-ff-only}"
READY_URL="${CFG_BACKEND_READY_URL:-http://127.0.0.1:3010/ready}"
READY_ATTEMPTS="${CFG_BACKEND_READY_ATTEMPTS:-20}"
READY_SLEEP_SECONDS="${CFG_BACKEND_READY_SLEEP_SECONDS:-2}"

log() {
  printf '%s\n' "$*"
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
      log "[1/4] Git pull skipped (CFG_BACKEND_GIT_PULL_MODE=none)."
      ;;
    ff-only)
      log "[1/4] Updating repo (git pull --ff-only): $REPO_ROOT"
      git -C "$REPO_ROOT" pull --ff-only
      ;;
    rebase)
      log "[1/4] Updating repo (git pull --rebase): $REPO_ROOT"
      git -C "$REPO_ROOT" pull --rebase
      ;;
    *)
      err "Unsupported CFG_BACKEND_GIT_PULL_MODE: $GIT_PULL_MODE (expected: ff-only|rebase|none)"
      exit 1
      ;;
  esac
}

wait_ready() {
  if [[ -z "$READY_URL" ]]; then
    log "[4/4] Ready check skipped (CFG_BACKEND_READY_URL empty)."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log "[4/4] Ready check skipped (curl not available)."
    return 0
  fi

  if ! [[ "$READY_ATTEMPTS" =~ ^[0-9]+$ ]] || ! [[ "$READY_SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
    err "CFG_BACKEND_READY_ATTEMPTS and CFG_BACKEND_READY_SLEEP_SECONDS must be integers."
    exit 1
  fi

  log "[4/4] Waiting for backend readiness: $READY_URL"

  local i body
  for i in $(seq 1 "$READY_ATTEMPTS"); do
    body="$(curl -fsS "$READY_URL" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
      log "Backend is ready."
      return 0
    fi
    sleep "$READY_SLEEP_SECONDS"
  done

  err "Backend readiness check failed after $READY_ATTEMPTS attempts: $READY_URL"
  return 1
}

require_cmd git
require_cmd docker

run_git_pull

log "[2/4] Deploying backend service with Docker Compose: $SERVICE"
docker compose -f "$COMPOSE_FILE" --project-directory "$STACK_ROOT" up -d --build "$SERVICE"

log "[3/4] Backend service status"
docker compose -f "$COMPOSE_FILE" --project-directory "$STACK_ROOT" ps "$SERVICE"

wait_ready

log "Backend deploy completed."
