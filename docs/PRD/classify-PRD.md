# PRD — Classify (Tier-1 Enrichment)

Status: active  
Surface owner: backend Tier-1 orchestration + classify batch lifecycle  
Scope type: backfilled baseline  
Last verified: 2026-04-19  
Related authoritative docs: `docs/api_control.md`, `docs/database_schema.md`, `docs/backend_runtime_env.md`, `docs/requirements.md`  
Related work-package doc: none

## Purpose
Baseline the Tier-1 classify surface so it is cleanly separated from ingest on the way in and distill on the way out.

## Use this PRD when
- changing Tier-1 classify sync or batch behavior
- changing LiteLLM-backed classify execution, orchestration, or batch-status semantics
- deciding whether a behavior belongs to ingest or classify

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Control plane / execution flow`, `Runtime contract`, `Orchestration contract`, and `API / contract surfaces`.
- Planning agent: read `Goals`, `Boundaries and callers`, `Contract delta table`, `Control plane / execution flow`, and `Risks / open questions`.
- Reviewing agent: read `Status and scope boundary`, `Runtime contract`, `Batch visibility contract`, `Validation / acceptance criteria`, and `Known gaps requiring code deep-dive`.
- Architect agent: read `Boundaries and callers`, `Contract delta table`, `Data model / state transitions`, and `Config / runtime / topology implications`.

## Status and scope boundary
This PRD owns:
- `POST /enrich/t1`
- `POST /enrich/t1/update`
- `POST /pkm/classify`
- `POST /pkm/classify/batch`
- `POST /enrich/t1/batch`
- `POST /enrich/t1/update-batch`
- `GET /status/batch?stage=t1`
- `GET /status/batch/:batch_id?stage=t1`
- legacy `/status/t1/batch*` compatibility while it exists
- sync and batch Tier-1 orchestration through backend services
- LiteLLM-backed Tier-1 model calls
- LangGraph-driven Tier-1 execution flow

This PRD does not own:
- ingest normalization or idempotent insert policy
- the email backlog import before classify enqueue
- Tier-2 distill behavior
- generic read/context-pack behavior
- working-memory or ChatGPT action semantics

## Current behavior / baseline
Current repo behavior is:
- Tier-1 sync classify is exposed through `POST /enrich/t1`
- explicit sync classify writeback is exposed through `POST /enrich/t1/update`
- n8n capture flows call `POST /pkm/classify` for single-row classify+write after `/pkm/insert`
- `10 Read` `/classify` command calls `POST /pkm/classify/batch` for sync/batch runs
- Tier-1 batch enqueue is exposed through `POST /enrich/t1/batch`
- explicit batch classify writeback is exposed through `POST /enrich/t1/update-batch` and internal batch-collect apply flow
- batch status is exposed through the generic `/status/batch` surface with explicit `stage=t1`
- batch lifecycle persistence is backend-owned and restart-safe
- LiteLLM is the only model gateway for Tier-1
- Tier-1 orchestration is graph-driven and backend-owned; n8n callers use backend APIs only
- the legacy `21 Tier-1 Enrichment` subworkflow has been removed; callers classify directly via HTTP
- email backlog import enqueues classify work through `/enrich/t1/batch`, but backlog ingest itself remains ingest-owned until enqueue
- sync calls use the OpenAI-compatible LiteLLM chat-completions path
- batch classify uses LiteLLM file + batch endpoints through backend-owned orchestration
- model routing is config-driven through `T1_DEFAULT_MODEL` and `T1_BATCH_MODEL`
- status aggregation exposes total, processed, pending, ok, parse_error, and error counters
- status queries are schema-aware and are not limited by the current runtime test-mode flag
- classify run sweep defaults `limit` to `1` when omitted; unlimited mode is removed for safety

## Goals
- keep Tier-1 orchestration behind backend APIs
- separate sync classify from batch lifecycle without fragmenting their shared domain logic
- keep LiteLLM and batch-runtime behavior invisible to n8n callers except through documented APIs
- preserve a clean handoff boundary from ingest into classify

## Non-goals
- defining ingest normalization rules
- owning Tier-2 distill planning or execution
- turning status queries for other stages into classify-owned behavior
- exposing provider-specific semantics to n8n callers

## Boundaries and callers
Primary callers:
- capture flows that trigger sync classify after successful ingest writes
- email backlog import once non-skipped rows are ready for batch classify enqueue
- operator or workflow status readers calling `/status/batch?stage=t1`

Boundary rule:
- ingest decides whether a row should continue downstream
- classify decides how Tier-1 model orchestration, batching, retries, and status persistence happen after that handoff

## Contract delta table
| Surface | Changes? | Baseline known? | Notes |
|---|---|---|---|
| Internal backend API | yes | yes | classify writeback routes include `/pkm/classify` and explicit update routes (`/enrich/t1/update*`) |
| Public webhook API | no | yes | out of scope here |
| Database schema | no | mostly | lifecycle table families are known; detailed writeback field set still has one review marker |
| Config / infra | no | yes | LiteLLM and backend runtime env dependencies are known |
| n8n workflows / nodes | yes | yes | capture caller inventory is now explicit and verified (`02`, `03`, `04`, `22`) |
| Runtime topology | no | yes | backend remains the only classify boundary |
| Docs | yes | yes | this pass backfills runtime and status detail into the PRD |
| Tests | no | yes | server/API/status tests exist for the current surface |

## Control plane / execution flow
### Sync classify
1. caller submits title/author/clean_text to `POST /enrich/t1`.
2. backend runs the Tier-1 graph.
3. LiteLLM handles the model call.
4. backend parses and returns Tier-1 results.

### Sync classify update
1. caller submits entry selector + classify input to `POST /enrich/t1/update`.
2. backend runs Tier-1 classify if `t1` was not provided.
3. backend applies the fixed Tier-1 writeback field set to `entries`.
4. backend syncs active-topic related-entry link (`classified_primary`) when topic maps to an active topic.
5. backend returns updated entry summary + topic-link result.

### PKM classify (capture-facing sync update)
1. caller submits `entry_id`, `clean_text`, and optional `title`/`author` to `POST /pkm/classify`.
2. backend runs the same Tier-1 sync graph (`load -> prompt -> llm -> parse`) used by `/enrich/t1`.
3. backend persists Tier-1 fields for the selected row and syncs active-topic link (`classified_primary`).
4. backend returns one row in `/pkm/insert/enriched` response shape (without `action`).

### Batch classify
1. caller submits `items[]` to `POST /enrich/t1/batch`.
2. backend validates and persists batch request state.
3. backend-owned batch worker schedules provider work and later collects results.
4. status is exposed through `/status/batch` with `stage=t1`.
5. batch collect persists parsed rows and applies explicit entry writeback through backend-owned classify update methods.

### Runtime contract
- Tier-1 must route through LiteLLM, not direct provider APIs.
- Backend client uses OpenAI-compatible LiteLLM endpoints:
  - sync classify: `/v1/chat/completions`
  - batch classify: `/v1/files`, `/v1/batches`, `/v1/files/{id}/content`
- Authentication uses `LITELLM_MASTER_KEY`.
- Base URL is configurable through `OPENAI_BASE_URL`.
- Model routing is config-driven:
  - `T1_DEFAULT_MODEL` for sync classify
  - `T1_BATCH_MODEL` for batch classify
- n8n and other callers never call LiteLLM directly for Tier-1 work.

### Orchestration contract
- Tier-1 orchestration is graph-driven via LangGraph.
- Current required graph families are:
  - sync enrichment
  - batch schedule
  - batch collect
- The node order stays explicit and extensible as:
  - `load -> prompt -> llm -> parse -> write`
- Shared parsing logic must be reused across sync classify and batch collect so Tier-1 JSON interpretation does not drift by execution mode.
- Observability rule:
  - LiteLLM interactions emit full LLM/proxy instrumentation
  - non-LLM graph nodes log primarily on error rather than flooding normal-path logs

## Data model / state transitions
Owned state categories:
- Tier-1 batch request lifecycle
- Tier-1 batch item lifecycle
- enrichment fields written back to entries

Representative lifecycle states:
- enqueue accepted
- queued / in progress
- terminal success or failure

### Batch visibility contract
- Status APIs expose read-only visibility into current Tier-1 batch jobs.
- Required aggregate counters per batch:
  - total items
  - processed
  - pending
  - ok
  - parse_error
  - error
- Detailed status reads may include bounded item-level listings for one batch.
- Status queries must support both `pkm` and `pkm_test` schemas regardless of the current test-mode flag.

## API / contract surfaces
Owned routes:
- `POST /enrich/t1`
- `POST /enrich/t1/update`
- `POST /pkm/classify`
- `POST /pkm/classify/batch`
- `POST /enrich/t1/batch`
- `POST /enrich/t1/update-batch`
- `GET /status/batch?stage=t1`
- `GET /status/batch/:batch_id?stage=t1`

Coupled docs:
- `docs/api_control.md`
- `docs/database_schema.md`
- `docs/backend_runtime_env.md`
- `docs/requirements.md` for Tier-1 invariants

## Config / runtime / topology implications
Relevant runtime/config surfaces:
- LiteLLM base URL, keys, and model route config
- backend batch worker/runtime settings
- batch persistence tables and related status APIs
- backend LangGraph execution layer and shared Tier-1 parsing logic

## Evidence / recovery basis
Recovered from:
- `src/server/index.js`
- `src/server/tier1/**`
- `src/server/litellm-client.js`
- `src/server/tier1-enrichment.js`
- `src/libs/sql-builder.js`
- `src/n8n/workflows/02-telegram-capture*`
- `src/n8n/workflows/03-e-mail-capture*`
- `src/n8n/workflows/04-notion-capture*`
- `src/n8n/workflows/22-web-extraction*`
- `src/n8n/nodes/03-e-mail-capture/compose-reply-text*`
- `src/n8n/workflows/23-e-mail-batch-import*`
- `docs/requirements.md`
- `docs/changelog.md`
- `docs/backend_runtime_env.md`
- `docs/api_ingest.md`

## Findings from backfill verification
- Verified capture caller inventory for single-row classify updates: `02 Telegram Capture`, `03 E-Mail Capture`, `04 Notion Capture`, `22 Web Extraction`.
- Verified `flags_json` is not a backend API field; it is an n8n-side optional compatibility read in `03` email reply composition.
- Verified `clean_len` is not part of canonical classify/update return shape; `clean_word_count` is used for caller-facing message rendering.
- Verified capture-facing classify response contract now requires `entry_id` and returns row-level enriched fields without `action`.

## Validation / acceptance criteria
This PRD remains accurate if:
- Tier-1 remains backend-owned and LiteLLM-backed
- n8n callers continue to use only the documented classify/status APIs
- backlog import remains ingest-owned only through enqueue
- stage-specific status behavior stays explicit in docs and code

## Risks / open questions
- the generic `/status/batch` surface is shared with distill; changes there must preserve the stage boundary rather than letting one surface implicitly own the other
- capture flows can accidentally couple ingest and classify too tightly if workflow logic starts duplicating backend orchestration assumptions

## TBD
- whether the legacy `/status/t1/batch*` compatibility paths should be removed on a future cleanup pass
