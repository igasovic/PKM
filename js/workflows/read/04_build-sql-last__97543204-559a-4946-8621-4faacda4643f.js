/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build SQL - /LAST
 * Node ID: 97543204-559a-4946-8621-4faacda4643f
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = $items('PKM Config')[0].json.config;
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

  const q = String($json.q || '').trim();
const days = Number($json.days || 180);

// WP3 safety cap
const cfgLimit = Number($json.config?.scoring?.maxItems?.last || 15);
const limit = Math.min(cfgLimit, Math.max(1, Number($json.limit || 10)));

const W = $json.config?.scoring?.weightsByCmd?.last || {};
const halfLife = Number($json.config?.scoring?.recencyByCmd?.last?.half_life_days || 180);

const sql = `
WITH params AS (
  SELECT
    ${sb.lit(q)}::text AS qtext,
    websearch_to_tsquery('english', ${sb.lit(q)}) AS tsq,
    ${days}::int AS days,
    ${limit}::int AS lim,
    ${halfLife}::real AS half_life_days
),
base AS (
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

    COALESCE(e.keywords, ARRAY[]::text[]) AS keywords,
    COALESCE(e.quality_score, 0.5) AS quality_score,
    COALESCE(e.boilerplate_heavy, false) AS boilerplate_heavy,
    COALESCE(e.low_signal, false) AS low_signal,
    COALESCE(e.extraction_incomplete, false) AS extraction_incomplete,
    COALESCE(e.link_ratio, 0.0) AS link_ratio,

    p.qtext,
    p.tsq,

    exp( - (extract(epoch from (now() - e.created_at)) / 86400.0) / p.half_life_days ) AS recency,

    to_tsvector('english',
      trim(
        COALESCE(e.topic_primary,'') || ' ' ||
        COALESCE(e.topic_secondary,'') || ' ' ||
        COALESCE(array_to_string(e.keywords,' '),'') || ' ' ||
        COALESCE(e.gist,'') || ' ' ||
        COALESCE(e.title,'') || ' ' ||
        COALESCE(e.author,'')
      )
    ) AS t1_tsv
  FROM ${entries_table} e, params p
  WHERE
    e.created_at >= (now() - (p.days || ' days')::interval)
    AND e.duplicate_of IS NULL
),
scored AS (
  SELECT
    b.*,

    -- ranks
    ts_rank_cd(b.t1_tsv, b.tsq) AS t1_rank,
    ts_rank_cd(e.tsv, b.tsq) AS fts_rank,

    -- score using config weights
    (
      -- topic matches
      (CASE WHEN lower(b.topic_primary) = lower(b.qtext) THEN ${Number(W.topic_primary_exact || 0)} ELSE 0 END) +
      (CASE WHEN lower(b.topic_primary) LIKE lower(b.qtext) || '%' THEN ${Number(W.topic_primary_fuzzy || 0)} ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) = lower(b.qtext) THEN ${Number(W.topic_secondary_exact || 0)} ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) LIKE '%' || lower(b.qtext) || '%' THEN ${Number(W.topic_secondary_fuzzy || 0)} ELSE 0 END) +

      -- keywords overlap (FIXED: avoids text = text[] error)
      LEAST(
        ${Number(W.keywords_overlap_cap || 0)},
        ${Number(W.keywords_overlap_each || 0)} * (
          SELECT count(*)
          FROM unnest(b.keywords) kw
          WHERE kw <> ''
            AND lower(kw) = ANY (regexp_split_to_array(lower(b.qtext), '\\s+'))
        )
      ) +

      -- gist/title/author matches
      (CASE WHEN b.gist ILIKE '%' || b.qtext || '%' THEN ${Number(W.gist_match || 0)} ELSE 0 END) +
      (CASE WHEN b.title ILIKE '%' || b.qtext || '%' THEN ${Number(W.title_match || 0)} ELSE 0 END) +
      (CASE WHEN b.author ILIKE '%' || b.qtext || '%' THEN ${Number(W.author_match || 0)} ELSE 0 END) +

      -- fts rank (scaled)
      (${Number(W.fts_rank || 0)} * ts_rank_cd(e.tsv, b.tsq)) +

      -- preferences
      (CASE WHEN b.content_type = 'note' THEN ${Number(W.prefer_content_type_note || 0)} ELSE 0 END) +
      (CASE WHEN b.intent = 'think' THEN ${Number(W.prefer_intent_think || 0)} ELSE 0 END) +
      (CASE WHEN b.topic_primary <> '' THEN ${Number(W.prefer_enriched || 0)} ELSE 0 END) +

      -- quality + recency (continuous nudges)
      (10.0 * b.quality_score) +
      (5.0 * b.recency) -

      -- penalties
      (CASE WHEN b.boilerplate_heavy THEN ${Number(W.penalty_boilerplate_heavy || 0)} ELSE 0 END) -
      (CASE WHEN b.low_signal THEN ${Number(W.penalty_low_signal || 0)} ELSE 0 END) -
      (CASE WHEN b.link_ratio > 0.18 THEN ${Number(W.penalty_link_ratio_high || 0)} ELSE 0 END) -
      (CASE WHEN b.extraction_incomplete THEN ${Number(W.penalty_extraction_incomplete || 0)} ELSE 0 END)
    ) AS score
  FROM base b
  JOIN ${entries_table} e ON e.id = b.id
  WHERE
    b.tsq IS NOT NULL
    AND (e.tsv @@ b.tsq OR b.t1_tsv @@ b.tsq)
),
hits AS (
  SELECT
    entry_id,
    id,
    created_at,
    source,
    intent,
    content_type,
    url,
    title,
    author,
    topic_primary,
    topic_secondary,
    gist,
    excerpt,
    score
  FROM scored
  ORDER BY score DESC, created_at DESC
  LIMIT (SELECT lim FROM params)
),
meta AS (
  SELECT
    TRUE AS is_meta,
    'last'::text AS cmd,
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
  'last'::text AS cmd,
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
  NULL::text AS snippet
FROM hits h;
`.trim();

return [{ json: { ...$json, sql } }];
};
