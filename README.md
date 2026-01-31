# E-Mail Capture — externalized Code nodes

Generated from `e-mail-capture__D7ZqryewKY23am6l.json`.

## Contents
- `js/workflows/e-mail-capture/*.js` — one file per Code node
- `workflows_import/e-mail-capture__.externalized.json` — normalized workflow JSON with Code nodes replaced by `require('/data/js/...')` wrappers
- `MANIFEST.json` — node name/id → JS filename mapping

## Import note (important)
Your repo exports are normalized and remove fields like `id`/`versionId`. **Do not import** this JSON directly.

To update n8n:
1) Export the workflow RAW from n8n (keeps `versionId`)
2) Patch the RAW JSON using your script:
   `python3 scripts/migrate/patch_workflow_use_external_js.py <raw.json> js/workflows/e-mail-capture e-mail-capture`
3) Import the patched RAW JSON into n8n
4) Run `./scripts/export_workflows.sh` and commit the normalized `workflows/` output.

Externalized Code nodes: 14
