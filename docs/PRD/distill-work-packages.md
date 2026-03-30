# Work Packages — Distill

Status: active companion  
Companion to: docs/PRD/distill-prd.md`  
Last verified: 2026-03-30

## Purpose
This file breaks the Tier-2 distillation implementation into ordered, testable work packages.

## Sequencing assumptions

- Work starts with a reconciliation pass, not code.
- API, schema, runtime, and read-surface contracts must be updated in the same change set when they are affected.
- New DB access must respect the `AGENTS.md` rule: no raw SQL outside `src/libs/sql-builder.js` and `src/server/db.js`.
- n8n, UI, and backend boundaries must continue to flow through documented backend APIs only.

---

## WP0 — Reconciliation and implementation plan

**Objective**
- Convert the current Tier 2 architecture into an implementation-ready change plan that matches the actual repo and runtime.

**PRD references**
- `## Control Plane`
- `### Candidate Discovery`
- `### Validation`
- `### Async Execution Design`
- `docs/PRD/archive/distill-reference-appendix.md#schema-migration-plan-guidelines`
- `docs/PRD/archive/distill-reference-appendix.md#candidate-discovery-sql-guidelines`

**Optional source references**
- `AGENTS.md` sections `Read-first`, `System boundaries`, `Default workflow`, `Quality gates`
- `env.md` sections `PKM server`, `LiteLLM`, `Postgres (DB roles, schemas, prod/test)`
- `requirements.md` sections `Tier-1 LiteLLM client requirements`, `Tier-1 orchestration requirements`, `Read context pack requirements`

**Scope**
- Inspect current Tier 1 batch implementation and identify extraction boundaries.
- Confirm the exact file/module placement for:
  - candidate discovery SQL
  - control-plane orchestration
  - validation
  - batch runtime reuse
  - read-surface integration
- Resolve documented ambiguities before coding starts:
  - `quality_score` vs `source_quality_score`
  - exact source-version field
  - final-state ownership
  - generic vs Tier 2-specific async persistence
  - Tier 2 model/provider/config surface
  - whether read context packs consume `distill_summary`

**Deliverables**
- Short implementation plan.
- File/component touch list.
- Contract/doc update list.
- Test plan.
- Risk log for any unresolved ambiguity that still needs explicit approval.

**Exit criteria**
- No core Tier 2 implementation starts until the above questions are answered in writing.

---

## WP1 — Schema migration and backfill

**Objective**
- Introduce the Tier 2 data model to both `pkm.entries` and `pkm_test.entries`.

**PRD references**
- `### Tier 2 / distill_ fields on entries`
- `### State Transition Matrix`
- `docs/PRD/archive/distill-reference-appendix.md#schema-migration-plan-guidelines`

**Optional source references**
- `database_schema.md` sections `pkm.entries / pkm_test.entries`, `Test vs prod + mirroring`

**Scope**
- Add Tier 2 fields to both schemas:
  - `distill_summary`
  - `distill_excerpt`
  - `distill_version`
  - `distill_created_from_hash`
  - `distill_why_it_matters`
  - `distill_stance`
  - `distill_status`
  - `distill_metadata`
- Add allowed-value constraints for:
  - `distill_stance`
  - `distill_status`
- Add indexes described in the PRD.
- Backfill only `distill_status` per PRD guidance.
- Confirm grants/default privileges remain sufficient for app writes in both schemas.

**Implementation notes for the code-access agent**
- Keep migration work explicit and reversible where appropriate.
- Verify whether any new batch/runtime tables are also required before finalizing migration scope.

**Tests / verification**
- Migration up on empty and populated schemas.
- Backfill correctness for:
  - newsletter with usable `clean_text`
  - newsletter without usable `clean_text`
  - non-newsletter rows
- Constraint checks for invalid status/stance values.
- Index existence checks.

**Docs to update**
- `database_schema.md`

---

## WP2 — Tier 2 config and runtime contract

**Objective**
- Implement the configuration surface required by the Tier 2 control plane.

**PRD references**
- `### Budgeting`
- `### Route Selection`
- `### Chunking Design`
- `### Route Selection Rules`
- `### Budgeting Implementation Rules`
- `### Retry Config and Behavior`
- `### Async Execution Design`

**Optional source references**
- `env.md` sections `PKM server`, `LiteLLM`
- `api.md` section `GET /config`

**Scope**
- Define/configure the `distill.*` keys described by the PRD, including at minimum:
  - run budget
  - direct/chunk threshold
  - chunk sizing and overlap
  - retry settings
- Decide how Tier 2 model/provider settings are expressed in config.
- Decide whether `/config` should expose any Tier 2 static config.
- Ensure runtime wiring remains consistent with current backend deployment boundaries.

**Implementation notes for the code-access agent**
- Do not hardcode provider/model values unless the reconciliation pass explicitly confirms that behavior.
- If new env/config keys are introduced, document them in the same change.

**Tests / verification**
- Config load/default behavior.
- Invalid config rejection or safe fallback behavior.
- Route threshold and retry settings read correctly at runtime.

**Docs to update**
- `env.md`
- `api.md` if `/config` changes
- `requirements.md` if Tier 2 runtime rules become normative

---

## WP3 — Candidate discovery, eligibility, scoring, budgeting, and route selection

**Objective**
- Implement the synchronous Tier 2 pre-generation control plane.

**PRD references**
- `### Candidate Discovery`
- `### Eligibility Gate`
- `### Priority Scoring`
- `### Budgeting`
- `### Route Selection`
- `### Budgeting Implementation Rules`
- `docs/PRD/archive/distill-reference-appendix.md#priority-scoring-formula`
- `docs/PRD/archive/distill-reference-appendix.md#candidate-discovery-sql-guidelines`

**Optional source references**
- `AGENTS.md` section `Database safety`
- `database_schema.md` sections `pkm.entries / pkm_test.entries`

**Scope**
- Implement candidate discovery SQL through the approved DB boundaries.
- Implement eligibility decisions and state updates for:
  - `skipped`
  - `not_eligible`
  - `proceed`
- Implement deterministic priority scoring.
- Implement run-level budgeting and tie-break rules.
- Implement direct vs chunked route selection.
- Keep candidate discovery lightweight and avoid early full-text fetches unless the design explicitly calls for them after budgeting.

**Implementation notes for the code-access agent**
- Confirm and codify the exact source-version field before implementing stale/current checks.
- Ensure the final working set contains all fields required by budgeting without accidental second-query drift.

**Tests / verification**
- Candidate inclusion/exclusion cases.
- Eligibility gate behavior and state writes.
- Scoring examples, especially stale and length bands.
- Budget ordering and tie-break determinism.
- Route selection threshold cases.

**Docs to update**
- `database_schema.md` if discovery/scoring rely on newly documented columns/indexes
- `requirements.md` if Tier 2 selection rules become normative outside the PRD

---

## WP4 — Generation prompts, parsers, and validation

**Objective**
- Implement the direct and chunked generation contracts plus deterministic validation.

**PRD references**
- `### Generation`
- `### Validation`
- `### Chunking Design`
- `### Generation Contract`
- `### Validation Contract`

**Optional source references**
- `AGENTS.md` section `Logging and observability`
- `requirements.md` sections `Tier-1 LiteLLM client requirements`, `Tier-1 orchestration requirements`

**Scope**
- Implement direct-generation prompt path.
- Implement chunk-note and final-synthesis path.
- Implement structured parsing for all expected outputs.
- Implement deterministic validation checks and failure codes.
- Define where the app enriches raw model output with:
  - `distill_version`
  - `distill_created_from_hash`
  - `distill_metadata`

**Implementation notes for the code-access agent**
- Resolve the raw-output vs enriched-output validation boundary before coding.
- Use one shared validation path so sync and async collection cannot drift.
- Keep excerpt handling deterministic and auditable.

**Tests / verification**
- Parser success/failure cases.
- Validation failures by code and rule.
- Direct vs chunked output normalization to one final shape.
- Excerpt null/non-null edge cases.

**Docs to update**
- `requirements.md` if Tier 2 validation rules become contract-level requirements
- `api.md` only if any external endpoint contracts are exposed for Tier 2 generation

---

## WP5 — Shared async batch runtime extraction

**Objective**
- Extract the current Tier 1 async implementation into a shared stage-agnostic batch runtime.

**PRD references**
- `### Async Execution Design`
- `### Review / Retry`
- `### Retry Config and Behavior`
- `### State Transition Matrix`

**Optional source references**
- `requirements.md` sections `Tier-1 orchestration requirements`, `Tier-1 batch visibility requirements`
- `api.md` sections `POST /enrich/t1/batch`, `GET /status/t1/batch`, `GET /status/t1/batch/:batch_id`
- `database_schema.md` sections covering `t1_batches`, `t1_batch_items`, `t1_batch_item_results`

**Scope**
- Identify the existing Tier 1 async components that can be generalized.
- Introduce stage-aware abstractions for:
  - enqueue
  - sync/poll
  - item/result parsing
  - persistence
  - status computation
  - worker lifecycle
- Preserve current Tier 1 behavior while making Tier 2 possible.

**Implementation notes for the code-access agent**
- Do not regress Tier 1 while extracting shared code.
- Finalize the persistence model first: generic batch tables vs stage-specific tables.
- Confirm whether both schemas must be scanned for Tier 2 as they are for Tier 1.

**Tests / verification**
- Tier 1 regression tests.
- Shared runtime unit tests.
- Restart recovery behavior.
- Idempotent re-sync behavior.

**Docs to update**
- `api.md` if status surfaces/generalized batch APIs change
- `database_schema.md` if batch persistence changes
- `requirements.md` if shared-runtime behavior becomes normative

---

## WP6 — Tier 2 async adapter and persistence flow

**Objective**
- Build the Tier 2 stage implementation on top of the shared runtime.

**PRD references**
- `### Generation`
- `### Validation`
- `### Persist`
- `### Review / Retry`
- `### Retry Config and Behavior`
- `### State Transition Matrix`
- `### Async Execution Design`

**Optional source references**
- `database_schema.md` sections on mirrored schemas and runtime_config nuance

**Scope**
- Implement Tier 2 enqueue path.
- Implement Tier 2 collection path.
- Implement the final successful persistence of validated distillation artifacts.
- Implement terminal failure persistence and retry metadata updates.
- Implement currentness checks before writing final results.
- Ensure queued semantics match the PRD and are only written at the correct point in dispatch.

**Implementation notes for the code-access agent**
- Establish one clear owner for the final `completed` write.
- Establish one clear owner for `failed`.
- Decide whether `stale` is persisted proactively or inferred lazily.

**Tests / verification**
- Successful async round trip.
- Retryable vs terminal failure paths.
- Currentness mismatch during collection.
- Duplicate collect/replay safety.
- Final artifact persistence integrity.

**Docs to update**
- `database_schema.md`
- `requirements.md` if Tier 2 worker behavior becomes contractual
- `api.md` if new Tier 2 status/trigger endpoints are exposed

---

## WP7 — Observability and transition logging

**Objective**
- Add Tier 2 observability without violating existing logging boundaries.

**PRD references**
- `docs/PRD/archive/distill-reference-appendix.md#observability--braintrust-plan`
- `### Async Execution Design`
- `### State Transition Matrix`

**Optional source references**
- `AGENTS.md` section `Logging and observability`
- `requirements.md` section `Pipeline transition logging requirements`
- `api.md` debug endpoint sections

**Scope**
- Emit pipeline transition events for Tier 2 control-plane and async steps.
- Add Braintrust instrumentation for Tier 2 LLM activity.
- Use the shared backend logger and avoid heavy payload logging.
- Ensure transition naming and summaries remain queryable through existing debug surfaces or documented successors.

**Implementation notes for the code-access agent**
- Keep event payloads lightweight and aligned with current run-id handling.
- Be explicit about which steps emit `start`, `end`, and `error`.

**Tests / verification**
- Pipeline event creation for key Tier 2 transitions.
- Run-id propagation through Tier 2 paths.
- Braintrust metadata presence on Tier 2 calls.
- No raw heavy text leakage into logs/events.

**Docs to update**
- `api.md` if debug surfaces change
- `requirements.md` if Tier 2 observability rules become normative

---

## WP8 — Read/context-pack integration

**Objective**
- Integrate Tier 2 artifacts into downstream read surfaces if the PRD's "primary chip" intent is part of this rollout.

**PRD references**
- `### Tier 2 / distill_ fields on entries`

**Optional source references**
- `requirements.md` section `Read context pack requirements`
- `AGENTS.md` section `System boundaries`

**Scope**
- Decide whether `distill_summary` participates in context-pack content selection.
- If yes, update the shared context-pack builder and any dependent consumers through the shared builder only.
- Keep UI and n8n on the same centralized context-pack implementation.

**Implementation notes for the code-access agent**
- This work package is conditional on the reconciliation decision.
- If Tier 2 is stored but not yet surfaced, say so explicitly in docs and tests.

**Tests / verification**
- Context-pack selection priority tests.
- UI vs n8n output parity tests through the shared builder.

**Docs to update**
- `requirements.md`
- any read-surface docs affected by Tier 2 consumption

---

## WP9 — API and operational surfaces

**Objective**
- Add or update backend-facing surfaces required to operate Tier 2 without violating the documented integration boundary.

**PRD references**
- `### Async Execution Design`
- `### Review / Retry`
- `### State Transition Matrix`

**Optional source references**
- `AGENTS.md` section `Integration boundary`
- `api.md` current status/debug/config sections

**Scope**
- Determine whether Tier 2 requires:
  - schedule/trigger endpoints
  - status endpoints
  - admin retry/review endpoints
  - config visibility updates
- Keep all external contracts documented in `api.md` in the same change.

**Implementation notes for the code-access agent**
- Do not create undocumented operational shortcuts.
- Prefer extending existing documented patterns where possible.

**Tests / verification**
- Endpoint contract tests for any new/changed surfaces.
- Auth tests for any admin-only operation.

**Docs to update**
- `api.md`
- `env.md` if new runtime/admin requirements are introduced

---

## WP10 — n8n and orchestration wiring

**Objective**
- Wire Tier 2 into the existing workflow environment without breaking repo and sync rules.

**PRD references**
- `## Control Plane`
- `### Async Execution Design`
- `docs/PRD/archive/distill-reference-appendix.md#observability--braintrust-plan`

**Optional source references**
- `AGENTS.md` sections `n8n workflow editing model`, `Repository ownership and placement`
- `n8n_node_style_guide.md`
- `n8n_sync.md`

**Scope**
- Add or update orchestration entrypoints needed to invoke Tier 2.
- Keep workflow wiring changes in exported workflow JSON.
- Keep Code nodes thin and externalized.
- Maintain the backend-only boundary for all data access.

**Implementation notes for the code-access agent**
- Workflow logic should live under `src/n8n/` only.

**Tests / verification**
- Workflow smoke runs.
- Payload shape checks at backend boundaries.
- Thin-wrapper/externalized-code compliance.

**Docs to update**
- `api.md` if new workflow-called endpoints are introduced
- `env.md` if new runtime mounts/paths are required

---

## WP11 — Test suite, CI, rollout, and documentation closeout

**Objective**
- Finish Tier 2 with enforceable verification and complete doc synchronization.

**PRD references**
- all Tier 2 sections, with emphasis on:
  - `### Validation Contract`
  - `### Retry Config and Behavior`
  - `### State Transition Matrix`
  - `docs/PRD/archive/distill-reference-appendix.md#schema-migration-plan-guidelines`

**Optional source references**
- `AGENTS.md` section `Quality gates`

**Scope**
- Add/update Jest tests.
- Add smoke coverage for key Tier 2 flows.
- Run `scripts/CI/check.sh`.
- Update all touched contracts/docs in the same change set.
- Define rollout order, including when Tier 2 workers are enabled relative to schema deployment/backfill.

**Minimum verification set**
- schema migration + backfill
- control-plane selection correctness
- direct-generation path
- chunked-generation path
- validation failures
- async queue/collect path
- retry path
- stale/currentness handling
- observability/logging
- any read-surface integration that is part of the rollout

**Docs to update**
- `database_schema.md`
- `api.md`
- `env.md`
- `requirements.md`
- changelog and repo-map if affected by final file placement

---

## Suggested dependency order

1. `WP0` Reconciliation and implementation plan  
2. `WP1` Schema migration and backfill  
3. `WP2` Tier 2 config and runtime contract  
4. `WP3` Candidate discovery, eligibility, scoring, budgeting, and route selection  
5. `WP4` Generation prompts, parsers, and validation  
6. `WP5` Shared async batch runtime extraction  
7. `WP6` Tier 2 async adapter and persistence flow  
8. `WP7` Observability and transition logging  
9. `WP8` Read/context-pack integration (conditional but should be decided early)  
10. `WP9` API and operational surfaces  
11. `WP10` n8n and orchestration wiring  
12. `WP11` Test suite, CI, rollout, and documentation closeout

## Notes for the code-access agent

- Start by reconciling the Tier 2 PRD with the current repo and docs; do not assume the architecture text alone is sufficient.
- Treat `AGENTS.md` as the implementation policy layer.
- Keep doc updates atomic with contract changes.
- Prefer shared/runtime extraction over parallel Tier 2-only forks where the PRD explicitly calls for generalization.
