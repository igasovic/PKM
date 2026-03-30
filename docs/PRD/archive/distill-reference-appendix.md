# Distill Reference Appendix

Status: archived reference companion  
Surface owner: Tier-2 distill reference material split from the active canonical PRD  
Scope type: archive reference  
Last extracted: 2026-03-30  
Related canonical PRD: `docs/PRD/distill-prd.md`

## Purpose
Preserve detailed distill reference material that is useful for deep review or implementation recovery without keeping the active canonical PRD overloaded.

## Use this appendix when
- you need the detailed observability plan, scoring formula, migration guidelines, or candidate-discovery SQL guidance
- the active PRD points here for deep reference
- you are validating an edge case that is too detailed for the active contract summary

## Notes
- This appendix was split out during the PRD usability pass.
- The active contract remains in `docs/PRD/distill-prd.md`.
- If any section here becomes part of the actively maintained contract again, move it back into the canonical PRD instead of duplicating it.

### Observability / Braintrust Plan

- Purpose:
  - Define what Tier 2 execution should trace, where telemetry should go, what metadata should be logged, and what success should look like.

- Explicit meaning:
  - Observability has two telemetry destinations:
    - LLM telemetry:
      - Braintrust
    - transition telemetry:
      - Postgres `pipeline_events`
  - The shared backend logger (`src/server/logger`) is the common orchestration component used to emit transition logs into those flows.
  - Do not log heavy payloads.
  - Log counts, identifiers, enums, timings, and hashes.
  - Do not log raw `clean_text`, raw prompts, raw excerpts, or full model outputs unless explicitly debugging in a controlled path.

- Telemetry destinations:
  - Braintrust:
    - LLM request / response telemetry
    - generation-path metrics
    - prompt / model metadata
    - validation outcome metadata
  - Postgres `pipeline_events`:
    - durable transition telemetry
    - stage changes
    - enqueue / collect / validate / persist events
    - per-entry failure and retry events

- Shared logger requirements:
  - use `src/server/logger`
  - log stage transitions and control-plane decisions
  - do not log heavy payloads
  - summarize with counts + hashes, not raw fields

- What to trace in Braintrust:
  - direct generation calls
  - chunk note generation calls
  - final synthesis calls
  - validation outcome per completed generation
  - retry attempts that reissue model work

- Braintrust metadata to log per LLM call:
  - `stage`
    - `distill`
  - `route`
    - `direct`
    - `chunked`
  - `substage`
    - `direct_generation`
    - `chunk_note_generation`
    - `final_synthesis`
  - `entry_id`
  - `batch_id` *(if batch-backed)*
  - `model`
  - `distill_version`
  - `content_hash` used for the run
  - `clean_word_count`
  - chunk counts *(for chunked flow)*
  - chunk index *(for chunk-note calls)*
  - `chunking_strategy`
  - token usage / provider usage if returned
  - latency
  - retry count
  - validation decision
  - validation error code *(if failed)*

- What not to log to Braintrust:
  - raw `clean_text`
  - raw chunk text
  - full excerpt text
  - full generated summary text by default
  - any heavy request / response payload unless explicitly sampled in a safe debug mode

- What to write to `pipeline_events`:
  - candidate discovery completed
  - eligibility decision made
  - scoring completed
  - budgeting completed
  - route selected
  - batch dispatched
  - batch collected
  - generation completed
  - validation passed / failed
  - retry dispatched
  - terminal failure recorded
  - final artifact persisted

- `pipeline_events` metadata shape:
  - `stage`
    - `distill`
  - `step`
    - e.g. `candidate_discovery`, `eligibility_gate`, `priority_scoring`, `budgeting`, `route_selection`, `enqueue`, `collect`, `validation`, `persist`, `retry`
  - `entry_id` *(if per-entry event)*
  - `batch_id` *(if applicable)*
  - `status_before`
  - `status_after`
  - `reason_code` *(if applicable)*
  - `content_hash`
  - `distill_version`
  - route
  - `chunking_strategy`
  - `retry_count`
  - counts / timing / lightweight stats
  - error code and compact error summary when relevant

- Success looks like:
  - batch dispatch succeeds
  - collection succeeds
  - retries remain within configured limits
  - no duplicate application of results
  - accepted artifacts pass validation
  - stale results do not overwrite newer data
  - no invalid status transitions occur
  - no entries remain stuck in `queued` indefinitely

- Minimal V1 requirement:
  - Braintrust for all LLM calls with lightweight metadata only
  - `pipeline_events` for durable state changes

- Must not do:
  - store raw heavy payloads in telemetry
  - duplicate the same event in both destinations without purpose
  - treat Braintrust as the source of truth for state transitions

### Priority Scoring Formula

- Purpose:
  - Define the exact deterministic formula used to assign a priority score to eligible Tier 2 candidates.

- Explicit meaning:
  - Priority scoring runs only after eligibility.
  - It produces one numeric score per eligible entry.
  - Higher score means higher priority for budgeting.
  - Stale entries must always receive the highest priority.

- Inputs:
  - `distill_status`
  - `intent`
  - `topic_primary_confidence`
  - `topic_secondary_confidence`
  - `quality_score`
  - `clean_word_count`
  - future inputs:
    - topic match / topic importance
    - author priority

- Output:
  - `priority_score`
    - numeric
    - higher is better

- Formula:
  - if `distill_status = 'stale'`:
    - `priority_score = 1000`
  - otherwise:
    - `priority_score = intent_score + topic_confidence_score + quality_score_component + length_score`

- Component weights:
  - `intent_score`
    - `40` when `intent = 'think'`
    - `0` otherwise

  - `topic_confidence_score`
    - `round(20 * max(topic_primary_confidence, topic_secondary_confidence, 0))`
    - expected range:
      - `0..20`

  - `quality_score_component`
    - `round(20 * max(quality_score, 0))`
    - expected range:
      - `0..20`

  - `length_score`
    - if `400 <= clean_word_count <= 2500`:
      - `20`
    - if `200 <= clean_word_count < 400`:
      - `10`
    - if `2500 < clean_word_count <= 5000`:
      - `10`
    - if `clean_word_count > 5000`:
      - `5`
    - if `clean_word_count < 200`:
      - `0`

- Expected score range:
  - non-stale entries:
    - `0..100`
  - stale entries:
    - `1000`

- Missing value handling:
  - if topic confidence fields are missing:
    - treat as `0`
  - if `quality_score` is missing:
    - treat as `0`
  - if `clean_word_count` is missing:
    - treat length score as `0`

- Future extensions:
  - topic match / topic importance:
    - add as a separate component later
    - do not stub with placeholder logic now
  - author priority:
    - add as a separate component later
    - do not stub with placeholder logic now

- Tie behavior:
  - ties are not broken in the score itself
  - tie-breaking is handled later by budgeting rules

- Determinism rules:
  - use only persisted fields
  - no model calls
  - no randomness
  - same inputs must always produce the same score

- Examples:
  - stale entry:
    - `priority_score = 1000`

  - newsletter with:
    - `intent = 'think'`
    - `topic_primary_confidence = 0.8`
    - `quality_score = 0.9`
    - `clean_word_count = 1200`
    - score:
      - `40 + round(20 * 0.8) + round(20 * 0.9) + 20`
      - `40 + 16 + 18 + 20 = 94`

  - newsletter with:
    - `intent = 'archive'`
    - no topic confidence
    - `quality_score = 0.5`
    - `clean_word_count = 300`
    - score:
      - `0 + 0 + round(20 * 0.5) + 10`
      - `0 + 0 + 10 + 10 = 20`

- Must not do:
  - eligibility decisions
  - budget selection
  - route selection
  - fetching `clean_text`
  - model calls

### Schema Migration Plan Guidelines

- Scope:
  - apply the Tier 2 schema changes to both:
    - `pkm.entries`
    - `pkm_test.entries`
  - if the generic batch persistence extraction lands in the same rollout, apply the batch-table / column rename migration to both schemas too

- Prerequisite check:
  - verify `entries.content_hash` exists in both schemas
  - if the column is missing, restore it before enabling Tier 2 currentness / stale logic
  - if the column exists but is not populated or was never used, implement and run a backfill before enabling Tier 2 currentness / stale logic

- Migration split:
  - prefer separate migrations for:
    1. Tier 2 entry fields / constraints / indexes
    2. `content_hash` verification / restoration / backfill if needed
    3. generic batch persistence extraction / rename if included in the same rollout
    4. `distill_status` backfill
  - this keeps rollout and rollback cleaner

- Constraints:
  - add DB constraints only for:
    - allowed `distill_status` values
    - allowed `distill_stance` values
  - keep `distill_metadata` shape enforcement in app logic, not DB constraints

- Index guidelines:
  - add only indexes that support the agreed workflow:
    - `distill_status` with recency support
    - `distill_created_from_hash`
    - optional partial index for newsletter candidate discovery
  - do not over-index before real usage is observed

- Backfill rules:
  - backfill `distill_status`
  - use these deterministic rules:
    - if `content_type != 'newsletter'` or missing:
      - `distill_status = 'not_eligible'`
    - if `content_type = 'newsletter'` but `clean_text` is missing or blank:
      - `distill_status = 'skipped'`
    - if `content_type = 'newsletter'` and `clean_text` exists:
      - `distill_status = 'pending'`
  - do not backfill `stale`
  - `stale` is set later by the stale-detection cron when a completed artifact no longer matches `content_hash`

- Do not backfill:
  - do not populate any Tier 2 artifact fields from existing data
  - leave all Tier 2 artifact fields null until real Tier 2 generation produces them

- Do not infer from Tier 1:
  - do not derive Tier 2 artifacts from existing Tier 1 outputs
  - Tier 2 should start clean, not as a projection of Tier 1

- Rollout order:
  - use this order:
    1. verify / restore / backfill `content_hash` if needed
    2. apply Tier 2 entry migration
    3. apply generic batch persistence migration if included in the same rollout
    4. deploy app code that understands the new fields and generic batch runtime
    5. run `distill_status` backfill
    6. enable Tier 2 scheduled execution
    7. enable stale-detection cron
  - do not enable workers before the app can safely read and write the new fields

- App compatibility requirements:
  - before enabling Tier 2, make sure the application can:
    - read the new Tier 2 fields
    - write the new Tier 2 fields
    - handle null Tier 2 artifact fields
    - handle backfilled `distill_status`
    - respect the agreed status transition rules
    - handle the generalized batch persistence tables if the extraction lands in the same rollout

- Metadata guidelines:
  - use app-level conventions for `distill_metadata`
  - do not require every expected key to exist at migration time

- Test cases to validate after migration:
  - newsletter with `clean_text` -> `pending`
  - newsletter without `clean_text` -> `skipped`
  - non-newsletter -> `not_eligible`
  - all Tier 2 artifact fields remain null after backfill
  - invalid stance / status values are rejected
  - `content_hash` exists and is populated enough for currentness logic
  - `stale` is not backfilled directly
  - existing Tier 1 behavior is unaffected

- Main principle:
  - this migration should introduce Tier 2 structure, restore / confirm `content_hash`, and prepare generic batch reuse where needed — not fake Tier 2 data

### Candidate Discovery SQL Guidelines

- Purpose:
  - define the exact shape and behavior of the first candidate-discovery query for Tier 2 distillation

- Query role:
  - this is the first of two pre-dispatch read queries
  - it should build the broader lightweight working set for Tier 2
  - it should not fetch `clean_text`
  - it should not perform final route selection, request building, or enqueueing

- Source table:
  - query from `entries`

- Filtering rules:
  - include only rows where:
    - `content_type = 'newsletter'`
    - `clean_text` exists and is not blank
  - exclude rows where:
    - `distill_status = 'queued'`
    - `distill_created_from_hash = content_hash`
  - keep the filtering deterministic and limited to persisted fields only

- Currentness rule:
  - candidate discovery must treat an entry as already current when:
    - `distill_created_from_hash = content_hash`
  - those rows should not be returned

- Return shape:
  - minimum required field:
    - `id`
  - practical return shape:
    - `id`
    - `entry_id`
    - `content_hash`
    - `intent`
    - `content_type`
    - `author`
    - `topic_primary_confidence`
    - `topic_secondary_confidence`
    - `quality_score`
    - `clean_word_count`
    - `distill_status`
    - `distill_created_from_hash`
    - `created_at`

- Must not return:
  - `clean_text`
  - heavy payload fields
  - raw metadata blobs unless later proven necessary

- Ordering:
  - candidate discovery itself does not need to apply final priority ordering
  - if ordering is used in the query for stability, keep it simple and deterministic
  - recommended stable fallback ordering:
    - `created_at` ascending or descending, whichever better matches backlog behavior
    - then `id` as final tie-breaker

- Limits:
  - optional SQL-level limit is acceptable only as a protective cap for the broader scan
  - it should not replace budgeting
  - if used, keep it higher than `distill.max_entries_per_run` so scoring and budgeting still have room to operate

- Null-handling expectations:
  - treat blank `clean_text` as missing
  - treat missing `content_hash` as not current
  - allow missing optional scoring fields to pass through as null for later deterministic handling

- Output contract:
  - query 1 returns lightweight candidate rows
  - application code performs:
    - eligibility gate
    - priority scoring
    - budgeting
  - query 2 then fetches `clean_text` and detailed fields for the selected IDs only

- Validation checklist for the query:
  - returns newsletter entries only
  - never returns rows already in `queued`
  - never returns rows already current for the same `content_hash`
  - never returns rows without usable `clean_text`
  - never returns `clean_text`
  - returns all fields needed for eligibility, scoring, and budgeting

- Main principle:
  - candidate discovery should return a lightweight, deterministic working set — not the full entry payload

