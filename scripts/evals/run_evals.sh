#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT/src/server"
STACK_ENV_FILE_DEFAULT="/home/igasovic/stack/.env"

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

# Load PKM_ADMIN_SECRET from Pi stack .env only when caller did not pass secret.
if [[ -z "$admin_secret" && -z "${PKM_ADMIN_SECRET:-}" && -f "$STACK_ENV_FILE_DEFAULT" ]]; then
  loaded_secret="$(
    sed -n 's/^[[:space:]]*PKM_ADMIN_SECRET[[:space:]]*=[[:space:]]*//p' "$STACK_ENV_FILE_DEFAULT" \
      | head -n 1
  )"
  loaded_secret="${loaded_secret%\"}"
  loaded_secret="${loaded_secret#\"}"
  loaded_secret="${loaded_secret%\'}"
  loaded_secret="${loaded_secret#\'}"
  if [[ -n "$loaded_secret" ]]; then
    admin_secret="$loaded_secret"
  fi
fi

common_args=()
if [[ -n "$backend_url" ]]; then
  common_args+=(--backend-url "$backend_url")
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
  local -a env_cmd=()
  if [[ -n "$admin_secret" ]]; then
    env_cmd=(env "PKM_ADMIN_SECRET=$admin_secret")
  fi
  if command -v npm >/dev/null 2>&1; then
    local cmd=(npm run "eval:${target}:live")
    if [[ ${#common_args[@]} -gt 0 ]]; then
      cmd+=(--)
      cmd+=("${common_args[@]}")
    fi
    (
      cd "$SERVER_DIR"
      if [[ ${#env_cmd[@]} -gt 0 ]]; then
        "${env_cmd[@]}" "${cmd[@]}"
      else
        "${cmd[@]}"
      fi
    )
    return
  fi

  if command -v node >/dev/null 2>&1; then
    local script_path
    if [[ "$target" == "router" ]]; then
      script_path="$ROOT/scripts/evals/run_router_live.js"
    else
      script_path="$ROOT/scripts/evals/run_calendar_live.js"
    fi
    local cmd=(node "$script_path")
    if [[ ${#common_args[@]} -gt 0 ]]; then
      cmd+=("${common_args[@]}")
    fi
    if [[ ${#env_cmd[@]} -gt 0 ]]; then
      "${env_cmd[@]}" "${cmd[@]}"
    else
      "${cmd[@]}"
    fi
    return
  fi

  echo "ERROR: Neither 'npm' nor 'node' is available in PATH." >&2
  echo "Install Node.js on the Pi or run evals from an environment that has node/npm." >&2
  exit 127
}

if [[ "$run_router" == true ]]; then
  run_eval router
fi

if [[ "$run_calendar" == true ]]; then
  run_eval calendar
fi

echo "✅ Eval run(s) completed."
