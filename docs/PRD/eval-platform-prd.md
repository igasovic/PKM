# PRD — Eval Platform (Fixtures, Runners, Case Explorer)

Status: active  
Surface owner: Eval platform across router/calendar/todoist and PKM UI case exploration  
Scope type: canonical surface  
Last verified: 2026-04-14  
Related authoritative docs: `evals/README.md`, `evals/eval-writing-guide.md`, `docs/api_calendar.md`, `docs/api_todoist.md`, `docs/api_control.md`, `docs/testing_strategy.md`  
Related work-package doc: none (this PRD currently carries its own staged plan)

## Purpose
Define a single owned surface for eval infrastructure so existing implementation and future expansion stay coherent across:
- eval fixtures (`gold` and `candidates`)
- live eval runners and shared tooling
- report outputs
- PKM UI eval case exploration UX

This PRD explicitly includes both:
- already implemented eval infrastructure
- planned repo-first UI case explorer behavior

## Use this PRD when
- adding or changing eval fixture schemas, corpus layout, or fixture lifecycle rules
- adding or changing live eval runners, shared eval libs, scoring, or report generation
- adding or changing PKM UI eval exploration surfaces
- deciding whether eval functionality should be repo-first, backend API-based, or mixed

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Current behavior / baseline`, `Control plane / execution flow`, `Work plan`, and `Validation / acceptance criteria`.
- Planning agent: read `Goals`, `Boundaries and callers`, `Work plan`, and `Risks / open questions`.
- Reviewing agent: read `Status and scope boundary`, `Current behavior / baseline`, `Validation / acceptance criteria`, and `Risks / open questions`.
- Architect agent: read `Boundaries and callers`, `Control plane / execution flow`, `API / contract surfaces`, and `Config / runtime / topology implications`.

## Status and scope boundary
This PRD owns:
- the top-level eval platform structure under `evals/` and `scripts/evals/`
- fixture lifecycle and cross-surface consistency rules
- shared runner utility patterns
- non-gating scoring/reporting conventions for eval runs
- PKM UI eval case exploration requirements and constraints

This PRD does not own:
- domain behavior semantics for calendar routing/normalization or todoist normalization
- deployment gating policy for CI/CD outside eval-surface-specific guidance
- backend route semantics not explicitly tied to eval surfaces

Domain-specific behavior remains owned by:
- family calendar PRD
- todoist planning PRD

## Current behavior / baseline
Implemented as of 2026-04-14:
- non-gating live eval surfaces exist for:
  - `POST /telegram/route`
  - `POST /calendar/normalize`
  - `POST /todoist/eval/normalize`
- live runners exist:
  - `scripts/evals/run_router_live.js`
  - `scripts/evals/run_calendar_live.js`
  - `scripts/evals/run_todoist_live.js`
- shared eval libs exist under `scripts/evals/lib/` for:
  - fixtures
  - live API calls
  - scoring
  - reporting
  - common runner helpers (`runner-common.js`)
- a reusable eval authoring guide exists:
  - `evals/eval-writing-guide.md`
- reports are generated to:
  - `evals/reports/<surface>/<timestamp>.json`
  - `evals/reports/<surface>/<timestamp>.md`
- current eval execution pattern is CLI-based (`npm run eval:*:live` and `scripts/evals/run_evals.sh`)
- evals are advisory and non-gating

- PKM UI page `/evals` now exists for lightweight eval case exploration from repo fixture files.

## Goals
- keep eval assets repo-first, explicit, and reviewable
- make eval buildouts consistent across surfaces
- reduce runner duplication through shared utilities
- enable lightweight UI exploration of actual eval cases (table + card) without requiring report parsing
- preserve human review in fixture promotion workflow

## Non-goals
- turning evals into mandatory CI deploy gates
- auto-promoting candidate fixtures to gold fixtures
- replacing domain PRDs with this platform PRD
- adding backend eval run orchestration for the case-explorer-only requirement

## Boundaries and callers
Current callers:
- operators / developers via shell commands
- test suites under `test/server/*eval-tooling*.test.js`

Additional caller:
- PKM UI `/evals` page (read-only case exploration)

Boundary decision for UI case explorer:
- source of truth must be fixture files in the same repo as the UI code
- this exploration mode must not depend on backend eval APIs or report JSON as primary data source
- this mode is for reading actual cases, not running evals

## Control plane / execution flow
### A. Existing live eval run flow
1. runner loads gold fixtures from `evals/<surface>/fixtures/gold/`.
2. runner validates fixture shape and corpus minima.
3. runner executes live backend calls per case with unique `run_id`.
4. runner checks observability traces (unless disabled).
5. runner scores outcomes and writes JSON + Markdown reports under `evals/reports/`.

### B. Repo-first case explorer flow (PKM UI)
1. UI reads fixture files from repo paths (router/calendar/todoist, gold and optional candidates).
2. UI normalizes heterogeneous fixture shapes into a common case-view model.
3. UI presents:
   - table view for fast scanning
   - detail card for selected case (`input`, `expect`, tags, bucket, metadata)
4. UI supports filters (surface, tier, suite, bucket, corpus group, text search).
5. no run/start/cancel operations are exposed in this mode.

## Data model / fixture lifecycle
Canonical fixture roots:
- `evals/router/fixtures/gold/`
- `evals/router/fixtures/candidates/`
- `evals/calendar/fixtures/gold/`
- `evals/calendar/fixtures/candidates/`
- `evals/todoist/fixtures/gold/`
- `evals/todoist/fixtures/candidates/`

Lifecycle:
1. real failure or synthetic case drafted into `candidates/`
2. expected output labeled by human review
3. promoted into `gold/` via explicit PR change

Invariants:
- `case_id` must be stable and unique within suite context
- candidate cases are never auto-promoted
- todoist `prompt_examples` and `eval_core` remain disjoint
- corpus-size and bucket-distribution checks remain enforced in tooling/tests

## API / contract surfaces
Current eval platform contracts:
- existing backend eval endpoints already documented in owning API docs
- runner/report contracts are file- and tooling-based inside repo

UI case explorer contract:
- repo fixture files are authoritative source
- no new backend endpoints required for the case-explorer-only mode

If future scope introduces backend eval case APIs, update in the same change set:
- `docs/api_control.md` (or relevant API domain doc)
- `docs/api.md`
- route registry docs and tests

## Config / runtime / topology implications
Current:
- live eval runs depend on backend reachability and admin secret handling
- report artifacts remain repo-tracked outputs under `evals/reports/`

UI case explorer:
- local UI dev/runtime must have read access to repo fixture paths
- no new backend runtime or database dependency is required for case browsing
- avoid introducing direct DB coupling or hidden backend dependencies for this surface

## Work plan
### Phase 0 (implemented baseline)
- [x] three live eval surfaces (router, calendar normalize, todoist normalize)
- [x] shared eval libraries
- [x] shared runner-common extraction
- [x] eval writing guide
- [x] per-surface tooling tests and shared helper tests

### Phase 1 (next target)
- [x] add PKM UI `/evals` case explorer for repo fixtures only
- [x] render lightweight table + card views for actual cases
- [x] add filtering/search for case discovery
- [x] keep this mode strictly read-only (no run actions)

### Phase 2 (future expansion, optional)
- [ ] add richer cross-surface case taxonomy and tagging standards
- [ ] add UI affordances for candidate-to-gold review workflows
- [ ] add optional report linkage from case detail without making reports primary data source

## Validation / acceptance criteria
This PRD remains accurate if:
- eval fixture lifecycle and non-gating nature stay explicit
- shared runner patterns continue to avoid duplicated plumbing
- case exploration can read actual fixture cases directly from repo
- case explorer does not require backend eval APIs for its core read path

When implementing Phase 1:
- UI must display actual fixture cases across all current surfaces
- UI must support table and card views
- UI must support at least surface + text filters
- no run/start/cancel controls are introduced

## Risks / open questions
- local/dev-only repo file access in UI may need careful handling for production packaging
- fixture volume growth may require pagination/virtualization in UI explorer
- candidate fixture folder conventions may diverge unless naming rules are standardized

## TBD
- whether case explorer should include in-browser fixture diff views across commits
- whether UI should support fixture export/copy helpers
- whether a dedicated eval taxonomy doc is needed once more surfaces are added
