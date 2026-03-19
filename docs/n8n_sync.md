# n8n <-> Git Sync

Canonical process for syncing n8n workflows and externalized Code-node JS with this repo.

Canonical repo locations:
- Workflows: `src/n8n/workflows`
- Externalized code nodes: `src/n8n/nodes`
- Runtime package manifest: `src/n8n/package.manifest.json`
- Generated runtime package: `src/n8n/package` (build output, ignored)

## One command

Run from repo root:

```bash
./scripts/n8n/sync_workflows.sh
```

Modes:
- `--mode pull` (default): n8n -> repo (export/normalize + externalize code nodes)
- `--mode push`: build runtime package + runners image, recreate n8n/runners, patch repo workflows to n8n in-place
- `--mode full`: pull + push

Push local workflow node/wiring changes to n8n in-place (no delete/import):

```bash
./scripts/n8n/sync_workflows.sh --mode push
```

Patch only specific workflows by exact workflow name:

```bash
./scripts/n8n/sync_workflows.sh --mode push --workflow-name "10 Read"
```

Optional commit:

```bash
./scripts/n8n/sync_workflows.sh --commit
```

Optional threshold override for `pull/full` (default is `50` non-empty lines):

```bash
MIN_JS_LINES=80 ./scripts/n8n/sync_workflows.sh --mode pull
```

## Git -> n8n usage (future operations)

Use these modes depending on intent:

1. Normal repo -> n8n update:
```bash
./scripts/n8n/sync_workflows.sh --mode push
```

2. Reconcile drift (pull then push):
```bash
./scripts/n8n/sync_workflows.sh --mode full
```

3. Patch one workflow only:
```bash
./scripts/n8n/sync_workflows.sh --mode push --workflow-name "10 Read"
```

4. Rebuild the custom runners image and recreate `n8n` + `task-runners` without patching workflows:
```bash
./scripts/n8n/recreate_stack.sh
```

5. Convenience redeploy wrapper (pull repo first, then push n8n changes):
```bash
./scripts/redeploy n8n
```

6. Validate the cutover/runtime state on the Pi:
```bash
./scripts/n8n/validate_cutover.sh
```

The runners launcher config is repo-managed at:
- `ops/stack/n8n-runners/n8n-task-runners.json`

It is mounted into the runners container at:
- `/etc/n8n-task-runners.json`

Keep both launcher entries present:
- `runner-type: javascript`
- `runner-type: python`

7. Validate and execute smoke in one go:
```bash
./scripts/n8n/validate_cutover.sh --with-smoke
```

8. Run the smoke master from the Pi shell directly:
```bash
./scripts/n8n/run_smoke.sh
```

Prerequisites in current shell:
```bash
export N8N_API_BASE_URL='http://127.0.0.1:5678'
export N8N_API_KEY='...'
```

Node runtime note:
- n8n operator scripts use local `node`/`nodejs` when available.
- If host Node is absent, runtime package builds fall back to a short-lived `node:22-bookworm-slim` Docker container.
- Override explicitly with `NODE_BIN=/path/to/node` if needed.

Persist once in `~/.zshrc` (recommended) so `--mode push/full` works without re-exporting each shell.

Quick auth check:
```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_BASE_URL/api/v1/workflows?limit=1"
```

Expected: `HTTP 200`.

Avoid:
- direct DB edits for workflow state
- relative externalized imports like `../../../src/...`
- `/data/src/...` runtime imports in canonical workflows or externalized node code

## Flow (orchestrated)

1. Export workflows from n8n and normalize into `src/n8n/workflows/`.
2. Export raw workflows (for import-safe patching with metadata like `id`/`versionId`).
3. Sync Code nodes in repo:
   - externalize only Code nodes with `>= MIN_JS_LINES`
   - keep short Code nodes inline in workflow JSON
   - move node JS to the correct `src/n8n/nodes/<workflow-slug>/` folder when workflow/node location changed
   - update wrappers to canonical package imports under `@igasovic/n8n-blocks/nodes/...`
- package-root exports under `@igasovic/n8n-blocks` are allowed only as a compatibility escape hatch when n8n disallows deep package subpath imports
  - when external task runners do not honor Code-node allowlists from container env alone, prefer the launcher config file at `ops/stack/n8n-runners/n8n-task-runners.json` over ad hoc runtime edits
   - remove orphan managed canonical files (`*__<node-id>.js`) under `src/n8n/nodes/`
4. Push mode builds `src/n8n/package/` from `src/n8n/package.manifest.json`.
5. Push mode builds the local `pkm-n8n-runners:2.10.3` image from `ops/stack/n8n-runners/Dockerfile`.
6. Push mode recreates `n8n` and `n8n-runners`.
7. Push mode patches existing workflows in-place via n8n API (`PATCH`, fallback `PUT`).
8. Commit changes only if `--commit` is set.

## Safety rules

- No automatic workflow deletion in n8n.
- Node relocation is move/copy-first to avoid losing existing code.
- Non-canonical wrapper paths are forbidden in canonical repo workflows.
- Canonical runtime imports should use `@igasovic/n8n-blocks/nodes/...` or `@igasovic/n8n-blocks/shared/...` by default.
- Package-root imports from `@igasovic/n8n-blocks` are allowed only as a compatibility escape hatch for n8n allowlist/runtime issues.
- A targeted unscoped alias, `igasovic-n8n-blocks`, is currently allowed only for workflow-10 compatibility testing against stricter n8n external-module gating.
- `/data/...` runtime imports are forbidden after the package migration. The repo mount may remain for non-runtime purposes, but it is not part of the code import contract.

## Change logs emitted by sync

During node sync, script prints:

- `Workflows created`
- `Workflows updated`
- `Nodes added`
- `Nodes updated`
- `Nodes moved`
- `Nodes deleted`

## Scripts location

All workflow-management scripts live under `scripts/n8n/`:

- `scripts/n8n/sync_workflows.sh` (entrypoint)
- `scripts/n8n/sync_nodes.py`
- `scripts/n8n/build_runtime_package.js`
- `scripts/n8n/build_runtime_package.sh`
- `scripts/n8n/build_runners_image.sh`
- `scripts/n8n/recreate_stack.sh`
- `scripts/n8n/validate_cutover.sh`
- `scripts/n8n/run_smoke.sh`
- `scripts/n8n/export_workflows.sh`
- `scripts/n8n/normalize_workflows.sh`
- `scripts/n8n/rename_workflows_by_name.sh`
- `scripts/n8n/sync_code_nodes.py`

Archived (do not use for normal operations):
- `scripts/archive/n8n/import_workflows.sh`
- `scripts/archive/n8n/activate_workflows.sh`
