#!/usr/bin/env bash
set -euo pipefail

# Drop-in restore script for PKM stack backups
# Bundle format (tgz):
#   globals.sql.gz
#   pkm.dump
#   n8n.dump
#   SHA256SUMS          (optional but recommended)
#   MANIFEST.txt        (optional)

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres}"
PGUSER="${PGUSER:-pgadmin}"

BACKUP_ROOT="${BACKUP_ROOT:-/home/igasovic/backup/postgres}"
ONEDRIVE_DIR="${ONEDRIVE_DIR:-$BACKUP_ROOT/onedrive}"

TARGET="scratch"          # scratch|prod
WITH_GLOBALS="no"         # yes|no
LABEL=""                  # daily|weekly|monthly
BUNDLE=""                 # explicit path
SCRATCH_SUFFIX="$(date +'%Y%m%d_%H%M%S')"

usage() {
  cat <<EOF
Usage:
  $0 --bundle /path/to/pkm_backup_daily.tgz [--target scratch|prod] [--with-globals]
  $0 --label daily|weekly|monthly            [--target scratch|prod] [--with-globals]

Defaults:
  --target scratch
  --with-globals disabled (safe)

Prod restore safety:
  Requires CONFIRM_PROD=YES in env if --target prod.

Examples:
  # Restore daily bundle into new scratch DBs:
  $0 --label daily

  # Restore explicit bundle into scratch:
  $0 --bundle /tmp/pkm_backup_weekly.tgz

  # Restore into prod (dangerous; requires confirm):
  CONFIRM_PROD=YES $0 --label monthly --target prod

  # Restore + apply roles/grants (usually only needed on a fresh cluster):
  $0 --label daily --with-globals
EOF
  exit 1
}

log(){ echo "[$(date -Is)] $*"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1"; exit 2; }; }

require_cmd docker
require_cmd tar
require_cmd gzip
require_cmd sha256sum
require_cmd mktemp

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE="${2:-}"; shift 2;;
    --label)  LABEL="${2:-}"; shift 2;;
    --target) TARGET="${2:-}"; shift 2;;
    --with-globals) WITH_GLOBALS="yes"; shift 1;;
    -h|--help) usage;;
    *) echo "Unknown arg: $1"; usage;;
  esac
done

if [[ -n "$LABEL" && -n "$BUNDLE" ]]; then
  echo "Choose one: --label OR --bundle"
  exit 1
fi

if [[ -z "$BUNDLE" ]]; then
  [[ -n "$LABEL" ]] || usage
  [[ "$LABEL" == "daily" || "$LABEL" == "weekly" || "$LABEL" == "monthly" ]] || {
    echo "Invalid --label: $LABEL"; exit 1;
  }
  BUNDLE="$ONEDRIVE_DIR/pkm_backup_${LABEL}.tgz"
fi

[[ -f "$BUNDLE" ]] || { echo "Bundle not found: $BUNDLE"; exit 2; }

if [[ "$TARGET" != "scratch" && "$TARGET" != "prod" ]]; then
  echo "Invalid --target: $TARGET (must be scratch|prod)"
  exit 1
fi

if [[ "$TARGET" == "prod" ]]; then
  [[ "${CONFIRM_PROD:-}" == "YES" ]] || {
    echo "Refusing prod restore. Set CONFIRM_PROD=YES to proceed."
    exit 3
  }
fi

# --- extract bundle ---
TMPDIR="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

log "Extracting bundle: $BUNDLE"
tar -C "$TMPDIR" -xzf "$BUNDLE"

# Validate required files
for f in "pkm.dump" "n8n.dump"; do
  [[ -f "$TMPDIR/$f" ]] || { echo "Missing $f in bundle"; exit 4; }
done

# Optional integrity check
if [[ -f "$TMPDIR/SHA256SUMS" ]]; then
  log "Verifying SHA256SUMS"
  (cd "$TMPDIR" && sha256sum -c SHA256SUMS)
else
  log "No SHA256SUMS found; skipping checksum verification"
fi

# Optional: print manifest
if [[ -f "$TMPDIR/MANIFEST.txt" ]]; then
  log "MANIFEST:"
  sed 's/^/  /' "$TMPDIR/MANIFEST.txt" || true
fi

# --- helpers ---
exec_psql() {
  # usage: exec_psql "SQL..."
  docker exec -u postgres "$POSTGRES_CONTAINER" sh -lc \
    "psql -U '$PGUSER' -d postgres -v ON_ERROR_STOP=1 -c \"$1\""
}

terminate_db_connections() {
  local db="$1"
  exec_psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db}' AND pid <> pg_backend_pid();"
}

create_db() {
  local db="$1"
  docker exec -u postgres "$POSTGRES_CONTAINER" sh -lc \
    "createdb -U '$PGUSER' '$db'"
}

drop_db_if_exists() {
  local db="$1"
  docker exec -u postgres "$POSTGRES_CONTAINER" sh -lc \
    "dropdb -U '$PGUSER' --if-exists '$db'"
}

restore_into_db() {
  local db="$1"
  local dumpfile="$2"
  # pg_restore reads custom-format dumps
  cat "$dumpfile" | docker exec -i -u postgres "$POSTGRES_CONTAINER" sh -lc \
    "pg_restore -U '$PGUSER' -d '$db' --clean --if-exists -v"
}

apply_globals_if_requested() {
  [[ "$WITH_GLOBALS" == "yes" ]] || return 0
  [[ -f "$TMPDIR/globals.sql.gz" ]] || { echo "Missing globals.sql.gz (required for --with-globals)"; exit 4; }

  log "Applying globals (roles/grants) from globals.sql.gz"
  gunzip -c "$TMPDIR/globals.sql.gz" | docker exec -i -u postgres "$POSTGRES_CONTAINER" sh -lc \
    "psql -U '$PGUSER' -d postgres -v ON_ERROR_STOP=1"
}

# --- restore plan ---
apply_globals_if_requested

if [[ "$TARGET" == "scratch" ]]; then
  PKM_DB="pkm_restore_${SCRATCH_SUFFIX}"
  N8N_DB="n8n_restore_${SCRATCH_SUFFIX}"

  log "Restoring into SCRATCH DBs:"
  log "  $PKM_DB"
  log "  $N8N_DB"

  create_db "$PKM_DB"
  create_db "$N8N_DB"

  log "Restoring pkm.dump -> $PKM_DB"
  restore_into_db "$PKM_DB" "$TMPDIR/pkm.dump"

  log "Restoring n8n.dump -> $N8N_DB"
  restore_into_db "$N8N_DB" "$TMPDIR/n8n.dump"

  log "Done."
  echo "Scratch restore complete:"
  echo "  pkm: $PKM_DB"
  echo "  n8n: $N8N_DB"
  exit 0
fi

# TARGET == prod
log "Restoring into PROD DBs: pkm, n8n"

log "Terminating active connections to pkm and n8n"
terminate_db_connections "pkm" || true
terminate_db_connections "n8n" || true

log "Restoring pkm.dump -> pkm"
restore_into_db "pkm" "$TMPDIR/pkm.dump"

log "Restoring n8n.dump -> n8n"
restore_into_db "n8n" "$TMPDIR/n8n.dump"

log "Prod restore complete."
