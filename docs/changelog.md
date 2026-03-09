# changelog
## 2026-03-09 — Read context-pack Tier-2 summary + why-it-matters integration

### What changed
- Updated shared context-pack content selection priority in `src/libs/context-pack-builder.js`:
  - now prefers `distill_summary` before `gist` / `retrieval_excerpt` / raw text fallbacks.
- Updated shared context-pack rendering to include `distill_why_it_matters` for top-ranked rows:
  - includes `why_it_matters` on roughly the first quarter of hit rows (25% target) when present.
- Extended read SQL projections (`/db/read/continue`, `/db/read/find`, `/db/read/last`, `/db/read/pull`) to include `distill_summary` in row payloads.
- Extended read SQL projections (`/db/read/continue`, `/db/read/find`, `/db/read/last`, `/db/read/pull`) to include `distill_why_it_matters` in row payloads.
- Added server-side tests for context-pack priority behavior:
  - `test/server/context-pack-builder.test.js`
  - includes UI + Telegram layout checks for top-ranked `why_it_matters` inclusion behavior
- Added server-side SQL projection tests for read endpoints:
  - `test/server/read-sql-distill-projection.test.js`
- Updated `docs/api.md` read section to document `distill_summary` / `distill_why_it_matters` hit-row fields.
- Updated requirements + PRD contracts to document summary-first retrieval and early-row `why_it_matters` inclusion.

## 2026-03-09 — Tier-2 boolean option parsing hardening

### What changed
- Hardened Tier‑2 option parsing for plan/run flows to accept boolean-like string values consistently:
  - `dry_run`
  - `persist_eligibility`
  - `include_details`
- Added tests covering string boolean behavior:
  - `test/server/tier2.enrichment.test.js`
  - `test/server/tier2.planner.test.js`

## 2026-03-09 — Tier-2 run busy-response normalization

### What changed
- Normalized `/distill/run` busy-overlap response shape:
  - returns `mode = "skipped"` with `reason = "worker_busy"` and a user-facing `message`.
- Updated `Format Distill Run Message` node logic to render a dedicated Telegram message for worker-busy skips.
- Updated `docs/api.md` to document the worker-busy response variant for `POST /distill/run`.
- Updated `docs/api.md` to clarify that non-busy `/distill/run` responses include `batch_id` for status lookup.

## 2026-03-09 — Tier-2 batch retry policy + LLM metadata enrichment

### What changed
- Tier‑2 batch execution (`POST /distill/run`) now applies config-driven retry decisions for per-entry failures:
  - reads retry settings from `distill.retry.*`
  - evaluates retryable/non-retryable error codes and max attempts
  - retries only when policy allows; otherwise marks terminal failure for the entry
- Tier‑2 sync service now accepts optional retry context from the batch runner and persists `distill_metadata.retry_count` for both success and failure writes.
- Added lightweight Tier‑2 retry transition logging steps in pipeline events:
  - `t2.batch.retry.evaluate`
  - `t2.batch.retry.dispatch`
- Enriched Tier‑2 LiteLLM telemetry metadata by forwarding distillation context (stage/route/substage/entry/chunk metadata) into `litellm-client` logs.
- Expanded Tier‑2 batch runner tests to cover:
  - retryable failure -> retry -> success
  - non-retryable failure -> no retry
  - max-attempts stop condition

## 2026-03-09 — Read workflow status command wiring (n8n)

### What changed
- Updated `src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js`:
  - fixed `/status` parsing so it no longer falls through to query-required command handling
  - added optional stage argument: `/status [t1|t2]`
  - added optional flags: `--limit M`, `--active-only`
  - added `/distill <entry_id>` command parsing for Tier‑2 sync trigger
  - added `/distill-run` parsing (supports `--dry-run`, `--candidate-limit`, `--max-sync-items`, `--no-persist-eligibility`)
- Updated Read workflow status request node:
  - switched from `GET /status/t1/batch` to generic `GET /status/batch`
  - request now passes stage/limit/include-terminal from parsed command fields
- Added Tier‑2 sync branch in Read workflow:
  - `PKM Distill Sync` HTTP node calls `POST /distill/sync` (admin header required)
  - `Format Distill Message` node returns success/failure Telegram output
- Added Tier‑2 run branch in Read workflow:
  - `PKM Distill Run` HTTP node calls `POST /distill/run` (admin header required)
  - `Format Distill Run Message` node returns run/dry-run summary in Telegram output
- Updated status message label from `T1 Batch summary` to generic `Batch summary`.
- Fixed Tier‑2 telegram formatter rendering:
  - moved distill formatter code nodes to externalized files under `src/n8n/nodes/10-read/`
  - replaced broken inline escaped JS strings with thin wrapper imports in workflow JSON
- Improved `/distill/sync` failure response payload with `message` for generation failures (in addition to `error_code`).

## 2026-03-08 — Tier-2 foundation: sync distillation endpoint + control-plane utilities

### What changed
- Added Tier‑2 backend modules under `src/server/tier2/`:
  - control-plane eligibility/scoring/budget/route utilities
  - deterministic chunking
  - prompt builders
  - parsing + validation contract helpers
  - sync distillation service
- Added Tier‑2 sync API endpoint:
  - `POST /distill/sync` (admin-protected)
- Added Tier‑2 control-plane planning API endpoint:
  - `POST /distill/plan` (admin-protected)
- Added Tier‑2 batch-run API endpoint:
  - `POST /distill/run` (admin-protected)
- Extended DB/API runtime support for Tier‑2 fields:
  - added Tier‑2 columns to backend insert/update type map
  - added DB helpers for Tier‑2 candidate/detail reads, schema override routing, eligibility persistence, and sync persistence
  - added Tier‑2 SQL builders in `src/libs/sql-builder.js` for candidate selection and eligibility state writes
- Added optional Tier‑2 background batch worker controls (`T2_BATCH_WORKER_*`) and worker lifecycle wiring in backend startup/shutdown.
- Extracted shared worker loop runtime in backend and migrated both Tier‑1 and Tier‑2 workers to use it (common timer, busy-guard, and error handling behavior).
- Refactored batch status API to be stage-generic:
  - new canonical endpoints:
    - `GET /status/batch?stage=t1|t2`
    - `GET /status/batch/:batch_id?stage=t1|t2`
  - legacy Tier‑1 aliases remain available:
    - `GET /status/t1/batch`
    - `GET /status/t1/batch/:batch_id`
  - n8n migration note: switch status reads to `/status/batch` and pass explicit `stage` query param.
- Internal backend refactor:
  - added stage registry + batch status service modules
  - moved stage routing logic out of `index.js` handlers
  - no API contract change from the previous generic status endpoint rollout
- Added Tier‑2 stale-detection maintenance cycle in backend startup:
  - marks `distill_status = stale` for outdated completed artifacts in `pkm.entries`
  - controlled by `T2_STALE_MARK_ENABLED` and `T2_STALE_MARK_INTERVAL_MS`
- Expanded shared config with `distill.*` keys and Tier‑2 model/retry settings.
- Added Jest coverage for Tier‑2 control-plane, chunking, and validation modules.
- Updated docs:
  - `docs/api.md`
  - `docs/database_schema.md`
  - `docs/env.md`
  - `docs/requirements.md`

## 2026-03-06 — Script sunset + Git->n8n operator doc

### What changed
- Archived obsolete n8n scripts to `scripts/archive/n8n/`:
  - `activate_workflows.sh`
  - `import_workflows.sh`
  - `repair_legacy_bridges.py`
- Updated `docs/n8n_sync.md`:
  - integrated operator-focused Git->n8n runbook sections
  - updated active vs archived script lists

## 2026-03-06 — Bridge dependency cutover (safe remove path)

### What changed
- Removed bridge creation from sync flow:
  - `scripts/n8n/sync_code_nodes.py` no longer emits legacy bridge files in `js/workflows`.
- Hardened push validation:
  - `scripts/n8n/sync_nodes.py` now forbids legacy wrapper paths (`/data/js/workflows/...`) by default.
- Added repo/live validation in orchestrator:
  - `scripts/n8n/sync_workflows.sh` now validates:
    - repo workflows contain no legacy wrapper paths
    - canonical wrapper targets exist
    - live n8n workflows (post-push) contain no legacy wrapper paths
- Added safe cutover orchestration:
  - `scripts/n8n/cutover_remove_bridges.sh`
    - runs existing backup script (`scripts/db/backup.sh`)
    - snapshots live workflows before cutover
    - runs full sync + recreate
    - removes local legacy bridge files
    - validates no legacy wrapper references remain
- Added local bridge cleanup helper:
  - `scripts/n8n/remove_legacy_bridges.py`
- Updated docs:
  - `docs/n8n_sync.md`

## 2026-03-06 — Canonical n8n paths under src/n8n with legacy bridge compatibility

### What changed
- Migrated canonical n8n assets to:
  - `src/n8n/workflows` (workflow JSON)
  - `src/n8n/nodes` (externalized code nodes)
- Updated workflow wrapper paths to canonical mount path:
  - `/data/src/n8n/nodes/...`
- Kept legacy compatibility paths under `js/workflows` for existing/stale wrappers.
- Updated sync scripts defaults and behavior:
  - `scripts/n8n/export_workflows.sh` now defaults to `src/n8n/workflows`
  - `scripts/n8n/normalize_workflows.sh` and `rename_workflows_by_name.sh` default to `src/n8n/workflows`
  - `scripts/n8n/sync_workflows.sh` now syncs canonical `src/n8n/*` paths and keeps legacy root for bridges
  - `scripts/n8n/sync_code_nodes.py` now writes canonical nodes to `src/n8n/nodes`, emits canonical wrappers, and can read legacy wrapper sources from `js/workflows`
  - `scripts/n8n/sync_nodes.py` now defaults to canonical `src/n8n/*` paths with optional legacy wrapper validation root
- Updated docs:
  - `docs/n8n_sync.md`
- Consolidated to a single entrypoint script:
  - kept `scripts/n8n/sync_workflows.sh`
  - removed `scripts/n8n/sync_nodes.sh`
  - added `--mode pull|push|full` to `sync_workflows.sh`

## 2026-03-05 — n8n in-place node sync via API patch

### What changed
- Added `scripts/n8n/sync_nodes.sh` + `scripts/n8n/sync_nodes.py`.
- New flow patches existing workflows by name using n8n API (`PATCH /api/v1/workflows/:id`) instead of delete/import.
- Script preserves workflow IDs/history by default and restores active state for workflows that were active before patch.
- Added wrapper-target validation before patching:
  - if a code wrapper points to `/data/js/workflows/...` and target file is missing in repo, sync aborts early.
- Supports targeted patching:
  - `./scripts/n8n/sync_nodes.sh --workflow-name "<name>"`
- Updated docs:
  - `docs/n8n_sync.md`

## 2026-03-01 — n8n workflow sync orchestration under scripts/n8n

### What changed
- Added canonical one-command sync flow:
  - `./scripts/n8n/sync_workflows.sh`
  - optional `--commit` to commit `workflows/` + `js/workflows/`
- Added `scripts/n8n/` workflow-management scripts:
  - `export_workflows.sh`
  - `normalize_workflows.sh`
  - `rename_workflows_by_name.sh`
  - `import_workflows.sh`
  - `activate_workflows.sh`
  - `sync_code_nodes.py`
  - `sync_workflows.sh`
- Updated node sync behavior:
  - externalize only Code nodes with `>= 50` non-empty JS lines (`MIN_JS_LINES` override)
  - keep short Code nodes inline
  - move JS files to correct workflow folders when nodes moved
  - update wrapper paths to `/data/js/workflows/...`
  - remove orphan files from `js/workflows/` after processing all workflows
- Added compose guard in orchestrator:
  - script stops if n8n mount `/home/igasovic/repos/n8n-workflows:/data:ro` is not present in `docker-compose.yml`
- Removed top-level wrapper scripts:
  - `scripts/export_workflows.sh`
  - `scripts/normalize_workflows.sh`
  - `scripts/rename_workflows_by_name.sh`
- Made workflow activation mandatory in orchestrator after n8n restart and before optional commit.
- Added optional targeted recreate mode for problematic workflows:
  - `./scripts/n8n/sync_workflows.sh --recreate-workflow "<workflow name>"`
  - deletes matched live workflow by name before import (history-loss expected for that workflow)
  - default behavior remains overwrite import (no deletes)
- Updated docs:
  - merged `docs/n8n_to_git.md` + `docs/git_to_n8n.md` into `docs/n8n_sync.md`

## 2026-02-24 — Notion collector client + normalize/notion input expansion

### What changed
- Added `src/server/notion-client.js`:
  - fetches Notion page + paginated block tree
  - recursively collects children (including synced block source references)
  - renders collected blocks into `capture_text`
  - returns collector stats/errors for logging
- Wired Notion collector into `runNotionIngestionPipeline`:
  - backend now always collects Notion blocks/content by `id` before normalization
- Expanded `POST /normalize/notion` input handling:
  - uses top-level `id`/`page_id` as canonical input (no required `notion{}` block)
  - uses `capture_text` as the only body-text override field
  - always fetches Notion blocks for the page id in collector path
- Notion client now derives metadata without n8n-supplied fields:
  - resolves `page_url` from Notion API/page id
  - resolves `database_id` from page parent, or fallback config (`NOTION_DATABASE_ID` / `NOTION_DATABASE_URL`)
- Updated docs:
  - `docs/api.md`
  - `docs/requirements.md`
  - `docs/env.md` (Notion env vars)

## 2026-02-24 — Notion normalization + idempotency wiring

### What changed
- Added Notion normalization API endpoint:
  - `POST /normalize/notion`
- Added Notion ingest orchestration path in backend:
  - `runNotionIngestionPipeline` in `src/server/ingestion-pipeline.js`
  - Notion order is `normalize -> idempotency -> quality`
- Added Notion idempotency support in `src/server/idempotency.js`:
  - `notion_note_v1`
  - `notion_newsletter_v1`
  - `notion_correspondence_v1`
  - `notion_other_v1`
  - primary key uses `notion:{page_id}`
  - optional secondary key uses `sha256(created_at + title)` when `created_at` is provided
- Added Notion normalization behavior in `src/server/normalization.js`:
  - strict `content_type` validation (`note|newsletter|correspondence|other`)
  - `updated_at` required
  - Notion block rendering support for allowed block types
  - unsupported block types now cause non-fatal item skip with `skipped=true` + `skip_errors[]`
- Hardened DB insert/update idempotency requirement list:
  - `source=notion` now fail-closed if idempotency fields are missing
- Updated docs:
  - `docs/api.md`
  - `docs/requirements.md`

## 2026-02-23 — Test mode UI control + backend toggle export fix

### What changed
- Added test mode control to Mac UI left sidebar (`src/web/pkm-debug-ui`):
  - reads state via `GET /db/test-mode`
  - toggles state via `POST /db/test-mode/toggle`
  - visual state: green when ON, gray when OFF
  - positioned at the bottom of the sidebar menu with independent menu scrolling
- Fixed backend toggle wiring bug:
  - exported `toggleTestModeStateInDb` from `src/server/db.js` so `TestModeService.toggle()` works correctly

## 2026-02-23 — Read keywords + context pack format alignment

### What changed
- Updated read SQL outputs to include `keywords` in all three read methods:
  - `POST /db/read/continue`
  - `POST /db/read/find`
  - `POST /db/read/last`
- Fixed SQL regressions introduced during read-shape changes:
  - removed duplicate `keywords` select in `continue` path
  - added missing `keywords` select in `find` hits CTE
- Centralized context-pack rendering in `src/libs/context-pack-builder.js` and aligned output contracts:
  - context-pack generation now skips `is_meta=true` rows
  - UI uses compact markdown layout:
    - `## Context Pack`
    - `retrieval: ...`
    - per-entry block with topic, keywords, url, content
  - `run_id` removed from context-pack body
- Updated docs:
  - `docs/requirements.md` (new fixed UI context-pack template + read keywords requirement)

## 2026-02-22 — Debug runs listing API + UI requirement updates

### What changed
- Added new admin debug endpoint:
  - `GET /debug/runs`
- Added backend run-summary query path for `pipeline_events`:
  - SQL builder: `buildGetRecentPipelineRuns`
  - DB method: `getRecentPipelineRuns`
- `GET /debug/runs` supports:
  - `limit` (default `50`, max `200`)
  - `before_ts` pagination cutoff
  - `has_error` filtering (`true|false`)
- Updated docs:
  - `docs/api.md` with `/debug/runs` contract and examples
  - `docs/requirements.md` with full Mac Debug UI requirements and `/debug/runs` usage
- Updated Mac debug UI to consume recent runs:
  - added `/debug/runs` client support and recent-runs panel with quick-load actions

## 2026-02-21 — Pipeline transition logging + run correlation

### What changed
- Added backend logger subsystem under `src/server/logger/` with two sinks:
  - Postgres sink for pipeline transition events (`pipeline_events`)
  - Braintrust sink for LLM-oriented spans/metadata
- Added AsyncLocalStorage run context propagation:
  - request-scoped `run_id` + `request_id`
  - accepts `X-PKM-Run-Id` header
  - accepts body `run_id` when header is absent
  - response now includes `X-PKM-Run-Id`
- Added step-level transition logging wrappers in key orchestration paths:
  - normalization/ingestion pipeline
  - email importer flow
  - Tier-1 enrichment facade
  - LangGraph node wrappers
- Added Postgres DB plumbing for pipeline events:
  - SQL builders in `src/libs/sql-builder.js`
  - DB methods in `src/server/db.js`:
    - `insertPipelineEvent`
    - `getPipelineRun`
    - `prunePipelineEvents`
- Added admin debug endpoint:
  - `GET /debug/run/:run_id`
- Added daily retention prune in server startup:
  - `PKM_PIPELINE_EVENTS_RETENTION_DAYS` (default `30`)
- Added `run_id` metadata propagation to observability + LiteLLM logs for Braintrust correlation.
- Updated docs:
  - `docs/api.md`
  - `docs/requirements.md`
  - `docs/database_schema.md`
  - `AGENTS.md` (DB safety rule: no raw SQL outside sql-builder/db modules)

## 2026-02-16 — Tier-1 LangGraph orchestration refactor

### What changed
- Added LangGraph dependencies to backend server package (`@langchain/langgraph`, `@langchain/core`).
- Refactored Tier‑1 orchestration into reusable modules under `src/server/tier1/`:
  - shared domain logic (`prompt`, parse, batch result mapping)
  - shared batch persistence/store helpers
  - LangGraph graph definitions and execution wrappers
- Implemented three LangGraph flows with explicit node stages `load -> prompt -> llm -> parse -> write`:
  - sync enrichment
  - batch schedule
  - batch collect
- Kept external API contracts unchanged for:
  - `POST /enrich/t1`
  - `POST /enrich/t1/batch`
  - worker-driven batch collection behavior
- Updated `src/server/tier1-enrichment.js` to a thin facade over LangGraph execution, preserving exported function names used by API handlers/importers.
- Refactored `src/server/litellm-client.js` instrumentation to provide consistent structured logging for all LiteLLM operations:
  - chat completions attempts and resolved call
  - files upload
  - batch creation
  - batch retrieval
  - file content fetch
- Constrained non-LLM orchestration logging to error-only node logs.
- Added Tier‑1 batch visibility APIs:
  - `GET /status/t1/batch`
  - `GET /status/t1/batch/:batch_id`
- Added backend status aggregation for Tier‑1 jobs (counts for `total_items`, `processed`, `pending`, `ok`, `parse_error`, `error`) with optional per-item status listing.
- Status scanning supports both `pkm` and `pkm_test` schemas independently of current test mode.
- Added admin-only DB mutation APIs:
  - `POST /db/delete`
  - `POST /db/move`
- Added strict selector/schema validation for delete/move at the backend DB boundary (no implicit schema or direction).
- Added n8n read command parser support for `/delete` and `/move`.

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
- Normalization no longer derives/stores correspondence participants (`people`) as part of email normalization output.
- Renamed entry idempotency policy column from `idempotency_policy_id` to `idempotency_policy_key` across backend logic and documentation.
- Fixed schema resolution drift in reads: `/db/read/last` and `/db/read/pull` now honor persisted test mode just like other DB methods.
- Moved test mode caching/logic into `src/server/test-mode.js` and removed it from config.
- `/config` now returns only static config (no test mode state).
- Moved shared libs to `src/libs` and updated server Dockerfile copy path.
- Added `POST /normalize/webpage` for one-call webpage text cleaning plus retrieval/quality recomputation.
- Consolidated retrieval excerpt + quality signal recompute flows behind `buildRetrievalForDb` in `src/server/quality.js` and reused it in normalization paths.
- Added `POST /import/email/mbox` for WP4 backlog ingest from `.mbox` files: normalize sync, idempotent insert, duplicate filtering (`skipped`), and Tier‑1 batch enqueue.
- Added backend `email-importer` module with `.mbox` parsing, MIME plain-text extraction, and per-entry failure isolation.
- Expanded `/db/insert` and `/db/update` to support batch payloads via `items` with optional `continue_on_error`.
- Enforced idempotency fail-closed behavior for `source = email-batch` in insert path.
- Optimized DB batch operations by reusing resolved test-mode config across per-item execution.
- Switched Tier‑1 LLM client from OpenAI Responses routing to LiteLLM chat-completions routing.
- Renamed `src/server/openai-client.js` to `src/server/litellm-client.js` and updated enrichment imports/usages.
- LLM auth is now strict `LITELLM_MASTER_KEY` (no `OPENAI_API_KEY` fallback).

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
