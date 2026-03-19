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
EXPECTED_ALLOW_EXTERNAL="${EXPECTED_ALLOW_EXTERNAL:-@igasovic/n8n-blocks,igasovic-n8n-blocks}"
EXPECTED_ALLOW_BUILTIN="${EXPECTED_ALLOW_BUILTIN:-crypto,node:path,node:process}"
EXPECTED_RUNNERS_BROKER_URI="${EXPECTED_RUNNERS_BROKER_URI:-http://n8n:5679}"
RUN_SMOKE_SCRIPT="${RUN_SMOKE_SCRIPT:-$REPO_DIR/scripts/n8n/run_smoke.sh}"
RUNNERS_LAUNCHER_CONFIG_PATH="${RUNNERS_LAUNCHER_CONFIG_PATH:-/etc/n8n-task-runners.json}"
EXPECTED_JS_HEALTH_PORT="${EXPECTED_JS_HEALTH_PORT:-5681}"
EXPECTED_PY_HEALTH_PORT="${EXPECTED_PY_HEALTH_PORT:-5682}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/n8n/validate_cutover.sh [--with-smoke]

Checks:
  - compose pin still matches expected n8n and runners images
  - n8n and n8n-runners containers are running expected images
  - n8n runtime env matches proxy/external-runner expectations
  - runners launcher config includes expected JS allowlists
  - runners image contains expected runtime package files
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
  local scoped_package_path
  local alias_package_path

  scoped_package_path="$(docker exec "$RUNNERS_CONTAINER_NAME" sh -lc "test -f /usr/local/lib/node_modules/n8n/node_modules/@igasovic/n8n-blocks/package.json && printf %s /usr/local/lib/node_modules/n8n/node_modules/@igasovic/n8n-blocks/package.json" 2>/dev/null || true)"
  alias_package_path="$(docker exec "$RUNNERS_CONTAINER_NAME" sh -lc "test -f /usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/package.json && printf %s /usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/package.json" 2>/dev/null || true)"

  assert_nonempty "runners scoped package path" "$scoped_package_path"
  assert_nonempty "runners alias package path" "$alias_package_path"
  echo "OK: runners scoped package path = $scoped_package_path"
  echo "OK: runners alias package path = $alias_package_path"
}

validate_runner_launcher_config() {
  local launcher_config
  launcher_config="$(docker exec "$RUNNERS_CONTAINER_NAME" cat "$RUNNERS_LAUNCHER_CONFIG_PATH" 2>/dev/null || true)"
  assert_nonempty "runners launcher config" "$launcher_config"
  if [[ "$launcher_config" != *"NODE_FUNCTION_ALLOW_EXTERNAL"* ]]; then
    echo "FAIL: runners launcher config missing NODE_FUNCTION_ALLOW_EXTERNAL" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *'"runner-type": "javascript"'* && "$launcher_config" != *'"runner-type":"javascript"'* ]]; then
    echo "FAIL: runners launcher config missing javascript runner entry" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *'"runner-type": "python"'* && "$launcher_config" != *'"runner-type":"python"'* ]]; then
    echo "FAIL: runners launcher config missing python runner entry" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *'"workdir": "/home/runner"'* && "$launcher_config" != *'"workdir":"/home/runner"'* ]]; then
    echo "FAIL: runners launcher config missing /home/runner workdir" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *'/opt/runners/task-runner-javascript/dist/start.js'* ]]; then
    echo "FAIL: runners launcher config missing javascript launcher args" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *'/opt/runners/task-runner-python/.venv/bin/python'* ]]; then
    echo "FAIL: runners launcher config missing python launcher command" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *"\"health-check-server-port\": \"$EXPECTED_JS_HEALTH_PORT\""* && \
        "$launcher_config" != *"\"health-check-server-port\":\"$EXPECTED_JS_HEALTH_PORT\""* && \
        "$launcher_config" != *"\"health-check-server-port\": $EXPECTED_JS_HEALTH_PORT"* && \
        "$launcher_config" != *"\"health-check-server-port\":$EXPECTED_JS_HEALTH_PORT"* ]]; then
    echo "FAIL: runners launcher config missing javascript health-check-server-port $EXPECTED_JS_HEALTH_PORT" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *"\"health-check-server-port\": \"$EXPECTED_PY_HEALTH_PORT\""* && \
        "$launcher_config" != *"\"health-check-server-port\":\"$EXPECTED_PY_HEALTH_PORT\""* && \
        "$launcher_config" != *"\"health-check-server-port\": $EXPECTED_PY_HEALTH_PORT"* && \
        "$launcher_config" != *"\"health-check-server-port\":$EXPECTED_PY_HEALTH_PORT"* ]]; then
    echo "FAIL: runners launcher config missing python health-check-server-port $EXPECTED_PY_HEALTH_PORT" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *"$EXPECTED_ALLOW_EXTERNAL"* ]]; then
    echo "FAIL: runners launcher config missing expected external allowlist" >&2
    echo "  expected substring: $EXPECTED_ALLOW_EXTERNAL" >&2
    exit 1
  fi
  if [[ "$launcher_config" != *"$EXPECTED_ALLOW_BUILTIN"* ]]; then
    echo "FAIL: runners launcher config missing expected builtin allowlist" >&2
    echo "  expected substring: $EXPECTED_ALLOW_BUILTIN" >&2
    exit 1
  fi
  echo "OK: runners launcher config includes expected JS allowlists"
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
compose_must_contain "/etc/n8n-task-runners.json"

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
validate_runner_launcher_config
validate_runner_package

log_step "validate 5/6" "Check n8n CLI readiness"
wait_for_n8n_cli

if [[ "$RUN_SMOKE" == "1" ]]; then
  log_step "validate 6/6" "Run smoke workflow"
  GIT_PULL_MODE=none "$RUN_SMOKE_SCRIPT"
else
  log_step "validate 6/6" "Smoke execution skipped (pass --with-smoke to include it)"
fi
