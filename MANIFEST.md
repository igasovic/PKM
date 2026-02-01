# MANIFEST

This repository contains the **PKM DEV** n8n + Postgres workflow system: exported n8n workflows, externalized JavaScript for n8n Code nodes, and the operational documentation needed to reproduce the stack.

> Generated: 2026-02-01

## Top-level layout

- `.gitignore`  
  Git ignore rules (local artifacts, OS junk, etc.).

- `docs/`  
  Operational docs and “source of truth” notes for running the stack.

- `js/`  
  Externalized JavaScript modules used by n8n Code nodes (mounted into the n8n container at `/data/js`).

- `scripts/`  
  Helper scripts for exporting/normalizing workflows and keeping Git diffs clean.

- `workflows/`  
  Exported n8n workflows as JSON (normalized for stable diffs).

---

## docs/

Files:

- `docs/env.md`  
  Environment and deployment notes for the Raspberry Pi stack: host IP, SSD boot details, Docker stack paths, Postgres container/user/db, n8n JS mount, etc.  
  Also documents **global PKM test mode** behavior (prod schema `pkm` vs test schema `pkm_test`).

- `docs/database_schema.md`  
  Database schema reference for `pkm.entries` (and related notes).  
  Includes the **schema-level fork** convention (`pkm` / `pkm_test`) and how test data is cleaned.

- `docs/changelog.md`  
  Operator-facing changelog (SSD migration notes, Matter server, and PKM test-mode work).

- `docs/n8n_to_git.md`  
  Procedure: export workflows from n8n to Git (authoritative direction after workflow edits).

- `docs/git_to_n8n.md`  
  Procedure: when and how Git changes map back into n8n (primarily **external JS** changes; workflow-structure changes are generally made in n8n UI then exported back).

- `docs/pkm_n8n_js_templates_with_readme.zip`  
  Template bundle + README for authoring external JS modules that match this repo’s conventions.

---

## js/

### Purpose

`js/` holds the JavaScript modules that n8n Code nodes `require()` at runtime.

**Mount expectation (per `docs/env.md`):**
- Host repo path: `/home/igasovic/repos/n8n-workflows/js`
- n8n container mount: `/data/js`
- Code nodes load modules like: `/data/js/workflows/<workflow-slug>/<file>.js`

### Structure

- `js/workflows/<workflow-slug>/...`

Workflow slugs currently present:

- `js/workflows/pkm-retrieval-config/`
  - `return_scoring_config_v1.js` — central config provider for retrieval and routing.
  - `99_force-test-mode__*.js` — toggle helper (force test mode on a per-run basis).

- `js/workflows/tier-1-enhancement/`
  Shared Tier‑1 enrichment modules (prompt construction, response parsing, and DB update) used by the Tier‑1 subworkflow.

- `js/workflows/telegram-capture/`
  Externalized nodes for Telegram ingestion (normalize, build SQL insert/update, compute quality signals, create message/response).

- `js/workflows/e-mail-capture/`
  Externalized nodes for newsletter/email ingestion and reply composition.
  (Some Tier‑1 helper modules may also exist here for backwards compatibility.)

- `js/workflows/read/`
  Externalized nodes for the Telegram “read” commands (`/last`, `/find`, `/continue`, `/pull`, `/help`) including SQL builders and message formatting.

  - `return_scoring_config_v1.js` — central config provider for retrieval and routing.
  - `99_force-test-mode__*.js` — toggle helper (force test mode on a per-run basis).

- `js/workflows/telegram-capture/`
  Externalized nodes for Telegram ingestion (normalize, build SQL insert/update, compute quality signals, compose response).

- `js/workflows/e-mail-capture/`
  Externalized nodes for newsletter/email ingestion and reply composition.

- `js/workflows/read/`
  Externalized nodes for the Telegram “read” commands (`/last`, `/find`, `/continue`, `/pull`, `/help`) including SQL builders and message formatting.

### Critical convention: Config source

All builders that need configuration (especially schema routing) read config from the **sub-workflow node output named exactly `PKM Config`** (n8n Execute Workflow node).  
This avoids config being lost across branches/merges where `$json` state may be replaced.

---

## workflows/

Exported, normalized n8n workflows (JSON). These are the workflow definitions you can re-import if needed, but the repo’s canonical flow is:

- Make workflow structure edits in **n8n UI**
- Export to Git via `scripts/export_workflows.sh`

Current workflows (examples in this snapshot):

- `workflows/pkm-retrieval-config__*.json`  
  Central config workflow (returned config consumed by other workflows via “PKM Config” sub-workflow call).

- `workflows/telegram-capture__*.json`  
  Telegram ingestion pipeline (calls Tier‑1 Enhancement for newsletter/article captures once `clean_text` is available).

- `workflows/e-mail-capture__*.json`  
  Email/newsletter ingestion pipeline (calls Tier‑1 Enhancement for `content_type=newsletter`).

- `workflows/tier-1-enhancement__*.json`  
  Tier‑1 enrichment subworkflow: builds prompt(s), calls the LLM, parses metadata (`gist`, topics, keywords), and updates the entry in Postgres.

- `workflows/read__*.json`  
  Telegram read/query commands pipeline.

- `workflows/telegram-router__*.json`  
  Router/dispatcher for Telegram commands (if present in your n8n instance).

- `workflows/error-handling__*.json`  
  Shared error workflow used by other workflows.

- `workflows/test__*.json`  
  Scratch/test workflow (if present).

---

## scripts/

- `scripts/export_workflows.sh`  
  Exports workflows from n8n into `workflows/` in the repo.

- `scripts/normalize_workflows.sh`  
  Normalizes workflow JSON for stable Git diffs.

- `scripts/rename_workflows_by_name.sh`  
  Renames workflow export filenames based on workflow names/IDs.

- `scripts/migrate/`  
  (Reserved) migration helpers, if/when needed.

---

## Operational quickstart

- **After changing workflow structure in n8n UI:**  
  Run `./scripts/export_workflows.sh` and commit changes in `workflows/`.

- **After updating external JS modules:**  
  Commit `js/` changes and restart the n8n container to avoid module cache issues.

- **Test mode cleanup (Postgres):**  
  `TRUNCATE TABLE pkm_test.entries RESTART IDENTITY;`

---

## Notes on local artifacts

This zip snapshot includes OS artifacts (`.DS_Store`, `__MACOSX/`) which should not be committed.  
Keep the repo clean by removing those and/or ensuring `.gitignore` covers them.
