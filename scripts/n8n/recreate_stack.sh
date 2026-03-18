#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-/home/igasovic/stack/docker-compose.yml}"
STACK_ROOT="$(cd "$(dirname "$COMPOSE_FILE")" && pwd)"
BUILD_RUNNERS_IMAGE_SCRIPT="${BUILD_RUNNERS_IMAGE_SCRIPT:-$REPO_DIR/scripts/n8n/build_runners_image.sh}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
}

wait_for_n8n_cli() {
  echo "Waiting for n8n CLI to become ready..."
  for i in $(seq 1 30); do
    if docker exec -u node n8n n8n --help >/dev/null 2>&1; then
      echo "n8n CLI is ready."
      return 0
    fi
    sleep 2
  done
  echo "n8n did not become ready in time after restart." >&2
  exit 1
}

require_cmd docker
require_file "$COMPOSE_FILE"
require_file "$BUILD_RUNNERS_IMAGE_SCRIPT"

echo "[recreate 1/2] Build custom n8n runners image"
SKIP_PACKAGE_BUILD=0 "$BUILD_RUNNERS_IMAGE_SCRIPT"

echo "[recreate 2/2] Recreate n8n and task-runners"
docker compose -f "$COMPOSE_FILE" --project-directory "$STACK_ROOT" up -d n8n task-runners >/dev/null
wait_for_n8n_cli
