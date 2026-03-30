# PRD Expectations

This file records what agents should expect from PRDs in this repo.

It exists because `docs/requirements.md`, `docs/changelog.md`, and `docs/PRD/` are intentionally not being restructured in this pass.

## Purpose
- define the minimum useful shape of a PRD for coding, planning, reviewing, and architecture work
- make PRD quality expectations explicit before the PRD corpus is cleaned up
- give future PRD updates a stable local target

## A Good PRD Should Answer
- what exists today
- what is changing
- what is not changing
- which contracts or surfaces move together
- how the change rolls out safely
- how a reviewer will know the implementation is correct

## Required Sections
- Title + status
- Current behavior / baseline
- Desired behavior / delta
- Control plane / execution flow
- Data model / schema changes
- Validation + state transitions
- Config surface
- API / operational surfaces
- Migration / backfill / rollback plan
- Work packages
- Risks / open questions
- `TBD`

## Expectations By Agent Role

### Coding agent
A PRD should tell the coding agent:
- the invariants that must remain true
- the touched files or modules at a high level
- the contracts that must be preserved or updated
- the docs and tests that must change with the implementation
- the migration and rollout constraints

### Planning agent
A PRD should tell the planning agent:
- goal and non-goals
- touched surfaces and ownership boundaries
- sequencing and dependencies
- rollout order and rollback plan
- unresolved questions that block implementation

### Reviewing agent
A PRD should tell the reviewing agent:
- the important regression risks
- which contracts changed
- what tests are required
- what counts as incomplete documentation
- which shortcuts are forbidden

### Architect agent
A PRD should tell the architect agent:
- what becomes cross-cutting vs what stays local
- which source-of-truth docs must change together
- where trust boundaries, topology, or config ownership move
- whether new runtime or config surfaces are introduced

## Recommended Contract Delta Table
Every major or cross-cutting PRD should include a compact table like this:

| Surface | Changes? | Notes |
|---|---|---|
| Internal backend API | yes/no | |
| Public webhook API | yes/no | |
| Database schema | yes/no | |
| Config / infra | yes/no | |
| n8n workflows / nodes | yes/no | |
| Runtime topology | yes/no | |
| Docs | yes/no | |
| Tests | yes/no | |

## Quality Rules
- Separate current behavior from target behavior.
- Keep non-goals explicit.
- Put unresolved decisions in `TBD`; do not hide them in prose.
- If a change affects contracts, schema, env, requirements, or config location, the PRD should say which docs must update in the same change set.
- Work packages should reference specific PRD sections.

## Future Use
When the PRD corpus is updated later, this file should be used as the alignment target rather than treated as a PRD itself.
