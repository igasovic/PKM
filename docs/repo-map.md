# Repository Map

## Purpose
- define ownership boundaries and allowed dependencies
- help agents place work in the right surface quickly
- clarify which docs and contracts are likely to move together

## Authoritative For
- ownership by repo area
- placement rules
- allowed dependency directions at a high level

## Not Authoritative For
- runtime topology and service edges; use `docs/service_dependancy_graph.md`
- exact runtime paths and mounts; use `docs/env.md`
- API or schema contracts; use `docs/api.md` and `docs/database_schema.md`
- backend implementation topology; use `docs/backend_architecture.md`

## Read When
- deciding where code belongs
- reviewing whether a change introduced unsafe coupling
- planning work that spans server, web, n8n, scripts, or ops surfaces

## Core Ownership Map

| Surface | Owns | May depend on | Must not do |
|---|---|---|---|
| `src/server/` | HTTP API, business logic, DB access layer, logging, orchestration | `src/libs/`, DB module, documented contracts | raw SQL outside approved files; bypass DB module; undocumented contracts |
| `src/web/` | UI application | documented backend endpoints, shared libs as appropriate | direct DB access; undocumented backend paths |
| `src/libs/` | shared pure utilities and helpers | local utilities only | hidden environment-specific side effects unless intentional |
| `src/n8n/` | workflow JSON, externalized code nodes, runtime package manifest | documented backend endpoints, staged shared helpers | direct DB access; raw SQL; `/data/...` runtime imports |
| `src/n8n/package/` | generated runtime package output | build/runtime consumers only | manual authoring or review as a source-of-truth surface |
| `scripts/n8n/` | active n8n sync and cutover scripts | repo-managed n8n surfaces | ad hoc workflow state edits outside orchestrated flow |
| `scripts/archive/n8n/` | retired scripts kept for history | none for normal operations | use in active workflows |
| `scripts/cfg/` | config diff/apply tooling | repo-managed config surfaces | bypass documented operator workflow |
| `ops/stack/` | repo-authored non-secret stack config and runtime definitions | config tooling and documented runtime assumptions | host-local secret storage in repo |
| `test/` | automated tests | touched implementation surfaces | silently accept changed behavior without updating tests |
| `docs/` | contracts, guides, architecture, runbooks | references to authoritative repo surfaces | become the only source of truth for code behavior without matching implementation |

## Placement Rules
- New n8n logic belongs under `src/n8n/`.
- `src/n8n/package/` is generated output, not an authoring surface.
- Legacy `js/` workflow tree is sunset and must not be used.
- Raw SQL is allowed only in:
  - `src/libs/sql-builder.js`
  - `src/server/db.js`
- Business logic must call DB module methods rather than issuing SQL directly.

## Generated Vs Authoritative
- Authoritative source files live in repo-owned authoring surfaces such as `src/n8n/`, `ops/stack/`, `docs/`, and approved config/code locations.
- Generated outputs such as `src/n8n/package/` are build artifacts and should not be treated as the authoring surface.
- Live n8n state is runtime state, not source code; sync it through `docs/n8n_sync.md` workflows.

## Change Routing

| If you touch... | Also inspect... |
|---|---|
| backend endpoints | `docs/api.md`, relevant `docs/api_*.md`, `docs/database_schema.md`, relevant tests |
| public webhook contracts | `docs/external_api.md`, `docs/api.md`, relevant `docs/api_*.md`, `docs/service_dependancy_graph.md` |
| schema or migrations | `docs/database_schema.md`, `docs/api.md`, relevant `docs/api_*.md`, `docs/config_operations.md` |
| n8n nodes or workflows | `docs/n8n_sync.md`, `docs/n8n_node_style_guide.md`, `docs/api.md`, relevant `docs/api_*.md` |
| runtime/config/infra | `docs/config_operations.md`, `docs/env.md`, `docs/service_dependancy_graph.md` |
| topology or trust boundaries | `docs/service_dependancy_graph.md`, `docs/env.md` |
| repo structure / ownership | this file and `AGENTS.md` |

## Docs That Matter Most
- `docs/README.md`: doc entrypoint and read routing
- `docs/service_dependancy_graph.md`: dependency topology and trust boundaries
- `docs/env.md`: runtime access paths, ports, mounts, stack root
- `docs/backend_architecture.md`: backend implementation topology and consumer hierarchy
- `docs/api.md`: internal backend API index and shared conventions
- `docs/api_*.md`: detailed backend endpoint contracts by domain
- `docs/backend_runtime_env.md`: backend env vars and runtime knobs
- `docs/external_api.md`: public webhook contracts
- `docs/database_schema.md`: DB schema and lifecycle
- `docs/database_operations.md`: DB backup and restore runbook
- `docs/config_operations.md`: config registry and operator apply workflow
- `docs/n8n_sync.md`: n8n sync and deployment flow
- `docs/n8n_node_style_guide.md`: n8n authoring and review rules
- `docs/prd-expectations.md`: repo-local expectations for PRD quality and agent use
