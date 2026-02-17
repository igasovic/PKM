#!/usr/bin/env bash
set -euo pipefail

# --- config ---
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres}"
PGUSER="${PGUSER:-pgadmin}"

BACKUP_ROOT="${BACKUP_ROOT:-/home/igasovic/backup/postgres}"
NIGHTLY_DIR="$BACKUP_ROOT/nightly"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
MONTHLY_DIR="$BACKUP_ROOT/monthly"
ONEDRIVE_DIR="$BACKUP_ROOT/onedrive"

# n8n OneDrive node simple upload limit is 4MB; keep margin
MAX_UPLOAD_BYTES="${MAX_UPLOAD_BYTES:-3900000}"

HOST="$(hostname -s)"
TS="$(date +'%Y%m%d_%H%M%S')"

usage() {
  echo "Usage: $0 {daily|weekly|monthly}"
  exit 1
}

log(){ echo "[$(date -Is)] $*"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1"; exit 2; }; }

require_cmd docker
require_cmd tar
require_cmd gzip
require_cmd sha256sum
require_cmd flock

MODE="${1:-}"
[[ -z "$MODE" ]] && usage
[[ "$MODE" != "daily" && "$MODE" != "weekly" && "$MODE" != "monthly" ]] && usage

mkdir -p "$NIGHTLY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR" "$ONEDRIVE_DIR"

LOCKFILE="/tmp/pkm_pg_backup.lock"
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  log "Another backup is running; exiting."
  exit 0
fi

dump_globals() {
  local out="$1"
  # globals (roles/grants)
  docker exec -u postgres "$POSTGRES_CONTAINER" sh -lc "pg_dumpall -U '$PGUSER' --globals-only" \
    | gzip -6 > "$out"
}

dump_db_custom() {
  local db="$1"
  local out="$2"
  # custom format with internal compression
  docker exec -u postgres "$POSTGRES_CONTAINER" sh -lc "pg_dump -U '$PGUSER' -d '$db' -Fc -Z 6" > "$out"
}

make_bundle() {
  local label="$1"         # daily|weekly|monthly
  local globals="$2"
  local pkm_dump="$3"
  local n8n_dump="$4"

  local tmpdir; tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN

  cp -a "$globals" "$tmpdir/globals.sql.gz"
  cp -a "$pkm_dump" "$tmpdir/pkm.dump"
  cp -a "$n8n_dump" "$tmpdir/n8n.dump"

  (cd "$tmpdir" && sha256sum globals.sql.gz pkm.dump n8n.dump > SHA256SUMS)

  cat > "$tmpdir/MANIFEST.txt" <<EOF
host=$HOST
created_at=$(date -Is)
label=$label
source_globals=$(basename "$globals")
source_pkm=$(basename "$pkm_dump")
source_n8n=$(basename "$n8n_dump")
EOF

  local out_tmp="$ONEDRIVE_DIR/.pkm_backup_${label}.tgz.tmp"
  local out_final="$ONEDRIVE_DIR/pkm_backup_${label}.tgz"

  tar -C "$tmpdir" -czf "$out_tmp" .

  local sz; sz="$(stat -c%s "$out_tmp")"
  if (( sz > MAX_UPLOAD_BYTES )); then
    rm -f "$out_tmp"
    echo "Bundle too large (${sz} bytes) for OneDrive simple upload. Limit=${MAX_UPLOAD_BYTES}."
    exit 3
  fi

  mv -f "$out_tmp" "$out_final"
  sha256sum "$out_final" > "${out_final}.sha256"
  log "Wrote bundle: $out_final (bytes=$sz)"
}

latest_triplet_from_nightly() {
  # find newest pkm dump and match others by timestamp
  local latest_pkm
  latest_pkm="$(ls -t "$NIGHTLY_DIR"/${HOST}_pkm_*.dump 2>/dev/null | head -n 1 || true)"
  [[ -z "$latest_pkm" ]] && { echo "No nightly pkm dump found"; exit 4; }

  local ts
  ts="$(basename "$latest_pkm" | sed -E "s/^${HOST}_pkm_([0-9_]+)\.dump$/\\1/")"

  local globals="$NIGHTLY_DIR/${HOST}_globals_${ts}.sql.gz"
  local n8n="$NIGHTLY_DIR/${HOST}_n8n_${ts}.dump"

  [[ -f "$globals" ]] || { echo "Missing globals for ts=$ts"; exit 4; }
  [[ -f "$n8n" ]] || { echo "Missing n8n dump for ts=$ts"; exit 4; }

  echo "$globals|$latest_pkm|$n8n|$ts"
}

if [[ "$MODE" == "daily" ]]; then
  umask 077

  globals="$NIGHTLY_DIR/${HOST}_globals_${TS}.sql.gz"
  pkm_dump="$NIGHTLY_DIR/${HOST}_pkm_${TS}.dump"
  n8n_dump="$NIGHTLY_DIR/${HOST}_n8n_${TS}.dump"

  log "Creating nightly dumps…"
  dump_globals "$globals"
  dump_db_custom "pkm" "$pkm_dump"
  dump_db_custom "n8n" "$n8n_dump"

  sha256sum "$globals" > "${globals}.sha256"
  sha256sum "$pkm_dump" > "${pkm_dump}.sha256"
  sha256sum "$n8n_dump" > "${n8n_dump}.sha256"

  # quick sanity: list archive contents (fails if corrupt)
  docker exec -i -u postgres "$POSTGRES_CONTAINER" sh -lc "pg_restore -l >/dev/null" < "$pkm_dump"

  make_bundle "daily" "$globals" "$pkm_dump" "$n8n_dump"
  log "Daily backup done."
  exit 0
fi

# weekly/monthly: promote latest daily set
IFS="|" read -r globals pkm_dump n8n_dump ts <<<"$(latest_triplet_from_nightly)"

if [[ "$MODE" == "weekly" ]]; then
  cp -a "$globals" "$WEEKLY_DIR/${HOST}_globals_${ts}.sql.gz"
  cp -a "$pkm_dump" "$WEEKLY_DIR/${HOST}_pkm_${ts}.dump"
  cp -a "$n8n_dump" "$WEEKLY_DIR/${HOST}_n8n_${ts}.dump"
  make_bundle "weekly" "$globals" "$pkm_dump" "$n8n_dump"
  log "Weekly promotion done."
  exit 0
fi

if [[ "$MODE" == "monthly" ]]; then
  cp -a "$globals" "$MONTHLY_DIR/${HOST}_globals_${ts}.sql.gz"
  cp -a "$pkm_dump" "$MONTHLY_DIR/${HOST}_pkm_${ts}.dump"
  cp -a "$n8n_dump" "$MONTHLY_DIR/${HOST}_n8n_${ts}.dump"
  make_bundle "monthly" "$globals" "$pkm_dump" "$n8n_dump"
  log "Monthly promotion done."
  exit 0
fi
