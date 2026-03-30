# PRD Expectations

## Purpose
- define what a PRD is supposed to do in this repo
- provide the target model for the `docs/PRD/` corpus
- make it explicit how to recover PRDs from `docs/changelog.md`, `docs/requirements.md`, and code
- help coding, planning, reviewing, and architect agents work from the same PRD assumptions

## Current Reality

The repo has three historical layers of product intent:

1. `docs/changelog.md`
   - first place where many changes were recorded
   - good for implementation timeline and feature emergence
   - not a good long-term owner of surface intent
2. `docs/requirements.md`
   - broad requirement inventory that accumulated multiple surfaces
   - useful for cross-cutting invariants and partially documented behavior
   - not a clean surface-ownership model
3. `docs/PRD/`
   - newer attempt to capture owned surfaces and implementation plans
   - quality and scope are mixed
   - includes both canonical PRDs and historical work-product noise

Important repo fact:
- today no code exists outside of this repository
- if behavior is missing from docs, the repo code is still available for recovery work

This means PRD cleanup should be treated as a recovery and re-ownership exercise, not as a greenfield documentation rewrite.

## Source Hierarchy

When reconstructing or updating a PRD, use this order:

1. code
   - source of truth for current implemented behavior
2. authoritative contract docs
   - `docs/api*.md`, `docs/external_api.md`, `docs/database_schema.md`, `docs/env.md`, `docs/config_operations.md`, and related guides/runbooks
   - source of truth for API/schema/config/runtime facts inside their scope
3. PRDs
   - source of truth for owned-surface intent, boundaries, rollout, and open decisions
4. `docs/requirements.md`
   - transitional inventory of broader requirements and invariants
5. `docs/changelog.md`
   - timeline and implementation clues

If these conflict:
- do not silently pick the nicest version
- write the PRD baseline to match current code and authoritative docs
- record any unresolved mismatch explicitly

## Changelog-As-Inbox Rule

Using `docs/changelog.md` as a short-term staging inbox for small changes is reasonable, but only under a strict rule:
- changelog may record the change first
- changelog entry must name the impacted PRD or say `no PRD impact`
- active PRDs must be folded forward on a bounded cadence instead of waiting indefinitely

Good use:
- bugfixes
- small contract clarifications
- minor workflow behavior changes

Bad use:
- leaving a behavior change documented only in changelog for weeks
- relying on changelog as the permanent owner of surface intent
- stacking many small changes until the PRD becomes obviously stale

Recommended working rule:
- use changelog for immediate capture
- update the owning PRD in the same change when practical
- otherwise fold the change into the PRD on the next touch of that surface or in a scheduled consolidation pass

Changelog is the inbox. PRDs remain the owned surface memory.

## Active Set vs Archive

Use `docs/PRD/README.md` to find the active PRD owner for a surface.

Use `docs/PRD/archive/` for:
- completed migration PRDs
- completed work-package companions
- historical transition plans that still explain a major pivot
- superseded drafts that are still worth preserving

Do not leave duplicate or completed planning docs mixed into the active surface set just because they once mattered.

## What A PRD Owns

A good PRD owns one behavior surface or one time-boxed change program.

Good PRD ownership examples:
- ChatGPT / webhook integration
- working memory
- family calendar behavior
- Tier-1 classify
- Tier-2 distill
- failure-pack diagnostics
- configuration sync workflow
- smoke harness
- PKM UI shell and shared UI constraints

A PRD should answer:
- what exists today
- what surface it owns
- what is changing, if anything
- what is explicitly not changing
- which contracts and documents move together
- what rollout, migration, or validation is required
- what remains unresolved

## What A PRD Does Not Own

Do not use a PRD as the primary home for:
- low-level implementation details that do not affect behavior or boundaries
- full API, schema, env, or config reference material already owned by authoritative docs
- pure refactor notes with no product or operational impact
- generated artifacts
- runbook-only procedures that belong in operational docs
- transient debugging notes
- historical release notes that belong in `docs/changelog.md`

Not every code area needs a PRD.

By default, these should stay out unless they introduce meaningful surface-level behavior:
- helper-only modules
- internal formatting cleanups
- one-off test additions
- isolated script rewrites without operator or product impact

## Prompt / Instruction-Set Docs

Prompt or instruction-set docs are not PRDs.

Examples:
- `chatgpt/project_instructions.md`

PRDs should reference them when they shape surface behavior, but they should not live in the active PRD set unless the prompt contract itself becomes the owned product surface.

## PRD Types In This Repo

Use one of these shapes deliberately.

### 1. Canonical surface PRD

This is the main PRD type.

Use it when:
- a surface has ongoing product or operational ownership
- multiple components participate in one behavior boundary
- reviewers need a stable place to understand current behavior and intended changes

### 2. Work-package companion

Use this only when the canonical surface is large enough to need ordered implementation slices.

Rules:
- it must point to one canonical PRD
- it must not become the only owner of the surface
- each work package must cite exact sections in the canonical PRD
- once implemented, the canonical PRD baseline should be updated first, then the work package should be marked `completed` and moved to archive unless it is still actively guiding follow-on work

### 3. Backfilled baseline PRD

Use this when code exists but product intent was never cleanly captured.

Rules:
- start with current behavior, not aspirational redesign
- say explicitly that the baseline was recovered from code, docs, and changelog
- keep unresolved interpretation gaps visible
- do not invent missing rationale when evidence is weak

This is the preferred way to recover missing surfaces from legacy code.

### 4. Migration PRD

Use this for time-boxed transitions such as major runtime, packaging, or boundary migrations.

Rules:
- migration PRDs may be active while the migration is in progress
- once complete, they should either:
  - move to archive/history, or
  - be superseded by a canonical surface PRD if the surface needs ongoing ownership

Completed migrations should not remain mixed into the active surface set without an explicit reason.

### 5. Not-a-PRD artifacts

These do not belong in the active PRD set:
- duplicate files
- superseded versions
- instruction sets or prompt contracts that are not product requirements
- implementation-derived architecture notes that should live as normal docs

They should be moved, archived, merged, or reclassified during cleanup.

## Required Metadata For Canonical PRDs

Every canonical or backfilled PRD should have these near the top:
- Title
- Status
- Surface owner
- Scope type: `canonical surface`, `backfilled baseline`, or `migration`
- Baseline date or last verified date
- Related authoritative docs
- Related work-package doc, if one exists

Recommended status values:
- `proposed`
- `active`
- `implemented`
- `completed-migration`
- `superseded`
- `archived`

Avoid status hidden only in prose or filenames.

## Required Sections For Canonical Surface PRDs

At minimum:
- Purpose
- Status and scope boundary
- Current behavior / baseline
- Goals
- Non-goals
- Boundaries and callers
- Control plane / execution flow
- Data model / state transitions
- API / contract surfaces
- Config / runtime / topology implications
- Migration / rollout / rollback
- Validation / acceptance criteria
- Risks / open questions
- `TBD`

If the PRD is backfilled from existing code, add:
- Evidence / recovery basis
- Known gaps requiring code deep-dive

## Recommended Contract Delta Table

Every major or cross-cutting PRD should include a compact table like this:

| Surface | Changes? | Baseline known? | Notes |
|---|---|---|---|
| Internal backend API | yes/no | yes/no | |
| Public webhook API | yes/no | yes/no | |
| Database schema | yes/no | yes/no | |
| Config / infra | yes/no | yes/no | |
| n8n workflows / nodes | yes/no | yes/no | |
| Runtime topology | yes/no | yes/no | |
| Docs | yes/no | yes/no | |
| Tests | yes/no | yes/no | |

This table is especially important when recovering a PRD from existing code because it forces explicit statements about what is already understood versus what still needs deep-dive work.

## Current Vs Target Vs Unknown

PRDs in this repo must separate these states clearly:

- `Current behavior`
  - what code does today
  - what docs already confirm
- `Target behavior`
  - intended future change, if any
- `Unknown / TBD`
  - things that cannot yet be stated confidently

Do not blend all three into one prose block.

If the code exists but understanding is incomplete:
- document current known behavior
- mark the missing parts as deep-dive gaps
- do not write speculative target behavior just to make the PRD look complete

## REVIEW_REQUIRED Marker

When confidence is not high enough to make a clean statement from code or existing materials, use this exact searchable marker:
- `REVIEW_REQUIRED:`

Use it only for real uncertainty, not as a substitute for reading the code.

Good reasons to use it:
- undocumented current behavior
- unclear owner
- mixed with another surface
- contradictory historical trail
- implementation exists but acceptance boundary is not yet clear

Every `REVIEW_REQUIRED:` note should explain the reason and the next verification step.

## Split / Merge Rules

Split a PRD when:
- it owns multiple separate control planes
- it mixes unrelated callers or product surfaces
- parts of it evolve on different schedules
- one section is really a reusable platform capability and another is a feature built on top of it

Merge PRDs when:
- they describe the same owned surface
- they cannot realistically change independently
- one is only a partial restatement of the other

Keep separate:
- canonical surface PRD
- optional work-package companion
- public integration boundary PRDs versus internal domain-behavior PRDs when those boundaries change independently

Do not keep separate:
- duplicate versions of the same work-package file
- old transition plans after a canonical PRD exists

## Deep-Dive Gap Rules

When reviewing current docs against code, classify uncovered behavior into one of these buckets:

1. `Backfill now`
   - enough evidence exists in code + docs to write a baseline PRD immediately
2. `Restructure existing PRD`
   - the surface is covered, but ownership is spread across the wrong docs
3. `Archive / reclassify`
   - the file is historical, duplicated, or not actually a PRD
4. `Deep-dive required`
   - code clearly exists, but current behavior or ownership is still too unclear to recover honestly

Every deep-dive-required gap should say why:
- undocumented current behavior
- unclear owner
- mixed with another surface
- historical trail is contradictory
- implementation exists but acceptance boundary is not clear

## Out Of Scope By Default

The PRD cleanup should not do these unless explicitly approved:
- change runtime behavior or product behavior
- treat PRDs as the authoritative home for API/schema/env/config reference details
- create one PRD per route, node, or helper module
- force every operational workflow into a product PRD
- preserve outdated PRD files only because they exist
- invent product rationale that cannot be recovered from code, docs, or changelog

These are usually better kept outside the active PRD set:
- pure runbook material such as backup procedures
- archived migrations after completion
- duplicate work-package files
- instruction-set docs that are really prompt or UX contracts rather than product-surface PRDs

## Expectations By Agent Role

### Coding agent
A PRD should tell the coding agent:
- which surface is actually owned here
- what must remain true
- what current behavior is confirmed
- what companion docs and tests must move with implementation
- where uncertainty still requires care

### Planning agent
A PRD should tell the planning agent:
- scope and non-goals
- surface boundaries
- dependencies and sequencing
- what is implementation-ready versus what still needs deep-dive
- which docs and contracts are coupled

### Reviewing agent
A PRD should tell the reviewing agent:
- what counts as regression
- what contract drift to look for
- what tests and docs are mandatory
- whether the implementation skipped any known deep-dive gaps

### Architect agent
A PRD should tell the architect agent:
- what is local versus systemic
- which trust boundaries or topology edges move
- whether new config/runtime surfaces are introduced
- whether the current PRD split is still the right ownership model

## Practical Cleanup Goal

The target end state for this repo is:
- active PRDs are organized by owned surface, not by historical drafting sequence
- completed migrations and superseded plans are clearly marked or moved out
- work-package docs exist only where they help execution
- missing product surfaces get baseline PRDs or explicit deep-dive backlog items
- `docs/requirements.md` no longer acts as the hidden owner of half the system
- `docs/changelog.md` remains history, not the only place a feature is described

## Success Test

After cleanup, an agent should be able to answer these quickly:
- which PRD owns this surface
- whether that PRD describes current behavior, target behavior, or both
- which authoritative docs must change with it
- whether missing understanding requires a code deep-dive
- whether a file in `docs/PRD/` is active, historical, duplicated, or not actually a PRD
