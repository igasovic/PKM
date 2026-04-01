# Documentation Index

This file is the entrypoint for agents working in this repo.

## Purpose
- route agents to the minimum authoritative docs they need
- clarify which doc owns which kind of truth
- reduce duplicate reading and prevent stale assumptions

## Agent Read Paths

### Coding agent
Start with:
- `docs/repo-map.md`
- `docs/backend_architecture.md` when changing backend structure or ownership
- `docs/backend_db_store_map.md` when changing backend persistence ownership
- `docs/test_mode_exemptions.md` when changing schema-routed or exempt persistence surfaces
- `docs/testing_strategy.md` when changing tests or deciding what to run locally vs post-deploy
- then the surface docs for the change type you are touching
- then `docs/changelog.md` only if recent behavior on that surface matters

### Planning agent
Start with:
- `docs/repo-map.md`
- `docs/backend_architecture.md` when backend structure or caller boundaries are changing
- `docs/backend_db_store_map.md` when DB ownership or store placement is changing
- `docs/backend_test_surface_matrix.md` when test planning or route risk is part of the change
- `docs/testing_strategy.md` when local versus post-deploy coverage is part of the plan
- `docs/service_dependency_graph.md`
- `docs/env.md`
- then the relevant contract and config docs for the touched surfaces
- then the owning PRD in `docs/PRD/README.md` when the change is major or cross-cutting

### Reviewing agent
Start with:
- `docs/repo-map.md`
- `docs/backend_architecture.md` when reviewing backend refactors or ownership changes
- `docs/backend_db_store_map.md` for DB boundary changes
- `docs/test_mode_exemptions.md` for schema-routing changes
- `docs/testing_strategy.md` when reviewing missing gates or deploy verification gaps
- the contract docs for the changed surfaces
- any relevant style guide or workflow guide
- the owning PRD when the change touches boundaries, config, schema, or public contracts

### Architect agent
Start with:
- `docs/service_dependency_graph.md`
- `docs/env.md`
- `docs/repo-map.md`
- `docs/backend_architecture.md` for backend implementation topology
- `docs/backend_db_store_map.md` for store and table ownership
- `docs/test_mode_exemptions.md` when reviewing schema-routing boundaries
- `docs/testing_strategy.md` when shaping test and verification layers
- `docs/config_operations.md`
- then the relevant contract docs (`api`, `external_api`, `database_schema`)
- then `docs/PRD/README.md` for active surface ownership

## Change-Type Routing

| Change type | Read first | Must update if changed |
|---|---|---|
| Internal backend API | `docs/api.md`, relevant `docs/api_*.md`, `docs/database_schema.md`, `docs/repo-map.md` | `docs/api.md`, relevant `docs/api_*.md`, related schema/config docs |
| Public ChatGPT / webhook | `docs/external_api.md`, `docs/api.md`, relevant `docs/api_*.md`, `docs/service_dependency_graph.md` | `docs/external_api.md`, related internal contract docs |
| Database / schema / migrations | `docs/database_schema.md`, `docs/api.md`, relevant `docs/api_*.md`, `docs/config_operations.md` | `docs/database_schema.md`, related API/config docs |
| n8n workflows / nodes | `docs/n8n_sync.md`, `docs/n8n_node_style_guide.md`, `docs/api.md`, relevant `docs/api_*.md` | n8n docs plus any touched contract docs |
| Config / infra / runtime | `docs/config_operations.md`, `docs/env.md`, `docs/service_dependency_graph.md` | `docs/config_operations.md`, `docs/env.md`, service graph if topology changed |
| Backend implementation architecture | `docs/backend_architecture.md`, `docs/repo-map.md`, relevant `docs/api*.md` files | `docs/backend_architecture.md` plus any touched contract/config docs |
| Backend DB ownership / store placement | `docs/backend_db_store_map.md`, `docs/backend_architecture.md`, `docs/database_schema.md` | `docs/backend_db_store_map.md`, related architecture/schema docs |
| Test-mode routing / exemptions | `docs/PRD/test-mode-prd.md`, `docs/test_mode_exemptions.md`, `docs/database_schema.md` | `docs/test_mode_exemptions.md`, `docs/PRD/test-mode-prd.md`, related API/schema docs |
| Backend test planning / route coverage | `docs/backend_test_surface_matrix.md`, `docs/backend_route_registry.json`, `docs/n8n_backend_contract_map.md` | `docs/backend_route_registry.json`, generated test matrix, related contract docs |
| Testing strategy / execution | `docs/testing_strategy.md`, `docs/backend_test_surface_matrix.md`, `docs/PRD/smoke-prd.md` | `docs/testing_strategy.md`, related smoke and contract docs |
| Backend runtime knobs | `docs/backend_runtime_env.md`, `docs/config_operations.md`, `docs/env.md` | `docs/backend_runtime_env.md`, related env/config docs |
| DB backup / restore workflow | `docs/database_operations.md`, `docs/env.md`, `docs/config_operations.md` | `docs/database_operations.md`, related env/config docs |
| Repo placement / ownership | `docs/repo-map.md` | `docs/repo-map.md` |
| PRD process / expectations | `docs/prd-expectations.md`, `docs/PRD/README.md`, and the owning PRD | owning PRD and any contract docs touched |

## Authoritative Docs

| Doc | Authoritative for | Not authoritative for |
|---|---|---|
| `docs/service_dependency_graph.md` | dependency topology, trust boundaries, service edges | exact runtime mounts, ports, host paths |
| `docs/env.md` | runtime access paths, ports, mounts, stack root, operator-facing environment notes | high-level dependency topology |
| `docs/backend_architecture.md` | backend implementation topology, consumer priority, module ownership | public/internal contract schemas, runtime ports, DB schema facts |
| `docs/backend_db_store_map.md` | backend DB ownership, route/repository/store mapping | table DDL, runtime topology |
| `docs/test_mode_exemptions.md` | which backend persistence surfaces honor active test mode | API schema details or workflow-only calendar test routing |
| `docs/backend_test_surface_matrix.md` | generated backend route test-coverage inventory from the registry | whether individual tests are sufficient in depth |
| `docs/testing_strategy.md` | local pre-push versus Pi post-deploy test strategy | endpoint schemas or smoke implementation detail |
| `docs/n8n_backend_contract_map.md` | active n8n workflow to backend route ownership | detailed HTTP schemas or runtime topology |
| `docs/api.md` | internal backend API index and shared conventions | public ChatGPT webhook contracts |
| `docs/api_control.md`, `docs/api_ingest.md`, `docs/api_calendar.md`, `docs/api_distill.md`, `docs/api_read_write.md` | detailed internal endpoint contracts by family | public webhook contracts |
| `docs/backend_runtime_env.md` | backend env vars and runtime knobs | operator apply workflow |
| `docs/external_api.md` | public webhook contracts for ChatGPT / Custom GPT actions | internal backend contracts |
| `docs/database_schema.md` | DB schemas, tables, grants, lifecycle notes | runtime topology and apply workflow |
| `docs/database_operations.md` | DB backup and restore runbook | schema/table definitions |
| `docs/config_operations.md` | config surface registry and operator apply workflow | business behavior requirements |
| `docs/n8n_sync.md` | n8n sync and deployment workflow | n8n code authoring style |
| `docs/n8n_node_style_guide.md` | n8n node authoring and review rules | deployment/apply workflow |
| `docs/repo-map.md` | ownership, placement, allowed dependencies | runtime topology |
| `docs/requirements.md` | broad behavioral requirements and invariants in current structure | single-surface canonical contract docs |
| `docs/prd-expectations.md` | repo-local expectations for PRD quality and agent usage | actual product decisions for a specific surface |
| `docs/PRD/README.md` | active PRD routing and archive boundaries | domain truth or API/schema contracts |

## Documentation Conventions
Each authoritative doc should make these things obvious near the top:
- Purpose
- Authoritative for
- Not authoritative for
- Read when
- Update when
- Related docs

## Dependency Graph Update Workflow
`docs/service_dependency_graph.md` is authoritative and should be updated in passes:
- planning agent: first-pass update when a design changes boundaries or service edges
- architect agent: second-pass review if the change is cross-cutting or high-risk
- coding agent: final update to match implemented real state before work closes

## Architecture Doc Maintenance

Update architecture docs in the same change set as the code boundary they describe:
- `docs/backend_architecture.md` when backend module topology, caller priority, workers, or composition rules change
- `docs/backend_db_store_map.md` when route, repository, service, store, or table ownership changes
- `docs/test_mode_exemptions.md` when a persistence surface starts honoring active test mode, becomes prod-pinned, or becomes dual-schema
- `docs/backend_route_registry.json` when route path, auth, owner doc, primary callers, or required tests change

Generated architecture-supporting docs:
- `docs/backend_test_surface_matrix.md` is generated from `docs/backend_route_registry.json`
- edit the registry, then regenerate via `scripts/CI/generate_backend_test_surface_matrix.py --write`
- CI is expected to fail if the generated matrix is stale

## Current Constraints
- `docs/requirements.md` and `docs/changelog.md` still contain important historical and behavioral context and must be consulted when recovering old surfaces.
- Active PRDs are now routed through `docs/PRD/README.md`; archived PRD artifacts live under `docs/PRD/archive/`.
