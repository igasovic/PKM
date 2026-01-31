/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build SQL - /PULL
 * Node ID: 55ed7dbe-1cc2-46de-98b5-0fa4d916c84c
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = $items('PKM Config')[0].json.config;
  const db = config.db;

  const is_test_mode = !!db.is_test_mode;
  const schema_prod = db.schema_prod || 'pkm';
  const schema_test = db.schema_test || 'pkm_test';
  const schema_candidate = is_test_mode ? schema_test : schema_prod;

  const isValidIdent = (s) => (typeof s === 'string') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
  const db_schema = isValidIdent(schema_candidate) ? schema_candidate : 'pkm';

  // Safe, quoted identifier reference for SQL templates
  const entries_table = `"${db_schema}"."entries"`;
function sqlBigInt(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return 'NULL';
  return s;
}

const entry_id = $json.entry_id;
if (!entry_id || !String(entry_id).trim()) throw new Error('pull: missing entry_id');

const shortN = Number($json.config?.scoring?.maxItems?.pull_short_chars || 320);
const longN = Number($json.config?.scoring?.maxItems?.pull_excerpt_chars || 1800);

const sql = `
SELECT
  entry_id,
  id,
  created_at,
  source,
  intent,
  content_type,
  COALESCE(title,'') AS title,
  COALESCE(author,'') AS author,
  COALESCE(url_canonical, url, '') AS url,
  COALESCE(topic_primary,'') AS topic_primary,
  COALESCE(topic_secondary,'') AS topic_secondary,
  COALESCE(gist,'') AS gist,
  COALESCE(clean_text, '') AS clean_text,
  keywords,

  -- legacy name expected by current telegram message builder
  left(COALESCE(retrieval_excerpt, metadata #>> '{retrieval,excerpt}', ''), ${shortN}) AS excerpt,

  -- optional long body for later /pull --excerpt
  left(regexp_replace(COALESCE(clean_text, capture_text), '\\s+', ' ', 'g'), ${longN}) AS excerpt_long
FROM ${entries_table}
WHERE entry_id = ${sqlBigInt(entry_id)}::bigint
LIMIT 1;
`.trim();

return [{ json: { ...$json, sql } }];
};
