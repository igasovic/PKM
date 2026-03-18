#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-/home/igasovic/stack/docker-compose.yml}"
N8N_CONTAINER_NAME="${N8N_CONTAINER_NAME:-n8n}"
RUNNERS_CONTAINER_NAME="${RUNNERS_CONTAINER_NAME:-n8n-runners}"
RUN_SMOKE=0

EXPECTED_N8N_IMAGE="${EXPECTED_N8N_IMAGE:-docker.n8n.io/n8nio/n8n:2.10.3}"
EXPECTED_RUNNERS_IMAGE="${EXPECTED_RUNNERS_IMAGE:-pkm-n8n-runners:2.10.3}"
EXPECTED_EDITOR_BASE_URL="${EXPECTED_EDITOR_BASE_URL:-https://n8n.gasovic.com}"
EXPECTED_WEBHOOK_URL="${EXPECTED_WEBHOOK_URL:-https://n8n-hook.gasovic.com/}"
EXPECTED_PROXY_HOPS="${EXPECTED_PROXY_HOPS:-1}"
EXPECTED_RUNNERS_MODE="${EXPECTED_RUNNERS_MODE:-external}"
EXPECTED_ALLOW_EXTERNAL="${EXPECTED_ALLOW_EXTERNAL:-@igasovic/n8n-blocks}"
EXPECTED_RUNNERS_BROKER_URI="${EXPECTED_RUNNERS_BROKER_URI:-http://n8n:5679}"
RUN_SMOKE_SCRIPT="${RUN_SMOKE_SCRIPT:-$REPO_DIR/scripts/n8n/run_smoke.sh}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/n8n/validate_cutover.sh [--with-smoke]

Checks:
  - compose pin still matches expected n8n and runners images
  - n8n and n8n-runners containers are running expected images
  - n8n runtime env matches proxy/external-runner expectations
  - runners container can resolve @igasovic/n8n-blocks
  - n8n CLI is ready

Options:
  --with-smoke   run scripts/n8n/run_smoke.sh after validation
  -h, --help     show this help
EOF
  exit "${1:-1}"
}

log_step() {
  echo "[$1] $2"
}

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

assert_eq() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    exit 1
  fi
  echo "OK: $label = $actual"
}

assert_nonempty() {
  local label="$1"
  local actual="$2"
  if [[ -z "$actual" ]]; then
    echo "FAIL: $label is empty" >&2
    exit 1
  fi
  echo "OK: $label present"
}

compose_must_contain() {
  local needle="$1"
  if ! grep -Fq "$needle" "$COMPOSE_FILE"; then
    echo "FAIL: compose file missing expected line: $needle" >&2
    exit 1
  fi
  echo "OK: compose contains $needle"
}

docker_env() {
  local container="$1"
  local var_name="$2"
  docker exec "$container" printenv "$var_name" 2>/dev/null || true
}

docker_image() {
  local container="$1"
  docker inspect --format '{{.Config.Image}}' "$container"
}

docker_status() {
  local container="$1"
  docker inspect --format '{{.State.Status}}' "$container"
}

wait_for_n8n_cli() {
  for _ in $(seq 1 30); do
    if docker exec -u node "$N8N_CONTAINER_NAME" n8n --help >/dev/null 2>&1; then
      echo "OK: n8n CLI ready"
      return 0
    fi
    sleep 2
  done
  echo "FAIL: n8n CLI did not become ready in time" >&2
  exit 1
}

validate_runner_package() {
  local package_path
  package_path="$(docker exec "$RUNNERS_CONTAINER_NAME" node -p "require.resolve('@igasovic/n8n-blocks/package.json')" 2>/dev/null || true)"
  assert_nonempty "runners package resolution" "$package_path"
  echo "OK: runners package path = $package_path"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-smoke)
      RUN_SMOKE=1
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

require_cmd docker
require_cmd grep
require_file "$COMPOSE_FILE"
require_file "$RUN_SMOKE_SCRIPT"

log_step "validate 1/6" "Check compose pins"
compose_must_contain "image: $EXPECTED_N8N_IMAGE"
compose_must_contain "image: $EXPECTED_RUNNERS_IMAGE"

log_step "validate 2/6" "Check running containers"
assert_eq "$N8N_CONTAINER_NAME status" "$(docker_status "$N8N_CONTAINER_NAME")" "running"
assert_eq "$RUNNERS_CONTAINER_NAME status" "$(docker_status "$RUNNERS_CONTAINER_NAME")" "running"
assert_eq "$N8N_CONTAINER_NAME image" "$(docker_image "$N8N_CONTAINER_NAME")" "$EXPECTED_N8N_IMAGE"
assert_eq "$RUNNERS_CONTAINER_NAME image" "$(docker_image "$RUNNERS_CONTAINER_NAME")" "$EXPECTED_RUNNERS_IMAGE"

log_step "validate 3/6" "Check n8n runtime env"
assert_eq "N8N_EDITOR_BASE_URL" "$(docker_env "$N8N_CONTAINER_NAME" N8N_EDITOR_BASE_URL)" "$EXPECTED_EDITOR_BASE_URL"
assert_eq "WEBHOOK_URL" "$(docker_env "$N8N_CONTAINER_NAME" WEBHOOK_URL)" "$EXPECTED_WEBHOOK_URL"
assert_eq "N8N_PROXY_HOPS" "$(docker_env "$N8N_CONTAINER_NAME" N8N_PROXY_HOPS)" "$EXPECTED_PROXY_HOPS"
assert_eq "N8N_RUNNERS_MODE" "$(docker_env "$N8N_CONTAINER_NAME" N8N_RUNNERS_MODE)" "$EXPECTED_RUNNERS_MODE"
assert_eq "NODE_FUNCTION_ALLOW_EXTERNAL" "$(docker_env "$N8N_CONTAINER_NAME" NODE_FUNCTION_ALLOW_EXTERNAL)" "$EXPECTED_ALLOW_EXTERNAL"

log_step "validate 4/6" "Check runners connectivity"
assert_eq "N8N_RUNNERS_TASK_BROKER_URI" "$(docker_env "$RUNNERS_CONTAINER_NAME" N8N_RUNNERS_TASK_BROKER_URI)" "$EXPECTED_RUNNERS_BROKER_URI"
assert_nonempty "N8N_RUNNERS_AUTH_TOKEN" "$(docker_env "$RUNNERS_CONTAINER_NAME" N8N_RUNNERS_AUTH_TOKEN)"
validate_runner_package

log_step "validate 5/6" "Check n8n CLI readiness"
wait_for_n8n_cli

if [[ "$RUN_SMOKE" == "1" ]]; then
  log_step "validate 6/6" "Run smoke workflow"
  GIT_PULL_MODE=none "$RUN_SMOKE_SCRIPT"
else
  log_step "validate 6/6" "Smoke execution skipped (pass --with-smoke to include it)"
fi
