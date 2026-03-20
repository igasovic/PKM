# n8n Internal JS Package Migration PRD

- Status: Completed on 2026-03-20 (repo migration + Pi cutover validation complete)
- Owner: Igor Gasovic
- Executor: Coding agent with full repo access
- Primary runtime target: Raspberry Pi stack deployment
- PRD location in repo: `docs/PRD/n8n-npm-migration.md`

## 1. Title, status, owners, scope

Implementation status snapshot:
- `WP1` through `WP8`: repo-side complete
- `WP9`: complete (operator helpers implemented and validated on Pi)
- closeout: complete (cutover validation + smoke + representative flow checks passed on Pi)

This PRD covers migration of reusable n8n Code-node JavaScript from the current path-based `/data/...` import model to a package-based runtime model compatible with n8n Task Runners.

Included in scope:
- package creation and structure
- package versioning policy
- selective reuse of `src/libs/**`
- runner image distribution model
- sync and cutover behavior
- required scripts and redeploy flow
- required documentation and config-surface updates
- validation and rollback expectations

Out of scope unless explicitly added later:
- workflow business-logic redesign
- API contract redesign
- database schema redesign
- public npm publication

## 2. Baseline / current operating model

### 2.1 Canonical repo locations today
- Workflows: `src/n8n/workflows/**`
- Externalized Code-node JS: `src/n8n/nodes/**`
- Reusable shared helpers: `src/libs/**`

### 2.2 Current externalization rule
Current repo contract:
- `< 50` non-empty lines: inline in workflow JSON
- `>= 50` non-empty lines: externalize

This rule is documented in `docs/n8n_node_style_guide.md` and enforced in sync by `MIN_JS_LINES`, default `50` non-empty lines.

### 2.3 Current runtime import model
Current repo/runtime contract standardizes on:
- absolute mounted runtime imports under `/data/...`
- thin Code-node wrappers that `require('/data/src/n8n/nodes/...')`
- direct runtime reuse of `/data/src/libs/...`

### 2.4 Current sync and ops model
Current process:
- workflow wiring changes are made in the n8n UI, exported, normalized, and committed
- externalized Code-node JS is synchronized via `scripts/n8n/**`
- `updatecfg n8n` delegates to `scripts/n8n/sync_workflows.sh`
- repo-authored docker/runtime surfaces live under `ops/stack/**`

### 2.5 Current runtime topology facts relevant to this migration
- n8n runs on the Pi in Docker
- current stack uses external runners
- current runtime is behind Cloudflare/reverse proxy
- current runtime historically mounted repo as `/data:ro`

### 2.6 Product/runtime constraint driving the migration
Modern n8n executes Code-node JS on Task Runners. Official docs state:
- internal mode is not recommended for production
- external mode uses a separate `n8nio/runners` sidecar
- external modules must be sourced from `n8n/node_modules`
- when Task Runners are used, JS module allowlist variables belong on the Task Runners
- in external mode, the launcher inside the runners container is a separate config layer; if JS allowlists are not honored from container env alone, `/etc/n8n-task-runners.json` becomes the explicit control point

## 3. Problem statement

The current repo contract for n8n JS is structurally incompatible with the supported Task Runner model:
- repo and docs standardize on runtime filesystem imports from `/data/...`
- n8n Task Runners support built-ins plus allowlisted external modules from `n8n/node_modules`
- package/module availability and allowlists must be satisfied on the runners

As a result, reusable JS blocks must move from path-based runtime imports to a package-based runtime model.

This is not a general cleanup initiative. It is specifically:
- a package/runtime distribution problem
- a sync and cutover problem
- a repo-contract and documentation problem

## 4. Goals

1. Preserve extracted JS blocks as separate files.
2. Keep the current `< 50` inline / `>= 50` externalized rule.
3. Make externalized Code-node JS compatible with n8n Task Runners.
4. Standardize one private internal package model for n8n runtime JS.
5. Allow selective reuse of `src/libs/**` from n8n runtime code.
6. Define a supported runtime distribution path to the Pi.
7. Preserve repo-first config and operator apply workflow.
8. Update governing docs in the same initiative.
9. Require smoke tests to execute successfully and cover key flows.
10. Preserve a viable rollback path.

### Success criteria
- canonical workflows no longer contain runtime imports from `/data/src/n8n/...` or `/data/src/libs/...`
- reusable JS remains externalized in repo-owned files
- Task Runners can execute migrated JS through package imports
- sync no longer rewrites wrappers to canonical `/data/...` runtime paths
- docs are updated to reflect the new model
- Pi deployment can be rebuilt and validated through a documented operator flow
- manual `n8n` recreate flow also rebuilds the local runners image before bringing up `task-runners`
- runners launcher config explicitly carries JS Code-node allowlists for external mode

## 5. Non-goals

- redesigning workflow business logic
- redesigning backend API contracts
- redesigning database schema unless later proven necessary
- replacing `src/n8n/workflows/**` as workflow source of truth
- replacing the solution with custom n8n nodes
- moving secrets into repo
- introducing ad hoc host-local config as the main authored surface
- publishing a public npm package
- maintaining long-term dual support for both `/data/...` imports and package-based imports

## 6. Constraints and invariants

### 6.1 Repo and source-of-truth invariants
- `src/n8n/workflows/**` remains the canonical workflow source-of-truth surface.
- Canonical authoring source for reusable n8n JS remains repo-owned.
- Non-secret config remains repo-authored first.
- Host-local files remain for secrets, credentials, runtime-mutable state, and persistent service data only.

### 6.2 Runtime import invariant
After cutover, path-based runtime imports from:
- `/data/src/n8n/...`
- `/data/src/libs/...`

are forbidden.

### 6.3 Task-runner deployment invariant
- Target architecture remains external Task Runners.
- `n8n` and `n8n-runners` must be pinned to the same exact version.
- Initial exact target pin: `2.10.3`.

### 6.4 Dependency invariant
- Any runtime JS dependency used by Code nodes must be available in the runners image.
- Any allowed third-party package must be explicitly allowlisted on the Task Runners.
- Reuse of `src/libs/**` is allowed and expected, but anything reachable from n8n runtime code must be staged into the package/runtime dependency graph intentionally.

### 6.5 Operational invariant
- Operator flow remains explicit: repo changes first, then `checkcfg` / `updatecfg`.
- If the migration introduces a new config surface, it must be added to `docs/config_operations.md`.

### 6.6 Proxy/runtime invariant
The runtime model must continue to support reverse proxy operation and document:
- `WEBHOOK_URL`
- `N8N_PROXY_HOPS=1`

### 6.7 Failure semantics invariant
Workflows remain fail-fast unless a PRD explicitly documents an exception.

### 6.8 Cutover invariant
- Single hard cutover only
- No dual-mode compatibility window

## 7. Target operating model

Target runtime model:
- workflows stay in `src/n8n/workflows/**`
- source JS stays in canonical source trees (`src/n8n/nodes/**` and selected `src/libs/**`)
- package runtime output is generated into `src/n8n/package/`
- workflow wrappers import from package root (`@igasovic/n8n-blocks`) via named root exports
- external Task Runners execute Code-node JS
- custom runners image contains the internal package and required third-party dependencies
- `n8n` and `n8n-runners` are pinned to `2.10.3`
- sync no longer emits or validates `/data/...` runtime imports
- package/runtime model is the only supported post-cutover model

Important clarification:
- the repo mount may still exist for non-runtime reasons
- it is not part of the runtime code import contract after migration

## 8. Package model

### 8.1 Package root and role
Use:
- `src/n8n/package/`

This is a generated build/staging package assembled from canonical source under:
- `src/n8n/nodes/**`
- selected reusable modules under `src/libs/**`

It is not the primary authoring surface.

### 8.2 Git treatment
For now:
- `src/n8n/package/` is build-generated and ignored

### 8.3 Package scope
The package contains:
- reusable JS currently externalized for Code nodes
- stable exports for workflow/domain-specific JS blocks
- staged copies or exports of whitelisted `src/libs/**` modules
- package metadata and runtime dependencies

The package does not contain:
- workflow JSON
- docs
- sync scripts
- stack files

### 8.4 Package name
Use one private internal package, e.g.:
- `@igasovic/n8n-blocks`

One package is preferred over many packages.

### 8.5 API/export rule
The package must expose stable logical paths.
Runtime imports must not depend on UUID-suffixed filenames.
Canonical wrapper export naming is `wf<NN><NodeName>` (for example `wf10CommandParser`).

### 8.6 Versioning policy
Internal package versioning convention:
- patch bump (`0.2.5 -> 0.2.6`) for any package change
- minor bump (`0.2.5 -> 0.3.0`) for introduction of a new workflow with a new node set / exported surface
- major bump (`0.x.y -> 1.0.0`) only by explicit decision

## 9. Dependency policy and `src/libs` relationship

### 9.1 Core decision
`src/libs/**` reuse is allowed and expected.

### 9.2 Handling model
`src/libs/**` remains source-of-truth source code, but not a runtime import path.
The build process stages only whitelisted libs into the generated package.

### 9.3 Selective whitelist rule
Do not shove all of `src/libs/**` into the package.
Only explicitly approved libs are staged into `src/n8n/package/`.

A rule must be added to n8n docs that:
- if another lib is needed later, it must be explicitly added to package metadata / package assembly config
- runtime use of a new lib is not automatic

### 9.4 Third-party dependency rule
Any third-party npm dependency reachable from staged code must:
- be declared explicitly
- be installed into the custom runners image
- be allowlisted on the Task Runners if required

### 9.5 Config-specific caution
`src/libs/config.js` and `src/libs/config/**` require explicit validation if they are used from n8n runtime code.
The coding agent must confirm that any config-related usage is safe inside Task Runners before carrying it over.

### 9.6 Expected examples
A likely whitelisted example is Telegram Markdown helpers.
Both externalized and non-externalized nodes may continue using approved shared helpers.

## 10. Runtime distribution model

### 10.1 Target delivery mechanism
Use a custom runners image derived from:
- `n8nio/runners:2.10.3`

Implemented image/tag:
- local runtime image: `pkm-n8n-runners:2.10.3`
- repo Dockerfile: `ops/stack/n8n-runners/Dockerfile`

This image owns:
- installation of the generated internal package
- installation of third-party npm dependencies required by that package
- runner-side module allowlist configuration

### 10.2 Exact version pin
Lock explicitly:
- main n8n image: `docker.n8n.io/n8nio/n8n:2.10.3`
- runners base image: `n8nio/runners:2.10.3`

No floating tags.
No `latest`.
No independent runner version bumps.

### 10.3 Main image rule
The main n8n image is the `n8nio/n8n` application container.
The package should not be installed there unless later validation proves it necessary.
Default assumption: runtime package lives in the runners image only.

### 10.4 Compose/env ownership rule
Repo-managed runtime surfaces for this migration live under:
- `ops/stack/docker-compose.yml`
- `ops/stack/env/n8n.env`
- any new repo-owned Dockerfile/build context under `ops/stack/**`

### 10.5 Runner allowlist rule
JS built-in and external package allowlists belong on the Task Runners.
They must not rely solely on main n8n container env.

### 10.6 Reverse proxy rule
Target runtime must document and preserve:
- `WEBHOOK_URL`
- `N8N_PROXY_HOPS=1`

## 11. Developer workflow

### 11.1 Workflow wiring changes
No major change in principle:
1. edit workflow wiring in n8n UI
2. export/sync workflow JSON into repo
3. commit workflow changes

### 11.2 JS code changes
New flow:
1. edit source under canonical trees
2. build/generate `src/n8n/package/`
3. bump package version according to repo convention
4. rebuild custom runners image
5. update Pi runtime
6. validate smoke flows and targeted workflows
7. commit code + workflow + doc/config changes together

### 11.3 Externalization threshold
Keep current rule exactly:
- `< 50` non-empty lines: inline
- `>= 50` non-empty lines: externalize

### 11.4 Authoring rules after migration
- no runtime imports from `/data/...`
- no relative repo traversal imports from runtime code
- stable package export paths
- thin wrappers allowed, but wrappers call package imports only
- `src/libs/**` reuse allowed only through the staged package model

### 11.5 Script categories required
The migration must introduce or update scripts for:
1. package assembly/validation
2. custom runners image build
3. Pi apply/redeploy flow
4. sync normalization / wrapper rewrite / validation

## 12. Operator workflow and sync/cutover model

### 12.1 Operator workflow
Keep the current operator contract:
- agent changes repo-owned surfaces first
- operator verifies with `checkcfg`
- operator applies with `updatecfg --push`

Implemented apply surfaces:
- `n8n`
- `docker`

Implemented apply order when both surfaces changed:
1. `updatecfg docker --push`
2. `updatecfg n8n --push`

### 12.2 Redeploy flow
Implemented n8n redeploy path:
- `updatecfg n8n --push` via `scripts/n8n/sync_workflows.sh`
- build generated package
- build local runners image
- recreate `n8n` and `n8n-runners`
- patch workflows in-place
- validate live export

Implemented convenience redeploy entrypoints:
- `scripts/redeploy backend`
- `scripts/redeploy n8n`

Both redeploy targets pull the repo first, then delegate to the canonical backend/n8n deploy helpers rather than duplicating apply logic.

### 12.3 Cutover posture
- single hard cutover
- no dual mode
- post-cutover canonical workflows must not contain `/data/src/n8n/...` or `/data/src/libs/...` runtime imports

### 12.4 Sync behavior after migration
Sync should continue to:
- export and normalize workflows
- preserve the `< 50` inline / `>= 50` externalize rule

Sync must stop doing:
- canonicalizing wrappers to `/data/src/n8n/nodes/...`
- validating `/data/...` runtime paths as canonical

Sync must start doing:
- generating package-based wrappers/import behavior only
- validating that forbidden `/data/...` runtime imports do not appear in canonical workflows

### 12.5 Cutover phases
1. dependency and import inventory
2. package scaffold and assembly
3. runners image build/distribution setup
4. sync tooling rewrite
5. workflow import rewrite
6. Pi deployment cutover on pinned `2.10.3`
7. legacy `/data/...` assumption cleanup in docs and tooling

### 12.6 Post-cutover operator validation
Cutover is only complete when:
- `checkcfg n8n` passes
- `checkcfg docker` passes
- `n8n` and runners are pinned to `2.10.3`
- canonical workflows do not reintroduce `/data/...` imports
- smoke tests execute successfully
- representative flows execute successfully on the Pi

Operator helper for this phase:
- `./scripts/n8n/validate_cutover.sh`
- `./scripts/n8n/validate_cutover.sh --with-smoke`

Completion evidence (2026-03-20):
- `checkcfg docker` and `updatecfg docker --push` reached clean state for managed docker surfaces, including runners launcher config.
- `checkcfg n8n` and `updatecfg n8n --push` succeeded with runtime package build, custom runners image rebuild, stack recreate, and workflow patch/validation.
- `./scripts/n8n/validate_cutover.sh` passed with pinned images and running `n8n` + `n8n-runners`.
- runtime execution validated with package-root wrappers (`require('@igasovic/n8n-blocks')`) across canonical workflows.
- smoke flow resumed after migration and representative runtime paths executed successfully.

## 13. Config surface and documentation impact

### 13.1 Changed config surfaces
This migration changes at least:
- `src/n8n/**`
- `scripts/n8n/**`
- `ops/stack/docker-compose.yml`
- `ops/stack/env/n8n.env`

It also introduces at least one new repo-owned surface:
- `src/n8n/package/`
- custom runners image build surface under `ops/stack/**`

### 13.2 Required document updates
Must be updated in the same initiative:
- `AGENTS.md`
- `docs/env.md`
- `docs/n8n_sync.md`
- `docs/n8n_node_style_guide.md`
- `docs/config_operations.md`
- `docs/requirements.md` (must note that this PRD is being implemented)

### 13.3 Likely document updates
Likely to change:
- `docs/repo-map.md`
- optionally `docs/changelog.md`

### 13.4 No-change docs unless scope expands
Should stay unchanged unless later decisions force them in:
- `docs/api.md`
- `docs/database_schema.md`
- `docs/requirements.md` beyond the implementation-status note

### 13.5 Operator apply surfaces
Expected operator surfaces:
- `n8n`
- `docker`

## 14. Validation and test strategy

### 14.1 Package validation
Require validation that:
- package generation/build succeeds
- exports resolve cleanly
- version bump policy is followed
- staged `src/libs/**` dependencies are satisfied

### 14.2 Runner image validation
Require validation that:
- custom runners image builds from pinned base `2.10.3`
- internal package is installed correctly
- required third-party dependencies are present
- runner-side allowlist config is correct

### 14.3 Sync validation
Require validation that:
- sync still respects the `< 50` inline / `>= 50` externalize rule
- sync no longer writes or preserves `/data/...` runtime imports
- canonical workflows contain only allowed package-based imports after cutover

### 14.4 Runtime validation on Pi
Require validation that:
- `n8n` stays up
- `n8n-runners` stays up
- editor works through reverse proxy
- reverse-proxy settings remain correct

### 14.5 Smoke tests
Smoke tests must execute successfully.
They must cover key flows this system treats as health-critical.

### 14.6 Documentation validation
Migration is incomplete unless:
- old `/data/...` runtime guidance is removed from relevant docs
- `AGENTS.md` and `docs/config_operations.md` reflect new surfaces/rules
- `docs/env.md` reflects actual runtime topology and pinned version

### 14.7 Repo quality gate
Run the repo quality gate before commit.
Migration-aligned n8n tests should resolve canonical nodes by stable workflow slug and stable node stem or workflow node name, not by UUID-suffixed filenames.

## 15. Migration phases

### Phase 0 â inventory and freeze
- inventory all externalized n8n JS
- inventory all `src/libs/**` imports reachable from n8n runtime code
- inventory all third-party npm dependencies reachable from that graph
- freeze target runtime pin at `2.10.3`

### Phase 1 â package scaffold
- create generated package model rooted at `src/n8n/package/`
- define package metadata, exports, and versioning policy

### Phase 2 â dependency integration
- define whitelist of allowed `src/libs/**`
- stage only approved libs into the package
- validate third-party dependency ownership

### Phase 3 â runner distribution
- create custom runners image build path from `n8nio/runners:2.10.3`
- install generated package into runner image
- define runner allowlist/config

### Phase 4 â sync/tooling rewrite
- update `scripts/n8n/**`
- replace `/data/...` canonicalization with package-based canonicalization
- preserve `>= 50` rule

### Phase 5 â workflow import rewrite
- update canonical workflows to package imports
- preserve thin-wrapper model where appropriate
- preserve inline nodes under threshold

### Phase 6 â Pi cutover
- update compose/env/runtime surfaces
- deploy pinned `2.10.3` main image and matching runners image
- validate editor, runners, smoke tests, and key flows

### Phase 7 â cleanup
- remove legacy `/data/...` assumptions from docs and tooling
- update config registry
- close migration-specific TODOs

## 16. Rollback and recovery

Rollback can be executed by:
- rolling back repo changes
- restoring database from `2026-03-15`
- returning installation to `2.2.6`
- in whatever order the operator judges appropriate

The PRD does not need to prescribe the exact operational order beyond these required rollback surfaces.

## 17. Work packages

Each work package should include:
- goal
- PRD section references
- files/surfaces touched
- validation required
- explicit out-of-scope notes

Recommended work packages:

### WP1 â Package scaffold
- create generated package model under `src/n8n/package/`
- define package metadata and export strategy

### WP2 â `src/libs` whitelist inventory
- inventory reused libs
- define approved whitelist
- identify third-party dependencies reachable from approved libs

### WP3 â Package assembly pipeline
- assemble package from `src/n8n/nodes/**` and whitelisted `src/libs/**`
- generate package metadata
- enforce stable exports

### WP4 â Runner image path
- define custom runners image build strategy
- install generated package into runners image
- define runner allowlist/config surface

### WP5 â Sync rewrite
- update `scripts/n8n/**`
- remove `/data/...` canonicalization
- preserve `>= 50` rule
- add forbidden-path validation

### WP6 â Workflow rewrite
- update canonical workflow wrappers/imports
- validate no forbidden path-based runtime imports remain

### WP7 â Redeploy flow
- update redeploy script
- support `redeploy backend`
- support `redeploy n8n`

### WP8 â Doc and config-surface updates
- update `AGENTS.md`
- update `docs/env.md`
- update `docs/n8n_sync.md`
- update `docs/n8n_node_style_guide.md`
- update `docs/config_operations.md`
- update `docs/requirements.md`

### WP9 â Pi cutover validation (complete)
- validate runtime pin `2.10.3`
- validate runners sidecar
- validate proxy settings
- validate smoke tests and key flows

## 18. TBD / open questions

Open items that should remain explicit rather than guessed:

1. resolved with a root-wrapper standard: workflow wrappers call stable package-root exports from `@igasovic/n8n-blocks`; shared helper subpaths remain internal to externalized node files, and the unscoped alias is fallback-only
2. resolved: custom runners Dockerfile lives at `ops/stack/n8n-runners/Dockerfile`
3. resolved for current scope: `src/libs/config.js` and `src/libs/config/index.js` are reused as staged shared modules without a special wrapper
4. resolved for current scope: main `n8n` image does not install the internal package; runners own runtime execution dependencies
5. resolved: the repo mount `/data` may remain for non-runtime purposes only and is not part of the code import contract
6. resolved for current program boundary: `src/n8n/nodes/**` remains canonical; any reorganization is out of scope for this migration and requires a separate PRD

## Validation basis

This PRD shape and runtime model are grounded in:
- repo docs and governance files, especially:
  - `AGENTS.md`
  - `docs/config_operations.md`
  - `docs/env.md`
  - `docs/n8n_sync.md`
  - `docs/n8n_node_style_guide.md`
- official n8n docs confirming:
  - Task Runners are the execution model for Code nodes
  - internal mode is not recommended for production
  - external mode uses a separate `n8nio/runners` sidecar
  - `n8nio/runners` version must match `n8nio/n8n`
  - external modules come from `n8n/node_modules`
  - allowlists belong on Task Runners when runners are enabled
  - reverse-proxy deployments should set `WEBHOOK_URL` and `N8N_PROXY_HOPS=1`
