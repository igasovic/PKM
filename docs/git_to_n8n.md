# Git -> n8n (workflow + code sync)

Use the orchestrated sync script when you want repo and n8n to converge safely.

## Canonical command

```bash
./scripts/n8n/sync_workflows.sh
```

Optional commit:

```bash
./scripts/n8n/sync_workflows.sh --commit
```

## When to use this

- You changed workflow structure in n8n UI and want repo aligned.
- You moved or renamed nodes/workflows and need external JS paths corrected.
- You want orphan cleanup in `js/workflows/` without deleting workflows in n8n.

## Behavior notes

- Uses raw export + import cycle for n8n-safe updates (`id`, `versionId` preserved for import).
- Externalizes only Code nodes with `>= 50` non-empty lines (`MIN_JS_LINES` override available).
- Short Code nodes remain inline in workflow JSON.
- Import step overwrites existing workflows but does not auto-delete workflows from n8n.
- Final export/normalize step ensures `workflows/` matches n8n post-import.

## Legacy commands

These still work as wrappers and delegate to `scripts/n8n/*`:
- `./scripts/export_workflows.sh`
- `./scripts/normalize_workflows.sh`
- `./scripts/rename_workflows_by_name.sh`
