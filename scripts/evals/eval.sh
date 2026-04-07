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

exec "$RUNNER" "$@"
