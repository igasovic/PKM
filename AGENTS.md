# AGENTS.md

## 0) Fast Start
Read `docs/README.md` first.

Then read the minimum required docs for the surface you are changing:
- Always: `docs/README.md`, `docs/repo-map.md`
- Runtime topology / service interactions: `docs/service_dependancy_graph.md`, `docs/env.md`
- Internal backend API contracts: `docs/api.md` and the relevant `docs/api_*.md` domain doc
- Public ChatGPT / webhook contracts: `docs/external_api.md`
- Database schema / data lifecycle: `docs/database_schema.md`
- Database backup / restore runbooks: `docs/database_operations.md` when operational DB workflow changes
- n8n authoring / sync: `docs/n8n_sync.md`, `docs/n8n_node_style_guide.md`
- Config / infra / Docker / LiteLLM / Postgres init / backend-loader: `docs/config_operations.md`
- Backend runtime env/config knobs: `docs/backend_runtime_env.md`
- Behavioral invariants and broad requirements: `docs/requirements.md` when changing behavior or shared invariants
- Recent history / near-surface context: `docs/changelog.md` when validating recent behavior on the touched surface
- PRD process expectations: `docs/prd-expectations.md`

If a task is cross-cutting, read all relevant surface docs before changing code or contracts.

### Authoritative graph workflow
`docs/service_dependancy_graph.md` is authoritative for dependency topology and trust boundaries.
- Planning agents should do the first-pass graph update when a design changes topology or boundaries.
- Architect agents should review and tighten the graph when the change is cross-cutting or boundary-sensitive.
- Coding agents should finalize the graph to match implemented real state before work is considered done.

### Source-of-truth precedence
- `AGENTS.md` governs agent behavior, process, and hard invariants.
- `docs/*.md` contract and runbook docs govern domain truth for their declared scope.
- `docs/PRD/README.md` routes agents to the active surface owner. Active `docs/PRD/*.md` files govern change intent, rollout, work packages, and unresolved decisions for owned surfaces.
- If two sources conflict, reconcile them in the same change set rather than silently choosing the older text.

---

## 0a) Change Classification
Use these definitions to decide PRD and review depth.

### Minor change
A localized change within an existing owned surface that does not introduce a new public contract, schema object, config surface, workflow family, or migration path.

### Major change
Any change that introduces or materially changes:
- a public or internal contract
- a schema/table/index lifecycle surface
- a runtime/config surface
- a workflow family or cross-component control plane
- a migration, rollout, or backfill requirement

### Cross-cutting change
Any change touching two or more of:
- public webhook contracts
- internal backend API contracts
- database schema / data lifecycle
- config / infra / runtime topology
- n8n orchestration and workflow boundaries

Cross-cutting changes should be planned explicitly even if the code diff is small.

---

## 0b) PRDs (required process)
- PRDs live under `docs/PRD/`; use `docs/PRD/README.md` to find the active owner for a surface.
- Use an existing PRD when one already covers the surface you are changing.
- New major functionality: create a new PRD file.
- Minor functionality: update the existing PRD that owns that surface.
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
- Use `docs/prd-expectations.md` as the repo-local template for what agents should expect PRDs to contain.

---

## 1) Hard Invariants

### Integration boundary
- UI and n8n must call backend only through endpoints documented in `docs/api.md` and the relevant `docs/api_*.md` file.
- Do not create new endpoints or change request or response shapes without updating `docs/api.md` and the relevant `docs/api_*.md` file in the same change.
- Public Custom GPT webhook contracts must be documented in `docs/external_api.md`.

### Database safety
- No raw SQL outside:
  - `src/libs/sql-builder.js`
  - `src/server/db/**`
- Business logic must call DB module methods rather than issuing SQL directly.

### Logging and observability
- Use the shared backend logger: `src/server/logger`.
- Do not log heavy payloads. Summarize with counts and hashes, not raw fields.
- Telemetry destinations:
  - LLM telemetry -> Braintrust
  - transition telemetry -> Postgres `pipeline_events`

### Repository ownership and placement
- Follow `docs/repo-map.md`.
- New n8n logic belongs under `src/n8n/`.
- Legacy `js/` workflow tree is sunset. Use only `src/n8n/workflows/` and `src/n8n/nodes/`.
- n8n runtime package metadata belongs in `src/n8n/package.manifest.json`.
- `src/n8n/package/` is generated output only; do not treat it as the authoring surface.

### Runtime and environment boundary
- `docs/service_dependancy_graph.md` is authoritative for service dependency topology and trust boundaries.
- `docs/env.md` is authoritative for runtime access paths, ports, mounts, container names, and runtime stack root.
- Do not assume paths, mounts, ports, or service edges not documented in those docs.

---

## 2) Configuration Governance

### Repo-first rule
Anything that should be reviewed, diffed, rollbackable, and safely editable by agents should live in the repo unless it is secret, runtime-mutable, or persistent service state.
All non-secret configuration must be authored in repo-managed surfaces, not by ad hoc host-local edits. Host-local files should only hold secrets, credentials, runtime-mutable state, and persistent service data.

### Secrets rule
Secrets and credentials must stay off-repo.

### Loader rule
Backend code must read configuration only through the approved config loader, except for minimal bootstrap internals.

### No scattered defaults rule
Do not introduce business defaults in backend modules, n8n node code, or scripts when they belong in shared config.

### Config-location registry rule
Any time you discover a new configuration surface, you must:
1. add it to the config-location registry in `docs/config_operations.md`
2. classify it as `authoritative`, `derived`, `legacy`, or `deprecated`
3. mark whether it is `secret`, `versioned`, `host-local`, or `runtime-mutable`
4. note the owning component
5. update related docs if contract-relevant

### Source-of-truth defaults
- Repo-owned files are the source of truth for versioned, non-secret config.
- Host-local files own secrets, credentials, runtime-mutable state, and persistent data.
- `pkm.runtime_config` stays narrow; do not turn it into a general config store without a PRD.
- `cloudflared` currently runs as runtime-managed token-mode compose state, not as a repo-managed config surface.
- Home Assistant and Matter Server are out of scope for this config program unless explicitly pulled in.

`docs/config_operations.md` is authoritative for the active config surface registry and operator apply workflow. Do not duplicate that registry elsewhere.

---

## 3) Change-Type Workflow

### Before non-trivial work
Provide a short plan covering:
- goal and non-goals
- components touched
- contracts touched
- tests you will add or update
- files you expect to change

### n8n workflow changes
- Workflow wiring changes: edit in n8n UI, export JSON, commit.
- Code node logic: externalize into repo files and keep Code nodes thin wrappers.
- Runtime imports in canonical workflows and externalized node code must use package subpaths under `@igasovic/n8n-blocks/...`, never `/data/...`.

### Config and infra changes
- Author versioned config in repo first.
- Validate before apply.
- Do not silently edit runtime stack files as the primary authored surface.
- Keep apply logic explicit and reviewable.
- For any non-secret config change, perform all repo/doc updates and provide only the required `checkcfg` / `updatecfg` operator command(s) for apply.
- Before proposing any apply or migration command, explicitly state what will be applied and where: target host, container/service, database/schema, or file path.
- For Postgres apply commands, never rely on an already-exported shell variable for admin user. Resolve DB user explicitly from `/home/igasovic/stack/.env` (fallback `postgres`) and pass it via `psql -U`.
- For Postgres migrations stored on the host, do not use `psql -f <host-path>` inside `docker exec` because `-f` resolves in-container paths. Pipe host files through stdin (`cat <host-file> | docker exec -i postgres psql ...`) or mount/copy into the container first.

### Docs-only changes
- Keep AGENTS focused on process and hard rules, not long inventories.
- Put domain truth in docs under `docs/`.
- If a doc becomes broad enough that agents cannot route quickly, add or update index/overview material in `docs/README.md`.

---

## 4) Role-Specific Outputs

### Coding agent
Final responses should make it easy to ship and verify work:
- summarize what changed
- list contracts, tests, and docs updated
- note anything not verified
- if config changed, include the mandatory config handoff block

### Planning agent
Plans should include:
- goal and non-goals
- touched surfaces and authoritative docs
- contracts and migrations affected
- sequencing / rollout order
- open questions and risks
- expected files and tests

### Reviewing agent
Reviews should focus on:
- bugs, regressions, unsafe coupling, contract drift, and missing tests
- missing doc or PRD updates when surfaces changed
- config ownership and rollout hazards when config/infra are involved
- findings first; summaries second

### Architect agent
Architecture reviews should include:
- affected boundaries and trust edges
- contracts and source-of-truth docs impacted
- topology, config, and migration implications
- what remains local vs what becomes systemic
- whether `docs/service_dependancy_graph.md`, `docs/env.md`, `docs/api.md`, `docs/external_api.md`, or `docs/config_operations.md` must change together

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

## 5) Quality Gates
- Run `scripts/CI/check.sh` before committing changes.
- If behavior changes, add or update tests.
- If boundaries or contracts change, update the relevant docs in the same change set.
- Prefer refactoring to avoid duplication rather than copying code.
- If config ownership changes, update both the PRD and `docs/config_operations.md`.
- If topology or service dependencies change, update `docs/service_dependancy_graph.md` and any affected runtime access notes in `docs/env.md`.

---

## 6) Do Not Do
- Do not bypass `docs/api.md` and the relevant `docs/api_*.md` file by calling undocumented endpoints.
- Do not introduce cross-component coupling such as UI<->PKM product DB or n8n<->PKM product DB. n8n's own runtime/execution database is part of n8n infrastructure and is allowed.
- Do not log raw payloads or large objects.
- Do not send transition telemetry anywhere except Postgres `pipeline_events`.
- Do not write raw SQL outside approved files.
- Do not bypass DB module methods from business logic.
- Do not commit secrets.
- Do not reintroduce hidden config through `docker-compose.yml`, ad hoc `.env` growth, or duplicated defaults in code.
- Do not reintroduce a `js/` workflow tree.
