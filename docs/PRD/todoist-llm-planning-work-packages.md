# Todoist LLM Planning Work Packages

- **Title:** Todoist planning implementation work packages
- **Status:** active
- **Companion type:** work-package companion
- **Canonical PRD:** `todoist-llm-planning-prd.md`
- **Baseline date / last verified date:** 2026-04-11

## Use this doc when
- sequencing Todoist planning implementation across backend, n8n, and PKM UI
- assigning bounded work slices while preserving contract/doc coupling
- checking workflow numbering and contract coverage before rollout

## Fast path
- start with WP1 for schema + backend contracts
- complete WP2 before `/waiting` Telegram command is considered done
- close each work package by updating canonical PRD and contract docs in the same change

## Dependency summary
- WP1 -> WP2 -> WP3 -> WP4
- WP5 runs in parallel once API schemas stabilize

## Implementation status (2026-04-11)
- WP1: completed
- WP2: completed
- WP3: completed
- WP4: completed
- WP5: completed

## Work package format
Each work package references sections in `todoist-llm-planning-prd.md`.

---

## WP1 — Backend + schema foundation
**References:** PRD sections 5, 6, 7, 8, 9, 10

### Goal
Implement the Todoist planning backend surface and prod-pinned table model.

### In scope
- add migration for `pkm.todoist_task_current` and `pkm.todoist_task_events`
- add Todoist store/repository/service/route modules
- implement reconcile transitions (`first_seen`, waiting transitions, `closed`, `reopened`)
- implement deterministic review-rule precedence and manual review actions
- wire LangGraph normalization node and telemetry usage pattern

### Deliverables
- migration file under `scripts/db/migrations/`
- backend route family `/todoist/*`
- Todoist service + store + repository code
- backend tests for contracts and deterministic behavior

### Acceptance
- `/todoist/sync` persists current/task-event state correctly
- `/todoist/review/*` actions behave per precedence rules
- brief endpoints return deterministic payloads with Telegram message text
- no raw SQL outside approved DB files

---

## WP2 — n8n workflow family `34–37` and command routing
**References:** PRD sections 5, 9, 10, 12

### Goal
Ship Todoist workflow block with contiguous numbering and Telegram delivery.

### In scope
- add workflows:
  - `34 Todoist Sync`
  - `35 Todoist Daily Focus`
  - `36 Todoist Waiting Radar`
  - `37 Todoist Weekly Pruning`
- add `/waiting` command support in `10 Read` parser/switch and route into workflow `36`
- externalize helper code nodes under `src/n8n/nodes/34-*` through `37-*`
- add root exports `wf34*`–`wf37*` in runtime package manifest

### Deliverables
- workflow JSONs under `src/n8n/workflows/`
- node helpers under `src/n8n/nodes/34-*` ... `37-*`
- command parser/switch updates in workflow `10 Read`
- n8n helper and routing tests

### Acceptance
- `34` runs hourly at `:05` and is callable as subworkflow
- `35` runs at `05:45 America/Chicago` and sends daily brief
- `36` is on-demand only and sends waiting radar
- `37` runs Sunday `18:30 America/Chicago` and sends weekly pruning
- `/waiting` command invokes workflow `36`

---

## WP3 — PKM UI Todoist review surface
**References:** PRD sections 7, 11, 14

### Goal
Provide operator/debug review controls for Todoist parse quality.

### In scope
- add `/todoist` page to PKM debug UI
- add queue views: Needs review, Unreviewed, Accepted, Overridden, All
- add actions: Accept, Override, Re-run parse, Next item
- expose editable fields:
  - `normalized_title_en`
  - `task_shape`
  - `suggested_next_action`
- render event history from `todoist_task_events`

### Deliverables
- new page component + route/nav wiring
- Todoist API client methods and UI types
- Vite proxy route support for `/todoist/*`

### Acceptance
- queue + selected-item fetch works end to end
- manual actions update status and refresh queue state
- event history is visible for selected item

---

## WP4 — Contract and architecture docs alignment
**References:** PRD sections 5, 6, 10, 12, 16

### Goal
Keep docs as source-of-truth for new Todoist planning contracts.

### In scope
- add `docs/api_todoist.md`
- update:
  - `docs/api.md`
  - `docs/database_schema.md`
  - `docs/backend_db_store_map.md`
  - `docs/test_mode_exemptions.md`
  - `docs/n8n_backend_contract_map.md`
  - `docs/service_dependency_graph.md`
  - `docs/env.md`
  - `docs/PRD/README.md`
  - `docs/PRD/todoist-llm-planning-prd.md`
  - `docs/changelog.md`

### Deliverables
- aligned contract docs in one changeset
- PRD index/work-package ownership updates

### Acceptance
- no `/todoist/*` route exists undocumented
- prod-only Todoist table behavior is documented in schema + test-mode docs
- n8n/route ownership docs reflect `34–37` and `/waiting`

---

## WP5 — Validation + generated artifacts
**References:** PRD sections 14, 16

### Goal
Lock in regression coverage and regenerate route/matrix artifacts.

### In scope
- backend contract tests for `/todoist/*`
- deterministic behavior tests for reconcile/review/ranking
- DB integration coverage for prod-pinned Todoist tables
- n8n parser + helper/workflow tests for `/waiting` and `34–37`
- regenerate route registry and backend test matrix

### Deliverables
- updated/added tests under `test/server/`
- regenerated:
  - `docs/backend_route_registry.json`
  - `docs/backend_test_surface_matrix.md`

### Acceptance
- tests pass for new Todoist surfaces
- generated route/matrix artifacts include `/todoist/*`
- full repo gate `bash scripts/CI/check.sh` passes

## Exit criteria for V1
V1 is ready when all of the below are true:
- backend sync/review/brief contracts are implemented and tested
- workflow block `34–37` is implemented with contiguous naming
- `/waiting` command routes to on-demand waiting radar
- PKM UI `/todoist` review surface works for accept/override/reparse loop
- authoritative docs and PRD ownership are updated in the same change set
