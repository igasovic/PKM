# Backend DB Store Map

## Purpose
- map backend route families and background services to the DB stores they actually touch
- help agents localize changes without rereading the whole backend
- make route, repository, store, and table ownership visible in one place

## Authoritative For
- backend DB access ownership and store boundaries
- route-family to repository/service to store flow
- non-route backend writers that still touch Postgres

## Not Authoritative For
- endpoint schemas; use `docs/api.md` and the relevant `docs/api_*.md`
- table definitions; use `docs/database_schema.md`
- runtime topology; use `docs/service_dependancy_graph.md`

## Read When
- splitting or extending `src/server/db/**`
- deciding where a new query belongs
- tracing which backend surface owns a table today

## Update When
- a route family starts using a different repository or store
- a new store is added under `src/server/db/**`
- a background worker or service starts reading or writing a new table

## Related Docs
- `docs/backend_architecture.md`
- `docs/test_mode_exemptions.md`
- `docs/backend_route_registry.json`
- `docs/database_schema.md`

## Route-Facing Map

| Route family | Entry modules | Repository / service seam | Stores touched | Main tables | Notes |
|---|---|---|---|---|---|
| Control, debug, and ChatGPT actions | `src/server/routes/control-routes.js`, `src/server/chatgpt-actions.js`, `src/server/chatgpt/service.js` | `debug-repository`, `TestModeService`, ChatGPT service | `src/server/db/debug-store.js`, `src/server/db/runtime-store.js`, `src/server/db/read-store.js`, `src/server/db/write-store.js` | `pipeline_events`, `failure_packs`, `runtime_config`, `entries` | mixes operator control surfaces with working-memory reads and session-note writes |
| Read and write | `src/server/routes/read-write-routes.js` | `src/server/repositories/read-write-repository.js` | `src/server/db/read-store.js`, `src/server/db/write-store.js` | `entries`, idempotency policy tables | the primary generic PKM data API for n8n and UI/operator tools |
| Calendar | `src/server/routes/calendar-routes.js` | `src/server/repositories/calendar-repository.js` | `src/server/db/calendar-store.js` | `calendar_requests`, `calendar_event_observations` | calendar business logs are fixed-table and not test-mode routed |
| Distill API | `src/server/routes/distill-routes.js` | distill planner and worker services, `src/server/repositories/distill-repository.js` | `src/server/db/distill-store.js`, `src/server/tier2/store.js` | `entries`, `t2_batches`, `t2_batch_items`, `t2_batch_item_results` | candidate discovery uses the distill store; batch orchestration uses the distill batch store |
| Classify and ingest | `src/server/routes/classify-routes.js` | ingestion pipeline, `src/server/tier1-enrichment.js`, `src/server/email-importer.js` | `src/server/db/write-store.js`, `src/server/tier1/store.js` | `entries`, `t1_batches`, `t1_batch_items`, `t1_batch_item_results` | route layer calls services directly rather than through repositories today |
| Status | `src/server/routes/status-routes.js`, `src/server/batch-status-service.js` | batch status service | `src/server/tier1/store.js`, `src/server/tier2/store.js` | `t1_*`, `t2_*` batch tables | status reads are batch-store owned, not generic DB-store owned |

## Background And Shared Writers

| Caller | Stores touched | Main tables | Why it matters |
|---|---|---|---|
| `src/server/logger/sinks/postgres.js` | `src/server/db/debug-store.js` | `pipeline_events` | telemetry writes bypass route families and should stay lightweight and failure-tolerant |
| `src/server/test-mode.js` | `src/server/db/runtime-store.js` | `runtime_config` | owns cached reads and toggles of persisted test mode |
| `src/server/email-importer.js` | `src/server/db/write-store.js`, `src/server/tier1/store.js` | `entries`, `t1_*` batch tables | import flow both writes entries and schedules classify batch work |
| `src/server/tier2/service.js` | `src/server/db/distill-store.js` | `entries` | single-entry distill sync writes directly to prod-pinned distill fields |
| `src/server/tier2-enrichment.js` | `src/server/db/distill-store.js`, `src/server/tier2/store.js` | `entries`, `t2_*` batch tables | the main distill worker spans both entry-state persistence and batch-control persistence |
| `src/server/tier1/graphs.js` and `src/server/tier1-enrichment.js` | `src/server/tier1/store.js` | `t1_*` batch tables | classify backlog execution uses its own batch store boundary, not `src/server/db/**` |

## Placement Rule

Use `src/server/db/**` when the query belongs to shared backend PKM persistence or a clear bounded store.

Keep a separate domain-owned store when the persistence surface is its own control plane:
- classify batch tables stay in `src/server/tier1/store.js`
- distill batch tables stay in `src/server/tier2/store.js`

That split keeps the generic DB stores focused on PKM entry data, runtime state, and shared logs instead of absorbing every batch table into one directory.
