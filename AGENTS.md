# AGENTS.md

## 0) Read-first (non-negotiable)
Before proposing changes or writing code, read:
- `docs/env.md`
- `docs/api.md`
- `docs/database_schema.md`
- `docs/n8n_sync.md`
- `docs/n8n_node_style_guide.md`
- `docs/requirements.md`
- `docs/changelog.md`
- `docs/repo-map.md`
- `docs/config_operations.md`

For any n8n-related change, reading `docs/n8n_sync.md` and `docs/n8n_node_style_guide.md` is mandatory.

For any config, infra, Docker, cloudflared, LiteLLM, Postgres init or backend-loader change, reading `docs/config_operations.md` is mandatory.

---

## 0a) PRDs (required process)

- PRDs live under `docs/PRD/`.
- Use an existing PRD when one already covers the surface you are changing.
- New major functionality:
  - create a new PRD file
- Minor functionality:
  - update the existing PRD that owns that surface
- Backfilled PRDs must first describe current behavior and boundaries, then leave unresolved items in `TBD`.

### Recommended PRD structure
- Title + baseline / status
- Control plane / execution flow
- Data model / schema changes
- Validation + state transitions
- Config surface
- API / operational surfaces
- Migration / backfill plan
- Work packages
- `TBD`

### PRD update rules
- If a change affects an existing PRD-owned surface, update that PRD in the same change.
- If API, schema, env, requirements, or config-location contracts change, update the corresponding docs in the same change set.
- Work packages should reference specific PRD sections.

---

## 1) System boundaries (hard rules)

### Integration boundary
- UI and n8n must call backend only through endpoints documented in `docs/api.md`.
- Do not create new endpoints or change request or response shapes without updating `docs/api.md` in the same change.

### Database safety
- No raw SQL outside:
  - `src/libs/sql-builder.js`
  - `src/server/db.js`
- Business logic must call DB module methods rather than issuing SQL directly.

### Logging and observability
- Use the shared backend logger: `src/server/logger`.
- Do not log heavy payloads. Summarize with counts and hashes, not raw fields.
- Telemetry destinations:
  - LLM telemetry → Braintrust
  - transition telemetry → Postgres `pipeline_events`

### Repository ownership and placement
- Follow `docs/repo-map.md`.
- New n8n logic belongs under `src/n8n/`.
- Legacy `js/` workflow tree is sunset. Use only `src/n8n/workflows/` and `src/n8n/nodes/`.

### Runtime and environment boundary
- `docs/env.md` is authoritative for service topology, ports, mounts, container names, and runtime stack root.
- Do not assume paths, mounts, or ports not documented there.

---

## 2) Configuration governance (hard rules)

### Repo-first rule
Anything that should be reviewed, diffed, rollbackable, and safely editable by agents should live in the repo unless it is secret, runtime-mutable, or persistent service state.

### Secrets rule
Secrets and credentials must stay off-repo.

### Loader rule
Backend code must read configuration only through the approved config loader, except for minimal bootstrap internals.

### No scattered defaults rule
Do not introduce business defaults in backend modules, n8n node code, or scripts when they belong in shared config.

### Config-location registry rule (mandatory)
Any time you discover a new configuration surface, you must:
1. add it to the config-location registry in `docs/config_operations.md`
2. classify it as `authoritative`, `derived`, `legacy`, or `deprecated`
3. mark whether it is `secret`, `versioned`, `host-local`, or `runtime-mutable`
4. note the owning component
5. update related docs if contract-relevant

### Current in-scope config surfaces
At minimum, treat these as active config surfaces:
- `/home/igasovic/stack/docker-compose.yml`
- `/home/igasovic/stack/.env`
- `/home/igasovic/stack/postgres/`
- `/home/igasovic/stack/postgres-init/`
- `/home/igasovic/stack/n8n/`
- `/home/igasovic/stack/litellm/config.yaml`
- `src/libs/config.js` and `src/libs/config/`
- `src/server/**` direct env reads
- `src/n8n/workflows/`
- `src/n8n/nodes/`
- `scripts/n8n/**`
- `scripts/db/**`
- `pkm.runtime_config`
- shell exports for `N8N_API_*`
- known UI-local env files

### Source-of-truth defaults
- Repo-owned files are the source of truth for versioned, non-secret config.
- Host-local files own secrets, credentials, runtime mutable state, and persistent data.
- `pkm.runtime_config` stays narrow; do not turn it into a general config store without a PRD.
- cloudflared target state is locally managed repo config plus host-local credentials.
- Home Assistant and Matter Server are out of scope for this config program unless explicitly pulled in.

---

## 3) Default workflow

Before coding non-trivial changes, provide a short plan covering:
- goal and non-goals
- components touched
- contracts touched
- tests you will add or update
- files you expect to change

### n8n workflow editing model
- Workflow wiring changes: edit in n8n UI, export JSON, commit.
- Code node logic: externalize into repo files and keep Code nodes thin wrappers.

### Config and infra workflow
- Author versioned config in repo first.
- Validate before apply.
- Do not silently edit runtime stack files as the primary authored surface.
- Keep apply logic explicit and reviewable.

### Config-change handoff block (mandatory)
When your change affects config, your final response must include:

```text
Config surfaces changed:
- <surface>

Run:
- checkcfg <surface>
- updatecfg <surface> --push
```

If multiple surfaces changed, list all of them with matching commands.

If no operator apply step is required, explicitly say:

```text
Config surfaces changed:
- none

Run:
- no operator config apply required
```

---

## 4) Quality gates

- Run `scripts/CI/check.sh` before committing changes.
- If behavior changes, add or update tests.
- If boundaries or contracts change, update the relevant docs in the same change set.
- Prefer refactoring to avoid duplication rather than copying code.
- If config ownership changes, update both the PRD and `docs/config_operations.md`.

---

## 5) Do not do

- Do not bypass `docs/api.md` by calling undocumented endpoints.
- Do not introduce cross-component coupling such as UI↔DB or n8n↔DB.
- Do not log raw payloads or large objects.
- Do not send transition telemetry anywhere except Postgres `pipeline_events`.
- Do not write raw SQL outside approved files.
- Do not bypass DB module methods from business logic.
- Do not commit secrets.
- Do not reintroduce hidden config through `docker-compose.yml`, ad hoc `.env` growth, or duplicated defaults in code.
- Do not reintroduce a `js/` workflow tree.
