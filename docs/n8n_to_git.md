# n8n -> Git (canonical sync flow)

This is the canonical flow for keeping workflow JSON and external Code-node JS in sync between n8n and this repo.

Repo root (Pi):
- `/home/igasovic/repos/n8n-workflows`

## One command

Run from repo root:

```bash
./scripts/n8n/sync_workflows.sh
```

Optional auto-commit:

```bash
./scripts/n8n/sync_workflows.sh --commit
```

## What the script does (in order)

1. Export workflows from n8n and normalize them in `workflows/`.
2. Export raw workflows (with `id`/`versionId`) for patch/import.
3. Sync Code nodes in repo:
   - Externalize only Code nodes with `>= 50` non-empty JS lines.
   - Keep short Code nodes inline in workflow JSON.
   - Move external JS files to the correct workflow folder when nodes moved.
   - Update wrappers to the correct `/data/js/workflows/...` path.
   - Remove orphan files from `js/workflows/` after all workflows are processed.
4. Import patched raw workflows back to n8n (overwrite existing workflows only).
5. Export + normalize again to ensure repo reflects n8n post-import state.
6. Restart `n8n` container.
7. Commit `workflows/` and `js/workflows/` only when `--commit` is provided.

## Safety rules enforced by the script

- Mount path guard: script validates `docs/env.md` contains `/home/igasovic/repos/n8n-workflows` mounted to `/data` before patching wrappers.
- No automatic workflow deletes in n8n: import uses `n8n import:workflow` per raw workflow (overwrite/update only).
- Node relocation is move-first: existing JS is moved to the new folder/path when possible, not dropped/recreated.

## Script locations

All n8n workflow-management scripts live under:
- `scripts/n8n/`

Main entrypoint:
- `scripts/n8n/sync_workflows.sh`

Helpers:
- `scripts/n8n/export_workflows.sh`
- `scripts/n8n/normalize_workflows.sh`
- `scripts/n8n/rename_workflows_by_name.sh`
- `scripts/n8n/sync_code_nodes.js`
- `scripts/n8n/import_workflows.sh`

Compatibility wrappers remain at:
- `scripts/export_workflows.sh`
- `scripts/normalize_workflows.sh`
- `scripts/rename_workflows_by_name.sh`

These wrappers delegate to `scripts/n8n/*`.

## Tuning

- Minimum JS lines for externalization:
  - env var `MIN_JS_LINES` (default `50`)

Example:

```bash
MIN_JS_LINES=80 ./scripts/n8n/sync_workflows.sh
```
