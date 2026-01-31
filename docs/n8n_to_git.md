# n8n → Git (new workflow + updated workflow)

This is the canonical flow for keeping your GitHub repo as the reviewable “source of truth” **for workflow definitions + externalized Code node JS**, without committing secrets/runtime state.

Repo root (Pi):
- `/home/igasovic/repos/n8n-workflows`

Key ideas:
- **Workflow JSON in Git is normalized** for clean diffs (IDs/metadata stripped).
- **Code/SQL lives in external JS files** under `js/workflows/<workflow-slug>/` and is mounted into the n8n container at `/data/js`.
- **Export is authoritative**: Git should reflect what’s currently in n8n after each UI change.

---

## Prereqs (one-time)

### A) Container settings for external JS
In `docker-compose.yml` for the `n8n` service:

- volume mount:
  - `/home/igasovic/repos/n8n-workflows/js:/data/js:ro`

- env allowlist:
  - `NODE_FUNCTION_ALLOW_EXTERNAL=*`
  - `NODE_FUNCTION_ALLOW_BUILTIN=node:process,node:path`

Restart n8n after changing compose.

### B) Export pipeline scripts (already in repo)
- `./scripts/export_workflows.sh`
  - exports workflows from n8n
  - copies them into `workflows/`
  - renames to stable filenames (`<slug(name)>__<id>.json`)
  - normalizes JSON for clean diffs

---

## Case 1 — New workflow created in n8n UI

### 1) Create workflow in n8n UI
- Create new workflow
- Add nodes, test, **Save**

### 2) Export to repo (Pi)
```bash
cd /home/igasovic/repos/n8n-workflows
./scripts/export_workflows.sh
```

### 3) Review what changed
```bash
git status
git diff --stat
```

### 4) Commit + push (Pi)
```bash
git add workflows/
git commit -m "Add workflow: <workflow name>"
git push
```

### 5) (Optional but recommended) Externalize Code nodes for clean diffs
If the workflow has **Code** nodes with non-trivial JS/SQL:
- externalize the code into `js/workflows/<workflow-slug>/...`
- replace the Code node’s JS with the one-line wrapper calling `require('/data/js/...')`

Then:
```bash
git add js/workflows/<workflow-slug>/
git commit -m "Externalize <workflow name> Code node logic"
git push
```

---

## Case 2 — Update an existing workflow (n8n UI changes)

### 1) Make changes in n8n UI
- Add/edit nodes, test, **Save**

### 2) Export to repo (Pi)
```bash
cd /home/igasovic/repos/n8n-workflows
./scripts/export_workflows.sh
```

### 3) Review diffs (Pi)
```bash
git diff
```

### 4) Commit + push
```bash
git add workflows/
git commit -m "Update workflow: <workflow name>"
git push
```

---

## Externalizing Code nodes (manual, per node)

Use this wrapper inside a Code node (single line):

```js
try{const fn=require('/data/js/workflows/<workflow-slug>/<file>.js');return await fn({$input,$json,$items,$node,$env,helpers});}catch(e){e.message=`[extjs:<workflow-slug>/<file>.js] ${e.message}`;throw e;}
```

And create the external JS file in the repo:

Path:
- `js/workflows/<workflow-slug>/<file>.js`

Template shape:
- `module.exports = async function run(ctx) { ... return [{ json: ... }]; };`

Commit external JS:
```bash
git add js/workflows/<workflow-slug>/
git commit -m "Externalize JS: <workflow name> / <node name>"
git push
```

---

## Externalizing Code nodes (automated, per workflow)

When you want to externalize **all Code nodes in a workflow**:
1) Export the workflow **raw** from n8n (includes required metadata like `versionId`)
2) Patch raw JSON to swap Code node JS → wrapper requires
3) Import patched raw JSON back into n8n (overwrites)
4) Export normalized workflows for Git diff

Commands (example):
```bash
# 1) raw export
WF_ID="<workflow-id>"
docker exec -u node n8n sh -lc "rm -f /tmp/raw.json && n8n export:workflow --id='$WF_ID' --output=/tmp/raw.json"
docker cp n8n:/tmp/raw.json ./tmp/raw.json

# 2) patch raw
python3 scripts/migrate/patch_workflow_use_external_js.py ./tmp/raw.json ./js/workflows/<workflow-slug> <workflow-slug>

# 3) import patched raw
docker cp ./tmp/<workflow-slug>.raw.externalized.json n8n:/tmp/<workflow-slug>.raw.externalized.json
docker exec -u node n8n n8n import:workflow --input=/tmp/<workflow-slug>.raw.externalized.json

# 4) export normalized + commit
./scripts/export_workflows.sh
git add workflows/
git commit -m "<workflow name>: switch Code nodes to external JS modules"
git push
```

---

## Removing deleted/archived workflows from Git
If you delete workflows in n8n UI, ensure the container export directory is cleaned before export (so stale files don’t linger):

```bash
docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows && mkdir -p /tmp/workflows'
```

Then export and commit deletions:
```bash
./scripts/export_workflows.sh
git add -u workflows/
git commit -m "Remove deleted workflows"
git push
```

---

## Review strategy (GitHub Web PRs)
Recommended habit:
- Make a branch per change
- Push
- Open PR in GitHub
- Review diffs:
  - workflow JSON: should be small and wrapper-only
  - JS files: show real logic diffs
