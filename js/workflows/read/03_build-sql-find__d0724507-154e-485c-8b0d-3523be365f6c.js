/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build SQL - /FIND
 * Node ID: d0724507-154e-485c-8b0d-3523be365f6c
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
function sqlString(v) {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

const q = String($json.q || '').trim();
const days = Number($json.days || 365);

// WP3 safety cap
const cfgLimit = Number($json.config?.scoring?.maxItems?.find || 15);
const limit = Math.min(cfgLimit, Math.max(1, Number($json.limit || 10)));

// escape LIKE wildcards in user input
const needle = String(q).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

const W = $json.config?.scoring?.weightsByCmd?.find || {};

const sql = `
WITH params AS (
  SELECT
    ${sqlString(q)}::text AS qtext,
    websearch_to_tsquery('english', ${sqlString(q)}) AS tsq,
    ${days}::int AS days,
    ${limit}::int AS lim,
    ${sqlString(needle)}::text AS needle
),
hits AS (
  SELECT
    e.entry_id,
    e.id,
    e.created_at,
    e.source,
    e.intent,
    e.content_type,
    COALESCE(e.url_canonical, e.url, '') AS url,
    COALESCE(e.title, e.external_ref->>'title', '') AS title,
    COALESCE(e.author, '') AS author,

    COALESCE(e.topic_primary,'') AS topic_primary,
    COALESCE(e.topic_secondary,'') AS topic_secondary,
    COALESCE(e.gist,'') AS gist,
    COALESCE(e.retrieval_excerpt, e.metadata #>> '{retrieval,excerpt}', '') AS excerpt,

    COALESCE(char_length(COALESCE(e.clean_text, e.capture_text)), 0) AS text_len,

    ts_rank_cd(e.tsv, p.tsq) AS fts_rank,
    left(regexp_replace(COALESCE(e.clean_text, e.capture_text), '\\s+', ' ', 'g'), 600) AS snippet,

    (
      -- literal evidence matters most for /find
      (CASE WHEN COALESCE(e.clean_text,'') ILIKE '%' || p.needle || '%' ESCAPE '\\' THEN 50 ELSE 0 END) +
      (CASE WHEN COALESCE(e.capture_text,'') ILIKE '%' || p.needle || '%' ESCAPE '\\' THEN 20 ELSE 0 END) +
      (${Number(W.fts_rank || 80)} * ts_rank_cd(e.tsv, p.tsq)) +

      -- small chip boosts (don’t overwhelm find)
      (CASE WHEN e.title ILIKE '%' || p.qtext || '%' THEN ${Number(W.title_match || 0)} ELSE 0 END) +
      (CASE WHEN e.gist ILIKE '%' || p.qtext || '%' THEN ${Number(W.gist_match || 0)} ELSE 0 END)
    ) AS score
  FROM ${entries_table} e, params p
  WHERE
    e.created_at >= (now() - (p.days || ' days')::interval)
    AND e.duplicate_of IS NULL
    AND (
      COALESCE(e.clean_text,'') ILIKE '%' || p.needle || '%' ESCAPE '\\'
      OR COALESCE(e.capture_text,'') ILIKE '%' || p.needle || '%' ESCAPE '\\'
      OR (p.tsq IS NOT NULL AND e.tsv @@ p.tsq)
    )
  ORDER BY score DESC, e.created_at DESC
  LIMIT (SELECT lim FROM params)
),
meta AS (
  SELECT
    TRUE AS is_meta,
    'find'::text AS cmd,
    (SELECT qtext FROM params) AS query_text,
    (SELECT days FROM params) AS days,
    (SELECT lim FROM params) AS limit,
    (SELECT count(*) FROM hits)::int AS hits
)
SELECT
  TRUE AS is_meta,
  m.cmd,
  m.query_text,
  m.days,
  m.limit,
  m.hits,
  NULL::bigint AS entry_id,
  NULL::uuid AS id,
  NULL::timestamptz AS created_at,
  NULL::text AS source,
  NULL::text AS intent,
  NULL::text AS content_type,
  NULL::text AS url,
  NULL::text AS title,
  NULL::text AS author,
  NULL::text AS topic_primary,
  NULL::text AS topic_secondary,
  NULL::text AS gist,
  NULL::text AS excerpt,
  NULL::double precision AS score,
  NULL::text AS snippet
FROM meta m
UNION ALL
SELECT
  FALSE AS is_meta,
  'find'::text AS cmd,
  (SELECT qtext FROM params) AS query_text,
  (SELECT days FROM params) AS days,
  (SELECT lim FROM params) AS limit,
  NULL::int AS hits,
  h.entry_id,
  h.id,
  h.created_at,
  h.source,
  h.intent,
  h.content_type,
  h.url,
  h.title,
  h.author,
  h.topic_primary,
  h.topic_secondary,
  h.gist,
  h.excerpt,
  h.score,
  h.snippet
FROM hits h;
`.trim();

return [{ json: { ...$json, sql } }];
};
