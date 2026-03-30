# Legacy Requirements Inventory

Implementation note (2026-03-17):
- `docs/PRD/archive/n8n-npm-migration.md` is repo-side implemented.
- Live Pi validation remains the final cutover step.
- n8n runtime code imports shared helpers through the internal package `@igasovic/n8n-blocks`.
- Idempotency/API requirements in this document are unchanged by that migration.

Migration note (2026-03-30):
- This file is no longer the primary owner of active product-surface requirements.
- Active requirements were reviewed section by section and migrated into the owning PRDs.
- `docs/changelog.md` remains the historical inbox/timeline.
- `docs/PRD/README.md` is the active PRD entrypoint.

## Migrated Sections

| Former section in this file | Current owner |
|---|---|
| Scope | `docs/PRD/ingest-PRD.md` |
| Core rules | `docs/PRD/ingest-PRD.md` |
| Content hash requirements | `docs/PRD/ingest-PRD.md` |
| Data flow | `docs/PRD/ingest-PRD.md` |
| API requirements | `docs/PRD/ingest-PRD.md` plus `docs/api_ingest.md` |
| Policy definitions | `docs/PRD/ingest-PRD.md` |
| DB requirements | `docs/PRD/ingest-PRD.md` plus `docs/database_schema.md` |
| Conflict handling | `docs/PRD/ingest-PRD.md` |
| Test mode and schema behavior | `docs/PRD/test-mode-PRD.md` |
| Test mode requirements | `docs/PRD/test-mode-PRD.md` |
| Integration expectations (n8n and other clients) | `docs/PRD/ingest-PRD.md` |
| Batch CRUD requirements | `docs/PRD/ingest-PRD.md` |
| Quality/retrieval computation requirements | `docs/PRD/ingest-PRD.md` |
| Tier-1 LiteLLM client requirements | `docs/PRD/classify-PRD.md` |
| Tier-1 orchestration requirements | `docs/PRD/classify-PRD.md` |
| Tier-2 distillation requirements | `docs/PRD/Distill-PRD.md` |
| Tier-1 batch visibility requirements | `docs/PRD/classify-PRD.md` |
| Pipeline transition logging requirements | `docs/PRD/logging-PRD.md` plus `docs/PRD/failure-pack-prd-draft.md` |
| Debug UI requirements | `docs/PRD/pkm-ui-PRD.md` |
| Read context pack requirements | `docs/PRD/read-PRD.md` |
| Telegram command UX requirements | `docs/PRD/read-PRD.md` plus `docs/PRD/Distill-PRD.md` |
| Family calendar requirements | `docs/PRD/family-calendar-PRD.md` |
| ChatGPT action requirements | `docs/PRD/GPT-Actions-Integration-PRD.md` plus `docs/PRD/working-memory-PRD.md` |
| Non-goals | owned by the relevant feature PRD |

## Remaining Uncovered Requirements

None currently identified.

If future review finds a requirement that is not explicitly carried by an active PRD, use the searchable marker:
- `PRD_GAP:`

If a PRD statement cannot be made confidently from code or existing docs, use:
- `REVIEW_REQUIRED:`
