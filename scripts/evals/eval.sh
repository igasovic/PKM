#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  RESOLVED="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || true)"
  if [[ -n "${RESOLVED:-}" ]]; then
    SCRIPT_PATH="$RESOLVED"
  fi
fi

ROOT="$(cd "$(dirname "$SCRIPT_PATH")/../.." && pwd)"
RUNNER="$ROOT/scripts/evals/run_evals.sh"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing runner: $RUNNER" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  exec "$RUNNER" --help
fi

for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    exec "$RUNNER" "$@"
  fi
done

args=("$@")
has_backend_url=false
has_admin_secret=false

for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    --backend-url)
      has_backend_url=true
      ;;
    --admin-secret)
      has_admin_secret=true
      ;;
  esac
done

if [[ "$has_backend_url" == false ]]; then
  args+=(--backend-url "http://127.0.0.1:3010")
fi

if [[ "$has_admin_secret" == false && -n "${PKM_ADMIN_SECRET:-}" ]]; then
  args+=(--admin-secret "$PKM_ADMIN_SECRET")
fi

exec "$RUNNER" "${args[@]}"
