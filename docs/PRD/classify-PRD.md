# PRD — Classify (Tier-1 Enrichment)

Status: active  
Surface owner: backend Tier-1 orchestration + classify batch lifecycle  
Scope type: backfilled baseline  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_control.md`, `docs/database_schema.md`, `docs/backend_runtime_env.md`, `docs/requirements.md`  
Related work-package doc: none

## Purpose
Baseline the Tier-1 classify surface so it is cleanly separated from ingest on the way in and distill on the way out.

## Status and scope boundary
This PRD owns:
- `POST /enrich/t1`
- `POST /enrich/t1/batch`
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
- Tier-1 batch enqueue is exposed through `POST /enrich/t1/batch`
- batch status is exposed through the generic `/status/batch` surface with explicit `stage=t1`
- batch lifecycle persistence is backend-owned and restart-safe
- LiteLLM is the only model gateway for Tier-1
- Tier-1 orchestration is graph-driven and backend-owned; n8n callers use backend APIs only
- email backlog import enqueues classify work through `/enrich/t1/batch`, but backlog ingest itself remains ingest-owned until enqueue
- sync calls use the OpenAI-compatible LiteLLM chat-completions path
- batch classify uses LiteLLM file + batch endpoints through backend-owned orchestration
- model routing is config-driven through `T1_DEFAULT_MODEL` and `T1_BATCH_MODEL`
- status aggregation exposes total, processed, pending, ok, parse_error, and error counters
- status queries are schema-aware and are not limited by the current runtime test-mode flag

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
| Internal backend API | no | yes | API routes and batch-status surfaces are implemented and documented |
| Public webhook API | no | yes | out of scope here |
| Database schema | no | mostly | lifecycle table families are known; detailed writeback field set still has one review marker |
| Config / infra | no | yes | LiteLLM and backend runtime env dependencies are known |
| n8n workflows / nodes | no | mostly | main workflow callers are known; exact full caller inventory still has one review marker |
| Runtime topology | no | yes | backend remains the only classify boundary |
| Docs | yes | yes | this pass backfills runtime and status detail into the PRD |
| Tests | no | yes | server/API/status tests exist for the current surface |

## Control plane / execution flow
### Sync classify
1. caller submits title/author/clean_text to `POST /enrich/t1`.
2. backend runs the Tier-1 graph.
3. LiteLLM handles the model call.
4. backend parses and returns Tier-1 results.

### Batch classify
1. caller submits `items[]` to `POST /enrich/t1/batch`.
2. backend validates and persists batch request state.
3. backend-owned batch worker schedules provider work and later collects results.
4. status is exposed through `/status/batch` with `stage=t1`.

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
- `POST /enrich/t1/batch`
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
- `src/n8n/workflows/21-tier-1-enrichment*`
- `src/n8n/workflows/23-e-mail-batch-import*`
- `docs/requirements.md`
- `docs/changelog.md`
- `docs/backend_runtime_env.md`
- `docs/api_ingest.md`

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: verify the exact set of n8n capture workflows that currently call sync `/enrich/t1` before redesigning the ingest -> classify handoff. This pass confirmed the API surface and backlog batch path, but did not fully inventory every workflow caller.`
- `REVIEW_REQUIRED: verify the exact writeback field set for Tier-1 results in `src/server/tier1/**` and DB tests before treating this PRD as a migration guide. The current surface ownership is clear, but the full persisted result contract was not exhaustively recovered in this pass.`

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
