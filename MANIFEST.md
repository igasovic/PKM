# MANIFEST

This repository contains the **PKM DEV** n8n + Postgres workflow system: exported n8n workflows, externalized JavaScript for n8n Code nodes, and the operational documentation needed to reproduce the stack.

> Generated: 2026-02-01

## Top-level layout

- `.gitignore`  
  Git ignore rules (local artifacts, OS junk, etc.).

- `docs/`  
  Operational docs and “source of truth” notes for running the stack.

- `src/n8n/`  
  Externalized JavaScript modules and workflow JSON used by n8n.

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

- `docs/n8n_sync.md`  
  Canonical end-to-end sync process between n8n and Git (export, node sync, import, re-export, optional commit).

- `docs/pkm_n8n_js_templates_with_readme.zip`  
  Template bundle + README for authoring external JS modules that match this repo’s conventions.

---

## src/n8n/

### Purpose

`src/n8n/` holds externalized JavaScript modules and workflow JSON for n8n.

**Mount expectation (per `docs/env.md`):**
- Host repo path: `/home/igasovic/repos/n8n-workflows/src/n8n`
- n8n container mount: `/data`
- Code nodes load modules like: `/data/src/n8n/nodes/<workflow-slug>/<file>.js`

### Structure

- `src/n8n/nodes/<workflow-slug>/...`

Current node folders include:
- `src/n8n/nodes/10-read/` and `src/n8n/nodes/read/` for read-command formatting and SQL builder fixtures.
- `src/n8n/nodes/03-e-mail-capture/` and `src/n8n/nodes/e-mail-capture/` for email capture/reply and SQL builder fixtures.
- `src/n8n/nodes/02-telegram-capture/` and `src/n8n/nodes/telegram-capture/` for telegram capture/response and SQL builder fixtures.
- `src/n8n/nodes/22-web-extraction/` for extraction cleanup and retrieval-quality recompute logic.

### Critical convention: Config source

All builders that need configuration (especially schema routing) read config from the **sub-workflow node output named exactly `PKM Config`** (n8n Execute Workflow node).  
This avoids config being lost across branches/merges where `$json` state may be replaced.

---

## workflows/

Exported, normalized n8n workflows (JSON). These are the workflow definitions you can re-import if needed, but the repo’s canonical flow is:

- Make workflow structure edits in **n8n UI**
- Export/sync via `scripts/n8n/sync_workflows.sh`

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

- `scripts/n8n/sync_workflows.sh`  
  Canonical one-command n8n<->Git sync orchestration.

- `scripts/n8n/export_workflows.sh`  
  Exports workflows from n8n into `workflows/` in the repo.

- `scripts/n8n/normalize_workflows.sh`  
  Normalizes workflow JSON for stable Git diffs.

- `scripts/n8n/rename_workflows_by_name.sh`  
  Renames workflow export filenames based on workflow names/IDs.

- `scripts/migrate/`  
  (Reserved) migration helpers, if/when needed.

---

## Operational quickstart

- **After changing workflow structure in n8n UI:**  
  Run `./scripts/n8n/sync_workflows.sh` (or `--commit`) to sync workflows and code nodes.

- **After updating externalized Code-node modules:**  
  Commit `src/n8n/nodes/` changes and restart the n8n container to avoid module cache issues.

- **Test mode cleanup (Postgres):**  
  `TRUNCATE TABLE pkm_test.entries RESTART IDENTITY;`

---

## Notes on local artifacts

This zip snapshot includes OS artifacts (`.DS_Store`, `__MACOSX/`) which should not be committed.  
Keep the repo clean by removing those and/or ensuring `.gitignore` covers them.
