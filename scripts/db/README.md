# PKM Postgres Backup Scripts

These scripts create **fast logical backups** (pg_dump) for your PKM stack and produce **three rolling bundles** for off-host upload:

- `pkm_backup_daily.tgz` (latest daily)
- `pkm_backup_weekly.tgz` (latest weekly)
- `pkm_backup_monthly.tgz` (latest monthly)

Local retention keeps history (nightly/weekly/monthly directories). OneDrive keeps only the 3 rolling bundles.

---

## What gets backed up

- Postgres DB: `pkm` (contains schemas like `pkm` + `pkm_test`)
- Postgres DB: `n8n`
- Optional globals file in bundle: `globals.sql.gz` (roles/grants) — restored only if requested

All backups are online (`pg_dump`) and should complete quickly for a small DB.

---

## Directory layout (on host)

Default root:
- `/home/igasovic/backup/postgres`

Created subfolders:
- `nightly/`  - timestamped dumps
- `weekly/`   - promoted snapshots
- `monthly/`  - promoted snapshots
- `onedrive/` - **rolling bundles** uploaded off-host

Rolling bundles live here:
- `/home/igasovic/backup/postgres/onedrive/pkm_backup_daily.tgz`
- `/home/igasovic/backup/postgres/onedrive/pkm_backup_weekly.tgz`
- `/home/igasovic/backup/postgres/onedrive/pkm_backup_monthly.tgz`

---

## Scripts

### `backup.sh`
Creates backups + writes the rolling bundle.

Modes:
- `backup.sh daily`
  - creates new timestamped dumps in `nightly/`
  - writes `onedrive/pkm_backup_daily.tgz`
- `backup.sh weekly`
  - uses the **latest nightly** set and promotes copies into `weekly/`
  - writes `onedrive/pkm_backup_weekly.tgz`
- `backup.sh monthly`
  - uses the **latest nightly** set and promotes copies into `monthly/`
  - writes `onedrive/pkm_backup_monthly.tgz`

Each bundle is created atomically (temp file → rename) to avoid partial uploads.

### `rotate.sh`
Deletes old local backups:
- nightly: keep 14 days
- weekly: keep 8 weeks (~56 days)
- monthly: keep 12 months (~365 days)

### `restore.sh`
Restores from a bundle.

Defaults:
- **Target:** `scratch` (safe)
- **Globals:** not applied unless `--with-globals`

Scratch restore creates new DBs like:
- `pkm_restore_YYYYmmdd_HHMMSS`
- `n8n_restore_YYYYmmdd_HHMMSS`

Prod restore:
- requires `--target prod`
- requires env var `CONFIRM_PROD=YES`

---

## Install

From repo root:
```bash
chmod +x scripts/db/*.sh
git update-index --chmod=+x scripts/db/*.sh
