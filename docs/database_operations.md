# Database Operations

## Purpose
- define the operator-facing Postgres backup and restore workflow for this repo
- keep operational runbook material separate from the schema contract

## Authoritative For
- backup and restore policy described in-repo
- on-disk backup layout and restore expectations

## Not Authoritative For
- schema/table contracts; use `docs/database_schema.md`
- config apply flow; use `docs/config_operations.md`

## Related Docs
- `docs/database_schema.md`
- `docs/env.md`
- `docs/config_operations.md`

## Read When
- changing backup/restore workflow or operational DB runbooks
- reviewing backup, restore, or retention expectations

## Update When
- backup cadence, retention, storage layout, or restore semantics change

## Backups (Operational Reference)

This project uses **logical Postgres backups** (`pg_dump` custom format) because the DB is still small and we want **fast, low-risk** operations with easy restore.

### Policy and frequency

**Local backups (cron on host)**
- **Daily**: 02:10 local time — creates fresh dumps for `pkm` and `n8n` and builds the rolling “daily” bundle.
- **Weekly**: Sunday 02:20 — promotes the most recent nightly dumps and builds the rolling “weekly” bundle.
- **Monthly**: 1st of month 02:25 — promotes the most recent nightly dumps and builds the rolling “monthly” bundle.
- **Rotation**: 02:35 — prunes old local history.

**Retention (local disk)**
- Nightly: keep **14 days**
- Weekly: keep **8 weeks**
- Monthly: keep **12 months**

Notes:
- Backups are **logical only** (no WAL archiving).
- Backups run outside peak hours to reduce chances of ingestion/maintenance operations failing.

### On-disk locations

Backups live on the host under:

- Root: `/home/igasovic/backup/postgres`
- Timestamped history:
  - `nightly/` — fresh daily dumps
  - `weekly/` — weekly promoted copies
  - `monthly/` — monthly promoted copies
- Rolling bundles for off-site upload (overwritten each run):
  - `/home/igasovic/backup/postgres/uploads/pkm_backup_daily.tgz`
  - `/home/igasovic/backup/postgres/uploads/pkm_backup_weekly.tgz`
  - `/home/igasovic/backup/postgres/uploads/pkm_backup_monthly.tgz`

Each bundle contains:
- `pkm.dump` (custom-format `pg_dump`)
- `n8n.dump`
- `globals.sql.gz` (roles/grants; optional to apply during restore)
- `SHA256SUMS` (integrity)
- `MANIFEST.txt` (metadata)

Scripts are versioned in the repo:
- `/home/igasovic/repos/n8n-workflows/scripts/db/backup.sh`
- `/home/igasovic/repos/n8n-workflows/scripts/db/rotate.sh`
- `/home/igasovic/repos/n8n-workflows/scripts/db/restore.sh`

### Off-site backup (n8n → Google Drive)

Off-site copies are pushed by n8n to Google Drive and intentionally kept to **only 3 files** (latest daily/weekly/monthly).

**How it works**
- n8n reads the rolling bundle files from disk (mounted into the n8n container under the allowed path):
  - `/home/node/.n8n-files/backup-postgres/uploads/pkm_backup_daily.tgz`
  - `/home/node/.n8n-files/backup-postgres/uploads/pkm_backup_weekly.tgz`
  - `/home/node/.n8n-files/backup-postgres/uploads/pkm_backup_monthly.tgz`
- Workflow schedule: **04:00** daily
  - Always uploads **daily**
  - Uploads **weekly** only on Sunday
  - Uploads **monthly** only on the 1st
- Overwrite policy: if a file with the same name exists in the target folder, n8n deletes it and uploads the new one (ensures exactly 3 files).

### Monitoring and alerting

- Cron jobs report status to n8n via local webhooks.
- On failure, n8n sends a Telegram alert.
- A daily **09:00** Telegram summary reports the latest status for: daily/weekly/monthly/rotation.

### Restore

- Preferred: restore into **scratch DBs** first (safe), then promote to prod only if needed.
- `restore.sh` supports:
  - `--target scratch` (default): restores into `pkm_restore_YYYYmmdd_HHMMSS` and `n8n_restore_YYYYmmdd_HHMMSS`
  - `--target prod`: requires `CONFIRM_PROD=YES` to prevent accidents
- Integrity: bundles include `SHA256SUMS`; restore verifies checksums when present.

