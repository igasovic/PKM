/**
 * SQL Builder — Stateless helpers for safe SQL literal/identifier construction
 * =============================================================================
 *
 * USER GUIDE (for agents)
 * ----------------------
 * Use this library in js/workflows when building SQL for Postgres (INSERT/UPDATE/SELECT).
 * All functions are pure and stateless: same inputs always produce the same output.
 *
 * Literals (use in VALUES, SET, WHERE, params):
 *   lit(v)           — text: null/undefined → NULL, else '...' with backslash/single-quote escaped
 *   jsonbLit(obj)    — jsonb: null/undefined → NULL; optional jsonbLit(obj, { dollarTag: 'x' }) for dollar-quoting (avoids backslash issues in JSON)
 *   intLit(v)        — integer: null/non-finite → NULL, else truncated number string (no quotes)
 *   numLit(v)        — real: null/non-finite → NULL, else number string (no quotes)
 *   boolLit(v)       — boolean: null/undefined → NULL, else 'true'/'false'
 *   bigIntLit(v)     — bigint: trim string, must be non-negative digits only, else NULL (no quotes)
 *   textArrayLit(arr)— text[]: null/empty → NULL, else ARRAY['a','b']::text[] (elements escaped via esc)
 *
 * Escaping (low-level):
 *   esc(s)           — escape string for use inside single-quoted SQL literal (\\ and ')
 *   escapeLikeWildcards(s) — escape % _ \ for use in LIKE/ILIKE patterns (e.g. user search)
 *
 * Identifiers / schema:
 *   isValidIdent(s)  — true if s is a valid SQL identifier (letters, digits, underscore)
 *   qualifiedTable(schema, table) — returns "schema"."table" (validated); invalid schema → uses fallbackSchema
 *   resolveEntriesTable(db)       — given db config { is_test_mode, schema_prod?, schema_test? }, returns "schema"."entries" (default schema 'pkm')
 *
 * Utilities:
 *   clamp01(x)       — clamp number to [0, 1] (e.g. confidence scores)
 *
 * Example:
 *   const sb = require('./libs/sql-builder.js');
 *   const entries_table = sb.resolveEntriesTable(config.db);
 *   const sql = `SELECT * FROM ${entries_table} WHERE id = ${sb.lit(id)}::uuid AND n = ${sb.intLit(n)}`;
 */

'use strict';

/**
 * Escape string for use inside a single-quoted SQL string literal.
 * Escapes backslash and single quote.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * SQL text literal. null/undefined → 'NULL'; otherwise quoted and escaped.
 * @param {*} v
 * @returns {string} 'NULL' or 'escaped_value'
 */
function lit(v) {
  return (v === null || v === undefined) ? 'NULL' : `'${esc(v)}'`;
}

/**
 * SQL jsonb literal. null/undefined → 'NULL'.
 * By default: single-quoted JSON with only single-quote escaped (JSON.stringify handles \ and ").
 * Option { dollarTag: 'tag' } uses dollar-quoting to avoid any escape issues: $tag$...$tag$::jsonb.
 * @param {*} obj
 * @param {{ dollarTag?: string }} [opts]
 * @returns {string}
 */
function jsonbLit(obj, opts) {
  if (obj === null || obj === undefined) return 'NULL';
  const s = JSON.stringify(obj);
  const tag = opts && opts.dollarTag;
  if (tag && !s.includes(`$${tag}$`)) {
    return `$${tag}$${s}$${tag}$::jsonb`;
  }
  const escaped = s.replace(/'/g, "''");
  return `'${escaped}'::jsonb`;
}

/**
 * SQL integer literal. null/undefined/non-finite → 'NULL'; else truncated number (unquoted).
 * @param {*} v
 * @returns {string}
 */
function intLit(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(Math.trunc(n));
}

/**
 * SQL real/numeric literal. null/undefined/non-finite → 'NULL'; else number string (unquoted).
 * @param {*} v
 * @returns {string}
 */
function numLit(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(n);
}

/**
 * SQL boolean literal. null/undefined → 'NULL'; else 'true' or 'false'.
 * @param {*} v
 * @returns {string}
 */
function boolLit(v) {
  if (v === null || v === undefined) return 'NULL';
  return v ? 'true' : 'false';
}

/**
 * SQL bigint literal (unquoted). Input trimmed; must be non-negative digits only, else 'NULL'.
 * @param {*} v
 * @returns {string}
 */
function bigIntLit(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return 'NULL';
  return s;
}

function requireConfig(opts) {
  const config = opts && opts.config;
  if (!config || !config.scoring) {
    throw new Error('config is required');
  }
  return config;
}

/**
 * SQL text[] literal. null/non-array/empty → 'NULL'; else ARRAY['a','b']::text[].
 * Elements are trimmed and escaped; empty after trim are skipped.
 * @param {*} arr
 * @returns {string}
 */
function textArrayLit(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'NULL';
  const items = arr
    .map(x => String(x ?? '').trim())
    .filter(Boolean)
    .map(x => `'${esc(x)}'`);
  if (items.length === 0) return 'NULL';
  return `ARRAY[${items.join(', ')}]::text[]`;
}

/**
 * Escape % _ \ for use in LIKE/ILIKE pattern (e.g. user-provided search).
 * Use with ESCAPE '\\' in SQL.
 * @param {string} s
 * @returns {string}
 */
function escapeLikeWildcards(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * True if s is a valid SQL identifier (starts with letter/underscore, then alphanumeric/underscore).
 * @param {*} s
 * @returns {boolean}
 */
function isValidIdent(s) {
  return (typeof s === 'string') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

/**
 * Quoted qualified table: "schema"."table". If schema invalid, uses fallbackSchema (default 'pkm').
 * @param {string} schema
 * @param {string} table
 * @param {string} [fallbackSchema='pkm']
 * @returns {string}
 */
function qualifiedTable(schema, table, fallbackSchema = 'pkm') {
  const sch = isValidIdent(schema) ? schema : fallbackSchema;
  const tbl = isValidIdent(table) ? table : 'entries';
  return `"${sch}"."${tbl}"`;
}

/**
 * Resolve entries table from db config (prod vs test schema).
 * db: { is_test_mode?, schema_prod?, schema_test? }. Default schema names: pkm, pkm_test.
 * @param {{ is_test_mode?: boolean, schema_prod?: string, schema_test?: string }} db
 * @returns {string} "schema"."entries"
 */
function resolveEntriesTable(db) {
  const is_test_mode = !!db.is_test_mode;
  const schema_prod = db.schema_prod || 'pkm';
  const schema_test = db.schema_test || 'pkm_test';
  const schema_candidate = is_test_mode ? schema_test : schema_prod;
  const schema = isValidIdent(schema_candidate) ? schema_candidate : 'pkm';
  return `"${schema}"."entries"`;
}

/**
 * Clamp number to [0, 1] (e.g. confidence scores).
 * @param {number} x
 * @returns {number}
 */
function clamp01(x) {
  return (x < 0 ? 0 : x > 1 ? 1 : x);
}

module.exports = {
  esc,
  lit,
  jsonbLit,
  intLit,
  numLit,
  boolLit,
  bigIntLit,
  textArrayLit,
  escapeLikeWildcards,
  isValidIdent,
  qualifiedTable,
  resolveEntriesTable,
  clamp01,
  buildInsert,
  buildUpdate,
  buildReadContinue,
  buildReadFind,
  buildReadLast,
  buildReadPull,
  buildT1BatchUpsert,
  buildT1BatchItemsInsert,
  buildT1BatchResultsUpsert,
  buildT1BatchSummary,
  buildT1BatchFind,
  buildT1BatchListPending,
};

/**
 * Build upsert SQL for Tier-1 batch envelope row.
 * @param {{ batchesTable: string }} opts
 * @returns {string}
 */
function buildT1BatchUpsert(opts) {
  const batchesTable = opts && opts.batchesTable;
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT1BatchUpsert: batchesTable must be a non-empty string');
  }
  return `INSERT INTO ${batchesTable} (batch_id, status, model, input_file_id, output_file_id, error_file_id, request_count, metadata, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
ON CONFLICT (batch_id) DO UPDATE SET
  status = EXCLUDED.status,
  model = COALESCE(EXCLUDED.model, ${batchesTable}.model),
  input_file_id = COALESCE(EXCLUDED.input_file_id, ${batchesTable}.input_file_id),
  output_file_id = COALESCE(EXCLUDED.output_file_id, ${batchesTable}.output_file_id),
  error_file_id = COALESCE(EXCLUDED.error_file_id, ${batchesTable}.error_file_id),
  request_count = CASE
    WHEN EXCLUDED.request_count > 0 THEN EXCLUDED.request_count
    ELSE ${batchesTable}.request_count
  END,
  metadata = COALESCE(EXCLUDED.metadata, ${batchesTable}.metadata)`;
}

/**
 * Build bulk insert SQL for Tier-1 batch request items.
 * @param {{ itemsTable: string, rowCount: number }} opts
 * @returns {string}
 */
function buildT1BatchItemsInsert(opts) {
  const itemsTable = opts && opts.itemsTable;
  const rowCount = Number(opts && opts.rowCount);
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT1BatchItemsInsert: itemsTable must be a non-empty string');
  }
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new Error('buildT1BatchItemsInsert: rowCount must be a positive integer');
  }
  const values = [];
  let idx = 1;
  for (let i = 0; i < rowCount; i++) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, now())`);
  }
  return `INSERT INTO ${itemsTable} (batch_id, custom_id, title, author, content_type, prompt_mode, prompt, created_at)
VALUES ${values.join(', ')}
ON CONFLICT (batch_id, custom_id) DO NOTHING`;
}

/**
 * Build bulk upsert SQL for Tier-1 batch item results.
 * @param {{ resultsTable: string, rowCount: number }} opts
 * @returns {string}
 */
function buildT1BatchResultsUpsert(opts) {
  const resultsTable = opts && opts.resultsTable;
  const rowCount = Number(opts && opts.rowCount);
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT1BatchResultsUpsert: resultsTable must be a non-empty string');
  }
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new Error('buildT1BatchResultsUpsert: rowCount must be a positive integer');
  }
  const values = [];
  let idx = 1;
  for (let i = 0; i < rowCount; i++) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}::jsonb, $${idx++}::jsonb, now(), now())`);
  }
  return `INSERT INTO ${resultsTable}
  (batch_id, custom_id, status, response_text, parsed, error, raw, updated_at, created_at)
VALUES ${values.join(', ')}
ON CONFLICT (batch_id, custom_id) DO UPDATE SET
  status = EXCLUDED.status,
  response_text = EXCLUDED.response_text,
  parsed = EXCLUDED.parsed,
  error = EXCLUDED.error,
  raw = EXCLUDED.raw,
  updated_at = now()`;
}

/**
 * Build SQL for Tier-1 batch result summary counters.
 * @param {{ resultsTable: string }} opts
 * @returns {string}
 */
function buildT1BatchSummary(opts) {
  const resultsTable = opts && opts.resultsTable;
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT1BatchSummary: resultsTable must be a non-empty string');
  }
  return `SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_count,
  COUNT(*) FILTER (WHERE status = 'parse_error')::int AS parse_error_count,
  COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
FROM ${resultsTable}
WHERE batch_id = $1`;
}

/**
 * Build SQL for finding one Tier-1 batch by id.
 * @param {{ batchesTable: string }} opts
 * @returns {string}
 */
function buildT1BatchFind(opts) {
  const batchesTable = opts && opts.batchesTable;
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT1BatchFind: batchesTable must be a non-empty string');
  }
  return `SELECT * FROM ${batchesTable} WHERE batch_id = $1 LIMIT 1`;
}

/**
 * Build SQL for listing pending Tier-1 batch ids.
 * @param {{ batchesTable: string }} opts
 * @returns {string}
 */
function buildT1BatchListPending(opts) {
  const batchesTable = opts && opts.batchesTable;
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT1BatchListPending: batchesTable must be a non-empty string');
  }
  return `SELECT batch_id
FROM ${batchesTable}
WHERE status IS NULL
   OR status = ''
   OR status <> ALL($1::text[])
ORDER BY created_at ASC
LIMIT $2`;
}

/**
 * Build a parameter-free INSERT statement with explicit column/value lists.
 * @param {{ table: string, columns: string[], values: string[], returning?: string[] | string }} opts
 * @returns {string}
 */
function buildInsert(opts) {
  const table = opts && opts.table;
  const columns = opts && opts.columns;
  const values = opts && opts.values;
  const returning = opts && opts.returning;

  if (!table || typeof table !== 'string') {
    throw new Error('buildInsert: table must be a non-empty string');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('buildInsert: columns must be a non-empty array');
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('buildInsert: values must be a non-empty array');
  }
  if (columns.length !== values.length) {
    throw new Error('buildInsert: columns/values length mismatch');
  }

  const cols = columns.map(c => String(c).trim());
  const vals = values.map(v => String(v).trim());

  let returningClause = '';
  if (returning && Array.isArray(returning) && returning.length > 0) {
    returningClause = `\nRETURNING\n  ${returning.map(r => String(r).trim()).join(',\n  ')}`;
  } else if (returning) {
    const ret = String(returning).trim().replace(/;$/, '');
    if (ret) returningClause = `\nRETURNING\n  ${ret}`;
  }

  return [
    `INSERT INTO ${table} (`,
    `  ${cols.join(',\n  ')}`,
    `)`,
    `VALUES (`,
    `  ${vals.join(',\n  ')}`,
    `)${returningClause};`,
  ].join('\n');
}

/**
 * Build a parameter-free UPDATE statement with explicit SET clauses.
 * @param {{ table: string, set: string[], where: string, returning?: string[] | string }} opts
 * @returns {string}
 */
function buildUpdate(opts) {
  const table = opts && opts.table;
  const set = opts && opts.set;
  const where = opts && opts.where;
  const returning = opts && opts.returning;

  if (!table || typeof table !== 'string') {
    throw new Error('buildUpdate: table must be a non-empty string');
  }
  if (!Array.isArray(set) || set.length === 0) {
    throw new Error('buildUpdate: set must be a non-empty array');
  }
  if (!where || typeof where !== 'string') {
    throw new Error('buildUpdate: where must be a non-empty string');
  }

  const setLines = set.map(line => (line === null || line === undefined) ? '' : String(line).trim());
  const assignmentIdx = [];
  for (let i = 0; i < setLines.length; i += 1) {
    const line = setLines[i];
    if (line === '') continue;
    if (line.startsWith('--')) continue;
    assignmentIdx.push(i);
  }

  const lastAssignment = assignmentIdx.length > 0 ? assignmentIdx[assignmentIdx.length - 1] : -1;
  const renderedSet = setLines.map((line, idx) => {
    if (line === '') return '';
    if (line.startsWith('--')) return line;
    const clean = line.replace(/,+$/, '');
    return (idx === lastAssignment) ? clean : `${clean},`;
  });

  const whereClause = where.trim().toUpperCase().startsWith('WHERE ')
    ? where.trim()
    : `WHERE ${where.trim()}`;

  const returningLines = [];
  if (returning && Array.isArray(returning) && returning.length > 0) {
    returningLines.push('RETURNING');
    returningLines.push(`  ${returning.map(r => String(r).trim()).join(',\n  ')}`);
  } else if (returning) {
    const ret = String(returning).trim().replace(/;$/, '');
    if (ret) {
      returningLines.push('RETURNING');
      returningLines.push(`  ${ret}`);
    }
  }

  const lines = [
    `UPDATE ${table}`,
    'SET',
    `  ${renderedSet.join('\n  ')}`,
    whereClause,
  ];
  if (returningLines.length > 0) {
    lines.push(...returningLines);
  }
  lines[lines.length - 1] = `${lines[lines.length - 1]};`;

  return lines.join('\n');
}

function buildReadContinue(opts) {
  const config = requireConfig(opts);
  const scoring = config.scoring;
  const entries_table = opts.entries_table;
  const q = String(opts.q ?? '').trim();
  let days = Number(opts.days);
  if (!days) {
    days = Number(scoring.daysByCmd.continue);
  }
  const maxLimit = Number(scoring.maxItems.continue);
  let limit = Number(opts.limit);
  if (!limit) {
    limit = maxLimit;
  }
  limit = Math.min(maxLimit, Math.max(1, limit));
  const W = scoring.weightsByCmd.continue;
  const halfLife = Number(scoring.recencyByCmd.continue.half_life_days);
  const noteQuota = Number(scoring.noteQuotaByCmd.continue);

  return `
WITH params AS (
  SELECT
    ${lit(q)}::text AS qtext,
    websearch_to_tsquery('english', ${lit(q)}) AS tsq,
    ${days}::int AS days,
    ${limit}::int AS lim,
    ${halfLife}::real AS half_life_days,
    ${noteQuota}::real AS note_quota
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
),

scored AS (
  SELECT
    b.*,
    ts_rank_cd(b.t1_tsv, b.tsq) AS t1_rank,
    ts_rank_cd(e.tsv, b.tsq) AS fts_rank,

    (
      (CASE WHEN lower(b.topic_primary) = lower(b.qtext) THEN ${Number(W.topic_primary_exact || 0)} ELSE 0 END) +
      (CASE WHEN lower(b.topic_primary) LIKE lower(b.qtext) || '%' THEN ${Number(W.topic_primary_fuzzy || 0)} ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) = lower(b.qtext) THEN ${Number(W.topic_secondary_exact || 0)} ELSE 0 END) +
      (CASE WHEN lower(b.topic_secondary) LIKE '%' || lower(b.qtext) || '%' THEN ${Number(W.topic_secondary_fuzzy || 0)} ELSE 0 END) +

      -- keywords overlap (fixed)
      LEAST(
        ${Number(W.keywords_overlap_cap || 0)},
        ${Number(W.keywords_overlap_each || 0)} * (
          SELECT count(*)
          FROM unnest(b.keywords) kw
          WHERE kw <> ''
            AND lower(kw) = ANY (regexp_split_to_array(lower(b.qtext), '\\s+'))
        )
      ) +

      (CASE WHEN b.gist ILIKE '%' || b.qtext || '%' THEN ${Number(W.gist_match || 0)} ELSE 0 END) +
      (CASE WHEN b.title ILIKE '%' || b.qtext || '%' THEN ${Number(W.title_match || 0)} ELSE 0 END) +
      (CASE WHEN b.author ILIKE '%' || b.qtext || '%' THEN ${Number(W.author_match || 0)} ELSE 0 END) +

      (${Number(W.fts_rank || 0)} * ts_rank_cd(e.tsv, b.tsq)) +

      (CASE WHEN b.content_type = 'note' THEN ${Number(W.prefer_content_type_note || 0)} ELSE 0 END) +
      (CASE WHEN b.intent = 'think' THEN ${Number(W.prefer_intent_think || 0)} ELSE 0 END) +
      (CASE WHEN b.topic_primary <> '' THEN ${Number(W.prefer_enriched || 0)} ELSE 0 END) +

      (10.0 * b.quality_score) +
      (5.0 * b.recency) -

      (CASE WHEN b.boilerplate_heavy THEN ${Number(W.penalty_boilerplate_heavy || 0)} ELSE 0 END) -
      (CASE WHEN b.low_signal THEN ${Number(W.penalty_low_signal || 0)} ELSE 0 END) -
      (CASE WHEN b.link_ratio > 0.18 THEN ${Number(W.penalty_link_ratio_high || 0)} ELSE 0 END)
    ) AS score
  FROM base b
  JOIN ${entries_table} e ON e.id = b.id
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
}

function buildReadFind(opts) {
  const config = requireConfig(opts);
  const scoring = config.scoring;
  const entries_table = opts.entries_table;
  const q = String(opts.q ?? '').trim();
  let days = Number(opts.days);
  if (!days) {
    days = Number(scoring.daysByCmd.find);
  }
  const maxLimit = Number(scoring.maxItems.find);
  let limit = Number(opts.limit);
  if (!limit) {
    limit = maxLimit;
  }
  limit = Math.min(maxLimit, Math.max(1, limit));
  const needle = String(escapeLikeWildcards(q));
  const W = scoring.weightsByCmd.find;

  return `
WITH params AS (
  SELECT
    ${lit(q)}::text AS qtext,
    websearch_to_tsquery('english', ${lit(q)}) AS tsq,
    ${days}::int AS days,
    ${limit}::int AS lim,
    ${lit(needle)}::text AS needle
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
}

function buildReadLast(opts) {
  const config = requireConfig(opts);
  const scoring = config.scoring;
  const entries_table = opts.entries_table;
  const q = String(opts.q ?? '').trim();
  let days = Number(opts.days);
  if (!days) {
    days = Number(scoring.daysByCmd.last);
  }
  const maxLimit = Number(scoring.maxItems.last);
  let limit = Number(opts.limit);
  if (!limit) {
    limit = maxLimit;
  }
  limit = Math.min(maxLimit, Math.max(1, limit));
  const W = scoring.weightsByCmd.last;
  const halfLife = Number(scoring.recencyByCmd.last.half_life_days);

  return `
WITH params AS (
  SELECT
    ${lit(q)}::text AS qtext,
    websearch_to_tsquery('english', ${lit(q)}) AS tsq,
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
      (CASE WHEN b.link_ratio > 0.18 THEN ${Number(W.penalty_link_ratio_high || 0)} ELSE 0 END)
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
}

function buildReadPull(opts) {
  const entries_table = opts.entries_table;
  const entry_id = opts.entry_id;
  const shortN = Number(opts.shortN ?? 320);
  const longN = Number(opts.longN ?? 1800);

  return `
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
WHERE entry_id = ${bigIntLit(entry_id)}::bigint
LIMIT 1;
`.trim();
}
