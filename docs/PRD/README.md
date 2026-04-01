# PRD Index

This file is the entrypoint for active PRDs in this repo.

## Purpose
- identify which PRD owns each active surface
- separate active PRDs from archived implementation history
- clarify when prompt / instruction-set docs should be referenced instead of treated as PRDs

## How To Use This Index
- Start here when you know the surface but do not know the owning PRD.
- Open the canonical PRD first, not the work-package companion, unless you are sequencing remaining implementation.
- For very large PRDs, use that file's `Fast path by agent` and `Section map` instead of reading top to bottom.
- Use `chatgpt/project_instructions.md` for assistant behavior contracts when a PRD tells you to, but do not treat it as a PRD.

## Fast Path By Agent
- Coding agent: find the owning surface below, then read the canonical PRD's scope boundary, control plane, API surface, and validation sections.
- Planning agent: read the canonical PRD, then the work-package companion if one is still active.
- Reviewing agent: read the canonical PRD's scope boundary, state transitions, validation, and risks sections first.
- Architect agent: read the canonical PRD plus adjacent surface PRDs when the change crosses ingest, classify, distill, read, working memory, UI, config, or public webhook boundaries.

## Active Canonical PRDs

| Surface | File | Status | Notes |
|---|---|---|---|
| Core ingest | `docs/PRD/ingest-prd.md` | active | Telegram, email, Notion, webpage normalization, and email backlog ingest up to the classify handoff |
| Test mode | `docs/PRD/test-mode-prd.md` | active | persisted test-mode state and schema-routing platform capability |
| Tier-1 classify | `docs/PRD/classify-prd.md` | active | sync + batch classify control plane |
| Tier-2 distill | `docs/PRD/distill-prd.md` | active | canonical Tier-2 surface with deeper appendix material split out |
| Generic read + context pack | `docs/PRD/read-prd.md` | active | shared read methods and context-pack builder |
| Working memory | `docs/PRD/working-memory-prd.md` | active | topic working memory and wrap/commit artifact semantics |
| GPT actions integration | `docs/PRD/gpt-actions-integration-prd.md` | active | public ChatGPT -> n8n webhook boundary |
| PKM UI shell | `docs/PRD/pkm-ui-prd.md` | active | baseline UI shell, pages, and shared UI constraints |
| Failure packs | `docs/PRD/failure-pack-prd.md` | active | canonical failure-pack surface |
| Logging / telemetry | `docs/PRD/logging-prd.md` | active | as-built logging and telemetry contract |
| Family calendar | `docs/PRD/family-calendar-prd.md` | proposed | dedicated family-calendar feature surface |
| Config sync | `docs/PRD/config-prd.md` | active | repo-managed config/operator workflow |
| Smoke harness | `docs/PRD/smoke-prd.md` | active | end-to-end smoke validation surface with split-out detailed matrix |

## Active Companion Docs

| Companion | Parent PRD | Status | Notes |
|---|---|---|---|
| `docs/PRD/config-work-packages.md` | config-prd | active | sequencing remaining config work |
| `docs/PRD/distill-work-packages.md` | distill-prd | active | sequencing remaining distill work |
| `docs/PRD/family-calendar-eval-work-packages.md` | family-calendar-prd | active | eval harness buildout |
| `docs/PRD/family-calendar-work-packages.md` | family-calendar-prd | active | core calendar feature buildout |
| `docs/PRD/smoke-detailed-matrix.md` | smoke-prd | active | detailed test matrix reference |

Lifecycle rule: once the canonical PRD baseline is self-sufficient, move the companion to `docs/PRD/archive/`. Review companion relevance when the parent PRD status changes.

## Prompt / Instruction-Set Docs
These are not PRDs, but PRDs should link them when they shape behavior:
- `chatgpt/project_instructions.md`

Use prompt / instruction-set docs for assistant behavior contracts. Use PRDs for product or operator surface ownership.

## Requirements Migration Map

The legacy sections that previously lived in `docs/requirements.md` were reviewed and folded into PRDs using this map.

| Requirement area | Primary PRD owner | Notes |
|---|---|---|
| idempotency policy catalog | `docs/PRD/ingest-prd.md` | database facts still stay in `docs/database_schema.md` |
| DB idempotency table / column / constraint contract | `docs/PRD/ingest-prd.md` | schema reference remains authoritative in `docs/database_schema.md` |
| skip / update conflict behavior | `docs/PRD/ingest-prd.md` | backend DB write boundary owned by ingest |
| batch `/db/insert` / `/db/update` semantics | `docs/PRD/ingest-prd.md` | until a dedicated write-surface PRD exists |
| shared retrieval / quality computation | `docs/PRD/ingest-prd.md` | especially normalization-side DB-ready projections |
| Tier-1 LiteLLM runtime contract | `docs/PRD/classify-prd.md` | config/env details still move with backend runtime docs |
| Tier-1 graph / orchestration rules | `docs/PRD/classify-prd.md` | includes sync, schedule, and collect graphs |
| Tier-1 batch visibility contract | `docs/PRD/classify-prd.md` | owns aggregate counters and cross-schema status expectations |
| debug UI feature contract | `docs/PRD/pkm-ui-prd.md` | link to `docs/PRD/logging-prd.md` and `docs/PRD/failure-pack-prd.md` for backend-owned data surfaces |
| fixed context-pack template and output guardrails | `docs/PRD/read-prd.md` | generic read/context-pack owner |
| Telegram command parser/help UX | split owner: `docs/PRD/read-prd.md` + `docs/PRD/distill-prd.md` | read PRD owns parser/help shell; Distill PRD owns `/distill-run` semantics |

This map is intentionally biased toward expanding existing active PRDs before creating new ones. If one of these areas grows into a long-lived cross-surface program later, split it into a new canonical PRD at that point instead of pushing detail back into changelog or legacy requirements notes.

## Archive
Historical and completed artifacts live under:
- `docs/PRD/archive/`

Do not treat archived docs as the primary owner of a surface unless the active PRD explicitly tells you to read them for context.
