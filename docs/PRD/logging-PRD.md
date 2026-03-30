# PRD — Logging And Telemetry

Status: active  
Surface owner: backend logging and observability layer  
Scope type: backfilled baseline  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_control.md`, `docs/database_schema.md`, `docs/backend_runtime_env.md`  
Related work-package doc: none

## Purpose
Define the backend logging and telemetry system as it exists today.

## Use this PRD when
- changing backend transition telemetry, Braintrust instrumentation, correlation, summarization, or redaction behavior
- reviewing whether a feature change violates logging or sink-boundary guarantees
- deciding whether a telemetry concern belongs to this cross-cutting layer or to a feature-specific PRD

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Architecture`, `Transition Event Contract`, `Braintrust Telemetry Contract`, and `Operational Guarantees`.
- Planning agent: read `Goals and Non-Goals`, `Architecture`, `Configuration Matrix`, and `Validation Coverage`.
- Reviewing agent: read `Status and scope boundary`, `Transition Event Contract`, `Summarization and Redaction`, `Sink failure behavior`, and `Validation Coverage`.
- Architect agent: read `Ownership boundaries`, `Transition Event Contract`, `Braintrust Telemetry Contract`, `Operational Guarantees`, and `File Map`.

## Section map
- Boundaries and architecture: `Status and scope boundary`, `Architecture`
- Run/request correlation: `Correlation Model`
- Postgres transition logging: `Transition Event Contract`
- Redaction and payload controls: `Summarization and Redaction`
- Braintrust rules: `Braintrust Telemetry Contract`
- Operational setup and code map: `Configuration Matrix`, `Operational Guarantees`, `File Map`

## Status and scope boundary
This PRD owns:
- transition telemetry to Postgres `pipeline_events`
- Braintrust operational telemetry
- correlation, summarization, redaction, and sink-failure guarantees for backend logging

This PRD does not own:
- feature-specific business logs such as family-calendar business tables
- a full alerting or observability platform beyond the current sinks

## Evidence / recovery basis
Recovered primarily from current implementation under `src/server/logger/` and related backend call sites.

## Detailed design
## 1) Purpose

Define the backend logging/telemetry system as it exists today, including:
- pipeline transition logging to Postgres `pipeline_events`
- Braintrust telemetry for LLM/API/DB operational spans
- run correlation (`run_id`) and request correlation (`request_id`)
- redaction/summarization and failure behavior

This PRD is implementation-derived and should be treated as normative until superseded.

## 2) Goals and Non-Goals

### Goals
- Preserve execution traceability for backend pipelines with deterministic step order.
- Provide low-overhead, always-on transition logs for debugging and run inspection.
- Capture LLM operational telemetry (including token usage and estimated cost) in Braintrust.
- Prevent heavy payload leakage by default through summarization and field redaction.
- Keep application flow resilient when telemetry sinks fail.

### Non-Goals
- Full payload archival in pipeline transition logs.
- Replacing Postgres `pipeline_events` with an external log platform.
- Building alerting policy in this layer (alerting is outside logger module scope).

## 3) Architecture

### Components
- Request context (`AsyncLocalStorage`): `src/server/logger/context.js`
- Pipeline logger (transition events): `src/server/logger/index.js`
- Postgres sink (pipeline events): `src/server/logger/sinks/postgres.js`
- Braintrust sink (operational telemetry): `src/server/logger/sinks/braintrust.js`
- Braintrust initialization + wrappers:  
  - `src/server/logger/braintrust-client.js`  
  - `src/server/logger/braintrust.js`

### Ownership boundaries
- Transition telemetry destination: Postgres `pipeline_events`.
- LLM telemetry destination: Braintrust.
- Business logic must not emit raw SQL for logging outside allowed DB/sql-builder modules.

## 4) Correlation Model

### `run_id`
- Preferred source: request header `X-PKM-Run-Id`.
- Secondary source: request body `run_id` (only when header was not provided).
- Fallback: generated UUID per request.
- Returned in response header `X-PKM-Run-Id`.

### `request_id`
- Generated UUID per request in context storage.

### Sequencing
- `seq` is monotonic within a request context via `nextSeq()`.
- For contexts without active request state, logger uses local sequence counters.
- DB insert for `pipeline_events` retries up to 8 times on `(run_id, seq)` uniqueness collision.

## 5) Transition Event Contract (`pipeline_events`)

### Event shape
As written by `PipelineLogger.step`:
- `run_id`, `seq`, `service`, `pipeline`, `step`, `direction`, `level`
- optional: `duration_ms`, `entry_id`, `batch_id`, `trace_id`
- summaries: `input_summary`, `output_summary`
- error envelope (for direction=`error`): `error`
- optional `artifact_path`
- context metadata in `meta` (`request_id`, `route`, `method`, plus caller-provided meta)

### Direction semantics
- `start`: emitted before function execution.
- `end`: emitted after success.
- `error`: emitted on exception, includes normalized error summary.

### Error normalization
- `name`
- `message`
- `stack_hash` (sha256 of truncated stack/message)
- `stack_sample` (up to first 8 stack lines)

## 6) Summarization and Redaction

### Summary behavior
`src/server/logger/summarize.js`:
- structured summarization by type, depth, and size cap
- large strings hashed and counted instead of raw inclusion
- compact fallback summary when max-byte cap is exceeded

### Protected heavy fields
Never summarized as full text by default:
- `capture_text`
- `extracted_text`
- `clean_text`

### API telemetry redaction
For `api.request` Braintrust events:
- `capture_text` is recursively redacted on both success and error logs.

## 7) Braintrust Telemetry Contract

### Canonical payload shape
- `input`
- `output` (success) or `error` (error path)
- `metadata`:
  - `op`
  - `outcome` (`success` or `error`)
  - `run_id`
  - `request_id`
  - operation/source metadata
- `metrics`

### Outcome differentiation
- `logSuccess(...)` always emits `metadata.outcome = "success"`.
- `logError(...)` always emits `metadata.outcome = "error"`.

### Cost and usage normalization
- Usage normalization supports aliases:
  - `prompt_tokens` / `input_tokens`
  - `completion_tokens` / `output_tokens`
  - `reasoning_tokens` (including nested details)
  - `total_tokens` fallback from prompt+completion
- `estimated_cost_usd` is derived if rates are available.

### Cost rate precedence (implemented)
1. `LLM_MODEL_COSTS_PER_1M_USD_JSON`
2. `LLM_MODEL_<MODEL_KEY>_INPUT_COST_PER_1M_USD` + `LLM_MODEL_<MODEL_KEY>_OUTPUT_COST_PER_1M_USD`
3. `LLM_INPUT_COST_PER_1M_USD` + `LLM_OUTPUT_COST_PER_1M_USD`

`MODEL_KEY` is sanitized from model id by replacing non-alphanumeric characters with `_` and uppercasing.

### Sink failure behavior
- Braintrust sink failures never throw into business flow.
- Failures are surfaced through sampled stderr warnings:
  - first 3 failures
  - every 100th failure
  - or at least once per `60s` interval
- Warning includes:
  - `op`
  - `total_failures`
  - `consecutive_failures`
  - error message
- In tests (`NODE_ENV=test`), warnings are suppressed unless `PKM_BRAINTRUST_SINK_WARN_IN_TEST=1`.

## 8) API and DB Logging Behavior

### HTTP API
- Most endpoint handlers wrap work in `logger.step(...)` for transition logs.
- Generic `/db/*` path also emits Braintrust API request telemetry:
  - success: `api.request`
  - error: `api.request`
- `/db/*` handled errors are de-duplicated at request level (no extra `server.request_error` in that path).

### DB operation telemetry
- `traceDb(...)` emits Braintrust success/error around DB operations with duration and `rowCount` where available.
- DB helper `exec(...)` routes query execution through `traceDb('query', meta, fn)`.

### Transition event persistence
- Postgres sink writes through `db.insertPipelineEvent(...)`.
- Postgres sink write failures are swallowed to avoid flow interruption.

## 9) LiteLLM Telemetry Behavior

### Canonical sync completion telemetry
- `sendMessage(...)` emits one canonical `chat.completions` Braintrust event per call (success or error).
- Retry/attempt details are attached in metadata (`attempt_count`, `attempts[]`) rather than separate per-attempt events.

### Batch-related operations
The following operation names are emitted:
- `files.upload`
- `batches.create`
- `batches.create.model_unsupported`
- `createBatch`
- `batches.retrieve`
- `files.content`

## 10) Retention and Maintenance

- `pipeline_events` retention is enforced by daily prune job at backend startup loop:
  - env: `PKM_PIPELINE_EVENTS_RETENTION_DAYS` (default `30`)
- Maintenance execution is logged as transition events under maintenance pipeline steps.

## 11) Configuration Matrix

### Core logger config
- `PKM_LOG_LEVEL` (`error|warn|info|debug|trace`, default `info`)
- `PKM_LOG_SUMMARY_MAX_BYTES` (summary cap, default `12*1024`)
- `PKM_LOG_STRING_HASH_THRESHOLD` (string hashing threshold, default `500`)

### Debug capture
- `PKM_DEBUG_CAPTURE` (`1` enables debug bundles)
- `PKM_DEBUG_CAPTURE_DIR` (default `/data/pipeline-debug`)

### Pipeline events retention
- `PKM_PIPELINE_EVENTS_RETENTION_DAYS` (default `30`)

### Braintrust init
- `BRAINTRUST_API_KEY` (required at backend startup)
- `BRAINTRUST_PROJECT` or `BRAINTRUST_PROJECT_NAME` (defaults to `pkm-backend` if unset)

### LLM cost config
- `LLM_MODEL_COSTS_PER_1M_USD_JSON`
- `LLM_MODEL_<MODEL_KEY>_INPUT_COST_PER_1M_USD`
- `LLM_MODEL_<MODEL_KEY>_OUTPUT_COST_PER_1M_USD`
- `LLM_INPUT_COST_PER_1M_USD`
- `LLM_OUTPUT_COST_PER_1M_USD`

### Test-only sink warning override
- `PKM_BRAINTRUST_SINK_WARN_IN_TEST=1`

## 12) Operational Guarantees

- Backend startup hard-fails if Braintrust logger cannot initialize.
- Telemetry sink failures do not block request/business execution.
- Transition logs remain queryable via debug endpoints:
  - `GET /debug/run/:run_id`
  - `GET /debug/run/last`
  - `GET /debug/runs`

## 13) File Map

- Context and run correlation:
  - `src/server/logger/context.js`
- Transition logger:
  - `src/server/logger/index.js`
  - `src/server/logger/summarize.js`
  - `src/server/logger/sinks/postgres.js`
- Braintrust:
  - `src/server/logger/braintrust-client.js`
  - `src/server/logger/braintrust.js`
  - `src/server/logger/sinks/braintrust.js`
- API integration:
  - `src/server/index.js`
- DB integration:
  - `src/server/db.js`
  - `src/libs/sql-builder.js` (pipeline events SQL)
- LLM integration:
  - `src/server/litellm-client.js`

## 14) Validation Coverage

Current tests covering this behavior:
- `test/server/braintrust-sink.test.js`
- `test/server/braintrust-wrapper.test.js`
- transition/run status surfaces are exercised through existing server/tier tests.
