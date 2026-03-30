# PRD — Working Memory And Wrap Commit

Status: active  
Surface owner: backend working-memory/session-note artifact semantics  
Scope type: backfilled baseline  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_control.md`, `docs/external_api.md`, `docs/database_schema.md`, `docs/requirements.md`, `chatgpt/project_instructions.md`  
Related work-package doc: none

## Purpose
Separate the working-memory domain surface from the public GPT Actions integration boundary so topic memory, session-note semantics, and wrap/commit behavior can evolve without being buried inside webhook transport details.

## Use this PRD when
- changing working-memory retrieval or wrap-commit behavior
- changing working-memory artifact semantics, topic normalization, or memory-write invariants
- deciding whether a behavior belongs to GPT transport or the memory domain itself

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Control plane / execution flow`, `Data model / state transitions`, and `API / contract surfaces`.
- Planning agent: read `Goals`, `Boundaries and callers`, `Control plane / execution flow`, and `Risks / open questions`.
- Reviewing agent: read `Status and scope boundary`, `Data model / state transitions`, `Validation / acceptance criteria`, and `Known gaps requiring code deep-dive`.
- Architect agent: read `Boundaries and callers`, `API / contract surfaces`, and `Config / runtime / topology implications`.

## Status and scope boundary
This PRD owns:
- topic working-memory retrieval semantics
- session-note and working-memory write semantics for wrap/commit
- `POST /chatgpt/working_memory`
- `POST /chatgpt/wrap-commit`
- ChatGPT-authored artifact identity, idempotency, and non-enrichment rules
- the relationship to `chatgpt/project_instructions.md`

This PRD does not own:
- public webhook endpoints exposed to ChatGPT
- n8n webhook routing and response-envelope normalization
- generic read methods other than topic working-memory
- prompt-copy authoring as a PRD surface in its own right

## Current behavior / baseline
Current repo behavior is:
- topic-first ChatGPT workflow is documented in `chatgpt/project_instructions.md`
- `POST /chatgpt/working_memory` is an admin-protected internal route used for topic-keyed working-memory retrieval
- `POST /chatgpt/wrap-commit` is an admin-protected internal route used to persist one session note and one working-memory artifact in one backend flow
- wrap/commit writes exactly two artifacts:
  - session summary note
  - topic working memory
- session-note idempotency policy key is `chatgpt_session_note_v1` with primary key `chatgpt:<session_id>`
- working-memory idempotency policy key is `chatgpt_working_memory_v1` with primary key `wm:<normalized_topic_primary>`
- ChatGPT-authored session notes and working-memory rows must not trigger Tier-1 or Tier-2 enrichment
- there is no MCP execution layer in the active implementation; working-memory retrieval and wrap/commit run through backend `chatgpt` service modules directly

## Goals
- keep working-memory semantics separate from public transport/orchestration details
- keep topic normalization and artifact identity stable
- preserve explicit preview (`wrap`) then explicit persistence (`commit`) behavior
- keep prompt/instruction docs referenced rather than duplicated inside PRDs

## Non-goals
- owning the public webhook schema that ChatGPT calls
- redefining the assistant instruction set inside this PRD
- replacing the generic read surface
- making public MCP an active integration path again

## Boundaries and callers
Primary callers:
- `11 ChatGPT Read Router` for the `working_memory` method
- `05 ChatGPT Wrap Commit` for commit persistence
- backend `chatgpt-actions` adapter layer

Boundary rule:
- GPT Actions PRD owns the public ChatGPT -> n8n boundary
- this PRD owns what working-memory retrieval and wrap/commit actually mean inside the backend

## Control plane / execution flow
### Working-memory read
1. caller submits a topic.
2. backend normalizes topic label/key.
3. backend reads the current working-memory row for that topic.
4. backend returns a working-memory result envelope for the internal caller.

### Wrap commit
1. caller submits validated wrap-commit payload.
2. backend renders session-note markdown and working-memory markdown.
3. backend derives content hashes and idempotency keys.
4. backend inserts or updates both artifacts.
5. backend returns both artifact outcomes together.

## Data model / state transitions
Owned artifact types:
- ChatGPT session note
- topic working memory

Important invariants:
- one working-memory entry per normalized topic key
- one session-note identity per session id
- both artifacts are persisted through the same wrap/commit flow
- artifact content is derived from rendered markdown, then hashed

## API / contract surfaces
Owned internal routes:
- `POST /chatgpt/working_memory`
- `POST /chatgpt/wrap-commit`

Coupled docs:
- `docs/api_control.md`
- `docs/external_api.md` for the public webhook boundary that calls into these routes
- `chatgpt/project_instructions.md`
- `docs/requirements.md`

## Config / runtime / topology implications
Relevant surfaces:
- n8n workflows `05 ChatGPT Wrap Commit` and `11 ChatGPT Read Router`
- backend adapter layer in `src/server/chatgpt-actions.js`
- backend implementation in `src/server/chatgpt-actions.js` and `src/server/chatgpt/**`

## Evidence / recovery basis
Recovered from:
- `chatgpt/project_instructions.md`
- `src/server/index.js`
- `src/server/chatgpt-actions.js`
- `src/server/chatgpt/service.js`
- `src/server/chatgpt/renderers.js`
- `src/server/chatgpt/topic.js`
- `src/n8n/workflows/05-chatgpt-wrap-commit*`
- `src/n8n/workflows/11-chatgpt-read-router*`
- `docs/requirements.md`
- `docs/changelog.md`

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: verify whether any non-ChatGPT callers persist or consume these same artifact types. This pass confirmed the ChatGPT path, but did not exhaustively inventory alternate internal callers.`

## Validation / acceptance criteria
This PRD remains accurate if:
- topic working-memory retrieval stays distinct from generic read
- wrap/commit continues to persist exactly one session note and one working-memory artifact together
- ChatGPT-authored memory artifacts continue to bypass Tier-1 and Tier-2
- changes to prompt/instruction behavior update `chatgpt/project_instructions.md` and the affected PRDs together

## Risks / open questions
- transport/orchestration work can easily re-absorb this surface if public integration and memory semantics are documented together again

## TBD
- whether working-memory retrieval should ever be exposed to non-ChatGPT callers as a first-class product surface
