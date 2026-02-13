# changelog
## 2026-02-11 — Config-driven read defaults

### What changed
- Read queries now take weights, half-life, and note quota directly from config instead of request payloads.
- `/db/read/*` now defaults `days` and `limit` from config when omitted or `0`.
- `/db/read/find` now derives `needle` from `q` internally.
- Updated API docs for read endpoints.
- Persisted test mode in Postgres (`pkm.runtime_config`) and wired config to read it.
- Insert/update/read now respect persisted test mode when choosing the schema.
- Added `/db/test-mode` and `/db/test-mode/toggle` endpoints.
- `/db/*` endpoints now return only `rows` from SQL (no ok/rowCount wrapper).
- Added cached test mode reads (10s TTL) to reduce runtime_config lookups.
- Added Telegram normalization API and extracted quality signals into `src/server/quality.js`.
- Added unified email normalization endpoint (`/normalize/email`) using raw IMAP text/plain input.
- Added email intent detection endpoint (`/normalize/email/intent`) returning `content_type`.
- Added Tier‑1 enrichment endpoint (`/enrich/t1`) backed by OpenAI.
- Added restart-safe Tier‑1 batch enqueue API (`/enrich/t1/batch`) with Postgres persistence and backend-owned OpenAI re-sync worker.
- Added normalization-side idempotency key output for Telegram/Email using structured `source` payloads.
- Added policy-driven idempotent `/db/insert` handling with conflict actions `skip`/`update` and result actions `inserted|skipped|updated`.
- Added recursive JSON metadata merge behavior for idempotent `update` conflicts.
- Hardened ingest to fail closed: normalization throws if idempotency keys cannot be derived, and `/db/insert` rejects `email`/`telegram` rows without idempotency fields.
- Normalize APIs now infer source system by endpoint (`/normalize/email` vs `/normalize/telegram`), so callers do not need to pass `source.system`.
- `/normalize/email` no longer expects input `participants`; correspondence idempotency no longer uses participants in key evaluation.
- `/normalize/telegram` no longer expects input `url`; URL is extracted and canonicalized from message text during normalization.
- `/normalize/email` now treats top-level `from` and `subject` as the canonical inputs for those fields (no fallback from `source.from_addr`/`source.subject`).
- Fixed schema resolution drift in reads: `/db/read/last` and `/db/read/pull` now honor persisted test mode just like other DB methods.
- Moved test mode caching/logic into `src/server/test-mode.js` and removed it from config.
- `/config` now returns only static config (no test mode state).
- Moved shared libs to `src/libs` and updated server Dockerfile copy path.

## 2026-02-10 — Backend config module + API endpoint

### What changed
- Added a shared retrieval config module in `js/workflows/pkm-retrieval-config/config_v1.js`.
- Added `src/libs/config.js` so backend code can read config via a single import.
- Added `GET /config` endpoint to return the config as JSON.
- Updated API docs for the new config endpoint.

## 2026-02-08 — SQL builders, prompt builders, and Pi-ready server

### What changed
- Centralized SQL `INSERT` and `UPDATE` construction in `js/libs/sql-builder.js` and refactored workflow builders to use them.
- Added snapshot-style tests for SQL insert/update/read builders in `test/`.
- Added `js/libs/prompt-builder.js` and refactored Tier‑1 prompt creation nodes (sample + whole) to use it.
- Added a minimal Node.js backend in `src/server/` with a Pi-friendly Dockerfile, plus basic server tests.
- Added Braintrust observability hooks for server errors (config via env).
- Enforced Braintrust initialization at startup (service fails fast if missing config or init fails).
- Added Postgres DB module + HTTP endpoints for insert/update/read (last/find/continue/pull) with Braintrust tracing.
- Added `/docs/api.md` describing the backend API for external systems.
- Updated server Dockerfile to copy project sources instead of individual files.
- Updated server image build to include `js/libs/sql-builder.js` from the repo without duplicating files (requires repo-root build context).
- Replaced Telegram-specific insert mapping with a generic insert that accepts any `pkm.entries` columns and sanitizes server-side.
- Added support for client-specified `RETURNING` columns on `/db/insert` requests.
- API responses now flatten the first row into the top-level JSON (no `rows` or `data` wrapper).
- Added generic `/db/update` input handling with server-side validation/sanitization and optional `returning`.
- Added JSONB validation for `metadata`/`external_ref` inputs (accept objects or valid JSON strings).

## 2026-02-01 — Tier‑1 enrichment subworkflow + Telegram message enrichment

### What changed
- Extracted the Tier‑1 newsletter enrichment chain out of `e-mail-capture` into a dedicated subworkflow: `workflows/tier-1-enhancement__WFB4SDkDPDPIphppIn3l7.json`.
- Updated both `e-mail-capture` and `telegram-capture` workflows to call **Tier‑1 Enhancement** (Execute Workflow) on the newsletter path instead of duplicating nodes.
- Externalized Tier‑1 JS modules into `js/workflows/tier-1-enhancement/` and updated subworkflow Code-node wrappers to load them from the new path.
- Ensured callers keep using the config subworkflow named exactly **PKM Config**.

### Fixes / gotchas discovered
- n8n can keep running “old” external JS after file updates; a container restart (`docker compose restart n8n`) resolved mismatches between repo code and executed SQL.
- Telegram Capture: updated the runtime message builder (`js/workflows/telegram-capture/05_create-message__e7474a77-f17b-4f8f-bbe1-632804bd2e69.js`) to include `gist`, topic path (`topic_primary → topic_secondary`), and to compute message length from `clean_text`.
- Cleaned up Git sync between Mac ↔ Pi (avoid committing `versionCounter`-only workflow diffs; reset Pi to `origin/main` when needed).


## 2026-01-30 — Pi SD → SSD migration (with SD rollback)

### What we achieved
- Migrated Raspberry Pi OS + full Docker stack from SD card (`mmcblk0`) to SSD (`/dev/sda`) while keeping the SD card untouched for rollback.
- Verified services on SSD: Postgres, n8n, Home Assistant, cloudflared.
- Verified n8n external JS mount works inside container (`/data/js/workflows`).
- Verified Cloudflare tunnel routes to n8n and HA.

### Backups (stored on Mac)
- Postgres logical dump: `postgres_dumpall.sql.gz` (covers `n8n` + `pkm`, including n8n credentials such as Telegram).
- Filesystem bundle: `pi_backup_bundle.tgz` (stack, repo, SSH keys).

Mac copy commands used:
- `scp igasovic@192.168.5.4:/home/igasovic/backup/postgres_dumpall.sql.gz ~/pi-ssd-migration/backup/`
- `scp igasovic@192.168.5.4:/home/igasovic/backup/pi_backup_bundle.tgz    ~/pi-ssd-migration/backup/`

### Migration summary
- Identified disks:
  - SD: `mmcblk0` (boot: `mmcblk0p1`, root: `mmcblk0p2`)
  - SSD: `sda` (CT240BX500SSD1)
- Cloned SD → SSD:
  - SSD partitions created:
    - `/dev/sda1` (FAT32 boot)
    - `/dev/sda2` (EXT4 root)
  - Copied root and boot partitions to SSD.
  - Boot-tested with SD removed.
- Fixed post-boot issues on SSD:
  - Root initially mounted read-only (`ro`) and `/etc/fstab` was empty.
  - Remounted root RW.
  - Mounted `/dev/sda1` at `/boot/firmware`.
  - Rebuilt `/etc/fstab` using SSD PARTUUIDs and verified persistence after reboot.

SSD PARTUUIDs used:
- `/dev/sda1` PARTUUID: `22c916e3-aea2-4920-9080-ba0e5f51412d`
- `/dev/sda2` PARTUUID: `7cc91410-0a0e-43c7-a27b-f739c21dec3f`

Final verification commands (passed):
- `findmnt / -o SOURCE,FSTYPE,OPTIONS` → `/dev/sda2` mounted `rw`
- `findmnt /boot/firmware -o SOURCE,FSTYPE,OPTIONS` → `/dev/sda1` mounted `rw`
- `docker compose ps` → all services `Up`
- Postgres DBs present: `n8n`, `pkm`
- n8n JS mount present: `/data/js/workflows/*`
- `https://n8n.gasovic.com` → `302` to Cloudflare Access login (expected)
- `https://ha.gasovic.com` → `405` for HEAD; use GET to validate
## 2026-01-31 — Matter support (Home Assistant Container)

### What was added
- Enabled Matter support for Home Assistant running as a Docker container (not HA OS).
- Added `matter-server` as a dedicated container (`python-matter-server`) to the Docker stack.
- Configured Matter Server to run with `network_mode: host` for reliable mDNS/Thread discovery on Raspberry Pi 4.
- Connected Home Assistant to Matter Server via WebSocket endpoint.

### Key configuration details
- Matter Server UI: `http://192.168.5.4:5580`
- Matter Server WebSocket: `ws://192.168.5.4:5580/ws`
- Home Assistant Matter integration configured to use the above WebSocket URL (not `localhost`).

### Operational notes
- Devices are paired via Home Assistant, not directly in the Matter Server UI.
- Matter Server acts as a backend service only.
- Eero 6 provides Thread Border Router functionality implicitly; it is not added to Home Assistant or Matter.
- Compatible with existing SSD-booted Pi and Docker-based stack.

## 2026-01-31 — PKM test mode & schema isolation

### What was added
- Introduced **schema-level test/production isolation** in Postgres:
  - Production: `pkm.entries`
  - Test: `pkm_test.entries`
- Added `PKM Config` sub-workflow as the **single source of truth** for runtime configuration.
- All workflows now invoke `PKM Config` at startup.
- All SQL and JS builders read configuration **exclusively** from `PKM Config` output.
- Implemented global **test mode** toggle (no parallel deployments required).
- Added visible **⚗️🧪 TEST MODE** banner to Telegram and email responses when active.

### Safety guarantees
- Test data is physically separated from production data.
- Test runs can be wiped safely using:
  ```sql
  TRUNCATE TABLE pkm_test.entries RESTART IDENTITY;
  ```
- No reliance on global mutable state (Data Tables, static data, env vars).

### Developer impact
- Builders fail fast if `PKM Config` is missing.
- Configuration flow is explicit, deterministic, and auditable.
