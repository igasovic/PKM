# Backend Runtime Environment

## Purpose
- define the backend-specific environment variables and runtime knobs used by `pkm-server`
- keep environment/config detail separate from HTTP contract docs

## Authoritative For
- backend service env var names, defaults, and intent
- backend runtime knobs that matter for deploy and review work

## Not Authoritative For
- operator apply workflow; use `docs/config_operations.md`
- exact runtime stack paths and host/container access; use `docs/env.md`

## Related Docs
- `docs/api.md`
- `docs/api_control.md`
- `docs/api_ingest.md`
- `docs/api_distill.md`
- `docs/config_operations.md`
- `docs/env.md`

## Read When
- changing backend runtime knobs, env defaults, or deploy assumptions
- reviewing whether a behavior change belongs in shared config vs code

## Update When
- backend env var names, defaults, or intent change
- ownership moves between repo-managed config and runtime-only state

## Environment

This section is a convenience summary for backend-related env vars.
Authoritative runtime location and apply workflow still live in `docs/env.md` and `docs/config_operations.md`.
Backend feature modules should read these values through `src/server/runtime-env.js`, not from direct `process.env` calls.

These variables are required in the service container:
- `PKM_INGEST_USER`
- `PKM_INGEST_PASSWORD`
- `BRAINTRUST_API_KEY`
- `BRAINTRUST_PROJECT` (or `BRAINTRUST_PROJECT_NAME`)

Optional:
- `PORT` (default: `8080`)
- `PKM_DB_HOST` (default: `postgres`)
- `PKM_DB_PORT` (default: `5432`)
- `PKM_DB_NAME` (default: `pkm`)
- `PKM_DB_SCHEMA` (default: `pkm`)
- `PKM_DB_SSL` (default: `false`)
- `PKM_DB_SSL_REJECT_UNAUTHORIZED` (default: `true`)
- `PKM_ADMIN_SECRET` (required for `/db/delete` and `/db/move`)
- `PKM_DB_ADMIN_ROLE` (optional; used via `SET LOCAL ROLE` for admin DB operations)
- `EMAIL_IMPORT_ROOT` (default: `/data`; root directory for `/import/email/mbox` reads)
- `OPENAI_BASE_URL` (recommended: `http://litellm:4000/v1`)
- `LITELLM_TIMEOUT_MS` (`60000` default)
- `T1_DEFAULT_MODEL` (recommended: `t1-default`)
- `T1_BATCH_MODEL` (recommended: `t1-batch`)
- `T1_BATCH_DEFAULT_MODEL` (optional provider-default batch alias fallback)
- `T1_BATCH_PROVIDER_MODEL` (optional provider model override for classify batch submission)
- `T1_BATCH_REQUEST_MODEL` (optional provider request model override for classify batch submission)
- `T1_REASONING_EFFORT` (optional LiteLLM/OpenAI reasoning effort hint for classify sync calls)
- `T1_BATCH_WORKER_ENABLED` (`true` default)
- `T1_BATCH_SYNC_INTERVAL_MS` (`600000` default)
- `T1_BATCH_SYNC_LIMIT` (`20` default)
- `T2_MODEL_DIRECT` (recommended: `t2-direct`)
- `T2_MODEL_CHUNK_NOTE` (recommended: `t2-chunk-note`)
- `T2_MODEL_SYNTHESIS` (recommended: `t2-synthesis`)
- `T2_MODEL_SYNC_DIRECT` (recommended: `t2-sync-direct`)
- `T2_MODEL_BATCH_DIRECT` (recommended: `t2-batch-direct`; falls back to sync/direct route if unset)
- `T2_RETRY_ENABLED` (`true` default)
- `T2_RETRY_MAX_ATTEMPTS` (`2` default)
- `T2_STALE_MARK_ENABLED` (`true` default)
- `T2_STALE_MARK_INTERVAL_MS` (`86400000` default)
- `T2_BATCH_WORKER_ENABLED` (`false` default)
- `T2_BATCH_SYNC_INTERVAL_MS` (`600000` default)
- `T2_BATCH_SYNC_LIMIT` (`distill.max_entries_per_run` default)
- `T2_BATCH_COLLECT_LIMIT` (`20` default)
- `T2_BATCH_STATUS_HISTORY_LIMIT` (optional cap for returned distill batch status history; bounded in code)
- `T2_BATCH_REQUEST_MODEL` (optional provider model override for distill batch request lines; falls back to `T1_BATCH_REQUEST_MODEL`)
- `DB_DELETE_MOVE_MAX_BATCH` (`200` default; admin delete/move safety cap)
- `FAMILY_CALENDAR_ID` (optional; shared calendar id surfaced in `/config.calendar.family_calendar_id`)
- `FAMILY_CALENDAR_RECIPIENT_EMAIL` (optional; default `pkm.gasovic`)
- `CALENDAR_TELEGRAM_ENFORCE_ALLOWLIST` (`false` default; when `true`, enforces Telegram user id allowlists for calendar/PKM routing)
- `CALENDAR_TELEGRAM_ALLOWED_USER_IDS` (optional CSV Telegram user ids allowed for calendar flows)
- `CALENDAR_TELEGRAM_PKM_ALLOWED_USER_IDS` (optional CSV Telegram user ids allowed for PKM capture; treated as subset of calendar users)

LLM auth:
- `LITELLM_MASTER_KEY` (required; used as Bearer token for LiteLLM)

Notion integration:
- `NOTION_API_TOKEN` (required for Notion API collection when backend must fetch page blocks)
- `NOTION_API_BASE` (default: `https://api.notion.com/v1`)
- `NOTION_API_VERSION` (default: `2022-06-28`)
- `NOTION_DATABASE_ID` (optional fallback database id when page parent metadata is unavailable)
- `NOTION_DATABASE_URL` (optional fallback database URL used to derive database id)

Observability and logging:
- `PKM_LOG_LEVEL` (`error|warn|info|debug|trace`, default `info`)
- `PKM_LOG_SUMMARY_MAX_BYTES` (`12288` default summary cap for persisted event summaries)
- `PKM_LOG_STRING_HASH_THRESHOLD` (`500` default threshold before long strings are summarized by hash)
- `PKM_DEBUG_CAPTURE` (`1` enables debug bundle capture on selected error paths)
- `PKM_DEBUG_CAPTURE_DIR` (default: `/data/pipeline-debug`)
- `PKM_PIPELINE_EVENTS_RETENTION_DAYS` (`30` default daily prune window)
- `LLM_MODEL_COSTS_PER_1M_USD_JSON` (optional per-model cost map for Braintrust cost attribution)
- `LLM_INPUT_COST_PER_1M_USD` (optional fallback input-token cost)
- `LLM_OUTPUT_COST_PER_1M_USD` (optional fallback output-token cost)

Testing and development:
- `NODE_ENV` (used to suppress some Braintrust sink warnings during tests)
- `PKM_BRAINTRUST_SINK_WARN_IN_TEST` (`1` re-enables Braintrust sink warnings under `NODE_ENV=test`)
