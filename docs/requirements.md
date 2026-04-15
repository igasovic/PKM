# Legacy Requirements Inventory

## Historical Only

Do not use this file as the active owner of feature requirements.

Use it only when:
- tracing how requirements moved into PRDs
- checking whether a surface was already migrated
- recovering a historical requirement that may have been missed

Use instead:
- `docs/PRD/README.md` for active surface ownership
- the owning PRD for current feature intent
- authoritative contract docs for API, schema, env, and config facts

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
| Scope | `docs/PRD/ingest-prd.md` |
| Core rules | `docs/PRD/ingest-prd.md` |
| Content hash requirements | `docs/PRD/ingest-prd.md` |
| Data flow | `docs/PRD/ingest-prd.md` |
| API requirements | `docs/PRD/ingest-prd.md` plus `docs/api_ingest.md` |
| Policy definitions | `docs/PRD/ingest-prd.md` |
| DB requirements | `docs/PRD/ingest-prd.md` plus `docs/database_schema.md` |
| Conflict handling | `docs/PRD/ingest-prd.md` |
| Test mode and schema behavior | `docs/PRD/test-mode-prd.md` |
| Test mode requirements | `docs/PRD/test-mode-prd.md` |
| Integration expectations (n8n and other clients) | `docs/PRD/ingest-prd.md` |
| Batch CRUD requirements | `docs/PRD/ingest-prd.md` |
| Quality/retrieval computation requirements | `docs/PRD/ingest-prd.md` |
| Tier-1 LiteLLM client requirements | `docs/PRD/classify-prd.md` |
| Tier-1 orchestration requirements | `docs/PRD/classify-prd.md` |
| Tier-2 distillation requirements | `docs/PRD/distill-prd.md` |
| Tier-1 batch visibility requirements | `docs/PRD/classify-prd.md` |
| Pipeline transition logging requirements | `docs/PRD/logging-prd.md` plus `docs/PRD/failure-pack-prd.md` |
| Debug UI requirements | `docs/PRD/pkm-ui-prd.md` |
| Read context pack requirements | `docs/PRD/read-prd.md` |
| Telegram command UX requirements | `docs/PRD/read-prd.md` plus `docs/PRD/distill-prd.md` |
| Family calendar requirements | `docs/PRD/family-calendar-prd.md` |
| ChatGPT action requirements | `docs/PRD/gpt-actions-integration-prd.md` plus `docs/PRD/active_topics_and_working_memory_prd.md` |
| Non-goals | owned by the relevant feature PRD |

## Remaining Uncovered Requirements

None currently identified.

If future review finds a requirement that is not explicitly carried by an active PRD, use the searchable marker:
- `PRD_GAP:`

If a PRD statement cannot be made confidently from code or existing docs, use:
- `REVIEW_REQUIRED:`
