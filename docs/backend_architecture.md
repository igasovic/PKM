# Backend Architecture

## Purpose
- define the implementation-level architecture of `pkm-server`
- make the primary caller boundary explicit: backend is n8n-first, UI-second
- give agents one place to reason about route ownership, domain seams, workers, and cleanup priorities

## Authoritative For
- backend consumer hierarchy and trust boundary
- backend implementation topology at the module level
- incremental target structure for backend cleanup work

## Not Authoritative For
- public webhook contracts; use `docs/external_api.md`
- detailed internal HTTP request/response schemas; use `docs/api.md` and the relevant `docs/api_*.md`
- database schema facts; use `docs/database_schema.md`
- runtime ports, mounts, and host access paths; use `docs/env.md`

## Read When
- changing backend structure, module boundaries, startup flow, or worker composition
- deciding whether a backend change is n8n-facing, UI-facing, or purely internal
- reviewing whether a refactor improves or worsens backend coupling

## Update When
- backend modules move or ownership changes
- a new backend caller class is introduced
- worker/startup composition changes

## Related Docs
- `docs/service_dependancy_graph.md`
- `docs/env.md`
- `docs/api.md`
- `docs/backend_runtime_env.md`
- `docs/database_schema.md`
- `docs/repo-map.md`

## Core Architecture Stance

`pkm-server` is primarily an internal API for n8n orchestration.

Primary request path:

```text
public trigger or schedule
-> n8n workflow
-> pkm-server internal HTTP API
-> Postgres / LiteLLM / Braintrust
```

The UI is a secondary operator-facing consumer of a subset of backend routes, mostly read/debug/failure surfaces.

Unsupported architecture:
- UI-first assumptions when shaping core backend modules
- direct public callers to internal backend routes
- direct n8n access to PKM product data tables in Postgres

## Consumer Priority

| Consumer | Priority | Typical route families | Notes |
|---|---|---|---|
| `src/n8n/workflows/**` | primary | normalize, read/write, calendar, distill, debug, ChatGPT internal actions | backend exists mainly to serve this orchestration layer |
| `src/web/pkm-debug-ui/**` | secondary | `/db/read/*`, `/debug/*`, test-mode control | operator/debug surface, not the main backend design center |
| operator scripts / local tooling | tertiary | health, ready, version, config-aware deploy/readiness | operational consumer, not product-facing |
| public callers | none direct | none | must terminate at n8n/webhook boundary first |

## Current Module Topology

### 1. Transport and startup
- entrypoint and composition: `src/server/index.js`
- shared HTTP helpers: `src/server/app/http-utils.js`
- route-family dispatch: `src/server/routes/**`
- background maintenance loops: `src/server/workers/maintenance-worker.js`

### 2. Domain/application services
- ingest: `src/server/ingestion-pipeline.js`, `src/server/normalization.js`, `src/server/idempotency.js`, `src/server/quality.js`
- calendar: `src/server/calendar-service.js`, `src/server/calendar-access.js`, `src/server/calendar/**`, `src/server/telegram-router/**`
- classify: `src/server/tier1-enrichment.js`, `src/server/tier1/**`
- distill: `src/server/tier2-enrichment.js`, `src/server/tier2/**`
- ChatGPT / working memory: `src/server/chatgpt-actions.js`, `src/server/chatgpt/**`
- backlog / batch status: `src/server/email-importer.js`, `src/server/batch-status-service.js`, `src/server/batch-worker-runtime.js`

### 3. Persistence
- shared DB gateway: `src/server/db.js`
- connection bootstrap: `src/server/db-pool.js`
- repository facades for route/domain ownership: `src/server/repositories/**`
- bounded-context stores already exist for classify and distill:
  - `src/server/tier1/store.js`
  - `src/server/tier2/store.js`

### 4. Shared backend support
- config: `src/libs/config/`
- logging and telemetry: `src/server/logger/**`
- reusable shared libs: `src/libs/**`

## Current Strengths

- contract docs are stronger than the implementation structure
- the route/controller split is now explicit:
  - HTTP composition in `src/server/index.js`
  - shared request/response/auth helpers in `src/server/app/http-utils.js`
  - route-family ownership in `src/server/routes/**`
  - maintenance loops in `src/server/workers/maintenance-worker.js`
- distill already shows a good backend pattern:
  - domain rules in `src/server/tier2/control-plane.js`
  - persistence in `src/server/tier2/store.js`
  - orchestration in `src/server/tier2/service.js` and `src/server/tier2-enrichment.js`
- route-facing repository facades now reduce direct coupling from HTTP handlers into `db.js`
- backend runtime env access is now centralized in `src/server/runtime-env.js`

## Current Structural Hotspots

### `src/server/index.js`
- much smaller than before, but still owns global composition and startup wiring
- should keep trending toward composition only, with no route-local business logic added back in

### `src/server/db.js`
- central SQL boundary is correct, but the module is too broad
- currently mixes:
  - generic entry CRUD
  - read surfaces
  - test-mode state
  - calendar business logs
  - failure-pack persistence
  - distill support queries
  - maintenance helpers

### Config ownership
- backend runtime env access is now routed through `src/server/runtime-env.js`
- broader config ownership still spans both `src/libs/config/**` and backend runtime loaders, so those seams should keep getting simpler

### Transitional seams
- some compatibility naming still exists at route/env level for stability (`/enrich/t1`, `T1_*`, `T2_*`)
- the old internal MCP execution seam has been removed; ChatGPT actions now execute through `src/server/chatgpt/**`

## Incremental Target Shape

The goal is not a big rewrite. The target is an incremental n8n-first backend structure:

```text
src/server/
  app/
    http-utils.js
  routes/
    control-routes.js
    classify-routes.js
    calendar-routes.js
    distill-routes.js
    status-routes.js
    read-write-routes.js
  repositories/
    read-write-repository.js
    calendar-repository.js
    debug-repository.js
    distill-repository.js
  workers/
    maintenance-worker.js
```

Rules for getting there:
- keep backend n8n-first in route and service design
- preserve the raw-SQL boundary
- keep SQL implementation under `src/server/db/**` and `src/libs/sql-builder.js`
- move one route family at a time
- prefer extracting route modules and repositories before deeper domain rewrites

## Review Heuristics

Good backend changes usually:
- reduce the size or responsibility spread of `index.js` or `db.js`
- make n8n-facing route ownership clearer
- move config reads toward one loader
- turn transitional seams into explicit, named boundaries instead of hidden reuse

Suspicious backend changes usually:
- add new route-local business logic inside `index.js`
- add more unrelated SQL helpers to `db.js`
- add more direct env reads in feature modules
- optimize for UI ergonomics at the expense of n8n orchestration clarity
