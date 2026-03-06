# n8n <-> Git Sync

Canonical process for syncing n8n workflows and externalized Code-node JS with this repo.

Canonical repo locations:
- Workflows: `src/n8n/workflows`
- Externalized code nodes: `src/n8n/nodes`

## One command

Run from repo root:

```bash
./scripts/n8n/sync_workflows.sh
```

Modes:
- `--mode pull` (default): n8n -> repo (export/normalize + externalize code nodes)
- `--mode push`: repo -> n8n in-place API patch (no delete/import)
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

## Flow (orchestrated)

1. Export workflows from n8n and normalize into `src/n8n/workflows/`.
2. Export raw workflows (for import-safe patching with metadata like `id`/`versionId`).
3. Sync Code nodes in repo:
   - externalize only Code nodes with `>= MIN_JS_LINES`
   - keep short Code nodes inline in workflow JSON
   - move node JS to the correct `src/n8n/nodes/<workflow-slug>/` folder when workflow/node location changed
   - update wrappers to canonical `/data/src/n8n/nodes/...` paths
   - remove orphan managed canonical files (`*__<node-id>.js`) under `src/n8n/nodes/`
4. Push mode patches existing workflows in-place via n8n API (`PATCH`, fallback `PUT`).
5. Commit changes only if `--commit` is set.

## Safety rules

- Compose guard: reads `docker-compose.yml` (default `/home/igasovic/stack/docker-compose.yml`, override via `COMPOSE_FILE`) and requires n8n mount:
  - `/home/igasovic/repos/n8n-workflows:/data:ro`
- No automatic workflow deletion in n8n.
- Node relocation is move/copy-first to avoid losing existing code.
- Legacy wrapper paths `/data/js/workflows/...` are forbidden in canonical repo workflows.
- Externalized code-node imports must not use relative repo paths like `../../../src/...`.
  Use absolute mount paths (for example `require('/data/src/libs/config.js')`) so runtime resolution is stable inside the n8n container.

## Bridge Cutover (safe)

Use one command to remove legacy bridge dependency safely:

```bash
./scripts/n8n/cutover_remove_bridges.sh
```

What it does:
1. Runs existing DB backup script (`scripts/db/backup.sh daily` by default).
2. Snapshots live n8n workflows before cutover.
3. Runs full sync (`pull + push + recreate`) with live no-legacy validation.
4. Removes local legacy bridge files under `js/workflows`.
5. Verifies no `/data/js/workflows/...` references remain in repo workflows.

Optional commit:

```bash
./scripts/n8n/cutover_remove_bridges.sh --commit
```

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
- `scripts/n8n/export_workflows.sh`
- `scripts/n8n/normalize_workflows.sh`
- `scripts/n8n/rename_workflows_by_name.sh`
- `scripts/n8n/sync_code_nodes.py`
- `scripts/n8n/cutover_remove_bridges.sh`
- `scripts/n8n/remove_legacy_bridges.py`
- `scripts/n8n/import_workflows.sh`
- `scripts/n8n/activate_workflows.sh`
