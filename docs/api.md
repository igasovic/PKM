# PKM Backend API

## Purpose
- define the authoritative entrypoint and navigation model for internal backend HTTP contracts
- keep shared conventions in one place while detailed endpoint contracts live in focused domain docs

## Authoritative For
- internal backend API domain map
- shared conventions used across internal backend routes
- which detailed doc owns which endpoint family

## Not Authoritative For
- public ChatGPT / Custom GPT webhook contracts; use `docs/external_api.md`
- detailed per-endpoint request/response schemas; use the linked domain docs below
- runtime topology and service exposure; use `docs/service_dependency_graph.md`
- backend env/config details; use `docs/backend_runtime_env.md`, `docs/env.md`, and `docs/config_operations.md`

## Read When
- deciding which internal contract doc to update
- planning or reviewing a change that touches backend endpoints
- orienting a coding agent before editing one endpoint family

## Update When
- a backend endpoint family is added, removed, renamed, or re-homed
- shared conventions such as auth patterns or run correlation change
- the owning detailed doc for an endpoint family changes

## Related Docs
- `docs/api_control.md`
- `docs/api_ingest.md`
- `docs/api_calendar.md`
- `docs/api_distill.md`
- `docs/api_read_write.md`
- `docs/api_recipes.md`
- `docs/n8n_backend_contract_map.md`
- `docs/backend_runtime_env.md`
- `docs/external_api.md`
- `docs/database_schema.md`
- `docs/service_dependency_graph.md`

Base URL: `http://<host>:<port>`

This service exposes a JSON API intended for internal systems such as n8n and operator-facing tooling.
The machine-readable route ownership registry lives in `docs/backend_route_registry.json`.

## Endpoint Families At A Glance

| Family | Detailed doc | Auth pattern | Primary schema touched | Typical tests |
|---|---|---|---|---|
| Control / debug | `docs/api_control.md` | mixed; debug/admin routes require secret | `runtime_config`, `pipeline_events`, `failure_packs` | debug/config/failure-pack tests |
| Ingest / enrichment | `docs/api_ingest.md` | internal | `entries`, `t1_*` for batch flows | normalization, idempotency, batch-status tests |
| Calendar | `docs/api_calendar.md` | admin secret | `calendar_requests`, `calendar_event_observations` | calendar API and workflow tests |
| Tier-2 distill | `docs/api_distill.md` | admin secret | `entries`, `t2_*` | tier2 API/control-plane/service tests |
| Read / write | `docs/api_read_write.md` | mixed; destructive routes require secret | active schema `entries` | read-sql, context-pack, idempotency tests |
| Recipes | `docs/api_recipes.md` | internal | active schema `recipes` | recipes API and parser contract tests |
| Backend env | `docs/backend_runtime_env.md` | n/a | n/a | config/runtime tests |

## Domain Docs

| Doc | Owns | Primary callers | Notes |
|---|---|---|---|
| `docs/api_control.md` | health, internal ChatGPT actions, config, debug routes | operators, UI, n8n admin flows | includes run correlation conventions |
| `docs/api_ingest.md` | normalization, Tier-1 enrichment, batch status, backlog import | n8n ingest flows, backend orchestration | batch table definitions live in `docs/database_schema.md` |
| `docs/api_calendar.md` | calendar route / normalize / finalize / observe | n8n calendar workflows | admin-protected business-log surface |
| `docs/api_distill.md` | Tier-2 sync / plan / run | operators, n8n, backend control plane | async status surfaces are documented in `docs/api_ingest.md` |
| `docs/api_read_write.md` | `/db/*` read, insert, update, delete, move | n8n and internal tooling | includes `/db/*` response-shape rules |
| `docs/api_recipes.md` | `/recipes/*` create/search/get/update/review | Telegram recipe workflows, debug UI, operators | includes `/recipe` command retrieval expectations |
| `docs/backend_runtime_env.md` | backend env vars and runtime knobs | operators, deploy/review work | runtime apply still lives in env/config docs |

## Shared Conventions

### Run ID Correlation
- Preferred header: `X-PKM-Run-Id: <run_id>`
- Optional body field: `run_id` (used if header is not provided)
- Response header: `X-PKM-Run-Id` is always returned.

`run_id` is propagated through backend pipelines, LangGraph nodes, Postgres `pipeline_events`, and Braintrust metadata.

### Auth Patterns
- Internal read/write and normalization flows are generally intended for repo-owned callers such as n8n.
- Admin-sensitive routes require `x-pkm-admin-secret: <secret>`.
- Public ChatGPT callers must never call internal backend routes directly; they go through `docs/external_api.md`.

### Source-Of-Truth Split
- `docs/api.md`: internal API index and shared conventions.
- `docs/api_*.md`: detailed endpoint contracts by domain.
- `docs/external_api.md`: public webhook contracts.
- `docs/database_schema.md`: DB objects and lifecycle facts those APIs rely on.
- `docs/backend_runtime_env.md`: backend env vars and runtime knobs.

## Change Coupling

| If you change... | Update at minimum |
|---|---|
| request or response shape for one endpoint family | `docs/api.md` and the relevant `docs/api_*.md` file |
| admin protection or caller boundary | relevant `docs/api_*.md`, `docs/external_api.md` if public boundary changes, and `docs/service_dependency_graph.md` when topology/trust edges move |
| DB-backed lifecycle assumptions | relevant `docs/api_*.md` and `docs/database_schema.md` |
| backend env vars or runtime knobs | `docs/backend_runtime_env.md`, plus `docs/env.md` / `docs/config_operations.md` if ownership or apply flow changes |
