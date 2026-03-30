# PRD Index

This file is the entrypoint for active PRDs in this repo.

## Purpose
- identify which PRD owns each active surface
- separate active PRDs from archived implementation history
- clarify when prompt / instruction-set docs should be referenced instead of treated as PRDs

## Active Canonical PRDs

| Surface | File | Status | Notes |
|---|---|---|---|
| Core ingest | `docs/PRD/ingest-PRD.md` | active | Telegram, email, Notion, webpage normalization, and email backlog ingest up to the classify handoff |
| Test mode | `docs/PRD/test-mode-PRD.md` | active | persisted test-mode state and schema-routing platform capability |
| Tier-1 classify | `docs/PRD/classify-PRD.md` | active | sync + batch classify control plane |
| Tier-2 distill | `docs/PRD/Distill-PRD.md` | active | canonical Tier-2 surface; legacy filename retained for now |
| Generic read + context pack | `docs/PRD/read-PRD.md` | active | shared read methods and context-pack builder |
| Working memory | `docs/PRD/working-memory-PRD.md` | active | topic working memory and wrap/commit artifact semantics |
| GPT actions integration | `docs/PRD/GPT-Actions-Integration-PRD.md` | active | public ChatGPT -> n8n webhook boundary |
| PKM UI shell | `docs/PRD/pkm-ui-PRD.md` | active | baseline UI shell, pages, and shared UI constraints |
| Failure packs | `docs/PRD/failure-pack-prd-draft.md` | active | canonical failure-pack surface; legacy filename retained for now |
| Logging / telemetry | `docs/PRD/logging-PRD.md` | active | as-built logging and telemetry contract |
| Family calendar | `docs/PRD/family-calendar-PRD.md` | proposed | dedicated family-calendar feature surface |
| Config sync | `docs/PRD/config-PRD.md` | active | repo-managed config/operator workflow |
| Smoke harness | `docs/PRD/smoke-test-PRD.md` | active | end-to-end smoke validation surface |

## Active Work-Package Companions
- `docs/PRD/config_working_packages.md`
- `docs/PRD/distill_work_packages.md`
- `docs/PRD/family-calendar-work-packages.md`

These remain active because they still help sequence ongoing or future implementation. Once the canonical PRD baseline is updated and the work package is no longer driving active work, move it to `docs/PRD/archive/`.

## Prompt / Instruction-Set Docs
These are not PRDs, but PRDs should link them when they shape behavior:
- `chatgpt/project_instructions.md`

Use prompt / instruction-set docs for assistant behavior contracts. Use PRDs for product or operator surface ownership.

## Requirements Migration Map

The legacy sections that previously lived in `docs/requirements.md` were reviewed and folded into PRDs using this map.

| Requirement area | Primary PRD owner | Notes |
|---|---|---|
| idempotency policy catalog | `docs/PRD/ingest-PRD.md` | database facts still stay in `docs/database_schema.md` |
| DB idempotency table / column / constraint contract | `docs/PRD/ingest-PRD.md` | schema reference remains authoritative in `docs/database_schema.md` |
| skip / update conflict behavior | `docs/PRD/ingest-PRD.md` | backend DB write boundary owned by ingest |
| batch `/db/insert` / `/db/update` semantics | `docs/PRD/ingest-PRD.md` | until a dedicated write-surface PRD exists |
| shared retrieval / quality computation | `docs/PRD/ingest-PRD.md` | especially normalization-side DB-ready projections |
| Tier-1 LiteLLM runtime contract | `docs/PRD/classify-PRD.md` | config/env details still move with backend runtime docs |
| Tier-1 graph / orchestration rules | `docs/PRD/classify-PRD.md` | includes sync, schedule, and collect graphs |
| Tier-1 batch visibility contract | `docs/PRD/classify-PRD.md` | owns aggregate counters and cross-schema status expectations |
| debug UI feature contract | `docs/PRD/pkm-ui-PRD.md` | link to `logging-PRD.md` and `failure-pack-prd-draft.md` for backend-owned data surfaces |
| fixed context-pack template and output guardrails | `docs/PRD/read-PRD.md` | generic read/context-pack owner |
| Telegram command parser/help UX | split owner: `docs/PRD/read-PRD.md` + `docs/PRD/Distill-PRD.md` | read PRD owns parser/help shell; Distill PRD owns `/distill-run` semantics |

This map is intentionally biased toward expanding existing active PRDs before creating new ones. If one of these areas grows into a long-lived cross-surface program later, split it into a new canonical PRD at that point instead of pushing detail back into changelog or legacy requirements notes.

## Archive
Historical and completed artifacts live under:
- `docs/PRD/archive/`

Do not treat archived docs as the primary owner of a surface unless the active PRD explicitly tells you to read them for context.
