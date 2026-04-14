# Todoist LLM Planning Work Packages

- **Title:** Todoist planning implementation work packages
- **Status:** active
- **Companion type:** work-package companion
- **Canonical PRD:** `todoist-llm-planning-prd.md`
- **Baseline date / last verified date:** 2026-04-13

## Use this doc when
- sequencing Todoist planning implementation across backend, n8n, and PKM UI
- assigning bounded work slices while preserving contract/doc coupling
- checking workflow numbering and contract coverage before rollout
- planning parser-quality and eval-harness follow-on work

## Fast path
- historical implementation slices are WP1–WP5
- eval corpus + harness foundation is WP6 (now completed)
- current parser-quality tuning work continues in WP7+
- close each work package by updating canonical PRD and contract docs in the same change

## Dependency summary
- Historical implementation: WP1 -> WP2 -> WP3 -> WP4, with WP5 in parallel once API/schema stabilized
- Current iteration: WP6 -> WP7 -> WP8 -> WP9 -> WP10

## Implementation status (2026-04-13)
- WP1: completed
- WP2: completed
- WP3: completed
- WP4: completed
- WP5: completed
- WP6: completed
- WP7: active
- WP8: active
- WP9: completed
- WP10: active

## Work package format
Each work package references sections in `todoist-llm-planning-prd.md`.

---

## WP1 — Backend + schema foundation
**Status:** completed  
**References:** PRD sections 5, 6, 7, 8, 10, 11

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
- brief endpoints return deterministic payloads with rationale support
- no raw SQL outside approved DB files

---

## WP2 — n8n workflow family `34–37` and command routing
**Status:** completed  
**References:** PRD sections 5, 10, 13

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
**Status:** completed  
**References:** PRD sections 7, 12, 15

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
**Status:** completed  
**References:** PRD sections 5, 6, 11, 13, 17

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
**Status:** completed  
**References:** PRD sections 15, 17

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

---

## WP6 — Eval corpus + harness foundation
**Status:** completed  
**References:** PRD sections 8, 9, 15

### Goal
Establish the Todoist normalization eval workflow, following the existing calendar eval pattern.

### In scope
- add one canonical Todoist parse corpus source with required `corpus_group` column
- support allowed group values:
  - `gold_only`
  - `prompt_examples`
  - `eval_core`
- ensure `prompt_examples` and `eval_core` are disjoint
- add loaders/build steps for:
  - prompt few-shot examples from `prompt_examples`
  - locked scoring on `eval_core`
- report baseline parser results at minimum for:
  - task-shape accuracy
  - next-action null/non-null agreement
  - project overcall rate
- support growth of the corpus without blocking implementation on final quota

### Deliverables
- canonical Todoist parse corpus file committed in repo
- corpus-loading utilities
- locked eval runner for `eval_core`
- baseline eval report artifact

### Acceptance
- parser prompt never sees `eval_core`
- eval harness is reproducible from canonical corpus source
- baseline report is produced from current parser behavior
- implementation pattern matches the existing calendar eval approach

### Implementation note (current)
- canonical gold fixture created from corpus workbook (`evals/todoist/fixtures/gold/normalize.json`)
- fixture loader, scoring, and markdown/json reporting are implemented in shared eval libs
- Pi live runner is implemented (`scripts/evals/run_todoist_live.js`) and wired into:
  - `src/server/package.json` -> `npm run eval:todoist:live`
  - `scripts/evals/run_evals.sh --todoist`
- dedicated backend eval endpoint is implemented (`POST /todoist/eval/normalize`, admin-secret protected, no Todoist table writes)

---

## WP7 — Normalization retune
**Status:** active  
**References:** PRD sections 8, 9, 15, 16

### Goal
Retune parser behavior to match the real task corpus.

### In scope
- update parser prompt
- inject prompt few-shot examples only from `prompt_examples`
- narrow `project` classification
- incorporate stronger project evidence:
  - `has_subtasks`
  - explicit project signal (for example `PRJ:`)
  - clearly multi-step workstream phrasing
- bias short actionable home/personal/admin tasks toward `next_action`
- prefer one concrete next action for true `project` items when supported

### Deliverables
- updated parser prompt resources
- parser-input support for `has_subtasks` / explicit project signal when available
- before/after eval report against locked `eval_core`

### Implementation note (current)
- prompt rubric retune is implemented
- prompt includes explicit few-shot placeholder token for future corpus injection
- parser input wiring for `has_subtasks` and explicit project signal is implemented
- locked eval report generation now uses WP6 live runner and should be executed on Pi

### Acceptance
- project overcall rate drops materially
- shape accuracy improves on `eval_core`
- obvious short actionable tasks stop defaulting to `project`

---

## WP8 — Review and ranking recalibration
**Status:** active  
**References:** PRD sections 7, 11, 14, 15, 16

### Goal
Retune downstream behavior after parser quality improves.

### In scope
- review threshold calibration
- reconsider daily brief treatment of reviewed `project` items
- preserve deterministic shortlist selection
- keep LLM rationale generation as wording-only
- tune weights/caps only after parser gains are measured

### Deliverables
- updated review/ranking logic
- before/after comparison using current corpus + system outputs
- brief/radar/pruning smoke checks

### Implementation note (current)
- review-threshold defaults and risky-project evidence handling were recalibrated in code
- ranking received conservative shape-sensitive tuning for daily/weekly behavior
- corpus-based before/after comparison now depends on running WP6 live eval snapshots on Pi

### Acceptance
- review queue becomes more manageable
- daily brief no longer excludes most useful tasks because of project overcalls
- overdue handling remains strong

---

## WP9 — Review-loop instrumentation and UI polish
**Status:** completed  
**References:** PRD sections 12, 14, 15

### Goal
Improve the correction loop and turn manual corrections into better future eval inputs.

### In scope
- expose useful parser/eval signals in PKM UI where appropriate
- keep review throughput fast
- make correction events easy to mine into future corpus additions
- adjust queue sorting only if parser/ranking recalibration changes review burden materially

### Deliverables
- UI polish for queue/detail loop
- correction-export or event-mining helper path
- small operator note on adding future eval rows from overrides

### Implementation note (current)
- PKM UI `/todoist` now includes copy helpers for full selected-task JSON and corpus-seed JSON rows (`corpus_group: gold_only`)

### Acceptance
- review loop stays fast
- corrected tasks are easy to promote into `gold_only` corpus rows later

---

## WP10 — Docs + final validation pass
**Status:** active  
**References:** PRD sections 9, 14, 15, 16, 17

### Goal
Freeze the parser-quality iteration boundary and align docs.

### In scope
- update canonical PRD with current parser/eval posture
- update work-package companion statuses
- update any contract docs touched by parser/ranking changes
- record locked eval results and acceptance posture

### Deliverables
- updated PRD/work-package docs
- eval result snapshot
- changelog entry if behavior materially changes

### Implementation note (current)
- docs/changelog are updated for parser retune and review/ranking recalibration
- eval snapshot now depends only on running Pi live eval against current backend

### Acceptance
- docs reflect current implementation and current target
- eval posture is explicit, not hidden in TODOs
- completed/active work packages are clearly separated

---

## Exit criteria for current iteration
Parser-quality iteration is ready to pause when all of the below are true:
- canonical corpus exists with `prompt_examples` and locked `eval_core`
- parser prompt does not see `eval_core`
- project overcall rate is materially reduced
- shape accuracy improves on locked eval
- review queue becomes operationally manageable
- docs reflect the new eval and parser-tuning surface
