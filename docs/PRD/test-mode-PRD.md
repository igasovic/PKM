# PRD — Test Mode And Schema Routing

Status: active  
Surface owner: backend runtime-config state + schema-routing capability  
Scope type: canonical surface  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_read_write.md`, `docs/database_schema.md`, `docs/env.md`, `docs/requirements.md`, `docs/test_mode_exemptions.md`  
Related work-package doc: none

## Purpose
Define the runtime test-mode capability that switches PKM data operations between `pkm` and `pkm_test` without requiring separate deployments.

## Use this PRD when
- changing persisted test-mode state, schema routing, or test/prod isolation guarantees
- changing `/db/test-mode*` endpoints or worker behavior that depends on schema routing
- deciding whether a test concern belongs to smoke harnesses or to the platform test-mode surface

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Control plane / execution flow`, `Routing and worker contract`, `Data model / state transitions`, and `API / contract surfaces`.
- Planning agent: read `Goals`, `Boundaries and callers`, `Control plane / execution flow`, and `Config / runtime / topology implications`.
- Reviewing agent: read `Status and scope boundary`, `Routing and worker contract`, `Validation / acceptance criteria`, and `Risks / open questions`.
- Architect agent: read `Boundaries and callers`, `Data model / state transitions`, `API / contract surfaces`, and `Config / runtime / topology implications`.

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
- backend reads that state through `TestModeService` with a 2s in-memory cache (reduced from 10s on 2026-03-31)
- toggle and set operations refresh cache immediately
- `POST /db/test-mode/toggle` requires admin secret (added 2026-03-31)
- `GET /db/test-mode` returns `[{ is_test_mode: boolean, test_mode_on_since: iso_timestamp|null }]` (watchdog timestamp added 2026-03-31)
- `POST /db/test-mode/toggle` flips the state atomically and returns the new state in the DB-style rows envelope
- generic PKM reads and writes route to `pkm` when test mode is off and `pkm_test` when it is on
- the PKM UI includes a sidebar control that reads and toggles test mode
- smoke setup and cleanup use the same backend endpoints instead of shell-only toggles
- API `/config` remains static config only and does not own mutable test-mode state
- batch workers must scan both configured schemas so pending work is not stranded by mode flips or restarts

## Original intent and operator context

Test mode was created to solve a specific solo-operator problem: when email/webpage normalization pipelines break or need tuning, the operator needs an easy way to drop random links and emails into the system repeatedly until behavior is correct — without polluting production data or requiring a second environment.

This is a one-person project. Running two separate environments (separate backends, separate databases, separate n8n instances) is too much maintenance overhead. The schema-level split (`pkm` vs `pkm_test`) was chosen deliberately: everything else stays the same — same backend, same n8n workflows, same entry points — except where data is stored.

### Primary use cases
1. **Manual QA**: operator feeds test emails, links, and messages through all regular entry points (Telegram, email, Notion, calendar, web) with test mode on, inspects results, iterates on pipeline logic.
2. **Smoke tests**: automated post-deploy verification inserts and reads entries in `pkm_test`, validates contracts, cleans up.
3. **Pipeline debugging**: reproduce a specific failure by re-ingesting the same input in test schema without risk to production data.

### Known pain points (as of 2026-03-31)
- **Data loss**: operator forgets to move useful test entries to prod before cleanup, losing work.
- **Prod pollution**: operator forgets to turn test mode on before manual QA, or forgets to turn it off after, causing real data to land in test schema or test data to land in prod.
- **Stale cleanup**: smoke test crashes mid-run, leaving test mode on and test data behind.
- **Table coverage drift**: test mode originally covered only `entries`. Now multiple table families (entries, idempotency_policies, t1_batch_*, t2_batch_*) are routed, while others (calendar, debug, runtime) are intentionally exempt. This makes the mental model muddy — operator must remember which surfaces follow test mode and which don't.
- **n8n complexity constraint**: n8n workflows are the primary orchestration layer for all entry points. Any solution that requires per-request header logic in n8n adds maintenance burden that outweighs the benefit. n8n must remain simple — ideally unaware of test mode entirely.

## Goals
- provide one mutable runtime switch for PKM data isolation
- keep schema routing centralized in backend logic rather than scattered in callers
- make the current test-mode state visible to operators and tooling
- keep state changes immediately observable by subsequent requests
- support manual QA through all regular entry points without requiring callers (especially n8n) to carry test-mode awareness

## Non-goals
- parallel prod/test deployments or separate environments
- moving business-log tables into the test-mode router automatically
- exposing raw runtime-config mutation beyond the owned endpoints
- making test mode the owner of feature semantics for ingest/read/classify/distill
- requiring n8n workflows to pass schema headers or test-mode flags

## Boundaries and callers
Primary callers:
- PKM UI sidebar toggle in `src/web/pkm-debug-ui`
- smoke harness setup/cleanup flows
- backend DB store methods that resolve active schema at request time

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
- cache TTL is 2s (reduced from 10s on 2026-03-31 to narrow the stale-state window)
- toggle/set operations refresh or invalidate cache immediately
- cache is an in-memory optimization only and does not survive process restart
- `testModeOnSince` timestamp tracks when test mode was last activated (watchdog support)

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
- `src/server/routes/read-write-routes.js`
- `src/server/routes/control-routes.js`
- `src/server/test-mode.js`
- `src/server/db/runtime-store.js`
- `src/web/pkm-debug-ui/src/App.tsx`
- `src/n8n/workflows/00-smoke-master*`
- `docs/requirements.md`
- `docs/changelog.md`

## Exemption matrix

The maintained exemption matrix now lives in `docs/test_mode_exemptions.md`.

Use it when:
- adding a new store or table that might follow active test mode
- reviewing whether a fixed-table or prod-pinned surface is intentional
- checking batch surfaces that scan both schemas instead of following the active flag

## Validation / acceptance criteria
This PRD remains accurate if:
- test-mode state is still persisted in Postgres rather than static env/config
- cache remains an optimization only, never the source of truth
- the owned endpoints continue to return explicit state rows
- generic PKM reads/writes continue to honor the persisted state

## Risks / open questions
- changes that add new tables or batch surfaces can accidentally bypass or over-apply test mode unless the exemption matrix stays current
- UI and smoke assumptions should stay thin; the backend must remain the owner of routing semantics
- global toggle is the root cause of all known pain points (data loss, prod pollution, stale cleanup) — incremental fixes (auth, watchdog, shorter cache) reduce severity but do not eliminate the fundamental race between "operator intent" and "request timing"
- manual QA sessions can span hours; any solution must handle long-lived test mode without risking prod data during that window
- n8n is the primary orchestration layer and must remain test-mode-unaware; solutions requiring per-request n8n changes are not viable

## TBD
- whether a non-toggle `set` endpoint should exist for safer automation and UI flows
- whether auto-expiry (test mode turns off after N minutes) would prevent forgotten-on scenarios without disrupting long QA sessions
- whether a "move entries from test to prod" command would prevent data loss during QA cleanup
- whether the global toggle should be replaced or augmented with a different isolation mechanism
