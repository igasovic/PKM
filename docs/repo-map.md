# Repository Map

Defines ownership boundaries and allowed dependencies. If unsure where code belongs,
propose placement before implementing.

---

## src/ (product code)

### src/server/ (Backend)
Owns:
- HTTP API implementation
- Business logic
- DB access layer
- Logging and telemetry sinks
- Tier pipeline modules (for example `src/server/tier1/`, `src/server/tier2/`)

Public surface:
- API endpoints documented in docs/api.md
- DB module methods (src/server/db.js)

Hard rules:
- No raw SQL outside:
  - src/libs/sql-builder.js
  - src/server/db.js
- Business logic must call DB module methods (e.g., db.insertPipelineEvent(...))
- Pipeline transition logs use src/server/logger
- Telemetry destinations:
  - LLM telemetry → Braintrust
  - Transition telemetry → Postgres pipeline_events

---

### src/web/ (UI)
Owns:
- UI application

Hard rules:
- UI must not access DB directly
- UI calls backend ONLY via endpoints documented in docs/api.md

---

### src/libs/ (Shared code)
Owns:
- Pure shared utilities/types/helpers used across server/web/n8n

Hard rules:
- Avoid environment-specific side effects unless explicitly intended

---

### src/n8n/ (n8n workflow code)  [Target location]
Owns:
- Code used by n8n Code nodes (externalized JS)
- Workflow JSON under `src/n8n/workflows`

Hard rules:
- No direct DB access
- No raw SQL
- Must call backend ONLY via endpoints documented in docs/api.md
- Keep Code node wrappers thin; logic lives in files here

Migration policy:
- New features: put new n8n logic under src/n8n/
- Existing modules may be edited in js/ when needed, but prefer opportunistic migration
- Do not add new files under js/ (unless explicitly requested)

---

## Legacy modules

### js/ (Legacy n8n code)  [To be migrated]
Status:
- Legacy location to be migrated to src/n8n/

Rules:
- Do not add new modules here unless explicitly requested
- Prefer migrating touched files to src/n8n/ opportunistically

---

## scripts/n8n/ (active n8n sync scripts)
Owns:
- Active n8n sync and cutover scripts

Rules:
- Use `scripts/n8n/sync_workflows.sh` as the orchestrator
- Keep legacy/retired helpers out of this folder

## scripts/archive/n8n/ (retired scripts)
Owns:
- Deprecated n8n scripts kept only for history/reference

Rules:
- Do not use these scripts for normal operations

---

## test/ (Jest)
Owns:
- Automated tests (unit, integration, contract)

Rules:
- Behavior changes require Jest tests
- Boundary/contract changes require contract tests

---

## docs/ (contracts + guides)
Authoritative contracts:
- docs/api.md
- docs/database_schema.md
- docs/env.md
