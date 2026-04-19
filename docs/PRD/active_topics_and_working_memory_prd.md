# PRD — Active Topics And Working Memory

Status: proposed  
Surface owner: backend active-topic / working-memory semantics  
Scope type: canonical surface  
Baseline date: 2026-04-15  
Related authoritative docs: `docs/api_control.md`, `docs/external_api.md`, `docs/database_schema.md`, `docs/backend_db_store_map.md`, `docs/test_mode_exemptions.md`, `docs/service_dependency_graph.md`, `chatgpt/project_instructions.md`  
Related work-package doc: none  
Supersedes / narrows: `PRD — Working Memory And Wrap Commit` (legacy baseline + migration input)

## Purpose
Move active-topic working memory out of `pkm.entries` and into a first-class topic-state surface, while preserving current ChatGPT interaction patterns and minimizing GPT-facing contract changes.

This PRD defines:
- what an active topic is in this system
- how topic state is read and updated
- how topic state relates to wrap/commit
- what must remain compatible during migration away from working-memory-as-entry
- the architecture and validation gates required to ship Phase 1 safely

This PRD defines Phase 1 in implementation-ready detail and scopes later phases without pretending they are fully designed.

## Use this PRD when
- changing active-topic semantics or storage
- changing `POST /chatgpt/working_memory` semantics or compatibility behavior
- changing how wrap/commit updates topic state
- changing the relationship between active topics and session notes
- planning migration away from working-memory-as-entry

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Architecture decisions`, `Phase 1 target behavior`, `Control plane / execution flow`, `Data model / state transitions`, `Migration / rollout / rollback`, and `Validation / acceptance criteria`.
- Planning agent: read `Goals`, `Non-goals`, `Contract delta table`, `Architecture decisions`, `Work packages`, `Migration / rollout / rollback`, and `Validation / acceptance criteria`.
- Reviewing agent: read `Current behavior / baseline`, `Architecture decisions`, `Data model / state transitions`, `Validation / acceptance criteria`, and `Risks / open questions`.
- Architect agent: read `Status and scope boundary`, `Contract delta table`, `Architecture decisions`, `API / contract surfaces`, `Migration / rollout / rollback`, and `Validation / acceptance criteria`.

## Section map
- `Status and scope boundary` — what this surface owns vs does not own
- `Current behavior / baseline` — current implementation facts inherited from the legacy working-memory model
- `Goals` / `Non-goals` — direction and explicit Phase 1 exclusions
- `Contract delta table` — which boundaries change in Phase 1
- `Architecture decisions` — concrete implementation choices to avoid ambiguity
- `Phase 1 target behavior` — implementation-ready product behavior
- `Control plane / execution flow` — read and wrap/commit behavior, including compatibility path
- `Data model / state transitions` — first-class topic-state model and allowed transitions
- `API / contract surfaces` — route behavior and compatibility policy
- `Migration / rollout / rollback` — backfill, cutover, and rollback sequencing
- `Validation / acceptance criteria` — must-pass gates for Phase 1
- `Work packages` — ordered implementation slices
- `TBD` — scoped later phases and unresolved decisions

## Status and scope boundary

This PRD owns:
- first-class active-topic state for ChatGPT working memory
- active-topic read semantics
- active-topic update semantics through wrap/commit
- migration away from storing topic working memory as a special row in `pkm.entries`
- compatibility expectations for `POST /chatgpt/working_memory`
- compatibility expectations for `POST /chatgpt/wrap-commit`
- topic-state representation rendered into markdown for GPT-facing reads

This PRD does not own:
- public ChatGPT webhook transport contracts
- generic retrieval methods such as `continue`, `last`, `find`, or `pull`
- ingestion classification logic for the broader entry taxonomy
- topic lifecycle management beyond the fixed four active topics in Phase 1
- motifs, claims, or nudging in Phase 1
- prompt/instruction-set text as a PRD-owned product surface

Boundary rule:
- GPT Actions PRD owns the public ChatGPT -> n8n boundary.
- This PRD owns what active-topic working memory means inside backend and how wrap/commit interacts with it.

## Current behavior / baseline

Current repo behavior is:
- `POST /chatgpt/working_memory` is an admin-protected internal route used for topic-keyed working-memory retrieval.
- `POST /chatgpt/wrap-commit` is an admin-protected internal route used to persist one session note and one working-memory artifact together.
- PKM UI exposes a Working Memory page that calls `POST /chatgpt/working_memory` for operator inspection.
- wrap/commit currently writes exactly two artifacts:
  - session summary note
  - topic working memory artifact
- session notes and topic working-memory rows are both persisted through the same wrap/commit flow.
- working memory today is represented as a special ChatGPT-authored artifact in `entries`, not first-class topic state.
- one working-memory row exists per normalized topic key where present, but not all desired active topics have rows.
- ChatGPT-authored session notes and working-memory rows bypass Tier-1 and Tier-2 enrichment.
- explicit Tier-1 classify write routes exist (`POST /pkm/classify`, `POST /enrich/t1/update`, `POST /enrich/t1/update-batch`) and are the only classify writeback path for Tier-1 field updates.
- Tier-1 classify writeback can synchronize active-topic related-entry links via `active_topic_related_entries` with relation type `classified_primary` when `topic_primary` maps to an active topic.
- current ChatGPT interaction pattern is topic-first:
  - read working memory
  - retrieve supporting context via existing read tools
  - wrap at the end

## Goals

### Global goals
- make active-topic working memory first-class rather than a special entry row
- preserve current ChatGPT workflow during Phase 1
- keep GPT-facing contracts stable to reduce retesting
- keep session notes separate from topic state
- create a cleaner underlying model for future topic behavior

### Phase 1 goals
- move active-topic working memory off `entries` into a dedicated topic-state surface
- keep existing GPT actions working
- keep wrap behavior conceptually the same for users
- support exactly four fixed active topics:
  - `communication`
  - `parenting`
  - `product`
  - `ai`
- make topic-entry relationship explicit for those active topics
- render structured topic state into markdown for GPT-facing reads
- support one-time migration from existing working-memory rows where available

## Non-goals

### Out of scope for Phase 1
- motifs
- claims
- nudging
- topic lifecycle management
- topic creation by end users
- topic archive / inactive-state design
- ingestion-driven topic-state updates
- richer related-entry semantics such as `central`, `supporting`, `adjacent`, or `bridge`
- changing the fixed set of four active topics
- redesigning the topic-first ChatGPT interaction loop
- moving session notes off `entries`

### Out of scope for this PRD
- broader entry-topic classification semantics across the full taxonomy
- low-level DB reference details that belong in authoritative docs
- public webhook payload shapes owned elsewhere

## Contract delta table

| Surface | Changes? | Baseline known? | Notes |
|---|---|---|---|
| Internal backend API | yes | yes | same routes, new underlying topic-state semantics |
| Public webhook API | no | yes | preserve GPT-facing contracts |
| Database schema | yes | no | add dedicated topic-state storage in active/test schemas |
| Config / infra | no (intended) | yes | no new config surface intended in Phase 1 |
| n8n workflows / nodes | yes | yes | internal adaptation for topic-patch compatibility |
| Runtime topology | no | yes | no service-edge change intended |
| Docs | yes | yes | PRD + coupled API/schema/test-mode docs |
| Tests | yes | yes | compatibility, migration, and patch validation coverage required |

## Boundaries and callers

Primary callers in Phase 1:
- `11 ChatGPT Read Router` for `working_memory`
- `05 ChatGPT Wrap Commit` for commit persistence
- PKM UI Working Memory page for operator/debug read

Primary user interaction remains:
1. read topic working memory
2. read extra context through existing retrieval flows
3. wrap at the end
4. commit topic update + session note

Phase 1 topic rule:
- each conversation must resolve to exactly one of the four active topics
- if ambiguous, user should choose
- fallback is assistant choosing one topic and explicitly noting ambiguity

## Architecture decisions

### AD-1: Keep route names stable for Phase 1
`POST /chatgpt/working_memory` and `POST /chatgpt/wrap-commit` stay in place. Internal route names, auth mode, and top-level response envelope remain stable.

### AD-2: Introduce dedicated topic-state tables, keep session notes in entries
Session notes stay in `entries`. Topic state moves to first-class topic tables. New wrap/commit writes stop creating `content_type='working_memory'` rows.

### AD-3: Use one read route with view mode, not a new endpoint
No new debug read route in Phase 1. `POST /chatgpt/working_memory` accepts an optional internal `view` selector:
- default `view='gpt'`: compatibility output
- optional `view='debug'`: compatibility output plus structured state details for PKM UI

### AD-4: Patch-based topic updates
Topic updates are patch-based, not full replacement:
- structured patch operations are authoritative when provided
- legacy wrap fields are translated into conservative patch operations for compatibility

### AD-5: Related-entry links are separate from wrap patch
Wrap/commit cannot mutate topic-entry links in Phase 1. Related-entry links are attached by ingestion/non-wrap paths only.

### AD-6: Preserve active test-mode routing for topic-state surfaces
Topic-state storage follows active test-mode schema routing, matching current ChatGPT write/read behavior against `entries`.

### AD-7: Additive migration with legacy fallback reads during transition
Migration is additive first (schema + backfill + dual-read). Write cutover happens only after parity checks pass.

### AD-8: No topology or trust-boundary change
No new public edges, no direct UI-to-DB access, no n8n direct PKM table access.

### AD-9: Classify writeback uses explicit Tier-1 update methods only
Tier-1 classify writes must use explicit classify-update methods/routes, not generic DB update:
- sync: `POST /pkm/classify` or `POST /enrich/t1/update`
- batch: `POST /enrich/t1/update-batch` and batch-collect apply path

Generic `POST /db/update` must reject Tier-1 classify field writes.

## Phase 1 target behavior

### Topic set
Phase 1 supports exactly four fixed topic keys:
- `communication`
- `parenting`
- `product`
- `ai`

Display names and canonical keys are the same in Phase 1.

### Topic shape
A Phase 1 topic contains:
- `title`
- `why_active_now`
- `current_mental_model`
- `tensions_uncertainties`
- `open_questions[]`
- `action_items[]`
- `related_entries[]`

Deferred from Phase 1:
- `scope_boundary`

Removed as a separate field:
- `next_likely_step` (folded into `action_items`)

Phase 1 allows:
- zero open questions
- zero action items

### Open questions
Each open question is:
- `id`
- `text`
- `status` where status is `open` or `closed`

### Action items
Each action item is:
- `id`
- `text`
- `status` where status is `open` or `done`

### Related entries
Phase 1 related-entry relationship is:
- explicit
- flat
- future foundation, not rich semantics yet

Phase 1 rule:
- related-entry links are not changed by wrap/commit
- related-entry links are attached through ingestion/non-wrap flows where applicable
- ingestion may attach entries to topics, but must not mutate topic state in Phase 1

## Control plane / execution flow

### Active-topic read
1. caller submits one of the four active topic keys plus optional `view`.
2. backend normalizes and validates the topic key against fixed active set.
3. backend reads structured topic state from first-class topic-state surface.
4. backend renders markdown-compatible output for GPT compatibility.
5. backend returns compatibility envelope; debug fields are included only when `view='debug'`.
6. during migration window only, if no topic-state row exists and fallback is enabled, backend may read legacy working-memory row from `entries`.

### Wrap commit
1. caller submits validated wrap payload for exactly one topic.
2. backend validates required fields (`session_id`, topic key).
3. backend derives a structured topic patch:
   - uses explicit `topic_patch` when present
   - otherwise maps legacy fields (`why_it_matters`, `working_memory_updates`, `tensions`, `open_questions`, `next_steps`) into conservative patch operations
4. backend validates patch operations (allowed fields/status transitions/topic scope).
5. backend writes session note to existing session-note path in `entries`.
6. backend applies topic patch to first-class topic-state tables in one transaction boundary.
7. backend returns one combined result envelope.

### Ingestion and classify related-entry linking
1. Tier-1 classify writeback occurs through explicit update routes (`/pkm/classify`, `/enrich/t1/update`, `/enrich/t1/update-batch`) and batch-collect apply.
2. Backend applies the fixed Tier-1 field set on `entries` and then synchronizes `active_topic_related_entries` for active-topic matches only.
3. Link relation type is `classified_primary`.
4. Non-active-topic `topic_primary` values do not create related-entry links.

### Validation policy
Phase 1 uses:
- validate-and-reject on malformed topic updates
- minimal repair only (trim/normalize)
- no broad auto-repair

## Data model / state transitions

### Owned domain objects in Phase 1
- session note
- active topic state
- active-topic open questions
- active-topic action items
- active-topic related-entry links

### Session note rules
- session notes remain in `entries`
- Phase 1 does not change session-note storage semantics beyond coexistence with new topic-state tables

### Topic-state table plan (Phase 1 design target)
Phase 1 introduces mirrored topic-state tables in `pkm` and `pkm_test`:
- `active_topics`
  - fixed topic registry for four active topics
  - canonical key and display metadata
- `active_topic_state`
  - one row per topic key
  - scalar fields (`title`, `why_active_now`, `current_mental_model`, `tensions_uncertainties`)
  - write metadata (`state_version`, `updated_at`, `last_session_id`, migration provenance)
- `active_topic_open_questions`
  - question records with status (`open`/`closed`)
- `active_topic_action_items`
  - action records with status (`open`/`done`)
- `active_topic_related_entries`
  - explicit topic-to-entry mapping
  - separate from wrap updates

### Topic-state rules
- topic state is not stored as a special entry row
- topic state is structured first; markdown is rendered/export form
- one selected topic may be updated per wrap/commit call
- updates are patch-only
- topic state and related-entry links remain distinct concerns

### Update permissions in Phase 1
Wrap/commit may:
- create, update, close/reopen, or delete open questions
- create, update, complete/reopen, or delete action items
- edit `why_active_now`
- edit `current_mental_model`
- edit `tensions_uncertainties`
- edit `title` only for supported topic display updates

Wrap/commit may not:
- update non-selected topics
- modify related-entry links
- create/retire topics
- change topic membership rules

## API / contract surfaces

### Phase 1 compatibility rule
Preserve GPT-facing contracts for:
- `POST /chatgpt/working_memory`
- `POST /chatgpt/wrap-commit`

Compatibility means:
- same route names and auth model
- same top-level response envelope shape
- no public webhook contract changes required for Phase 1

### `POST /chatgpt/working_memory`
Phase 1 behavior:
- reads from topic-state tables
- returns compatibility payload for existing n8n/GPT consumers
- supports optional internal `view='debug'` mode for PKM UI/operator details

Compatibility row contract in `result.row` remains available, including rendered `working_memory_text`.

### `POST /chatgpt/wrap-commit`
Phase 1 behavior:
- still writes one session note + one topic update outcome together
- session note persists through existing session-note path
- topic update writes to topic-state tables, not working-memory rows in `entries`
- may accept optional internal `topic_patch` extension while keeping legacy payload compatibility

### `POST /chatgpt/topic-state` (internal operator patch path)
Phase 1 extension behavior:
- admin-only internal route for topic-state patch operations without session-note writes
- used by PKM UI for manual update/reopen/close/done/delete operations on open questions and action items
- does not change public webhook contracts

### PKM UI behavior
- PKM UI Working Memory flow remains on `POST /chatgpt/working_memory`
- PKM UI may request `view='debug'` and render structured topic fields/items
- GPT-facing callers stay on default rendered view

## Config / runtime / topology implications

Expected touched surfaces:
- backend chatgpt service modules (`src/server/chatgpt/**`, `src/server/chatgpt-actions.js`)
- new backend DB store and repository ownership under approved DB boundaries (`src/server/db/**`, `src/server/repositories/**`)
- n8n `05 ChatGPT Wrap Commit`
- n8n `11 ChatGPT Read Router`
- PKM UI Working Memory page/API client

Phase 1 is not intended to change:
- runtime topology
- trust boundaries
- public ChatGPT webhook contracts

## Migration / rollout / rollback

### Migration direction
Phase 1 migrates from:
- working-memory-as-entry

to:
- first-class active topic state

### Rollout stages

#### Stage 0: Preflight
- add schema migration files for topic-state tables and indexes
- seed four fixed topics in both `pkm` and `pkm_test`
- add topic-store read/write tests and migration tests

#### Stage 1: Additive deploy
- deploy schema and backend read path that can resolve topic state
- keep legacy write path unchanged temporarily
- implement migration tooling and dry-run parity checks

#### Stage 2: Backfill
- migrate latest legacy working-memory row per topic into topic-state tables
- tolerate missing legacy rows by creating empty initialized topic rows
- record migration provenance (legacy entry id/hash, timestamp)
- run separate active-topic related-entry backfill for classify links using `scripts/db/backfill_active_topic_related_entries.sh` (not bundled into schema migration script)

#### Stage 2b: Related-entry classify-link backfill operation
- execute dry-run first per schema (`pkm`, optionally `pkm_test`)
- apply mode runs in a single transaction boundary (all-or-nothing per invocation)
- only entries whose `topic_primary` maps to active topics are linked
- relation type is `classified_primary`

#### Stage 3: Write cutover
- switch wrap/commit topic writes to topic-state tables
- stop writing new `content_type='working_memory'` rows to `entries`
- keep legacy read fallback only for guarded transition window

#### Stage 4: Stabilization
- remove legacy read fallback once parity confidence is met
- keep legacy rows as non-destructive history

### Legacy behavior during Phase 1
- old working-memory rows stay in DB as historical artifacts
- no destructive delete of legacy rows in Phase 1
- session-note writes continue unchanged

### Rollback strategy
If cutover needs rollback before cleanup:
1. revert backend to pre-cutover write path
2. keep session-note behavior unchanged
3. preserve migrated topic-state rows (non-destructive rollback)
4. if required, re-enable legacy read/write path temporarily

Rollback must not delete topic-state tables or legacy rows during incident response.

## Validation / acceptance criteria

Phase 1 is successful only if all gates pass.

### Gate A: Contract and doc integrity
1. PRD ownership and status are updated in `docs/PRD/README.md`.
2. Internal route contracts are updated in `docs/api_control.md` if request/response semantics changed.
3. Schema contracts are updated in `docs/database_schema.md` and `docs/backend_db_store_map.md`.
4. Test-mode routing expectations are updated in `docs/test_mode_exemptions.md`.
5. Workflow ownership references are updated in `docs/n8n_backend_contract_map.md`.

### Gate B: Automated tests
1. Existing route contract tests pass (`test/server/chatgpt.api-contract.test.js`).
2. New topic-state service/store tests pass (topic patch validation, status transitions, migration mapping).
3. n8n route tests pass for read/wrap compatibility.
4. Local repo gate passes:
   - `bash scripts/CI/check.sh`
5. DB integration suite passes for topic-state storage semantics:
   - `cd src/server`
   - `PKM_DB_INTEGRATION_URL=postgres://<user>:<pass>@<host>:5432/<db> npm run test:integration`

### Gate C: Data migration parity
For each fixed active topic:
1. backfill produced one structured topic row
2. rendered markdown from topic-state is non-empty or explicitly empty-by-design
3. migrated provenance references legacy source where present
4. no new wrap commits create `entries.content_type='working_memory'` rows
5. classify-link backfill dry-run/apply counts are sane and only include active-topic matches

### Gate D: End-to-end behavior
1. ChatGPT public read (`working_memory`) still returns handled success/no_result envelopes.
2. ChatGPT public wrap-commit still returns combined session-note + topic-update outcome.
3. PKM UI Working Memory page can inspect structured topic state via debug view.
4. Ingestion can attach related entries without mutating topic scalar/question/action state.

### Gate E: Rollback readiness
1. rollback steps are rehearsed in non-production environment
2. rollback keeps session-note continuity
3. rollback is non-destructive for both legacy and new topic-state data

## Work packages

### WP1 — Schema and migration assets
- add SQL migrations for topic-state tables in `scripts/db/migrations/`
- seed fixed topic registry in both active schemas
- add indexes/constraints for status transitions and topic-entry links

### WP2 — Backend topic-state store
- add bounded DB store for topic-state read/write under `src/server/db/**`
- keep raw SQL inside approved SQL boundaries
- wire through repository/service layer ownership

### WP3 — Read compatibility path
- update `/chatgpt/working_memory` implementation to read topic-state tables
- keep compatibility response envelope and rendered markdown output
- add optional debug view mode for PKM UI

### WP4 — Wrap patch path
- implement structured patch validation and application
- maintain legacy payload compatibility mapping
- keep session-note write path unchanged in `entries`

### WP5 — n8n workflow compatibility
- adapt `05 ChatGPT Wrap Commit` and `11 ChatGPT Read Router` only where required
- preserve public webhook contracts and normalized response envelopes

### WP6 — PKM UI debug parity
- update Working Memory UI client/page to consume debug mode payload when needed
- preserve operator-focused inspection ergonomics

### WP7 — Validation suite expansion
- extend API contract tests and add migration/integration coverage
- update route registry/test-surface artifacts if route behavior ownership changes

### WP8 — Cutover and rollback drill
- run additive deploy + backfill + cutover sequence
- execute validation gates
- document rollback evidence

## Risks / open questions

- compatibility adapters may grow complex if legacy and structured patch payloads diverge
- migration quality depends on legacy row quality and may require fallback defaults for missing topics
- strict single-topic conversations may create friction for cross-topic sessions
- related-entry linking behavior needs clear ownership to avoid silent wrap-path coupling

## Evidence / recovery basis
Recovered from:
- `docs/PRD/working-memory-PRD.md`
- `src/server/chatgpt-actions.js`
- `src/server/chatgpt/service.js`
- `src/server/chatgpt/renderers.js`
- `src/server/db/read-store.js`
- `src/server/db/write-store.js`
- `src/libs/sql-builder.js`
- `src/n8n/workflows/05-chatgpt-wrap-commit__whqfhIgcPLlEwlXG.json`
- `src/n8n/workflows/11-chatgpt-read-router__Z3ROrPMsI5aIbszW.json`
- `src/web/pkm-debug-ui/src/pages/WorkingMemoryPage.tsx`
- `docs/api_control.md`
- `docs/external_api.md`

## TBD

This PRD defines Phase 1 in implementation-ready detail.  
Phases 2-4 are intentionally lower precision: concrete enough for planning/review, not yet locked like Phase 1.  
Optional Phase 5 remains conditional.

### Phase 2 — Topic-entry relationship

Goal:
- make topics meaningfully interact with entries

Outcome:
- new entries can be interpreted against active topics instead of only ad hoc retrieval
- topics begin acting like operating objects, not static summaries

Own in this phase:
- relevance of a new entry to one or more active topics
- relationship types such as:
  - `central`
  - `adjacent`
  - `bridge`
  - `candidate`
- topic-level review of relevant new material
- manual acceptance/absorption of relevant material into topic state
- reevaluation of strict single-topic conversation rule
- reevaluation of richer direct operations for open questions/action items
- removal of remaining legacy working-memory read fallback once Phase 1 path is proven stable

Phase 2 interpretation rule:
- ingestion/retrieval may surface candidate relevance or candidate deltas
- core topic-state changes still require explicit acceptance

Still not in scope by default:
- nudging
- motifs
- claims
- topic lifecycle management beyond fixed Phase 1 topic set
- autonomous topic rewriting

### Phase 3 — Nudge MVP

Goal:
- introduce the smallest proactive behavior that is useful

Outcome:
- topics can nudge only on open questions/action items
- proactive behavior stays narrow and legible

Own in this phase:
- `this new entry may help answer an open question`
- `this action item is stale`
- `this topic needs follow-up`
- lightweight acknowledgment flow for nudges

Do not add yet:
- generic inspiration nudges
- broad revisit prompts
- autonomous topic rewriting
- complex recommender-style resurfacing

### Phase 4 — Hardening and richer structure

Goal:
- stabilize surface after real use and add next layer only where needed

Candidates:
- topic neighborhoods
- motifs
- stronger review flows
- better UI/operator affordances
- clearer activation/deactivation rules
- first manual topic management by operator
- `scope_boundary` as first-class field
- reevaluation of fixed-four-topic model and forced single-topic ambiguity handling
- possible lightweight claim support only if clearly needed

### Optional Phase 5 — Claims and synthesis

Purpose:
- introduce claims only if earlier phases prove clear value
- add higher-order synthesis without forcing it prematurely

Entry condition:
- topic-state model stable
- topic-entry relationship trusted
- nudge MVP useful and not noisy
- evidence that claims improve outcomes more than they complicate operations

### Explicitly unresolved across later phases
- final boundary between GPT-facing compatibility routes and richer internal topic APIs
- whether direct topic operations belong in normal ChatGPT loop
- when multi-topic conversations become first-class
- final semantics of topic-entry relationship types
- long-term relationship between motifs, neighborhoods, and claims
