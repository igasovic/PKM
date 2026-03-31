#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT/src/server"

show_help() {
  cat <<'USAGE'
Run family-calendar live evals.

Usage:
  ./scripts/evals/run_evals.sh [--router] [--calendar] [options]

If neither --router nor --calendar is passed, both run.

Options:
  --router                     Run router eval only.
  --calendar                   Run calendar normalize eval only.
  --backend-url <url>          Backend URL (for example http://pkm-server:8080).
  --admin-secret <secret>      Admin secret (or set PKM_ADMIN_SECRET env var).
  --telegram-user-id <id>      Telegram user id used by eval requests.
  --case-limit <n>             Limit number of cases per runner.
  --timeout <ms>               Request timeout in milliseconds.
  --no-observability-check     Disable per-case debug run trace check.
  --help                       Show this help.

Examples:
  ./scripts/evals/run_evals.sh --router --backend-url http://pkm-server:8080 --admin-secret "$PKM_ADMIN_SECRET"
  ./scripts/evals/run_evals.sh --calendar --telegram-user-id 1509032341
  ./scripts/evals/run_evals.sh --router --calendar
USAGE
}

run_router=false
run_calendar=false

backend_url=""
admin_secret=""
telegram_user_id=""
case_limit=""
timeout_ms=""
no_observability_check=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --router)
      run_router=true
      shift
      ;;
    --calendar)
      run_calendar=true
      shift
      ;;
    --backend-url)
      backend_url="${2:-}"
      shift 2
      ;;
    --admin-secret)
      admin_secret="${2:-}"
      shift 2
      ;;
    --telegram-user-id)
      telegram_user_id="${2:-}"
      shift 2
      ;;
    --case-limit)
      case_limit="${2:-}"
      shift 2
      ;;
    --timeout)
      timeout_ms="${2:-}"
      shift 2
      ;;
    --no-observability-check)
      no_observability_check=true
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      show_help
      exit 2
      ;;
  esac
done

if [[ "$run_router" == false && "$run_calendar" == false ]]; then
  run_router=true
  run_calendar=true
fi

common_args=()
if [[ -n "$backend_url" ]]; then
  common_args+=(--backend-url "$backend_url")
fi
if [[ -n "$admin_secret" ]]; then
  common_args+=(--admin-secret "$admin_secret")
fi
if [[ -n "$telegram_user_id" ]]; then
  common_args+=(--telegram-user-id "$telegram_user_id")
fi
if [[ -n "$case_limit" ]]; then
  common_args+=(--case-limit "$case_limit")
fi
if [[ -n "$timeout_ms" ]]; then
  common_args+=(--timeout "$timeout_ms")
fi
if [[ "$no_observability_check" == true ]]; then
  common_args+=(--no-observability-check)
fi

run_eval() {
  local target="$1"
  echo "==> Running $target eval"
  local cmd=(npm run "eval:${target}:live")
  if [[ ${#common_args[@]} -gt 0 ]]; then
    cmd+=(--)
    cmd+=("${common_args[@]}")
  fi
  (
    cd "$SERVER_DIR"
    "${cmd[@]}"
  )
}

if [[ "$run_router" == true ]]; then
  run_eval router
fi

if [[ "$run_calendar" == true ]]; then
  run_eval calendar
fi

echo "✅ Eval run(s) completed."
