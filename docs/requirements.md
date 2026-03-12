# Idempotency Requirements

## Scope
This document defines how idempotency must work for ingest and backfill across:
- `pkm` (prod schema)
- `pkm_test` (test schema)

Primary objective:
- prevent duplicate rows from being inserted into `entries`
- support rerunnable backfills safely

## Core rules
- Idempotency keys are computed in normalization.
- Conflict resolution is enforced in backend DB insert logic using DB unique constraints.
- Behavior must be schema-consistent between `pkm` and `pkm_test`.
- Email, email-batch, Telegram, and Notion inserts are fail-closed: if idempotency fields are missing, insert is rejected.

## Content hash requirements
- `content_hash` must be derived only from `clean_text`.
- Hash algorithm is fixed:
  - input: `clean_text` exactly as persisted (UTF-8 bytes, no extra normalization in hash function)
  - function: `SHA-256`
  - output: lowercase hex digest
- `content_hash` must be `null` when `clean_text` is missing or blank after trim.
- Any flow that recalculates `clean_text` must recalculate `content_hash` in the same step before persistence.
- One-off historical backfill is performed with `scripts/db/backfill_content_hash.sh` and is intended to be removable after rollout.

## Data flow
1. Ingest sends structured input to normalization.
2. Normalization returns canonical entry fields plus idempotency fields:
- `idempotency_policy_key`
- `idempotency_key_primary`
- `idempotency_key_secondary` (nullable)
- `content_hash`
3. Backend `/db/insert` resolves policy from `idempotency_policies` and applies conflict action.

## API requirements

### `POST /normalize/telegram`
- Input:
  - `text` required
  - `source.chat_id` and `source.message_id` required for thought-key path
  - `source.url` optional (URL can be extracted from `text`)
- `source.system` is inferred by normalization/API path as `telegram`

### `POST /normalize/email`
- Input:
  - `raw_text` required
  - `from` required for newsletter Tier2 key quality
  - `subject` required for subject-base keying
  - `source.message_id` optional but recommended
  - `source.date` recommended (used for newsletter day bucket)
- `source.system` is inferred by normalization/API path as `email`
- `source.from_addr` and `source.subject` are not used; top-level `from`/`subject` are canonical

### `POST /import/email/mbox`
- Purpose:
  - process large email backlogs (`*.mbox`) for WP4
  - normalize each email synchronously with existing email normalization
  - insert idempotently and enqueue Tier‑1 via Batch API
- Input:
  - `mbox_path` required (must be under `EMAIL_IMPORT_ROOT`)
  - `batch_size` optional, must be `500..2000` (default `500`)
  - `insert_chunk_size` optional (default `200`)
  - `completion_window` optional (`24h` default)
- Behavior:
  - inserted rows use `source = "email-batch"`
  - idempotency treats `email-batch` the same as `email` (same policy/key evaluation rules)
  - rows with DB action `skipped` are excluded from Tier‑1 enqueue
  - partial failures are isolated per email and recorded in response
  - reruns are safe because idempotency keys are still required/resolved

### `POST /normalize/webpage`
- Purpose:
  - normalize extracted webpage/article text
  - compute retrieval excerpt + quality signals in a single backend call
- Input:
  - `text` preferred (mapped to `extracted_text`)
  - optional `clean_text` (if already pre-cleaned)
  - optional `capture_text`, `content_type`, `url`, `url_canonical`
  - optional `excerpt` override
- Output:
  - `extracted_text`, `clean_text`, `content_hash`
  - promoted retrieval/quality fields (`retrieval_excerpt`, counts, ratios, quality flags/scores)
  - `metadata.retrieval`
- Empty-clean guard:
  - if normalized clean text is empty, response sets `retrieval_update_skipped: true`
  - caller should skip retrieval overwrite in that case

### `POST /normalize/notion`
- Purpose:
  - normalize Notion page payloads for PKM ingest
  - enforce strict content type validation
  - support page-text rendering from Notion blocks
- Input:
  - `id` (or `page_id`) required
  - `updated_at` required and must be sourced from Notion DB Last edited time property
  - `title` required
  - `content_type` optional; defaults to `note` only when missing/empty
  - `content_type` allowed values: `note|newsletter|correspondence|other`
  - `url` optional
  - `capture_text` optional
  - backend must collect page blocks from Notion API using page id and build `capture_text` when needed
  - Notion API collector requires `NOTION_API_TOKEN`
- Unsupported block behavior:
  - if any unsupported Notion block type is encountered, item is skipped (non-fatal)
  - response returns `skipped=true`, `skip_reason=unsupported_block_type`, and `skip_errors[]`
- Quality ordering:
  - Notion flow computes idempotency first
  - quality/retrieval fields are computed only after idempotency

## Policy definitions

### `telegram_thought_v1`
- source: `telegram`
- content type: `thought`/`note`
- conflict action: `update`
- primary key: `tg:{chat_id}:{message_id}`
- secondary key: optional `sha256(clean_text)`

### `telegram_link_v1`
- source: `telegram`
- content type: `link`
- conflict action: `skip`
- primary key: canonical URL
- secondary key: `sha256(normalized_url_without_tracking)`

### `email_newsletter_v1`
- source: `email`
- content type: `newsletter`
- conflict action: `skip`
- primary key: `message_id` (if present)
- secondary key: `sha256(from_addr + subject_base + date_bucket)`
- `subject_base` normalization:
  - remove `re:`, `fw:`, `fwd:`
  - remove leading `[List]` tags
  - collapse whitespace, lowercase
- `date_bucket`: America/Chicago day (`YYYY-MM-DD`)

### `email_correspondence_thread_v1`
- source: `email`
- content type: `correspondence_thread`
- conflict action: `update`
- primary key: `sha256(subject_base)`
- secondary key: none
- participants are not part of key evaluation

### `notion_note_v1`
- source: `notion`
- content type: `note`
- conflict action: `update`
- primary key: `notion:{page_id}`
- secondary key: optional `sha256(created_at + title)` when created_at is supplied

### `notion_newsletter_v1`
- source: `notion`
- content type: `newsletter`
- conflict action: `update`
- primary key: `notion:{page_id}`
- secondary key: optional `sha256(created_at + title)` when created_at is supplied

### `notion_correspondence_v1`
- source: `notion`
- content type: `correspondence`
- conflict action: `update`
- primary key: `notion:{page_id}`
- secondary key: optional `sha256(created_at + title)` when created_at is supplied

### `notion_other_v1`
- source: `notion`
- content type: `other`
- conflict action: `update`
- primary key: `notion:{page_id}`
- secondary key: optional `sha256(created_at + title)` when created_at is supplied

## DB requirements

### Policy table (both schemas)
- `idempotency_policies`
- required columns:
  - `policy_id`, `policy_key`, `source`, `content_type`, `conflict_action`, `update_fields`, `enabled`

### Entries columns (both schemas)
- `idempotency_policy_key text`
- `idempotency_key_primary text`
- `idempotency_key_secondary text`

### Constraints/indexes
- unique partial index on `(idempotency_policy_key, idempotency_key_primary)` where primary not null
- unique partial index on `(idempotency_policy_key, idempotency_key_secondary)` where secondary not null

## Conflict handling
- `skip`:
  - do not insert duplicate
  - return existing row with `action = "skipped"`
- `update`:
  - update matching row
  - immutable denylist must never be updated:
    - `id`, `entry_id`, `created_at`
  - if `update_fields` is null: update all allowed incoming columns
  - if `update_fields` is set: update only those columns
  - metadata is merged recursively (object merge), not blind-overwritten
  - return row with `action = "updated"`
- successful fresh insert returns `action = "inserted"`

## Test mode and schema behavior
- Backend resolves active schema via persisted runtime test mode state.
- Idempotency lookup and policy resolution are schema-scoped.
- Behavior and seed policies must exist in both schemas.

### Test-mode requirements
- Test mode state is persisted in Postgres runtime config (`runtime_config` table), key: `is_test_mode`.
- State toggles must be atomic and immediately visible to subsequent requests.
- DB methods that resolve active `entries` table must use persisted test-mode state, not static config defaults.
- Batch workers must not depend on current test-mode flag for dequeue/sync coverage:
  - worker must scan both configured schemas (`pkm` and `pkm_test`)
  - pending jobs in either schema must continue to be processed across restarts and mode flips
- API `/config` is static config only; test-mode state is retrieved via dedicated test-mode endpoints.

### Caching requirements
- Test-mode reads may be cached in backend service to reduce DB chatter.
- Cache TTL is `10s` (default behavior in current implementation).
- Cache invalidation rules:
  - `toggle` and `set` operations must update cache immediately
  - cache miss or expired entry must read from DB
  - cache must not outlive process restart (in-memory cache only)
- Cached value is an optimization only; Postgres remains source of truth.

## Test mode requirements
- Test mode state is persisted in Postgres runtime config under key `is_test_mode`.
- APIs:
  - `GET /db/test-mode` returns current state as `[{ is_test_mode: boolean }]`.
  - `POST /db/test-mode/toggle` flips state atomically and returns resulting state as `[{ is_test_mode: boolean }]`.
- Schema routing behavior:
  - `is_test_mode=false` routes DB operations to `pkm` schema.
  - `is_test_mode=true` routes DB operations to `pkm_test` schema.
- Toggle behavior requirements:
  - no implicit defaults at call sites
  - state change must be immediately visible to subsequent requests
  - service cache must be updated/invalidate-on-write for toggle/set operations
- Failure behavior:
  - if `runtime_config` is missing, test-mode endpoints must fail with explicit error
  - backend must not silently fall back to static config for mutable test-mode state
- UI requirement:
  - Mac debug UI includes a bottom-left sidebar control to view and toggle test mode (green when ON, gray when OFF).

## Integration expectations (n8n and other clients)
- Call normalization first; do not hand-craft idempotency keys downstream.
- Insert normalized payload directly to `/db/insert`.
- If a client-side step recalculates `clean_text` (for example in n8n web extraction), it must also send the recalculated `content_hash` in the same `/db/update` request.
- Branch by `action`:
  - `skipped`: stop enrichment/update pipeline
  - `inserted` / `updated`: continue downstream processing
- For backlog ingest, n8n should only trigger `/import/email/mbox`; batching and async Tier‑1 lifecycle stay in backend workers.

## Batch CRUD requirements
- `/db/insert` and `/db/update` support batch mode via `items: []`.
- Batch mode must support `continue_on_error` with per-item status:
  - success rows include `_batch_ok: true` and `_batch_index`
  - failure rows include `_batch_ok: false`, `_batch_index`, and `error`
- Batch operations must not abort the whole request when `continue_on_error = true`.

## Quality/retrieval computation requirements
- Retrieval excerpt + quality signals must be generated through shared backend quality logic.
- Normalization flows should call the quality module entrypoint instead of duplicating signal logic in workflow code.
- Returned fields must be DB-ready for direct `/db/update` or `/db/insert` usage.

## Tier-1 LiteLLM client requirements
- Tier‑1 enrichment must route through LiteLLM, not direct provider APIs.
- Backend client must use OpenAI-compatible LiteLLM endpoints:
  - sync calls: `/v1/chat/completions`
  - batch calls: `/v1/files`, `/v1/batches`, `/v1/files/{id}/content`
- Authentication must use `LITELLM_MASTER_KEY` only.
- Base URL must be configurable via `OPENAI_BASE_URL` (recommended: `http://litellm:4000/v1`).
- Model selection must use LiteLLM logical routes:
  - `T1_DEFAULT_MODEL` for sync enrichment
  - `T1_BATCH_MODEL` for batch enrichment
- n8n and other clients should call backend APIs only; LiteLLM orchestration stays inside backend.

## Tier-1 orchestration requirements
- Tier‑1 orchestration must be graph-driven via LangGraph.
- `src/server/index.js` must keep API contracts unchanged and delegate Tier‑1 orchestration to LangGraph-backed service functions.
- Graphs required:
  - sync enrichment
  - batch schedule
  - batch collect
- Node order must stay explicit and extensible as:
  - `load -> prompt -> llm -> parse -> write`
- Domain logic must be reusable across flows:
  - sync enrichment and batch collect must share the same parsing logic for Tier‑1 JSON interpretation.
- Observability policy:
  - LiteLLM client must emit full call instrumentation for all LLM/proxy interactions.
  - Non-LLM graph nodes should emit logs only on errors.

## Tier-2 distillation requirements
- Tier‑2 sync distillation must run through backend API only (`POST /distill/sync`).
- Tier‑2 control-plane planning must run through backend API only (`POST /distill/plan`).
- Tier‑2 manual batch execution must run through backend API only (`POST /distill/run`).
- Tier‑2 `/distill/run` must default to `execution_mode = batch`; sync execution is allowed only when explicitly requested (`execution_mode = sync`).
- Sync distillation must target prod schema (`pkm`) only.
- Sync distillation requires existing row `clean_text`; if absent, request fails.
- Control-plane planning must deterministically apply:
  - eligibility gate (`proceed|skipped|not_eligible`)
  - priority scoring
  - run budget
  - route selection (`direct|chunked`)
- Control-plane planning must persist eligibility outcomes (`skipped` / `not_eligible`) with compact reason metadata when persistence is enabled.
- Tier‑2 batch execution must target prod schema and enqueue selected entries through LiteLLM/OpenAI-compatible batch APIs.
- Tier‑2 batch execution must mark dispatched selected entries as `queued` only after successful provider dispatch.
- Tier‑2 batch execution (`POST /distill/run`) must apply config-driven retry decisions from `distill.retry.*` during async collect/reconciliation (sync endpoint remains single-attempt).
- Deterministic Tier‑2 failures must remain non-retryable even under permissive retry config:
  - validation contract errors (for example `excerpt_not_grounded`, `summary_empty`, similar `DISTILL_VALIDATION_ERROR_CODES`)
  - `currentness_mismatch`
- For batch mode, terminal `currentness_mismatch` failures must not leave rows in `queued`:
  - batch collect/reconcile must persist terminal failure state (`failed`) unless `preserved_current_artifact = true`.
- Tier‑2 batch execution runtime failures must return a normalized response payload (with `error`) and preserve status inspectability via `batch_id`.
- Tier‑2 batch status visibility must be durable via DB-backed tables (`t2_batches`, `t2_batch_items`, `t2_batch_item_results`), not process-memory only.
- Route selection must be deterministic from `clean_word_count` and `distill.direct_chunk_threshold_words`.
- Tier‑2 output must validate deterministically before persistence:
  - required fields: `distill_summary`, `distill_why_it_matters`, `distill_stance`, `distill_version`, `distill_created_from_hash`, `distill_metadata`
  - optional `distill_excerpt` must be non-empty and grounded in source when present
- Successful persistence must write artifact fields and `distill_status = completed` together.
- Successful persistence must be guarded by currentness (`content_hash` must still match `distill_created_from_hash` at write time).
- On currentness mismatch, Tier‑2 sync must return `error_code = currentness_mismatch` and must not overwrite existing distill state.
- Failed validation/generation must persist `distill_status = failed` with compact error metadata.
- Exception: when a row already has a current completed artifact, sync failures must not downgrade that row to `failed`.
- Tier‑2 stale detection must run as backend maintenance:
  - mark `completed -> stale` when `content_hash IS DISTINCT FROM distill_created_from_hash`
  - update status only (keep existing distill artifact fields)
- Tier‑2 status surfaces should include compact run-level failure summary in `metadata.error` when a batch run fails before per-entry execution.
- Tier‑2 status surfaces should include per-run failure-code aggregation in `metadata.error_code_counts` for quick diagnosis.

## Tier-1 batch visibility requirements
- Backend must expose read-only status APIs for current Tier‑1 batch jobs.
- Status APIs must report aggregate counts per batch:
  - total items
  - processed
  - pending
  - ok
  - parse_error
  - error
- Status queries must support both schemas (`pkm`, `pkm_test`) regardless of current test-mode setting.
- Detailed status API must support item-level status listing for one batch with bounded limit.

## Pipeline transition logging requirements
- Backend must emit lightweight, always-on transition events to Postgres `pipeline_events`.
- Correlation key is `run_id`:
  - accept `X-PKM-Run-Id` header
  - accept body `run_id` when header is absent
  - propagate into AsyncLocalStorage context and LangGraph state/options
- Every important step should log:
  - `start` and `end` (or `error`)
  - duration
  - input/output summaries (shape/count/hash), not full heavy texts
- Summaries must never include full values of:
  - `capture_text`
  - `extracted_text`
  - `clean_text`
- Braintrust logging remains focused on LLM spans and should include `run_id` metadata.
- API-level Braintrust telemetry must redact `capture_text` on both success and error paths.
- Handled API request failures should emit one canonical `api.request` error event (avoid duplicate request-level error events for the same failure).
- LLM call telemetry should emit one canonical event per call (`chat.completions`) with retry-attempt details summarized in metadata.
- Braintrust sink write failures must be surfaced via sampled stderr warnings that include cumulative and consecutive failure counters.
- LLM cost derivation precedence must be:
  - model map from `LLM_MODEL_COSTS_PER_1M_USD_JSON` (if provided)
  - model-specific env pair `LLM_MODEL_<MODEL_KEY>_INPUT_COST_PER_1M_USD` and `LLM_MODEL_<MODEL_KEY>_OUTPUT_COST_PER_1M_USD`
  - global fallback `LLM_INPUT_COST_PER_1M_USD` and `LLM_OUTPUT_COST_PER_1M_USD`
- Backend must expose run inspection API:
  - `GET /debug/run/:run_id` (admin-protected)
  - `GET /debug/run/last` (admin-protected)
  - `GET /debug/runs` (admin-protected, recent run summaries)
- Backend must prune old pipeline events daily with retention default `30` days (`PKM_PIPELINE_EVENTS_RETENTION_DAYS`).

## Debug UI requirements (Mac React + Tailwind)
- UI lives under `src/web/pkm-debug-ui` and must not add DB coupling.
- UI must read pipeline debug data only through PKM HTTP `/debug/*` endpoints.
- UI stack is fixed:
  - React + TypeScript
  - TailwindCSS
  - dark mode only
- UI must support:
  - run lookup by `run_id`
  - recent runs listing (`GET /debug/runs`)
  - timeline inspection in table view and call-stack tree view
  - paired span health states (`ok`, `error`, `missing_end`, `orphan_end`, `orphan_error`)
  - detail drawer for event/span with JSON copy actions

## Read context pack requirements
- Context pack generation must be centralized in `src/libs/context-pack-builder.js`.
- Both UI (`src/web/pkm-debug-ui`) and n8n read workflow context-pack node must use this shared builder.
- Output variants:
  - UI: regular Markdown using the UI-specific compact layout below
  - n8n Telegram: MarkdownV2-safe (escaped)
- Read endpoints (`/db/read/continue`, `/db/read/find`, `/db/read/last`) must include `keywords` in hit rows.
- Read endpoints (`/db/read/continue`, `/db/read/find`, `/db/read/last`) must include `distill_summary` in hit rows when present.
- Read endpoints (`/db/read/continue`, `/db/read/find`, `/db/read/last`) must include `distill_why_it_matters` in hit rows when present.
- Context-pack builder must skip meta row(s) (`is_meta=true`) and include only hit rows.
- UI context-pack template is fixed:
  - `## Context Pack`
  - `retrieval: {method} | q="{query}" | days={days_or_default} | limit={limit_or_default}`
  - `Entry {entry_id} | {content_type} | {author_or_-} | {title_or_-} | {yyyy_mm_dd}`
  - `topic: {topic_primary_or_-} -> {topic_secondary_or_-}`
  - `keywords: {k1, k2, k3_or_-}`
  - `url: {url_or_-}`
  - `content: {selected_content}`
  - for top ~25% of ranked hit rows, include `why_it_matters: {distill_why_it_matters}` when present
- `run_id` must not be included inside context-pack text.
- Content selection priority is mandatory:
  - `distill_summary`
  - `gist`
  - `retrieval_excerpt`
  - `snippet`
  - `clean_text` (snipped)
  - `capture_text` (snipped)
  - fallback `JSON keys: ...`
  - deterministic “investigation bundle” copy with stable key ordering
- UI must handle payload variants:
  - `{ run_id, rows }`
  - `[{ run_id, rows }]`
  - `{ rows }` (derive `run_id` from rows)
- Large string guardrails:
  - never render full heavy payload strings inline
  - show compact size/hash summaries instead

## Telegram command UX requirements
- Read workflow command parser must support `--help` (and `-h`) on user-facing commands and return command-specific usage without calling backend APIs.
- `/help` output must include Tier‑2 distill commands and current option flags.
- `/distill-run` must default to batch execution semantics and allow explicit sync override via command flag (`--sync`).

## Non-goals
- No duplicate side-table tracking in place of uniqueness constraints.
- No client-side duplicate suppression as primary mechanism.
- No dependence on participants for correspondence keying.
