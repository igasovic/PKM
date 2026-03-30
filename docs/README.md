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
- then the surface docs for the change type you are touching
- then `docs/changelog.md` only if recent behavior on that surface matters

### Planning agent
Start with:
- `docs/repo-map.md`
- `docs/service_dependancy_graph.md`
- `docs/env.md`
- then the relevant contract and config docs for the touched surfaces
- then the owning PRD in `docs/PRD/README.md` when the change is major or cross-cutting

### Reviewing agent
Start with:
- `docs/repo-map.md`
- the contract docs for the changed surfaces
- any relevant style guide or workflow guide
- the owning PRD when the change touches boundaries, config, schema, or public contracts

### Architect agent
Start with:
- `docs/service_dependancy_graph.md`
- `docs/env.md`
- `docs/repo-map.md`
- `docs/config_operations.md`
- then the relevant contract docs (`api`, `external_api`, `database_schema`)
- then `docs/PRD/README.md` for active surface ownership

## Change-Type Routing

| Change type | Read first | Must update if changed |
|---|---|---|
| Internal backend API | `docs/api.md`, relevant `docs/api_*.md`, `docs/database_schema.md`, `docs/repo-map.md` | `docs/api.md`, relevant `docs/api_*.md`, related schema/config docs |
| Public ChatGPT / webhook | `docs/external_api.md`, `docs/api.md`, relevant `docs/api_*.md`, `docs/service_dependancy_graph.md` | `docs/external_api.md`, related internal contract docs |
| Database / schema / migrations | `docs/database_schema.md`, `docs/api.md`, relevant `docs/api_*.md`, `docs/config_operations.md` | `docs/database_schema.md`, related API/config docs |
| n8n workflows / nodes | `docs/n8n_sync.md`, `docs/n8n_node_style_guide.md`, `docs/api.md`, relevant `docs/api_*.md` | n8n docs plus any touched contract docs |
| Config / infra / runtime | `docs/config_operations.md`, `docs/env.md`, `docs/service_dependancy_graph.md` | `docs/config_operations.md`, `docs/env.md`, service graph if topology changed |
| Backend runtime knobs | `docs/backend_runtime_env.md`, `docs/config_operations.md`, `docs/env.md` | `docs/backend_runtime_env.md`, related env/config docs |
| DB backup / restore workflow | `docs/database_operations.md`, `docs/env.md`, `docs/config_operations.md` | `docs/database_operations.md`, related env/config docs |
| Repo placement / ownership | `docs/repo-map.md` | `docs/repo-map.md` |
| PRD process / expectations | `docs/prd-expectations.md`, `docs/PRD/README.md`, and the owning PRD | owning PRD and any contract docs touched |

## Authoritative Docs

| Doc | Authoritative for | Not authoritative for |
|---|---|---|
| `docs/service_dependancy_graph.md` | dependency topology, trust boundaries, service edges | exact runtime mounts, ports, host paths |
| `docs/env.md` | runtime access paths, ports, mounts, stack root, operator-facing environment notes | high-level dependency topology |
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
`docs/service_dependancy_graph.md` is authoritative and should be updated in passes:
- planning agent: first-pass update when a design changes boundaries or service edges
- architect agent: second-pass review if the change is cross-cutting or high-risk
- coding agent: final update to match implemented real state before work closes

## Current Constraints
- `docs/requirements.md` and `docs/changelog.md` still contain important historical and behavioral context and must be consulted when recovering old surfaces.
- Active PRDs are now routed through `docs/PRD/README.md`; archived PRD artifacts live under `docs/PRD/archive/`.
