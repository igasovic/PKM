# Test Mode Exemption Matrix

## Purpose
- define which backend DB surfaces honor active test mode and which intentionally do not
- give agents a fast routing rule for new tables, stores, and batch surfaces
- close the current PRD gap around test-mode exceptions with one maintained matrix

## Authoritative For
- test-mode behavior of backend DB stores and batch stores
- intentionally exempt or prod-pinned PKM persistence surfaces
- agent review guidance for new schema-routed work

## Not Authoritative For
- detailed endpoint schemas; use `docs/api_read_write.md`, `docs/api_distill.md`, and related API docs
- calendar workflow-level test isolation; use `docs/PRD/smoke-prd.md`
- table definitions; use `docs/database_schema.md`

## Read When
- adding a new backend store, batch table, or route that reads or writes PKM data
- reviewing whether a persistence change should honor active test mode
- debugging why a surface wrote to `pkm` instead of `pkm_test`, or vice versa

## Update When
- a store starts honoring active test mode
- a store becomes prod-pinned or dual-schema by design
- a new batch or observability table is added

## Related Docs
- `docs/PRD/test-mode-prd.md`
- `docs/backend_db_store_map.md`
- `docs/database_schema.md`
- `docs/PRD/smoke-prd.md`

## Complexity note

Test mode originally covered only the `entries` table. As the system grew, multiple table families were added to both schemas (entries, idempotency_policies, t1_batch_*, t2_batch_*) while others remained intentionally exempt (calendar logs, debug telemetry, runtime config). This split makes the operator mental model non-trivial: during manual QA, some data flows through test schema and some flows through prod schema depending on the table. The matrix below is the single source of truth for which surfaces go where.

## Decision Rule

Default stance:
- PKM product-entry reads and writes should honor active test mode.
- Runtime config, observability logs, business logs, and batch-control tables should not silently follow active test mode unless the owning PRD says they should.

If a new surface is exempt, document why the exemption is safer than active-schema routing.

## Matrix

| Surface | Owner code | Tables | Behavior | Agent note |
|---|---|---|---|---|
| Generic PKM reads | `src/server/db/read-store.js` | `pkm.entries` or `pkm_test.entries` | honors active test mode | `/db/read/*`, working-memory reads, and read smoke resolve entries through `runtime-store` |
| Generic PKM writes and idempotent insert/update | `src/server/db/write-store.js` | `pkm.entries` or `pkm_test.entries` by default | honors active test mode by default | `/db/insert`, `/db/update`, importer writes, and ChatGPT action writes follow the persisted runtime flag unless caller explicitly chooses another table |
| Explicit Tier-1 classify writeback | `src/server/db/tier1-classify-store.js` | active schema `entries`, `active_topic_related_entries` | honors active test mode by default (or explicit schema override) | `/enrich/t1/update` and batch collect writeback use explicit Tier-1 field updates plus active-topic link sync |
| Active topic-state reads and snapshot writes | `src/server/db/active-topic-store.js` | `pkm.active_topics` + `pkm.active_topic_state` + `pkm.active_topic_open_questions` + `pkm.active_topic_action_items` + `pkm.active_topic_related_entries` (or `pkm_test.*`) | honors active test mode | first-class topic state follows the same active-schema routing rule as current ChatGPT working-memory/session-note paths; topic-state migration and patch workflows should not write cross-schema implicitly |
| Recipes create/search/get/update/review/link/note | `src/server/db/recipes-store.js` | `pkm.recipes` + `pkm.recipe_links` or `pkm_test.recipes` + `pkm_test.recipe_links` | honors active test mode | `/recipes/*` routes resolve active schema through `runtime-store`, preserve archived state semantics on recompute writes, and keep recipe links scoped to the active schema |
| Explicit delete and move admin ops | `src/server/db/write-store.js` | caller-supplied schema or `from_schema` / `to_schema` | explicit schema only | operator-directed maintenance must state the target schema and must not be silently redirected by active test mode |
| Runtime test-mode state | `src/server/db/runtime-store.js` | `<runtime_schema>.runtime_config` | exempt; owns test mode | this table is the source of truth for `is_test_mode`, so routing it through test mode would be recursive |
| Calendar request and observation logs | `src/server/db/calendar-store.js` | `pkm.calendar_requests`, `pkm.calendar_event_observations` | prod-pinned | family-calendar logs are canonical business history, not disposable test copies; calendar test isolation stays in n8n workflow logic |
| Todoist planning sync/review/event history | `src/server/db/todoist-store.js` | `pkm.todoist_task_current`, `pkm.todoist_task_events` | prod-pinned | Todoist planning is an operator-facing planning surface and should remain canonical across test-mode flips |
| Debug telemetry and failure packs | `src/server/db/debug-store.js` | `<runtime_schema>.pipeline_events`, `pkm.failure_packs` | exempt; fixed tables | observability and failure capture must remain queryable across mode flips and are not PKM-entry data surfaces |
| Distill candidate discovery and eligibility status | `src/server/db/distill-store.js` | active `entries` schema by default, optional explicit override | honors active test mode by default | planning and queue-eligibility work follow the current entry schema unless a caller passes `schema` intentionally |
| Distill sync writeback and stale marking | `src/server/db/distill-store.js` | `pkm.entries` | prod-pinned | single-entry sync and stale repair are currently production-only artifact management paths |
| Classify batch scheduling and batch-result writes | `src/server/tier1/store.js` | active schema `t1_batches`, `t1_batch_items`, `t1_batch_item_results` | honors active test mode at scheduling time | newly queued classify batch work lands in the active schema selected from persisted test mode |
| Classify batch status and pending scans | `src/server/tier1/store.js` | both configured `t1_*` schema families | dual-schema scan | workers and status endpoints scan both schemas so mode flips do not strand queued work |
| Distill batch tables and status surfaces | `src/server/tier2/store.js` | explicit schema `t2_batches`, `t2_batch_items`, `t2_batch_item_results`; status scans may inspect both schemas | explicit-schema or dual-schema, not active-mode routed | long-running distill execution chooses a schema deliberately, while status and lookup helpers may scan configured schemas for recovery and operator visibility |

## Review Heuristic

If a new persistence surface stores end-user PKM entries or their derived fields, it should usually honor active test mode.

If a new persistence surface stores:
- runtime control state
- observability artifacts
- audit/business logs
- long-running batch coordination

then it should usually be explicit-schema, dual-schema, or fixed-table, and the reason should be added here in the same change.
