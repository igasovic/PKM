#!/usr/bin/env bash
set -euo pipefail

JOB="${1:?job name required}"
shift

# Set these in cron (recommended) or hardcode them here
WEBHOOK_OK_URL="${WEBHOOK_OK_URL:?set WEBHOOK_OK_URL}"
WEBHOOK_FAIL_URL="${WEBHOOK_FAIL_URL:?set WEBHOOK_FAIL_URL}"

HOST="$(hostname -s)"
TS="$(date -Is)"

# run command, capture rc without exiting early
set +e
"$@"
RC=$?
set -e

payload() {
  printf '{"job":"%s","host":"%s","ts":"%s","rc":%d,"cmd":"%s"}' \
    "$JOB" "$HOST" "$TS" "$RC" "$*"
}

if [[ $RC -eq 0 ]]; then
  curl -fsS --max-time 10 -X POST "$WEBHOOK_OK_URL" \
    -H "Content-Type: application/json" \
    -d "$(payload "$@")" >/dev/null || true
  exit 0
else
  curl -fsS --max-time 10 -X POST "$WEBHOOK_FAIL_URL" \
    -H "Content-Type: application/json" \
    -d "$(payload "$@")" >/dev/null || true
  exit $RC
fi
