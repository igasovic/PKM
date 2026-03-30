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
- direct n8n access to Postgres

## Consumer Priority

| Consumer | Priority | Typical route families | Notes |
|---|---|---|---|
| `src/n8n/workflows/**` | primary | normalize, read/write, calendar, distill, debug, ChatGPT internal actions | backend exists mainly to serve this orchestration layer |
| `src/web/pkm-debug-ui/**` | secondary | `/db/read/*`, `/debug/*`, test-mode control | operator/debug surface, not the main backend design center |
| operator scripts / local tooling | tertiary | health, ready, version, config-aware deploy/readiness | operational consumer, not product-facing |
| public callers | none direct | none | must terminate at n8n/webhook boundary first |

## Current Module Topology

### 1. Transport and startup
- `src/server/index.js`
- currently owns HTTP dispatch, request parsing, auth checks, response mapping, and maintenance startup

### 2. Domain/application services
- ingest: `src/server/ingestion-pipeline.js`, `src/server/normalization.js`, `src/server/idempotency.js`, `src/server/quality.js`
- calendar: `src/server/calendar-service.js`, `src/server/calendar-access.js`, `src/server/calendar/**`, `src/server/telegram-router/**`
- Tier-1: `src/server/tier1-enrichment.js`, `src/server/tier1/**`
- Tier-2: `src/server/tier2-enrichment.js`, `src/server/tier2/**`
- ChatGPT / working memory: `src/server/chatgpt-actions.js`, `src/server/mcp/**`
- backlog / batch status: `src/server/email-importer.js`, `src/server/batch-status-service.js`, `src/server/batch-worker-runtime.js`

### 3. Persistence
- shared DB gateway: `src/server/db.js`
- connection bootstrap: `src/server/db-pool.js`
- bounded-context stores already exist for Tier-1 and Tier-2:
  - `src/server/tier1/store.js`
  - `src/server/tier2/store.js`

### 4. Shared backend support
- config: `src/libs/config/`
- logging and telemetry: `src/server/logger/**`
- reusable shared libs: `src/libs/**`

## Current Strengths

- contract docs are stronger than the implementation structure
- Tier-2 already shows a good backend pattern:
  - domain rules in `src/server/tier2/control-plane.js`
  - persistence in `src/server/tier2/store.js`
  - orchestration in `src/server/tier2/service.js` and `src/server/tier2-enrichment.js`
- shared builder logic is staged for reuse across backend and UI where appropriate

## Current Structural Hotspots

### `src/server/index.js`
- single-file router + controller + middleware + bootstrap
- carries too many unrelated concerns:
  - route matching
  - auth
  - body parsing
  - response normalization
  - some route-local orchestration
  - worker/timer startup

### `src/server/db.js`
- central SQL boundary is correct, but the module is too broad
- currently mixes:
  - generic entry CRUD
  - read surfaces
  - test-mode state
  - calendar business logs
  - failure-pack persistence
  - Tier-2 support queries
  - maintenance helpers

### Config ownership
- shared config loader exists, but backend still has direct `process.env` reads outside bootstrap/config
- config ownership is therefore only partially normalized today

### Transitional seams
- public MCP is retired, but internal ChatGPT execution still passes through MCP-shaped service code
- some compatibility routes and runtime aliases still exist for migration safety

## Incremental Target Shape

The goal is not a big rewrite. The target is an incremental n8n-first backend structure:

```text
src/server/
  app/
    create-server.js
    middleware/
  routes/
    control.routes.js
    ingest.routes.js
    calendar.routes.js
    distill.routes.js
    read-write.routes.js
  services/
    ingest/
    calendar/
    tier1/
    tier2/
    chatgpt/
    debug/
  repositories/
    entries.repo.js
    runtime-config.repo.js
    calendar.repo.js
    failure-packs.repo.js
    tier1.repo.js
    tier2.repo.js
  workers/
    tier1-batch.worker.js
    tier2-batch.worker.js
    maintenance.worker.js
```

Rules for getting there:
- keep backend n8n-first in route and service design
- preserve the raw-SQL boundary
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
