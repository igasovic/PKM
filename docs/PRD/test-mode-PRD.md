# PRD — Test Mode And Schema Routing

Status: active  
Surface owner: backend runtime-config state + schema-routing capability  
Scope type: canonical surface  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_read_write.md`, `docs/database_schema.md`, `docs/env.md`, `docs/requirements.md`  
Related work-package doc: none

## Purpose
Define the runtime test-mode capability that switches PKM data operations between `pkm` and `pkm_test` without requiring separate deployments.

## Status and scope boundary
This PRD owns:
- persisted runtime test-mode state under `pkm.runtime_config`
- backend cache and toggle semantics for that state
- `GET /db/test-mode`
- `POST /db/test-mode/toggle`
- automatic schema routing for generic PKM DB operations that honor test mode
- UI and smoke harness usage of the toggle/read surface

This PRD does not own:
- business behavior inside ingest/classify/distill/read surfaces beyond which schema they target
- prod-only business-log tables that explicitly opt out of test mode
- family-calendar business logs
- public ChatGPT integration contracts

## Current behavior / baseline
Current repo behavior is:
- test-mode state is persisted in Postgres runtime config under key `is_test_mode`
- backend reads that state through `TestModeService` with a 10s in-memory cache
- toggle and set operations refresh cache immediately
- `GET /db/test-mode` returns `[{ is_test_mode: boolean }]`
- `POST /db/test-mode/toggle` flips the state atomically and returns the new state in the DB-style rows envelope
- generic PKM reads and writes route to `pkm` when test mode is off and `pkm_test` when it is on
- the PKM UI includes a sidebar control that reads and toggles test mode
- smoke setup and cleanup use the same backend endpoints instead of shell-only toggles
- API `/config` remains static config only and does not own mutable test-mode state
- batch workers must scan both configured schemas so pending work is not stranded by mode flips or restarts

## Goals
- provide one mutable runtime switch for PKM data isolation
- keep schema routing centralized in backend logic rather than scattered in callers
- make the current test-mode state visible to operators and tooling
- keep state changes immediately observable by subsequent requests

## Non-goals
- parallel prod/test deployments
- moving business-log tables into the test-mode router automatically
- exposing raw runtime-config mutation beyond the owned endpoints
- making test mode the owner of feature semantics for ingest/read/classify/distill

## Boundaries and callers
Primary callers:
- PKM UI sidebar toggle in `src/web/pkm-debug-ui`
- smoke harness setup/cleanup flows
- backend DB module methods that resolve active schema at request time

Boundary rule:
- callers may read or toggle test mode through the owned endpoints
- callers must not embed their own schema-selection defaults when backend routing already owns that decision

## Control plane / execution flow
1. caller reads test mode through `GET /db/test-mode` when it needs the current operator-visible state.
2. caller flips the state through `POST /db/test-mode/toggle`.
3. backend persists the new boolean in `pkm.runtime_config`.
4. backend cache is updated immediately.
5. subsequent PKM DB operations resolve their active schema from the persisted state.

### Routing and worker contract
- Generic PKM DB operations route to:
  - `pkm` when `is_test_mode = false`
  - `pkm_test` when `is_test_mode = true`
- Mutable test-mode state must never silently fall back to static env/config defaults.
- Worker/runtime coverage rule:
  - queue and batch workers must not depend only on the current active flag
  - they must scan both configured schemas so pending work in either schema continues across restarts and mode flips

## Data model / state transitions
Owned mutable state:
- runtime-config key `is_test_mode`

Expected transitions:
- `false -> true`
- `true -> false`
- explicit error if the underlying runtime-config table is missing or unreadable

Cache rules:
- cache TTL is 10s
- toggle/set operations refresh or invalidate cache immediately
- cache is an in-memory optimization only and does not survive process restart

## API / contract surfaces
Owned routes:
- `GET /db/test-mode`
- `POST /db/test-mode/toggle`

Coupled docs:
- `docs/api_read_write.md`
- `docs/database_schema.md`
- `docs/requirements.md` when schema-routing invariants change

## Config / runtime / topology implications
Relevant runtime surfaces:
- Postgres runtime-config table
- backend cache process state
- UI and smoke callers that display or mutate the state

Test mode remains runtime-mutable state, not a repo-managed `checkcfg` / `updatecfg` surface.

## Evidence / recovery basis
Recovered from:
- `src/server/index.js`
- `src/server/test-mode.js`
- `src/server/db.js`
- `src/web/pkm-debug-ui/src/App.tsx`
- `src/n8n/workflows/00-smoke-master*`
- `docs/requirements.md`
- `docs/changelog.md`

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: produce a complete exemption matrix for tables and APIs that intentionally ignore test mode. Calendar logs and failure packs are documented exceptions, but this pass did not exhaustively verify every newer table or debug surface against the DB module.`

## Validation / acceptance criteria
This PRD remains accurate if:
- test-mode state is still persisted in Postgres rather than static env/config
- cache remains an optimization only, never the source of truth
- the owned endpoints continue to return explicit state rows
- generic PKM reads/writes continue to honor the persisted state

## Risks / open questions
- changes that add new tables or batch surfaces can accidentally bypass or over-apply test mode unless the exemption matrix stays current
- UI and smoke assumptions should stay thin; the backend must remain the owner of routing semantics

## TBD
- whether a non-toggle `set` endpoint should exist for safer automation and UI flows
