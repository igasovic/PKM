# n8n <-> Git Sync

Canonical process for syncing n8n workflows and externalized Code-node JS with this repo.

## One command

Run from repo root:

```bash
./scripts/n8n/sync_workflows.sh
```

Optional commit:

```bash
./scripts/n8n/sync_workflows.sh --commit
```

Optional threshold override (default is `50` non-empty lines):

```bash
MIN_JS_LINES=80 ./scripts/n8n/sync_workflows.sh
```

## Flow (orchestrated)

1. Export workflows from n8n and normalize into `workflows/`.
2. Export raw workflows (for import-safe patching with metadata like `id`/`versionId`).
3. Sync Code nodes in repo:
   - externalize only Code nodes with `>= MIN_JS_LINES`
   - keep short Code nodes inline in workflow JSON
   - move node JS to the correct `js/workflows/<workflow-slug>/` folder when workflow/node location changed
   - update wrappers to correct `/data/js/workflows/...` paths
   - remove orphan managed node files (`*__<node-id>.js`) after all workflows are processed
4. Import patched raw workflows back into n8n (overwrite existing workflows only).
5. Export + normalize again so repo matches post-import n8n state.
6. Restart `n8n` container.
7. Commit changes only if `--commit` is set.

## Safety rules

- Compose guard: reads `docker-compose.yml` (default `/home/igasovic/stack/docker-compose.yml`, override via `COMPOSE_FILE`) and requires n8n mount:
  - `/home/igasovic/repos/n8n-workflows:/data:ro`
- No automatic workflow deletion in n8n.
- Node relocation is move-first to avoid losing existing code.

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
- `scripts/n8n/export_workflows.sh`
- `scripts/n8n/normalize_workflows.sh`
- `scripts/n8n/rename_workflows_by_name.sh`
- `scripts/n8n/sync_code_nodes.js`
- `scripts/n8n/import_workflows.sh`
