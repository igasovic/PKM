# PRD — Distill (Tier-2)

Status: active  
Surface owner: backend Tier-2 planning and execution surface  
Scope type: canonical surface  
Last verified: 2026-03-30  
Related authoritative docs: `docs/api_distill.md`, `docs/database_schema.md`, `docs/backend_runtime_env.md`, `docs/requirements.md`  
Related work-package doc: `docs/PRD/distill-work-packages.md`
Related reference appendix: `docs/PRD/archive/distill-reference-appendix.md`

## Purpose
Define the Tier-2 distill surface, including planning, selection, generation, validation, and persistence for distillation work.

## Use this PRD when
- changing Tier-2 candidate discovery, eligibility, scoring, budgeting, route selection, generation, validation, persistence, or retry behavior
- changing sync or batch distill semantics
- reviewing whether a behavior belongs to distill versus ingest, classify, or generic read

## Fast path by agent
- Coding agent: read `Status and scope boundary`, `Boundaries and callers`, then jump to the relevant phase in `Control Plane` and its matching contract section later in the file.
- Planning agent: read `Goals`, `Boundaries and callers`, `Control Plane`, `Config Surface`, `State Transition Matrix`, and `Reference appendix`.
- Reviewing agent: read `Status and scope boundary`, `Eligibility Gate`, `Validation Contract`, `State Transition Matrix`, `Retry Config and Behavior`, and `Known gaps requiring code deep-dive`.
- Architect agent: read `Boundaries and callers`, `Command-shell coupling`, `Route Selection`, `Async Execution Design`, `Single-Entry Sync API`, and `Reference appendix`.

## Section map
- Pipeline overview: `Control Plane`
- Deterministic pre-generation logic: `Candidate Discovery`, `Eligibility Gate`, `Priority Scoring`, `Budgeting`, `Route Selection`
- Generation and validation rules: `Generation`, `Validation`, `Generation Contract`, `Validation Contract`
- Persistence and lifecycle: `Persist`, `Review / Retry`, `State Transition Matrix`, `Stale Detection and Cron`
- Runtime and APIs: `Config Surface`, `Async Execution Design`, `Single-Entry Sync API`
- Reference-heavy appendix: `Reference appendix`
- Change planning: `TBD`

## Status and scope boundary
This PRD owns:
- Tier-2 planning and execution behavior
- candidate discovery, eligibility, scoring, budgeting, route selection, generation, validation, and persistence
- Tier-2 sync and batch execution contracts
- Tier-2-specific state written back to entries and related batch/runtime state

This PRD does not own:
- ingest normalization and idempotent insert rules
- Tier-1 classify behavior
- generic read/context-pack behavior beyond Tier-2 fields that generic read can display
- working-memory or public ChatGPT integration surfaces

## Current behavior / baseline
This PRD remains the active owner of the Tier-2 contract. The main file now keeps the operationally active control-plane and state-transition material, while the most reference-heavy appendix sections live in `docs/PRD/archive/distill-reference-appendix.md`.

## Goals
- keep Tier-2 planning deterministic before model generation starts
- keep validation and currentness rules explicit
- keep Tier-2 separated from ingest and classify while still exposing its outputs to read surfaces

## Non-goals
- owning Tier-1 classify orchestration
- documenting generic read contracts in full here
- turning the PRD into the primary home for schema or env reference details

## Boundaries and callers
Primary callers and coupled surfaces:
- backend Tier-2 APIs and workers
- classify surface for handoff separation
- read/context-pack surface for display of distill output fields
- `10 Read` command parser shell for `/distill-run` entrypoint ergonomics

### Command-shell coupling
- When exposed through the `10 Read` workflow shell, `/distill-run` defaults to batch execution semantics.
- Sync execution is allowed only when explicitly requested through `--sync`.
- Help-text and parser ergonomics for `/distill-run` live with the read workflow shell, but execution-mode semantics remain owned by this PRD.

## Evidence / recovery basis
Recovered from:
- legacy distill PRD material now consolidated into this file and its reference appendix
- `docs/requirements.md`
- `docs/changelog.md`
- related backend/runtime docs

## Known gaps requiring code deep-dive
- `REVIEW_REQUIRED: confirm the exact current implementation coverage of the full Tier-2 PRD against `src/server/**` before treating every section below as fully implemented baseline. The design ownership is clear, but this cleanup pass did not re-verify each planned control-plane phase against code line by line.`

## Detailed design
## Control Plane
1. Candidate Discovery
2. Eligibility Gate
3. Priority Scoring
4. Budgeting
5. Route Selection
6. Generation
7. Validation
8. Persist
9. Review / Retry

### Candidate Discovery

- Purpose:
  - Build the initial candidate set for Tier 2 distillation.

- Explicit meaning:
  - This is the first of two pre-dispatch read queries.
  - It returns a broader, lightweight working set used for deterministic filtering, scoring, and prioritization.
  - It is not responsible for fetching full text.
  - It is not responsible for final chunking input assembly.

- Should include entries that:
  - have usable `clean_text`
  - have `content_type = 'newsletter'`
  - are in the appropriate lifecycle/state window for distillation
  - are not already current for the latest `content_hash`

- Should exclude entries that:
  - have `distill_status = 'queued'`
  - are already current for the same `content_hash`
  - are deterministically out of scope

- Minimum return shape:
  - `id`

- Practical return shape:
  - `id`
  - `entry_id`
  - `content_hash`
  - `intent`
  - `content_type`
  - `author`
  - topic / confidence fields
  - `quality_score`
  - text-length fields
  - `distill_status`
  - `distill_created_from_hash`
  - `created_at`

- Must not return:
  - `clean_text`

- Downstream role:
  - candidate discovery builds the broader lightweight candidate set
  - eligibility, priority scoring, and budgeting run on this result
  - a second smaller query loads the prioritized cutoff set with `clean_text` for route selection and request building

### Eligibility Gate

- Purpose:
  - Decide whether a candidate entry should proceed to Tier 2 distillation now.

- Explicit meaning:
  - This is a deterministic gate applied after candidate discovery.
  - It evaluates each candidate row and assigns one of:
    - `proceed`
    - `skipped`
    - `not_eligible`
  - It is not responsible for ranking candidates.
  - It is not responsible for budgeting.

- Inputs:
  - `id`
  - `entry_id`
  - `content_hash`
  - `intent`
  - `content_type`
  - `author`
  - topic / confidence fields
  - `quality_score`
  - text-length fields
  - `distill_status`
  - `distill_created_from_hash`

- Should allow entries that:
  - have usable `clean_text`
  - have `content_type = 'newsletter'`
  - are not already current for the same `content_hash`
  - are not already queued

- Should reject entries as `not_eligible` when:
  - `content_type != 'newsletter'`

- Should reject entries as `skipped` when:
  - `clean_text` is missing
  - they are already current for the same `content_hash`
  - `distill_status = 'queued'`

- Outputs:
  - decision:
    - `proceed`
    - `skipped`
    - `not_eligible`
  - reason code

- Suggested reason codes:
  - `missing_clean_text`
  - `wrong_content_type`
  - `already_current`
  - `already_queued`

- State effects:
  - if `proceed`:
    - no terminal state written yet
  - if `skipped`:
    - persist `distill_status = 'skipped'`
  - if `not_eligible`:
    - persist `distill_status = 'not_eligible'`

- Must not do:
  - final priority scoring
  - budget selection
  - route selection
  - fetching `clean_text`
  - model calls

### Priority Scoring

- Purpose:
  - Rank eligible entries so Tier 2 distillation is applied to the highest-value candidates first.

- Explicit meaning:
  - This is a deterministic scoring step applied only to entries that passed the eligibility gate.
  - It assigns a priority score used for later budgeting and selection.
  - It is not responsible for deciding whether an entry is eligible.
  - It is not responsible for final budget cutoffs.

- Inputs:
  - `id`
  - `entry_id`
  - `content_hash`
  - `intent`
  - `content_type`
  - `author`
  - topic / confidence fields
  - `quality_score`
  - text-length fields
  - `distill_status`
  - `distill_created_from_hash`

- Should score highest when:
  - `distill_status = 'stale'`

- Should score higher when:
  - `intent = 'think'`
  - topic match is stronger *(later; not available yet)*
  - topic confidence is higher
  - author priority is higher *(later; not available yet)*
  - `quality_score` is higher
  - length is in the preferred range for distillation

- Should score lower when:
  - `quality_score` is lower
  - text is too short to benefit much from distillation
  - text is very long and therefore more expensive to process

- Length guidance:
  - use `clean_word_count`
  - preferred range:
    - `400 <= clean_word_count <= 2500`
  - lower score:
    - `200 <= clean_word_count < 400`
    - `2500 < clean_word_count <= 5000`
  - very low score:
    - `clean_word_count < 200`
    - `clean_word_count > 5000`

- Outputs:
  - numeric priority score

- State effects:
  - no immediate state change on `entries`
  - score will be persisted later as part of distillation metadata

- Must not do:
  - eligibility decisions
  - budget selection
  - route selection
  - fetching `clean_text`
  - model calls

### Budgeting

- Purpose:
  - Select which scored entries will actually be processed in the current Tier 2 run.

- Explicit meaning:
  - This step applies run-level limits after priority scoring.
  - It determines the final workset for the run.
  - It is not responsible for deciding eligibility.
  - It is not responsible for computing priority scores.
  - It is not responsible for route selection.
  - It is not responsible for persisting queue state.

- Inputs:
  - scored eligible entries
  - numeric priority score
  - `id`
  - `distill_status`
  - text-length fields
  - run-level budget configuration

- Should do:
  - sort entries by priority score descending
  - take the top entries within the configured run budget
  - ensure stale entries are selected first because they received the highest score

- Budget controls:
  - `distill.max_entries_per_run`

- Initial recommendation:
  - start with:
    - `distill.max_entries_per_run`
  - do not add token-based or daily budgeting in V1

- Outputs:
  - final selected entry IDs for this run
  - those IDs drive the second pre-dispatch detail query that loads `clean_text` and other fields required for route selection and request building
  - non-selected scored entries remain untouched for future runs

- State effects:
  - no direct state change on `entries`
  - `distill_status = 'queued'` is persisted later by the enqueue / dispatch step, only if queueing actually occurs

- Must not do:
  - eligibility decisions
  - score calculation
  - fetching `clean_text`
  - model calls
  - route selection

### Route Selection

- Purpose:
  - Decide how each selected entry will be processed for Tier 2 distillation.

- Explicit meaning:
  - This step determines the execution path for each selected entry.
  - It is responsible for choosing between direct processing and chunked processing.
  - It runs on the detailed rows loaded by the second pre-dispatch query.
  - It is not responsible for deciding eligibility.
  - It is not responsible for scoring or budgeting.

- Inputs:
  - selected entry IDs
  - `clean_text`
  - `clean_word_count`
  - `distill_status`
  - `distill_metadata` *(for prior chunking strategy / error info, if present later)*
  - route-selection config

- Should choose:
  - `direct`
    - when the text is short enough to process in one pass
  - `chunked`
    - when the text is large enough that one-pass distillation is likely to degrade coverage or quality

- Initial routing rule:
  - use `clean_word_count`
  - compare against `distill.direct_chunk_threshold_words`
  - choose `direct` when:
    - `clean_word_count <= distill.direct_chunk_threshold_words`
  - choose `chunked` when:
    - `clean_word_count > distill.direct_chunk_threshold_words`

- Initial threshold:
  - start with:
    - `distill.direct_chunk_threshold_words = 5000`
  - this is a configuration value, not a hardcoded rule
  - it should be revisited after reviewing the real `clean_word_count` distribution for newsletter entries

- Outputs:
  - route decision per selected entry:
    - `direct`
    - `chunked`

- State effects:
  - no direct state change on `entries`
  - chosen route can be persisted later in `distill_metadata.chunking_strategy`

- Must not do:
  - eligibility decisions
  - score calculation
  - budget selection
  - issue additional entry reads beyond the second pre-dispatch detail query
  - model calls

### Generation

- Purpose:
  - Generate the Tier 2 distillation artifact for each selected entry.

- Explicit meaning:
  - This step performs the actual LLM call.
  - It uses the selected route (`direct` or `chunked`) and produces the Tier 2 output fields.
  - Standard scheduled Tier 2 processing uses the async batch worker.
  - A separate single-entry sync API may execute the same generation logic inline for one existing prod entry.
  - It is not responsible for candidate discovery, eligibility, scoring, budgeting, or route selection.

- Inputs:
  - `id`
  - `entry_id`
  - `clean_text`
  - `clean_word_count`
  - route decision:
    - `direct`
    - `chunked`
  - `content_hash`

- Dispatch behavior:
  - batch path:
    - selected entries are sent to the async distillation worker / batch processor
    - after successful dispatch, persist:
      - `distill_status = 'queued'`
  - single-entry sync path:
    - run inline for one existing prod entry
    - do not write `queued`

- Direct path:
  - send full `clean_text` in one pass
  - request:
    - `distill_summary`
    - `distill_excerpt`
    - `distill_why_it_matters`
    - `distill_stance`

- Chunked path:
  - split `clean_text` using the configured chunking strategy
  - generate intermediate chunk outputs as needed
  - synthesize final:
    - `distill_summary`
    - `distill_excerpt`
    - `distill_why_it_matters`
    - `distill_stance`

- Output fields:
  - `distill_summary`
  - `distill_excerpt`
  - `distill_why_it_matters`
  - `distill_stance`
  - `distill_version`
  - `distill_created_from_hash`
  - `distill_metadata`

- Metadata fields to populate:
  - `created_at`
  - `model`
  - `request_type`
  - `error`
  - `chunking_strategy`

- State effects:
  - batch path:
    - after enqueue:
      - persist `distill_status = 'queued'`
  - success:
    - pass output to validation
  - failure:
    - hand off to review / retry logic

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - route selection

### Validation

- Purpose:
  - Verify that the generated Tier 2 artifact is structurally valid and usable before it is treated as current.

- Explicit meaning:
  - This step runs after generation completes.
  - It checks the returned output against deterministic acceptance rules.
  - It compares currentness against the current `content_hash`.
  - It includes excerpt grounding against `clean_text`.
  - It is not responsible for generating content.
  - It is not responsible for candidate discovery, eligibility, scoring, budgeting, or route selection.

- Inputs:
  - `id`
  - `clean_text`
  - generated output fields:
    - `distill_summary`
    - `distill_excerpt`
    - `distill_why_it_matters`
    - `distill_stance`
    - `distill_version`
    - `distill_created_from_hash`
    - `distill_metadata`
  - current `content_hash`

- Should validate:
  - `distill_summary` exists and is non-empty
  - `distill_why_it_matters` exists and is non-empty
  - `distill_stance` is one of:
    - `descriptive`
    - `analytical`
    - `argumentative`
    - `speculative`
    - `instructional`
    - `narrative`
    - `other`
  - `distill_created_from_hash` matches the current `content_hash`
  - `distill_excerpt` is optional, but if present it must be non-empty and grounded in `clean_text`
  - required metadata fields are present:
    - `created_at`
    - `model`
    - `chunking_strategy`
    - `error` *(nullable on success)*

- Excerpt grounding rule:
  - compare against `clean_text`
  - normalize whitespace, quotes, and line breaks before comparison
  - do not require strict byte-for-byte equality
  - fail only when the excerpt is clearly not grounded in the source text

- Outputs:
  - validation decision:
    - `accepted`
    - `failed`

- State effects:
  - if `accepted`:
    - continue to persist
  - if `failed`:
    - persist `distill_status = 'failed'`
    - persist validation error details in `distill_metadata.error`

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - route selection
  - model calls

### Persist

- Purpose:
  - Write the validated Tier 2 artifact to `entries` as the current distillation state.

- Explicit meaning:
  - This step persists the final accepted output fields after validation succeeds.
  - It is not responsible for generating content.
  - It is not responsible for validating content.
  - It is not responsible for candidate discovery, eligibility, scoring, budgeting, or route selection.
  - `distill_status = 'completed'` must be persisted together with the main artifact fields in the same write.

- Inputs:
  - `id`
  - validated output fields:
    - `distill_summary`
    - `distill_excerpt`
    - `distill_why_it_matters`
    - `distill_stance`
    - `distill_version`
    - `distill_created_from_hash`
    - `distill_metadata`

- Should persist in one write:
  - `distill_summary`
  - `distill_excerpt`
  - `distill_why_it_matters`
  - `distill_stance`
  - `distill_version`
  - `distill_created_from_hash`
  - `distill_metadata`
  - `distill_status = 'completed'`

- Should overwrite:
  - the previous current Tier 2 artifact for that entry

- Outputs:
  - durable current Tier 2 state on `entries`

- State effects:
  - persist `distill_status = 'completed'` together with the artifact fields

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - route selection
  - model calls
  - validation logic

### Review / Retry

- Purpose:
  - Handle distillation attempts that did not produce a valid final artifact.

- Explicit meaning:
  - This step decides what to do after generation or validation failure.
  - It is responsible for retry policy and review routing.
  - It applies to the async / batch path.
  - The single-entry sync API does not automatically retry in V1.
  - It is not responsible for generating content.
  - It is not responsible for validating content.
  - It is not responsible for candidate discovery, eligibility, scoring, budgeting, or route selection.

- Inputs:
  - `id`
  - `distill_status`
  - current `distill_metadata`
  - latest error details
  - retry policy config

- Should do:
  - classify the failure as retryable or terminal
  - retry when the failure is considered transient
  - stop retrying when retry policy says no further attempts should be made
  - preserve enough error context for later inspection

- Retryable failures:
  - network / transport error
  - request timeout
  - rate limit / capacity error
  - temporary provider error
  - malformed or incomplete model response that suggests the call succeeded but the payload was unusable
  - transient batch / worker execution failure

- Non-retryable failures:
  - `clean_text` missing
  - `content_type != 'newsletter'` for the scheduled batch flow
  - already current for the same `content_hash`
  - `distill_status = 'queued'` at time of attempt
  - invalid configuration
  - unsupported or invalid route configuration
  - validation failure caused by deterministic contract mismatch that a blind retry is unlikely to fix

- Retry policy:
  - read from configuration
  - determines:
    - whether retry is enabled
    - maximum retry attempts
    - any retryable / non-retryable overrides
    - any backoff / delay behavior

- Review handling:
  - no separate review state for now
  - review remains an operational concept outside the current status model

- Outputs:
  - retry decision:
    - `retry`
    - `fail`

- State effects:
  - on retry dispatch:
    - persist `distill_status = 'queued'`
  - on terminal failure:
    - persist `distill_status = 'failed'`
    - persist final error details in `distill_metadata.error`

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - route selection
  - final artifact persistence on success

## Source Completion Checklist

- [x]  Config schema — define the exact distill configuration areas, defaults, and required runtime behavior.
- [x]  Field spec finalization — lock the final distill_* columns, allowed values, and `distill_metadata` JSON shape.
- [x]  Candidate discovery SQL — write the actual first query and confirm the exact return fields.
- [x]  Query budget and read pattern — make the 2-before / 1-after read pattern explicit.
- [x]  Priority scoring formula — turn the scoring rules into explicit weights and deterministic logic.
- [x]  Budgeting implementation rules — define exactly how `distill.max_entries_per_run` is applied and how ties are handled.
- [x]  Route selection rules — finalize the direct vs chunked threshold and how chunking strategy is chosen.
- [x]  Chunking design — specify how chunking works, because generation depends on that path being deterministic.
- [x]  Generation contract — define the exact prompt / output schema the LLM must return for direct and chunked flows.
- [x]  Validation contract — define exact pass / fail checks, including excerpt grounding against `clean_text`.
- [x]  Retry config and behavior — map config-driven retry policy to concrete worker behavior and state transitions.
- [x]  State transition matrix — document every valid `distill_status` transition so behavior stays consistent.
- [x]  Stale detection and cron — define how `completed` becomes `stale`.
- [x]  Async execution design — define how the shared batch worker enqueues, processes, and updates entries.
- [x]  Single-entry sync API — define the synchronous `entry_id`-driven execution path.
- [x]  Observability / Braintrust plan — decide what to trace, what metadata to log, and what success looks like.
- [x]  Schema migration plan — turn the agreed fields into actual ALTER TABLE work and backfill rules.
- [x]  Work packages — break the whole implementation into ordered, testable delivery chunks.
- [x]  TBD section — leave unresolved code-surface details explicit for the code-access pass.

### Config Surface

- Purpose:
  - Summarize the Tier 2 configuration surface in one place.

- Source of truth:
  - `src/libs/config.js`

- Required config areas:
  - run selection:
    - `distill.max_entries_per_run`
    - optional broader candidate-scan cap for the first query *(exact key TBD if needed)*
  - route selection:
    - `distill.direct_chunk_threshold_words`
  - chunking:
    - `distill.chunk_target_words`
    - `distill.chunk_max_words`
    - `distill.chunk_overlap_words`
  - retry:
    - `distill.retry.enabled`
    - `distill.retry.max_attempts`
    - `distill.retry.retryable_error_codes`
    - `distill.retry.non_retryable_error_codes`
  - model routing:
    - config-driven LiteLLM model route per Tier 2 request type
    - at minimum cover:
      - direct generation
      - chunk note generation
      - final synthesis
      - single-entry sync direct generation if different from standard direct generation
  - worker / schema behavior:
    - shared batch runtime must support prod and test
    - scheduled Tier 2 worker must target prod only

- Current rollout rule:
  - config changes are internal / backend-facing
  - no `/config` API expansion is required in this rollout

### Tier 2 / distill_ fields on `entries`

- `distill_summary text null`
  - Main Tier 2 summary artifact.
  - Read context-pack consumption is enabled:
    - `distill_summary` is the primary content field when present.
    - for top-ranked read hits, include `distill_why_it_matters` on roughly the first quarter of rows (target 20-30%, implemented at 25%).

- `distill_excerpt text null`
  - Optional bounded passage when wording, evidence, or texture matters.

- `distill_version text null`
  - Version of the Tier 2 schema / prompt contract. Useful for controlled regeneration.

- `distill_created_from_hash text null`
  - Ties the artifact to `entries.content_hash` for the exact source text version it was created from.

- `distill_why_it_matters text null`
  - Short statement of why this item should matter in future retrieval or context assembly.

- `distill_stance text null`
  - Content posture / rhetorical mode.
  - Recommended values:
    - `descriptive`
    - `analytical`
    - `argumentative`
    - `speculative`
    - `instructional`
    - `narrative`
    - `other`

- `distill_status text not null default 'pending'`
  - Current Tier 2 state.
  - Recommended values:
    - `pending`
    - `queued`
    - `completed`
    - `failed`
    - `skipped`
    - `not_eligible`
    - `stale`
  - `stale` is set later by stale-detection logic; it is not part of the initial backfill.

- `distill_metadata jsonb null`
  - Operational and generation metadata for Tier 2.
  - Suggested shape:
    - `created_at`
    - `model`
    - `request_type`
    - `error`
    - `chunking_strategy`
    - `retry_count`
    - `batch_id` *(if returned by the current enqueue method)*

- `entries.content_hash`
  - Not a new Tier 2 field, but it is the source-version field for currentness and stale checks.
  - Before rollout, verify that the column exists in both schemas and backfill / populate it if missing or previously unused.

    
### Chunking Design

- Purpose:
  - Define a deterministic chunking process for Tier 2 distillation when `clean_text` is too large for the direct path.

- Explicit meaning:
  - Chunking is a preprocessing and intermediate synthesis strategy used only for the `chunked` route.
  - It must be deterministic so the same `clean_text` and config produce the same chunk boundaries every time.
  - It is not responsible for final validation or persistence.

- Inputs:
  - `clean_text`
  - `clean_word_count`
  - `distill.direct_chunk_threshold_words`
  - chunking config

- Trigger:
  - use chunking only when:
    - `clean_word_count > distill.direct_chunk_threshold_words`

- Determinism rules:
  - use the same splitter implementation every time
  - use fixed config values for target chunk size and overlap
  - prefer structure-aware boundaries first, fallback to paragraph boundaries, then fallback to hard word limits
  - never use randomness
  - never let model output determine chunk boundaries

- Chunking strategy order:
  - Step 1:
    - split on strong section boundaries when present
    - examples:
      - markdown headings
      - repeated newsletter section markers
      - clear titled blocks
  - Step 2:
    - within each section, split by paragraph boundaries
  - Step 3:
    - if a section is still too large, split by fixed word-count windows with overlap

- Initial config:
  - `distill.direct_chunk_threshold_words = 5000`
  - `distill.chunk_target_words = 1800`
  - `distill.chunk_max_words = 2200`
  - `distill.chunk_overlap_words = 150`

- Chunk construction rules:
  - each chunk should target `distill.chunk_target_words`
  - a chunk may grow up to `distill.chunk_max_words` to avoid awkward paragraph breaks
  - if adding the next paragraph would exceed `distill.chunk_max_words`, start a new chunk
  - apply overlap by repeating the last `distill.chunk_overlap_words` words from the previous chunk at the start of the next chunk
  - if overlap would cut through formatting or a paragraph boundary awkwardly, prefer paragraph-aligned overlap when possible

- Special cases:
  - if a single paragraph exceeds `distill.chunk_max_words`, split that paragraph by fixed word-count windows
  - if structure markers do not exist, use paragraph-based chunking directly
  - if paragraph structure is poor, fallback to fixed word-count windows

- Intermediate generation:
  - each chunk produces a compact intermediate note, not the final artifact
  - each chunk note should capture:
    - main point
    - important supporting point(s)
    - whether the chunk contains useful excerpt candidates

- Final synthesis:
  - after all chunk notes are generated, run one synthesis pass over:
    - ordered chunk notes
    - source title / author if available
    - overall stance cues if available
  - final synthesis produces:
    - `distill_summary`
    - `distill_excerpt`
    - `distill_why_it_matters`
    - `distill_stance`

- Excerpt selection:
  - excerpt should be chosen only in the final synthesis step
  - excerpt should come from the best candidate chunk, not from arbitrary early text
  - excerpt remains optional

- Metadata to persist:
  - `distill_metadata.chunking_strategy`
    - suggested initial value:
      - `structure_paragraph_window_v1`
  - optionally also include:
    - `chunk_count`
    - `chunk_target_words`
    - `chunk_overlap_words`

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - validation
  - persistence

### Route Selection Rules

- Purpose:
  - Decide whether each selected entry uses the `direct` or `chunked` distillation path, and choose the chunking strategy when chunking is required.

- Explicit meaning:
  - This is a deterministic control-plane decision made before generation.
  - It decides:
    - route
    - chunking strategy
  - It runs on the detailed rows loaded by the second pre-dispatch query.
  - It does not define how chunking itself works.
  - It does not perform generation.

- Decision source of truth:
  - use `clean_word_count`
  - compare against config:
    - `distill.direct_chunk_threshold_words`

- Initial route rule:
  - choose `direct` when:
    - `clean_word_count <= distill.direct_chunk_threshold_words`
  - choose `chunked` when:
    - `clean_word_count > distill.direct_chunk_threshold_words`

- Initial threshold:
  - `distill.direct_chunk_threshold_words = 5000`
  - this is a configuration value, not a hardcoded constant
  - it should be revisited after observing real newsletter lengths and output quality

- Chunking strategy selection:
  - when route = `direct`:
    - no chunking strategy applies
  - when route = `chunked`:
    - use one fixed strategy in V1:
      - `structure_paragraph_window_v1`

- Strategy selection policy:
  - V1 should not choose among multiple chunking strategies dynamically
  - if route = `chunked`, always use the same configured strategy
  - this keeps behavior deterministic and easier to debug

- Persistence:
  - persist the chosen route in:
    - `distill_metadata.chunking_strategy`
  - suggested values:
    - `direct`
    - `structure_paragraph_window_v1`

- Fallback / override policy:
  - if `direct` generation fails for a retryable reason that suggests route may be the issue, retry policy may switch the entry to `chunked`
  - if `chunked` generation fails, retry policy should normally retry the same route first
  - route-switching rules should remain configuration-driven where possible
  - V1 should keep route overrides minimal

- Inputs:
  - `id`
  - `clean_text`
  - `clean_word_count`
  - `distill_status`
  - route-selection config

- Outputs:
  - route decision:
    - `direct`
    - `chunked`
  - chosen chunking strategy:
    - `direct`
    - `structure_paragraph_window_v1`

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - fetch more entry data beyond the second pre-dispatch query
  - model calls
  - chunk construction

### Budgeting Implementation Rules

- Purpose:
  - Define exactly how `distill.max_entries_per_run` is applied after scoring and how equal-score ties are resolved.

- Explicit meaning:
  - Budgeting operates only on entries that already passed:
    - candidate discovery
    - eligibility gate
    - priority scoring
  - It produces the final set of entry IDs for the current run.
  - It does not change scores.
  - It does not enqueue work.

- Input set:
  - all eligible scored entries for the current run

- Primary budget limit:
  - use config:
    - `distill.max_entries_per_run`
  - this is the maximum number of entries selected for the run

- Selection rule:
  - sort entries by:
    1. priority score descending
    2. tie-breaker order
  - select the first `distill.max_entries_per_run` entries from that ordered list

- Tie-breaker order:
  - apply in this order:
    1. `distill_status = 'stale'` first
    2. higher `clean_word_count` first
    3. older `created_at` first
    4. lower `id` first

- Tie-handling rule:
  - ties do not expand the run beyond `distill.max_entries_per_run`
  - if multiple entries tie around the cutoff, use the tie-breaker order and take only the entries that fit within the limit

- Zero / invalid budget handling:
  - if `distill.max_entries_per_run <= 0`:
    - select no entries
  - invalid config should be treated as configuration error upstream

- Output:
  - ordered list of selected entry IDs
  - that list is the input to the second pre-dispatch detail query
  - non-selected entries remain unchanged and are eligible for future runs

- State effects:
  - no direct state change on `entries`
  - queue state is handled later by enqueue / dispatch

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - route selection
  - fetching `clean_text`
  - model calls
  - enqueueing

### Query Budget and Read Pattern

- Purpose:
  - Minimize entry-read queries around a Tier 2 batch run and make the intended read pattern explicit.

- Target:
  - 2 read queries before batch dispatch
  - 1 read query after batch completion, before per-item result application
  - write statements are separate and are not counted in this target

- Pre-dispatch query 1:
  - broader candidate discovery
  - used for deterministic filtering, eligibility, priority scoring, and budgeting
  - does not return `clean_text`

- Pre-dispatch query 2:
  - smaller prioritized cutoff set
  - keyed by the selected IDs from budgeting
  - returns `clean_text` and the fields required for route selection, chunking, and request building

- Post-batch read query:
  - one reconciliation query over the returned item set
  - fetches current `content_hash`, current `distill_status`, and any fields needed to validate currentness before applying results

- Main principle:
  - avoid per-item read amplification
  - do as much deterministic work as possible on the first lightweight query

### Generation Contract

- Purpose:
  - Define the exact LLM prompt contract and output schema for Tier 2 distillation for both `direct` and `chunked` flows.

- Explicit meaning:
  - The generation step must request structured output only.
  - The model must return one JSON object matching the schema for the selected route.
  - The contract is the same final shape for both routes.
  - The chunked route may use intermediate schemas internally, but the final synthesis output must match the same final schema as the direct route.

- Model selection:
  - all Tier 2 model calls route through LiteLLM
  - model choice must be config-driven, not hardcoded in prompt logic
  - separate request types may use different model routes:
    - direct generation
    - chunk note generation
    - final synthesis
    - single-entry sync direct generation *(may reuse direct generation route)*

- Batch model-routing note:
  - OpenAI Batch input is a `.jsonl` file where each line contains the full request body for the underlying endpoint
  - one input file can contain requests to only one model
  - LiteLLM batch routing therefore needs the model for the batch request at file-creation / batch-creation time
  - the shared runtime must store and use the model route for each batch request type

- Common rules:
  - source of truth text is `clean_text`
  - do not invent facts not present in source text
  - preserve uncertainty when source text is unclear
  - `distill_excerpt` is optional
  - `distill_excerpt` should be a contiguous passage from source text, not a paraphrase
  - `distill_stance` must be one of:
    - `descriptive`
    - `analytical`
    - `argumentative`
    - `speculative`
    - `instructional`
    - `narrative`
    - `other`
  - output must be valid JSON only
  - no markdown fences
  - no prose before or after JSON

- Final output schema:
  - `distill_summary: string`
  - `distill_excerpt: string | null`
  - `distill_why_it_matters: string`
  - `distill_stance: string`

- Field expectations:
  - `distill_summary`
    - should be compact and quickly orient a future model or reader
    - should focus on durable ideas, not low-value detail
  - `distill_excerpt`
    - optional
    - include only when there is a clearly useful passage
    - must be copied from source text as a contiguous excerpt
  - `distill_why_it_matters`
    - should be brief and specific to the entry
    - should not repeat the summary verbatim
  - `distill_stance`
    - exactly one allowed enum value
    - no free-text explanation

- Direct flow prompt contract:
  - number of agents:
    - `1`
  - number of system prompts:
    - `1`
  - number of user prompts:
    - `1`
  - model:
    - config-driven LiteLLM route for direct distillation
  - inputs:
    - `title` if available
    - `author` if available
    - `clean_text`
  - task:
    - read the full source text
    - produce the final output schema directly
  - direct flow system requirements:
    - prioritize faithful compression over eloquence
    - cover the whole piece, not just the opening
    - select an excerpt only if it materially improves later retrieval or grounding

- Direct flow expected output example:
  - {
      "distill_summary": "...",
      "distill_excerpt": "... or null",
      "distill_why_it_matters": "...",
      "distill_stance": "analytical"
    }

- Chunked flow contract:
  - number of agents:
    - `2 logical agents`
      - chunk note generator
      - final synthesizer
  - number of system prompts:
    - `2`
      - one for chunk note generation
      - one for final synthesis
  - number of user prompts:
    - `N + 1`
      - `N` chunk-generation user prompts
      - `1` final synthesis user prompt
  - models:
    - chunk note generation:
      - config-driven LiteLLM route for chunk note generation
    - final synthesis:
      - config-driven LiteLLM route for final synthesis
  - chunked flow has two stages:
    - chunk note generation
    - final synthesis

- Chunk note generation schema:
  - `chunk_main_point: string`
  - `chunk_supporting_points: string[]`
  - `chunk_excerpt_candidate: string | null`
  - `chunk_stance_hint: string | null`

- Chunk note field expectations:
  - `chunk_main_point`
    - brief statement of the chunk's main idea
  - `chunk_supporting_points`
    - brief list of the strongest supporting points
    - target count:
      - `1–3 items`
  - `chunk_excerpt_candidate`
    - optional
    - must be contiguous source text from that chunk when present
  - `chunk_stance_hint`
    - optional
    - when present, must be one of:
      - `descriptive`
      - `analytical`
      - `argumentative`
      - `speculative`
      - `instructional`
      - `narrative`
      - `other`

- Chunk note generation rules:
  - each chunk note must summarize only its chunk
  - `chunk_excerpt_candidate` is optional
  - `chunk_excerpt_candidate` must be contiguous source text from that chunk when present
  - `chunk_stance_hint` should use the same allowed stance values when possible, otherwise `null`

- Chunk note generation expected output example:
  - {
      "chunk_main_point": "...",
      "chunk_supporting_points": ["...", "..."],
      "chunk_excerpt_candidate": "... or null",
      "chunk_stance_hint": "descriptive"
    }

- Final synthesis inputs for chunked flow:
  - ordered chunk notes
  - `title` if available
  - `author` if available

- Final synthesis task:
  - synthesize across all chunk notes
  - produce the same final output schema as the direct flow
  - choose `distill_excerpt` from the best `chunk_excerpt_candidate`, or return `null`

- Final synthesis expected output example:
  - {
      "distill_summary": "...",
      "distill_excerpt": "... or null",
      "distill_why_it_matters": "...",
      "distill_stance": "argumentative"
    }

- Suggested direct flow prompt structure:
  - system:
    - define role as a careful distillation assistant
    - require strict JSON output
    - define field meanings and allowed stance values
  - user:
    - provide title / author if present
    - provide source text
    - restate required schema

- Suggested chunk note prompt structure:
  - system:
    - define role as chunk-level note taker
    - require strict JSON output
    - define chunk note schema
  - user:
    - provide chunk index and chunk text
    - restate required schema

- Suggested final synthesis prompt structure:
  - system:
    - define role as synthesis assistant over chunk notes
    - require strict JSON output
    - define final schema
  - user:
    - provide ordered chunk notes
    - provide title / author if present
    - restate required schema

- Contract versioning:
  - `distill_version` should identify:
    - output schema version
    - prompt contract version
  - suggested initial value:
    - `distill_v1`

- Must not do:
  - return markdown
  - return free-form prose
  - return fields outside the schema unless explicitly allowed later

### Validation Contract

- Purpose:
  - Define the exact deterministic checks used to accept or reject generated Tier 2 output.

- Explicit meaning:
  - Validation is shared across async batch collection and the single-entry sync API.
  - It must operate on the same normalized final output shape for both `direct` and `chunked` flows.
  - It must compare currentness against the current `content_hash`.
  - It should be lenient enough to avoid rejecting good output for minor formatting drift.

- Inputs:
  - `clean_text`
  - current `content_hash`
  - generated final output fields:
    - `distill_summary`
    - `distill_excerpt`
    - `distill_why_it_matters`
    - `distill_stance`
    - `distill_version`
    - `distill_created_from_hash`
    - `distill_metadata`

- Required field checks:
  - `distill_summary`
    - fail if missing
    - fail if not a string
    - fail if empty after trim
  - `distill_excerpt`
    - pass if `null`
    - fail if present but not a string
    - fail if present but empty after trim
    - if present, compare against `clean_text` after normalization
  - `distill_why_it_matters`
    - fail if missing
    - fail if not a string
    - fail if empty after trim
  - `distill_stance`
    - fail if missing
    - fail if not one of:
      - `descriptive`
      - `analytical`
      - `argumentative`
      - `speculative`
      - `instructional`
      - `narrative`
      - `other`
  - `distill_version`
    - fail if missing
    - fail if not a string
    - fail if empty after trim
  - `distill_created_from_hash`
    - fail if missing
    - fail if not a string
    - fail if it does not equal the current `content_hash`
  - `distill_metadata`
    - fail if missing
    - fail if not a JSON object
    - fail if `created_at` missing
    - fail if `model` missing
    - fail if `chunking_strategy` missing

- Excerpt grounding checks:
  - if `distill_excerpt` is present:
    - it must be intended as a contiguous excerpt candidate returned by the generation path
    - it must not be a placeholder like:
      - `"none"`
      - `"n/a"`
      - `"not available"`
    - compare it to `clean_text` after normalization
  - normalization should at least handle:
    - whitespace collapse
    - line-break collapse
    - quote normalization
    - minor punctuation / formatting drift
  - exact byte-for-byte equality is not required
  - fail only when the excerpt is clearly not grounded in the source text

- Duplicate-content checks:
  - fail only if `distill_summary` and `distill_why_it_matters` are effectively identical after normalization
  - exact or near-exact normalized comparison is sufficient in V1
  - fuzzy semantic similarity checks are out of scope for V1

- Validation error codes:
  - `missing_summary`
  - `summary_not_string`
  - `summary_empty`

  - `excerpt_not_string`
  - `excerpt_empty`
  - `excerpt_placeholder_value`
  - `excerpt_not_grounded`

  - `missing_why_it_matters`
  - `why_it_matters_not_string`
  - `why_it_matters_empty`

  - `missing_stance`
  - `invalid_stance`

  - `missing_version`
  - `version_not_string`
  - `version_empty`

  - `missing_created_from_hash`
  - `created_from_hash_not_string`
  - `created_from_hash_mismatch`

  - `missing_metadata`
  - `metadata_not_object`
  - `metadata_missing_created_at`
  - `metadata_missing_model`
  - `metadata_missing_chunking_strategy`

  - `summary_why_it_matters_duplicate`

- Output:
  - validation decision:
    - `accepted`
    - `failed`
  - validation error code:
    - one primary code
  - optional validation error details:
    - stored in `distill_metadata.error`

- State effects:
  - if `accepted`:
    - continue to persist step
  - if `failed`:
    - persist `distill_status = 'failed'`
    - persist validation error code
    - persist validation error details in `distill_metadata.error`

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - route selection
  - model calls
  - final artifact persistence

### Retry Config and Behavior

- Purpose:
  - Define how config-driven retry policy maps to concrete worker behavior and `distill_status` transitions.

- Explicit meaning:
  - Retry behavior applies only after an async / batch distillation attempt fails.
  - Retry policy is driven by configuration, not hardcoded attempt limits.
  - The worker is responsible for reading retry config, classifying failures, and deciding whether to retry or fail terminally.
  - The single-entry sync API does not automatically retry in V1.

- Config inputs:
  - `distill.retry.enabled`
  - `distill.retry.max_attempts`
  - `distill.retry.retryable_error_codes`
  - `distill.retry.non_retryable_error_codes`

- Worker inputs:
  - `id`
  - current `distill_status`
  - current `distill_metadata`
  - latest error code
  - latest error details
  - current attempt count from `distill_metadata.retry_count`
  - retry config

- Retry decision rules:
  - if `distill.retry.enabled = false`:
    - do not retry
    - fail terminally
  - if current attempt count is greater than or equal to `distill.retry.max_attempts`:
    - do not retry
    - fail terminally
  - if error code is in `distill.retry.non_retryable_error_codes`:
    - do not retry
    - fail terminally
  - if `distill.retry.retryable_error_codes` is defined and error code is not in that set:
    - do not retry
    - fail terminally
  - otherwise:
    - retry

- Retryable behavior:
  - increment `distill_metadata.retry_count`
  - re-dispatch the job through the same async worker path
  - persist queue state only when the retry is actually dispatched

- Non-retryable behavior:
  - do not re-dispatch
  - persist terminal failure state

- State transition rules:
  - normal async path:
    - selected for processing:
      - no state change yet
    - dispatched:
      - `distill_status = 'queued'`
    - worker starts execution:
      - optional: remain `queued` in V1
    - generation succeeds and validation passes:
      - continue to persist step, which writes `completed`
    - generation or validation fails:
      - evaluate retry policy

- Retry state transitions:
  - if failure is retryable and retry is dispatched:
    - `queued -> queued`
    - update:
      - `distill_metadata.retry_count`
      - `distill_metadata.error`
  - if failure is terminal:
    - `queued -> failed`

- Terminal failure conditions:
  - retry disabled
  - retry limit reached
  - non-retryable error code
  - retryable set defined but error code not included
  - invalid retry config that prevents retry execution

- Metadata updates on each failed attempt:
  - update `distill_metadata.error`
  - update `distill_metadata.retry_count`

- Required worker behavior:
  - always classify the failure before changing state
  - never persist `queued` unless the retry is actually dispatched
  - never silently drop a failed attempt
  - always persist the latest error context before terminal failure
  - always use config as the source of truth for retry decisions

- Outputs:
  - retry decision:
    - `retry`
    - `fail`
  - updated metadata

- Must not do:
  - candidate discovery
  - eligibility decisions
  - score calculation
  - budget selection
  - route selection
  - final artifact persistence on success

### State Transition Matrix

- Purpose:
  - Define every valid `distill_status` transition so worker behavior stays consistent.

- Allowed statuses:
  - `pending`
  - `queued`
  - `completed`
  - `failed`
  - `skipped`
  - `not_eligible`
  - `stale`

- General rules:
  - transitions must be explicit
  - invalid transitions should be treated as application errors
  - two execution modes exist:
    - async / batch path:
      - uses `queued`
    - single-entry sync path:
      - may persist `completed` directly on success
  - `queued` is written only when work is actually dispatched
  - `completed` means the current distillation artifact is valid for the current `content_hash`
  - `stale` means an existing completed distillation artifact is no longer current for the row's `content_hash`
  - `stale` is set by stale-detection logic, not inferred lazily at read time in V1
  - `skipped` and `not_eligible` are terminal for the current batch run, but not permanently terminal across all future runs
  - `failed` is terminal for the current attempt, but may transition again if retry or reprocessing is initiated later
  - `completed` may be reprocessed directly when a new distillation run is intentionally dispatched for the entry

- Valid transitions from `pending`:
  - `pending -> queued`
    - when async distillation work is dispatched
  - `pending -> skipped`
    - when eligibility gate determines the entry should be skipped
  - `pending -> not_eligible`
    - when eligibility gate determines the entry is out of scope for the scheduled batch flow
  - `pending -> completed`
    - when single-entry sync succeeds and persists a validated artifact
  - `pending -> failed`
    - when single-entry sync fails terminally and no valid current artifact exists to preserve

- Valid transitions from `queued`:
  - `queued -> completed`
    - when generation succeeds, validation passes, and persist succeeds
  - `queued -> failed`
    - when generation or validation fails and no retry is dispatched
  - `queued -> queued`
    - when a retryable failure occurs and the job is re-dispatched

- Valid transitions from `completed`:
  - `completed -> stale`
    - when stale-detection logic finds `content_hash IS DISTINCT FROM distill_created_from_hash`
  - `completed -> queued`
    - when a new async distillation run is intentionally dispatched for the entry
  - `completed -> completed`
    - when single-entry sync succeeds and overwrites the current artifact in place

- Valid transitions from `failed`:
  - `failed -> queued`
    - when a retry or manual reprocessing dispatches a new async attempt
  - `failed -> completed`
    - when single-entry sync succeeds
  - `failed -> not_eligible`
    - when later deterministic rules determine the entry is out of scope for the scheduled batch flow
  - `failed -> skipped`
    - when later deterministic rules decide the entry should not be processed in the current batch run

- Valid transitions from `skipped`:
  - `skipped -> queued`
    - when a later async run dispatches the entry for processing
  - `skipped -> not_eligible`
    - when later deterministic rules determine the entry is out of scope for the scheduled batch flow
  - `skipped -> completed`
    - when single-entry sync succeeds

- Valid transitions from `not_eligible`:
  - `not_eligible -> queued`
    - when rules change and a later async run dispatches the entry
  - `not_eligible -> skipped`
    - when a later batch run determines the entry is not actionable now but is no longer permanently out of scope
  - `not_eligible -> completed`
    - when single-entry sync succeeds

- Valid transitions from `stale`:
  - `stale -> queued`
    - when re-distillation work is dispatched for the new `content_hash`
  - `stale -> completed`
    - when single-entry sync succeeds for the current `content_hash`

- Invalid transitions:
  - any transition not listed above
  - especially:
    - `completed -> failed`
    - `queued -> stale`
    - `stale -> failed`

- Notes:
  - successful single-entry sync can bypass `queued`
  - failed single-entry sync should not downgrade an existing valid current completed artifact; exact failure-handling detail is left in `TBD`
  - `skipped`, `not_eligible`, and `failed` may all re-enter processing later through `queued`
  - `stale` represents incorrect current data, so it must return to processing through `queued` or a successful single-entry sync

### Stale Detection and Cron

- Purpose:
  - Define how existing completed distillations become `stale` when source text changes.

- Stale rule:
  - mark an entry `stale` when:
    - `distill_status = 'completed'`
    - `content_hash IS DISTINCT FROM distill_created_from_hash`

- Execution model:
  - stale detection is performed by a cron job
  - the cron job does not exist yet and must be added
  - the scheduled stale-marking job should run against prod data
  - the same logic should be reusable and testable against test data

- Effects:
  - update only `distill_status = 'stale'`
  - do not overwrite existing distill artifact fields
  - do not enqueue work directly
  - stale rows are picked up later by normal selection and score highest

- Must not do:
  - generate new distillations
  - infer stale lazily at read time in V1

### Async Execution Design

- Purpose:
  - Define how shared async batch execution enqueues work, processes OpenAI Batch API jobs through LiteLLM, reconciles results, and updates `entries`.

- Explicit meaning:
  - This component should be extracted from the current Tier 1 batch implementation and made stage-agnostic.
  - It should support Tier 1, Tier 2, and future batch LLM use-cases through stage-specific adapters.
  - This extraction includes generalizing batch persistence so table and column names no longer encode Tier 1 semantics. Exact renamed names are left in `TBD` for the code-access pass.
  - The shared component should support both prod and test schemas.
  - The Tier 2 scheduled worker operates on prod data only.
  - It owns async execution mechanics, not stage semantics.

- Shared component responsibilities:
  - build and dispatch batch work
  - track pending batch jobs
  - poll / collect completed batch jobs
  - parse provider output and error files
  - hand off per-item results to the appropriate stage adapter
  - support existing status inspection surfaces used by Tier 1
  - run a stage-specific worker loop

- Stage-specific adapter responsibilities:
  - build provider request payloads
  - specify request type and model route for the batch being built
  - invoke stage schedule / collect graphs
  - map provider responses into stage schema
  - run stage-specific validation
  - persist stage-specific fields on `entries`
  - apply stage-specific status transitions

- Target provider:
  - OpenAI Batch API via LiteLLM
  - completion window:
    - `24h`

- Batch model-routing note:
  - OpenAI Batch input is a `.jsonl` file where each line contains the full request body for the underlying endpoint
  - one input file can contain requests to only one model
  - LiteLLM batch routing can use the model parameter / header / query or encoded file / batch IDs
  - therefore the shared runtime must accept and persist the model route for each batch request and support different models across different request types

- Shared runtime shape:
  - `enqueueBatch(stage, items, opts)`
  - `syncPendingBatches(stage, opts)`
  - `getBatchStatusList(stage, opts)`
  - `getBatchStatus(stage, batchId, opts)`
  - `runBatchWorkerCycle(stage, opts)`
  - `startBatchWorker(stage, opts)`
  - `stopBatchWorker(stage)`

- Required stage adapter contract:
  - `stage`
  - schema selector / target schema rules
  - request types + model routes
  - store functions:
    - `listPendingBatchIds`
    - `listBatchStatuses`
    - `getBatchStatus`
  - graph functions:
    - `runBatchScheduleGraph`
    - `runBatchCollectGraph`
    - optional `runSyncGraph`
  - observability pipeline names
  - stage-specific config / env keys

- Enqueue flow:
  1. receive final selected item IDs from upstream orchestration
  2. stage adapter runs the second pre-dispatch detail query for those IDs and builds provider request payloads
  3. shared runtime groups requests by request type / model route as needed and dispatches provider batches
  4. only after successful dispatch:
     - persist stage queue state
     - persist batch identifier, model route, request count, and schema
  5. return enqueue result

- Queue-state rule:
  - `queued` must be written only after actual dispatch succeeds
  - budgeting must not write `queued`
  - if processing is synchronous, `queued` may never be written

- Worker / collect flow:
  1. shared worker lists pending batch IDs for the stage and schema
  2. for each pending batch:
     - run stage collect graph
  3. collect graph fetches provider outputs / errors
  4. stage adapter parses per-item results
  5. stage adapter runs validation and currentness checks against current `content_hash`
  6. successful items persist artifact fields and `completed` together
  7. terminal and partial outcomes are recorded per item

- Per-item reconciliation rule:
  - batch completion must be applied per item, not only per batch
  - one batch may contain both successful and failed items
  - the post-batch read path should stay at one reconciliation query, not one query per item

- Worker isolation requirements:
  - worker activity must be isolated per stage
  - do not use one global `workerActive` flag for all stages
  - do not use one global timer for all stages
  - maintain worker state separately for each stage

- Currentness requirements:
  - result application must verify the current `content_hash` at collect time
  - long-running batches must not overwrite newer entry state with stale results
  - this is especially important for Tier 2 because batch completion may happen much later

- Idempotency requirements:
  - do not dispatch the same active work twice unintentionally
  - collect / reconciliation must be safe to run multiple times
  - already-applied results must not be applied twice

- Shared persistence requirements:
  - generalize current `t1_*` tables / columns to stage-neutral batch tables / columns
  - retain stage and model information per batch
  - design for both prod and test
  - preserve Tier 1 behavior during the migration / extraction

- Status update requirements:
  - shared runtime must not directly decide final stage semantics
  - stage adapter owns:
    - final field mapping
    - validation
    - final status transitions
  - shared runtime may only orchestrate dispatch / polling / collection

- External API rule:
  - no new Tier 2 batch status API is required in this rollout
  - the only new external API in scope is the single-entry sync endpoint

- Observability requirements:
  - shared runtime should log:
    - enqueue
    - poll
    - collect
    - worker cycle start / end
    - cycle error
  - stage adapters may add stage-specific metadata

- Required data to persist for each dispatched batch:
  - stage
  - provider batch identifier
  - model route
  - request type
  - request count
  - target schema
  - created_at
  - current batch status
  - optional provider file identifiers if needed by the current implementation

- Recommended extraction strategy:
  1. extract the current worker loop into a shared runtime
  2. parameterize store / graph calls through a stage adapter object
  3. wrap existing Tier 1 behavior in the adapter without changing semantics
  4. generalize batch persistence naming / schema before adding Tier 2 on top
  5. add Tier 2 adapter on top of the same runtime
  6. keep validation and entry updates stage-specific

- Must not do:
  - candidate discovery
  - eligibility decisions
  - priority scoring
  - budgeting
  - route selection
  - stage-specific prompt design
  - stage-specific validation logic

### Single-Entry Sync API

- Purpose:
  - Provide a synchronous Tier 2 execution path for one existing entry, intended for Telegram -> n8n -> backend triggering.

- Explicit meaning:
  - This is the only new external API introduced in this rollout.
  - It loads one existing entry by `entry_id`.
  - It works against prod data only.
  - It bypasses candidate discovery, eligibility gate, priority scoring, and budgeting.
  - It still performs route selection, generation, validation, and persistence.

- Request input:
  - `entry_id`

- Lookup scope:
  - query `pkm.entries` only
  - entry must already exist
  - use existing stored text / metadata; do not re-import source content

- Execution rules:
  - do not check budget eligibility
  - do not prioritize
  - do not queue async batch work
  - require usable `clean_text`
  - use the same generation contract and validation contract as the batch path
  - on success, persist the accepted artifact fields and `distill_status = 'completed'` together

- Response shape:
  - `entry_id`
  - `status`
  - `summary`
  - `excerpt`
  - `why_it_matters`
  - return `null` field values when generation / validation does not produce an accepted artifact

- Contract notes:
  - exact endpoint path, auth shape, and failure-persistence details are left in `TBD` for the code-access pass
  - sync mode should not introduce a separate Tier 2 artifact format

- Must not do:
  - operate on `pkm_test`
  - skip validation
  - create a separate Tier 2 artifact format for sync mode

  
## Reference appendix

The most reference-heavy material now lives in:
- `docs/PRD/archive/distill-reference-appendix.md`

Use that appendix for:
- detailed observability / Braintrust plan
- exact priority scoring formula
- migration-plan guidelines
- candidate-discovery SQL guidance

Keep the active contract in this PRD unless one of those reference sections becomes part of day-to-day surface ownership again.

## TBD

- Exact generic batch table and column names for the stage-neutral extraction.
- Exact endpoint path and auth details for the single-entry sync API.
- Exact failure-persistence behavior for single-entry sync when a valid current completed artifact already exists.
- Whether the first-query broader candidate-scan cap needs a dedicated config key.
- Any compatibility / migration shims needed while renaming the current Tier-1 batch tables.
