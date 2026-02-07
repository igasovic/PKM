# PKM n8n External JS Templates

This folder contains the standard templates used to keep n8n Code node logic readable in GitHub PR diffs.

## Design goals

- **Clean diffs:** keep complex JS out of workflow JSON (which tends to collapse into one line).
- **No drift:** every Code node uses the same wrapper; every external module follows the same shape.
- **Same n8n behavior:** you still "Execute node" and see inputs/outputs; thrown errors fail the node normally.
- **Compatible with your sandbox:** `require()` is allowed; `fs` and `process` are not.

## Mounting into the n8n container

Bind-mount the repo `js/` folder into the container at `/data/js` (read-only):

- Host: `.../n8n-workflows/js`
- Container: `/data/js`

Example docker-compose snippet:

```yaml
volumes:
  - /home/igasovic/repos/n8n-workflows/js:/data/js:ro
```

Restart n8n after changing compose.

## The one-line Code node wrapper (copy/paste)

Use the string in:

- `js/templates/code_node_wrapper_template.js`

Rule:
- Only change the **file path** (`/data/js/workflows/<workflow-slug>/<file>.js`)
- Do not edit the wrapper logic; that prevents drift across nodes.

## External module rules (all modules)

External files are CommonJS modules:

- Must export a function: `module.exports = async function(ctx) { ... }`
- Must return **n8n items**: `[{ json: ... }]` (or `items` array)
- Must not use `fs` or `process`
- Throw `Error` to fail node normally

## Regular module template

Use:
- `js/templates/regular_node_template.js`

Typical output shape:

```js
return [{ json: { ...ctx.$json, newField: value } }];
```

## SQL builder template (string-only SQL)

Your Postgres node accepts **Command only** (no params). Use:
- `js/templates/sql_builder_template.js`

Rules:
- Set `json.sql` to the exact SQL string to run.
- Never interpolate raw user input directly into SQL.
- Use shared helpers:
  - `js/libs/sql-builder.js`

Optional:
- set `json.sql_debug` with the inputs used to build SQL (ignored by Postgres node).

## Recommended file layout in your repo

```
js/
  shared/
    sql.js
  workflows/
    <workflow-slug>/
      10_<node-name>.js
      20_<node-name>.js
```

Example Code node requires:

```js
require('/data/js/workflows/pkm-retrieval-config/10_return_scoring_config_v1.js')
```

## Versioning conventions

- If you change semantics or output schema, bump the filename:
  - `*_v1.js` → `*_v2.js`
- Keep older versions around until all workflows are updated.


---

## Test Mode & Config Access (Mandatory)

All external JS and SQL builder modules **must** follow these rules:

### Config source (strict)
- Configuration is **never** read from pass-through `$json` state.
- Configuration is read **only** from the `PKM Config` sub-workflow node:

```js
const config = $items('PKM Config')[0].json.config;
```

If this node did not run, the module should fail naturally.

### Test mode behavior
- Schema selection is derived from:
  - `config.db.is_test_mode`
- Builders must route queries to:
  - `pkm.entries` when test mode is OFF
  - `pkm_test.entries` when test mode is ON

### UX signaling
- When `is_test_mode === true`, user-facing messages (Telegram, email)
  **must visibly indicate TEST MODE** (e.g. ⚗️🧪 TEST MODE banner).

### Rationale
This approach ensures:
- No hidden global state
- No accidental production writes
- Deterministic, auditable execution paths
