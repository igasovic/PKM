'use strict';

const assert = require('assert');
const path = require('path');

const buildContinue = require(path.resolve(__dirname, '../js/workflows/read/02_build-sql-continue__138ce96f-f56c-4bea-9443-67686bd6066b.js'));
const buildFind = require(path.resolve(__dirname, '../js/workflows/read/03_build-sql-find__d0724507-154e-485c-8b0d-3523be365f6c.js'));
const buildLast = require(path.resolve(__dirname, '../js/workflows/read/04_build-sql-last__97543204-559a-4946-8621-4faacda4643f.js'));
const buildPull = require(path.resolve(__dirname, '../js/workflows/read/05_build-sql-pull__55ed7dbe-1cc2-46de-98b5-0fa4d916c84c.js'));

function makeCtx(json) {
  return {
    $json: json,
    $items: (name) => {
      if (name !== 'PKM Config') return [];
      return [{ json: { config: json.config || getConfig() } }];
    },
  };
}

(async () => {
  {
    const $json = {
      q: 'ai',
      days: 12,
      limit: 5,
      config: {
        scoring: {
          maxItems: { continue: 6 },
          weightsByCmd: {
            continue: {
              topic_primary_exact: 1.5,
              topic_primary_fuzzy: 0.8,
              topic_secondary_exact: 1.2,
              topic_secondary_fuzzy: 0.4,
              keywords_overlap_cap: 2,
              keywords_overlap_each: 0.5,
              gist_match: 0.3,
              title_match: 0.2,
              author_match: 0.1,
              fts_rank: 1.1,
              prefer_content_type_note: 0.25,
              prefer_intent_think: 0.15,
              prefer_enriched: 0.05,
              penalty_boilerplate_heavy: 0.7,
              penalty_low_signal: 0.6,
              penalty_link_ratio_high: 0.5,
              penalty_extraction_incomplete: 0.4,
            },
          },
          recencyByCmd: { continue: { half_life_days: 30 } },
          noteQuotaByCmd: { continue: 0.6 },
        },
      },
    };

    const expected = `
WITH params AS (
  SELECT
    'ai'::text AS qtext,
    websearch_to_tsquery('english', 'ai') AS tsq,
    12::int AS days,
    5::int AS lim,
    30::real AS half_life_days,
    0.6::real AS note_quota
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
  FROM "pkm"."entries" e, params p
  WHERE
    e.created_at >= (now() - (p.days || ' days')::interval)
    AND e.duplicate_of IS NULL
),

scored AS (
  SELECT
    b.*,
    ts_rank_cd(b.t1_tsv, b.tsq) AS t1_rank,
    ts_rank_cd(e.tsv, b.tsq) AS fts_rank,

    (
      (CASE WHEN lower(b.topic_primary) = lower(b.qtext) THEN 1.5 ELSE 0 END) +
      (CASE WHEN lower(b.topic_primary) LIKE lower(b.qtext) || '%' THEN 0.8 ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) = lower(b.qtext) THEN 1.2 ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) LIKE '%' || lower(b.qtext) || '%' THEN 0.4 ELSE 0 END) +

      -- keywords overlap (fixed)
      LEAST(
        2,
        0.5 * (
          SELECT count(*)
          FROM unnest(b.keywords) kw
          WHERE kw <> ''
            AND lower(kw) = ANY (regexp_split_to_array(lower(b.qtext), '\\s+'))
        )
      ) +

      (CASE WHEN b.gist ILIKE '%' || b.qtext || '%' THEN 0.3 ELSE 0 END) +
      (CASE WHEN b.title ILIKE '%' || b.qtext || '%' THEN 0.2 ELSE 0 END) +
      (CASE WHEN b.author ILIKE '%' || b.qtext || '%' THEN 0.1 ELSE 0 END) +

      (1.1 * ts_rank_cd(e.tsv, b.tsq)) +

      (CASE WHEN b.content_type = 'note' THEN 0.25 ELSE 0 END) +
      (CASE WHEN b.intent = 'think' THEN 0.15 ELSE 0 END) +
      (CASE WHEN b.topic_primary <> '' THEN 0.05 ELSE 0 END) +

      (10.0 * b.quality_score) +
      (5.0 * b.recency) -

      (CASE WHEN b.boilerplate_heavy THEN 0.7 ELSE 0 END) -
      (CASE WHEN b.low_signal THEN 0.6 ELSE 0 END) -
      (CASE WHEN b.link_ratio > 0.18 THEN 0.5 ELSE 0 END) -
      (CASE WHEN b.extraction_incomplete THEN 0.4 ELSE 0 END)
    ) AS score
  FROM base b
  JOIN "pkm"."entries" e ON e.id = b.id
  WHERE
    b.tsq IS NOT NULL
    AND (e.tsv @@ b.tsq OR b.t1_tsv @@ b.tsq OR lower(b.topic_primary) = lower(b.qtext))
),

notes AS (
  SELECT *, row_number() OVER (ORDER BY score DESC, created_at DESC) AS rn
  FROM scored
  WHERE content_type = 'note'
),
externals AS (
  SELECT *, row_number() OVER (ORDER BY score DESC, created_at DESC) AS rn
  FROM scored
  WHERE content_type IS DISTINCT FROM 'note'
),

/* FIX: only select the hit rows (notes/externals), not params/note_count columns */
note_pick AS (
  SELECT n.*
  FROM notes n
  CROSS JOIN params p
  WHERE n.rn <= greatest(1, floor(p.lim * p.note_quota))::int
),
note_count AS (
  SELECT count(*)::int AS n FROM note_pick
),
external_pick AS (
  SELECT x.*
  FROM externals x
  CROSS JOIN params p
  CROSS JOIN note_count nc
  WHERE x.rn <= (p.lim - nc.n)
),
hits AS (
  SELECT * FROM note_pick
  UNION ALL
  SELECT * FROM external_pick
),

meta_row AS (
  SELECT
    TRUE AS is_meta,
    'continue'::text AS cmd,
    p.qtext AS query_text,
    p.days AS days,
    p.lim AS limit,
    (SELECT count(*) FROM hits)::int AS hits,
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
  FROM params p
),

hit_rows AS (
  SELECT
    FALSE AS is_meta,
    'continue'::text AS cmd,
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
    h.score::double precision AS score,
    NULL::text AS snippet
  FROM hits h
),

out AS (
  SELECT * FROM meta_row
  UNION ALL
  SELECT * FROM hit_rows
)

SELECT *
FROM out
ORDER BY is_meta DESC, score DESC NULLS LAST, created_at DESC NULLS LAST;
`.trim();

    const actual = (await buildContinue(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  {
    const $json = {
      q: 'ai',
      days: 300,
      limit: 4,
      config: {
        scoring: {
          maxItems: { find: 7 },
          weightsByCmd: {
            find: {
              fts_rank: 90,
              title_match: 1.2,
              gist_match: 0.8,
            },
          },
        },
      },
    };

    const expected = `
WITH params AS (
  SELECT
    'ai'::text AS qtext,
    websearch_to_tsquery('english', 'ai') AS tsq,
    300::int AS days,
    4::int AS lim,
    'ai'::text AS needle
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
      (90 * ts_rank_cd(e.tsv, p.tsq)) +

      -- small chip boosts (don’t overwhelm find)
      (CASE WHEN e.title ILIKE '%' || p.qtext || '%' THEN 1.2 ELSE 0 END) +
      (CASE WHEN e.gist ILIKE '%' || p.qtext || '%' THEN 0.8 ELSE 0 END)
    ) AS score
  FROM "pkm"."entries" e, params p
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

    const actual = (await buildFind(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  {
    const $json = {
      q: 'ai',
      days: 200,
      limit: 5,
      config: {
        scoring: {
          maxItems: { last: 8 },
          weightsByCmd: {
            last: {
              topic_primary_exact: 2,
              topic_primary_fuzzy: 0.9,
              topic_secondary_exact: 1.3,
              topic_secondary_fuzzy: 0.5,
              keywords_overlap_cap: 3,
              keywords_overlap_each: 0.75,
              gist_match: 0.25,
              title_match: 0.2,
              author_match: 0.1,
              fts_rank: 1.4,
              prefer_content_type_note: 0.3,
              prefer_intent_think: 0.2,
              prefer_enriched: 0.1,
              penalty_boilerplate_heavy: 0.8,
              penalty_low_signal: 0.7,
              penalty_link_ratio_high: 0.6,
              penalty_extraction_incomplete: 0.5,
            },
          },
          recencyByCmd: { last: { half_life_days: 120 } },
        },
      },
    };

    const expected = `
WITH params AS (
  SELECT
    'ai'::text AS qtext,
    websearch_to_tsquery('english', 'ai') AS tsq,
    200::int AS days,
    5::int AS lim,
    120::real AS half_life_days
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
  FROM "pkm"."entries" e, params p
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
      (CASE WHEN lower(b.topic_primary) = lower(b.qtext) THEN 2 ELSE 0 END) +
      (CASE WHEN lower(b.topic_primary) LIKE lower(b.qtext) || '%' THEN 0.9 ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) = lower(b.qtext) THEN 1.3 ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) LIKE '%' || lower(b.qtext) || '%' THEN 0.5 ELSE 0 END) +

      -- keywords overlap (FIXED: avoids text = text[] error)
      LEAST(
        3,
        0.75 * (
          SELECT count(*)
          FROM unnest(b.keywords) kw
          WHERE kw <> ''
            AND lower(kw) = ANY (regexp_split_to_array(lower(b.qtext), '\\s+'))
        )
      ) +

      -- gist/title/author matches
      (CASE WHEN b.gist ILIKE '%' || b.qtext || '%' THEN 0.25 ELSE 0 END) +
      (CASE WHEN b.title ILIKE '%' || b.qtext || '%' THEN 0.2 ELSE 0 END) +
      (CASE WHEN b.author ILIKE '%' || b.qtext || '%' THEN 0.1 ELSE 0 END) +

      -- fts rank (scaled)
      (1.4 * ts_rank_cd(e.tsv, b.tsq)) +

      -- preferences
      (CASE WHEN b.content_type = 'note' THEN 0.3 ELSE 0 END) +
      (CASE WHEN b.intent = 'think' THEN 0.2 ELSE 0 END) +
      (CASE WHEN b.topic_primary <> '' THEN 0.1 ELSE 0 END) +

      -- quality + recency (continuous nudges)
      (10.0 * b.quality_score) +
      (5.0 * b.recency) -

      -- penalties
      (CASE WHEN b.boilerplate_heavy THEN 0.8 ELSE 0 END) -
      (CASE WHEN b.low_signal THEN 0.7 ELSE 0 END) -
      (CASE WHEN b.link_ratio > 0.18 THEN 0.6 ELSE 0 END) -
      (CASE WHEN b.extraction_incomplete THEN 0.5 ELSE 0 END)
    ) AS score
  FROM base b
  JOIN "pkm"."entries" e ON e.id = b.id
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

    const actual = (await buildLast(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  {
    const $json = {
      entry_id: '123',
      config: {
        scoring: {
          maxItems: { pull_short_chars: 120, pull_excerpt_chars: 900 },
        },
      },
    };

    const expected = `
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
  left(COALESCE(retrieval_excerpt, metadata #>> '{retrieval,excerpt}', ''), 120) AS excerpt,

  -- optional long body for later /pull --excerpt
  left(regexp_replace(COALESCE(clean_text, capture_text), '\\s+', ' ', 'g'), 900) AS excerpt_long
FROM "pkm"."entries"
WHERE entry_id = 123::bigint
LIMIT 1;
`.trim();

    const actual = (await buildPull(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  // eslint-disable-next-line no-console
  console.log('sql-builder read snapshots: OK');
})();
