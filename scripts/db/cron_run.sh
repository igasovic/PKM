#!/usr/bin/env bash
set -euo pipefail

JOB="${1:?job name required}"
shift

WEBHOOK_FAIL_URL="${WEBHOOK_FAIL_URL:?set WEBHOOK_FAIL_URL (cron)}"
WEBHOOK_OK_URL="${WEBHOOK_OK_URL:-}"  # optional

HOST="$(hostname -s)"
TS="$(date -Is)"

set +e
"$@"
RC=$?
set -e

payload() {
  # keep it simple and JSON-safe-ish
  local cmd
  cmd="$(printf "%q " "$@")"
  printf '{"job":"%s","host":"%s","ts":"%s","rc":%d,"cmd":"%s"}' \
    "$JOB" "$HOST" "$TS" "$RC" "$cmd"
}

if [[ $RC -eq 0 ]]; then
  if [[ -n "$WEBHOOK_OK_URL" ]]; then
    curl -fsS --max-time 10 -X POST "$WEBHOOK_OK_URL" \
      -H "Content-Type: application/json" \
      -d "$(payload "$@")" >/dev/null || true
  fi
  exit 0
else
  curl -fsS --max-time 10 -X POST "$WEBHOOK_FAIL_URL" \
    -H "Content-Type: application/json" \
    -d "$(payload "$@")" >/dev/null || true
  exit $RC
fi
