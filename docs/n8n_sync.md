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

Prerequisites in current shell:
```bash
export N8N_API_BASE_URL='http://127.0.0.1:5678'
export N8N_API_KEY='...'
```

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
- Non-canonical wrapper paths are forbidden in canonical repo workflows.
- Externalized code-node imports must not use relative repo paths like `../../../src/...`.
  Use absolute mount paths (for example `require('/data/src/libs/config.js')`) so runtime resolution is stable inside the n8n container.

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

Archived (do not use for normal operations):
- `scripts/archive/n8n/import_workflows.sh`
- `scripts/archive/n8n/activate_workflows.sh`
