# Recipes Work Packages

- **Title:** Recipes implementation work packages
- **Status:** active
- **Companion type:** work-package companion
- **Canonical PRD:** `recipes-prd.md`
- **Baseline date / last verified date:** 2026-04-02

## Use this doc when
- sequencing implementation of the recipes surface
- assigning coding/review work in bounded slices
- checking whether contract/doc/schema changes are grouped correctly

## Fast path
- start with WP1 if no recipe table/API exists yet
- do not start WP3 or WP4 before WP1 and WP2 contracts are stable
- close each work package by updating the canonical PRD baseline first

## Dependency summary
- WP0 -> WP1 -> WP2 -> WP3 -> WP4 -> WP5
- WP6 can begin once WP2 response shapes are stable

## Implementation status (2026-04-02)
- WP0: completed (recipe telemetry naming aligned to existing `api.recipes.*` / `recipes_*` DB trace conventions)
- WP1: completed
- WP2: completed
- WP3: completed for V1 command path (`/recipe`, `/recipes`, `/recipe-save`, `/recipe-link`, `/recipe-note`) in `10 Read`
- WP4: completed
- WP5: completed
- WP6: completed for backend/n8n contract and formatter coverage; Telegram end-to-end validation remains operational verification work

## Work package format
Each work package below references relevant sections in `recipes-prd.md`.

---


## WP0 — Telemetry convention analysis
**References:** PRD sections 7, 9, 10, 13, 16

### Goal
Define recipe-specific `pipeline_events` conventions using the existing telemetry pattern before implementation spreads ad hoc event names.

### In scope
- analyze current `pipeline_events` conventions used by adjacent PKM surfaces
- propose recipe event names, required fields, and failure-state conventions
- write a separate architect-owned analysis doc that implementation can follow
- identify whether any findings need follow-up documentation in authoritative docs

### Deliverables
- separate telemetry analysis doc authored during analysis
- recommended recipe event naming/payload pattern
  - implementation doc: `docs/recipes_telemetry_conventions.md`

### Acceptance
- recipe telemetry conventions are explicit before backend/workflow implementation relies on them
- implementation teams are not guessing event names or payload shapes

### Risks to watch
- creating a recipe-only telemetry pattern that drifts from existing PKM conventions
- documenting event ideas too late, after code and workflows diverge

---

## WP1 — Schema foundation
**References:** PRD sections 2, 6, 8, 10, 11, 12, 16

### Goal
Create the isolated persistence surface for recipes.

### In scope
- add `recipes` table migration
- add constraints/indexes for:
  - primary key
  - `public_id`
  - normalized-title uniqueness
  - searchable columns/indexes required for V1 lexical retrieval
- implement generated stored columns for:
  - `public_id`
  - `total_time_minutes`
- choose implementation strategy for:
  - `updated_at`

### Deliverables
- migration file(s)
- repository/store layer support
- `docs/database_schema.md` update

### Acceptance
- schema supports all V1 columns and status values
- duplicate case-insensitive title insert is blocked
- archived visibility rule is enforceable in query layer

### Risks to watch
- over-indexing too early
- mixing recipe storage with `entries`

---

## WP2 — Backend API contracts
**References:** PRD sections 7, 8, 9, 10, 12, 15, 16

### Goal
Create stable backend contracts before Telegram/UI wiring expands surface area.

### In scope
- define and implement recipe endpoints for:
  - create
  - search
  - get by `public_id`
  - patch
  - overwrite
  - review queue
- enforce create/update validation rules
- implement review-reason generation and status recomputation
- attach concrete request/response examples in API docs before implementation is considered complete

### Deliverables
- backend route/controller/store code
- request/response examples
- `docs/api.md` updates and, if chosen, recipe-domain API doc
- tests for request validation and response shapes

### Acceptance
- duplicate title returns existing `public_id`
- search returns full top hit + compact alternatives
- direct lookup returns full payload
- update recomputes review status automatically except for explicit archive state
- recipe endpoints support `test_mode` using the same pattern as `entries` surfaces

### Risks to watch
- allowing route drift before examples are documented
- leaking Telegram formatting concerns into generic API responses

---

## WP3 — Telegram capture and retrieval workflow
**References:** PRD sections 6, 7, 9, 10, 11, 12

### Goal
Ship the first user-facing capture and retrieval path via Telegram.

### In scope
- one-shot paste capture only
- `/recipe R<number>` direct lookup
- recipe search command/path for vague-memory retrieval
- `/recipe-link <R<number>> <R<number>>` link command
- `/recipe-note <R<number>> <note>` append-note command
- Telegram response rendering for:
  - create confirmation
  - recipe card
  - See Also linked-recipe list
  - alternatives
- preserve existing Telegram workflow guardrails and repo n8n authoring rules

### Deliverables
- n8n workflow JSON updates
- externalized node code where required by node-size rules
- wrapper/import updates in `src/n8n/**`
- workflow-related docs if needed

### Acceptance
- structured paste works end to end
- semi-structured paste rejects ambiguous/incomplete required sections
- `/recipe R<number>` works end to end
- search returns top result plus two alternatives in Telegram-safe format
- `/recipe-link` and `/recipe-note` work end to end

### Risks to watch
- parser brittleness from semi-structured inputs
- long Telegram payloads for verbose recipes
- accidental creation of a weak-capture path that violates V1 scope

---

## WP4 — Debug UI Recipes page
**References:** PRD sections 6, 9, 10, 12, 13, 16

### Goal
Provide an operator/developer surface for search, read, and update.

### In scope
- add new Debug UI page named `Recipes`
- wire recipe search
- wire full recipe detail view
- wire patch/overwrite editing support
- expose full payload including `search_text`

### Deliverables
- debug UI route/page/components
- API client additions
- confirm reuse of existing proxy/admin-secret handling patterns only

### Acceptance
- user can search recipes from Debug UI
- user can read one recipe in full
- user can patch or overwrite a recipe
- full payload is visible for debugging

### Risks to watch
- mixing operator-only behavior into user-facing assumptions
- hidden auth drift on debug routes

---

## WP5 — Documentation and rollout alignment
**References:** PRD sections 9, 10, 11, 14, 15, 16

### Goal
Close contract/document drift before rollout.

### In scope
- add `docs/PRD/recipes-prd.md`
- add/update PRD registry entry in `docs/PRD/README.md`
- add `recipes-work-packages.md`
- update `docs/api.md`
- update `docs/database_schema.md`
- update any touched docs required by implementation
- move completed work-package doc to archive only when it stops guiding active work

### Deliverables
- aligned docs set
- changelog entry if repo practice expects one for surfaced changes

### Acceptance
- no new recipe endpoint or schema object exists undocumented
- PRD and authoritative docs agree on key contracts
- coding/review agents can locate the owning PRD quickly

### Risks to watch
- leaving recipe behavior documented only in changelog or code
- duplicating schema/API detail in PRD instead of authoritative docs

---

## WP6 — Validation and regression coverage
**References:** PRD sections 11, 12, 13, 15, 16

### Goal
Make the surface safe to evolve after V1.

### In scope
- backend tests for create/search/get/update/review queue
- parser tests for structured and semi-structured inputs
- search ranking sanity checks
- debug UI smoke coverage where practical
- end-to-end validation plan for Telegram path

### Deliverables
- test files
- test fixtures for recipe payloads
- explicit validation checklist for rollout

### Acceptance
- required field failures are deterministic
- review-state recomputation is deterministic
- archived exclusion in search is covered
- duplicate-title behavior is covered
- `/recipe R<number>` path is covered

### Risks to watch
- relying on manual validation only
- leaving ranking behavior untested

---

## Proposed execution order
1. WP0 — Telemetry convention analysis
2. WP1 — Schema foundation
3. WP2 — Backend API contracts
4. WP6 — Backend validation coverage can start once WP2 interfaces stabilize
5. WP4 — Debug UI Recipes page
6. WP3 — Telegram capture and retrieval workflow
7. WP5 — Documentation and rollout alignment as ongoing, finalized before merge

## Exit criteria for V1
V1 is ready when all of the below are true:
- recipe schema exists and is documented
- recipe APIs exist and are documented with examples
- duplicate title, review state, and archived visibility rules are enforced
- Debug UI Recipes page works
- Telegram capture and `/recipe R<number>` work end to end
- acceptance criteria in PRD section 12 are satisfied

## Deferred after V1
These should not be smuggled into the initial implementation:
- URL import
- Notion import
- embeddings / pgvector
- weak capture flows
- multilingual fragment support
- meal planning
