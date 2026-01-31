# Git → n8n (when editing via VSCode)

This describes what’s possible today given your setup:
- Your repo stores **normalized workflow JSON** for clean diffs.
- n8n **imports require raw metadata** (`id`, `versionId`, etc).
- Therefore: **workflow structure edits are best done in n8n UI**, while **logic edits happen in external JS** via Git/VSCode.

If you only change external JS files, you *do* have a clean “Git → n8n” loop.

---

## Case 1 — You changed external JS (recommended workflow)

### 1) Edit on your laptop
- Open repo in VSCode/Cursor
- Edit files under:
  - `js/workflows/<workflow-slug>/*.js`
  - optionally `js/shared/*.js`

### 2) Commit + push (laptop)
```bash
git checkout -b feat/<change>
git add js/
git commit -m "<summary>"
git push -u origin HEAD
```
Open a GitHub PR and review.

### 3) Pull on the Pi
```bash
cd /home/igasovic/repos/n8n-workflows
git pull
```

### 4) Ensure n8n sees updated code
Because Code nodes use `require('/data/js/...')`, the container reads files from the mounted repo.

Two safe options:

**Option A (usually enough): just execute the node/workflow**
- Many n8n Code-node runs are isolated, but module caching can vary.
- If your changes don’t show up, use Option B.

**Option B (guaranteed): restart n8n container**
```bash
cd /home/igasovic/stack
docker compose restart n8n
```

### 5) Test
- In n8n UI, execute the workflow/node.
- If it fails, the error prefix shows the exact file:
  - `[extjs:<workflow-slug>/<file>.js] ...`

---

## Case 2 — You want to change workflow structure in Git (not recommended right now)

### Why it’s hard
- Git-tracked `workflows/*.json` are normalized and **missing required fields** (like `versionId`).
- Importing normalized JSON causes DB constraint errors.

### What to do instead (today)
- Do structural edits in **n8n UI**
- Export to Git with:
  - `./scripts/export_workflows.sh`

### If you *must* apply a structure change programmatically
You need a raw workflow JSON as a base:
1) raw export from n8n (`n8n export:workflow --id=...`)
2) apply your transformation to that raw JSON
3) import raw JSON back

This is exactly the pattern used by `scripts/migrate/patch_workflow_use_external_js.py`.

---

## Practical rule of thumb
- **Workflow graph/structure**: edit in n8n UI → export → PR review.
- **Logic (JS/SQL)**: edit in VSCode → git push → pull on Pi → (restart if needed) → test in n8n.
