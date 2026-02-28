# AGENTS.md

## 0) Read-first (non-negotiable)
Before proposing changes or writing code, read:
- docs/env.md
- docs/api.md
- docs/database_schema.md
- docs/n8n_to_git.md + docs/git_to_n8n.md
- docs/requirements.md + docs/changelog.md
- docs/repo-map.md

## 1) System boundaries (hard rules)

### Integration boundary
- UI and n8n must call backend ONLY through endpoints documented in docs/api.md.
- Do not create new endpoints or change request/response shapes without updating docs/api.md in the same change.

### Database safety (non-negotiable)
- No raw SQL outside:
  - src/libs/sql-builder.js
  - src/server/db.js
- Business logic must call DB module methods (e.g., db.insertPipelineEvent(...))
  rather than issuing SQL directly.

### Logging and observability (non-negotiable)
- Use the shared backend logger: src/server/logger for pipeline transition logs.
- Do not log heavy payloads. Summarize with counts + hashes, not raw fields.
- Telemetry destinations:
  - LLM telemetry → Braintrust
  - Transition telemetry → Postgres pipeline_events

### Repository ownership and placement
- Follow docs/repo-map.md for where code belongs.
- n8n code migration policy (Hybrid):
  - New features: put new n8n logic under src/n8n/
  - Existing modules may be edited in js/ when needed, but prefer opportunistic migration to src/n8n/
  - Do not add *new* files under js/ (unless explicitly requested)

### Runtime/environment boundary
- docs/env.md is authoritative for service topology, ports, mounts, container names.
- Do not assume paths, mounts, or ports not documented there.

## 2) Default workflow (how work gets done)

### Change proposal (required for non-trivial changes)
Before coding, output a short plan:
- Goal + non-goals
- Components touched (UI / n8n / backend / DB / infra)
- Contracts touched (docs/api.md? docs/database_schema.md? docs/env.md?)
- Tests you will add/update (Jest) and how you will run them
- Files you expect to change

### n8n workflow editing model
- Workflow wiring changes: edit in n8n UI → export JSON → commit.
- Code node logic: externalize into repo files and keep Code nodes thin wrappers.

## 3) Quality gates (must-do)
- Run scripts/CI/check.sh before committing changes.
- If behavior changes: add/update Jest tests.
- If boundaries/contracts change: update the relevant docs in the same change.
- Prefer refactoring to avoid duplication rather than copying code.

## 4) “Do not do” list (common failure modes)
- Do not bypass docs/api.md by calling undocumented endpoints.
- Do not introduce cross-component coupling (UI↔DB, n8n↔DB).
- Do not log raw payloads or large objects; log summaries (counts + hashes).
- Do not send transition telemetry anywhere except Postgres pipeline_events.
- Do not write raw SQL outside src/libs/sql-builder.js and src/server/db.js.
- Do not bypass DB module methods from business logic.
- Do not ship changes without a minimal test plan and at least smoke coverage.
