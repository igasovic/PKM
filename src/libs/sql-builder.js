/**
 * SQL Builder — Stateless helpers for safe SQL literal/identifier construction
 * =============================================================================
 *
 * USER GUIDE (for agents)
 * ----------------------
 * Use this library in src/n8n/nodes when building SQL for Postgres (INSERT/UPDATE/SELECT).
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
  buildReadWorkingMemory,
  buildReadSmoke,
  buildReadEntities,
  buildTier1UnclassifiedCandidates,
  buildTier2CandidateDiscovery,
  buildTier2SelectedDetailQuery,
  buildTier2EntryByEntryId,
  buildTier2PersistEligibilityStatus,
  buildT1BatchUpsert,
  buildT1BatchItemsInsert,
  buildT1BatchResultsUpsert,
  buildT2BatchItemsInsert,
  buildT2BatchResultsUpsert,
  buildT2BatchReconcileRows,
  buildT2BatchMarkResultsApplied,
  buildT1BatchSummary,
  buildT1BatchFind,
  buildT1BatchListPending,
  buildT1BatchListCollectCandidates,
  buildT1BatchStatusList,
  buildT1BatchStatusById,
  buildT1BatchItemStatusList,
  buildT1BatchItemRequests,
  buildT2BatchItemStatusList,
  buildTier2EntryStatesByEntryIds,
  buildInsertPipelineEvent,
  buildGetPipelineEventsByRunId,
  buildGetRecentPipelineRuns,
  buildGetLastPipelineRunId,
  buildPrunePipelineEvents,
  buildUpsertFailurePack,
  buildGetFailurePackById,
  buildGetFailurePackByRootExecutionId,
  buildGetFailurePackByRunId,
  buildListFailurePacks,
  buildListOpenFailurePacks,
  buildAnalyzeFailurePackById,
  buildResolveFailurePackById,
  buildTier2MarkStale,
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
 * Build bulk insert SQL for Tier-2 batch request items.
 * @param {{ itemsTable: string, rowCount: number }} opts
 * @returns {string}
 */
function buildT2BatchItemsInsert(opts) {
  const itemsTable = opts && opts.itemsTable;
  const rowCount = Number(opts && opts.rowCount);
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT2BatchItemsInsert: itemsTable must be a non-empty string');
  }
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new Error('buildT2BatchItemsInsert: rowCount must be a positive integer');
  }
  const values = [];
  let idx = 1;
  for (let i = 0; i < rowCount; i++) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, now())`);
  }
  return `INSERT INTO ${itemsTable}
  (batch_id, custom_id, entry_id, content_hash, route, chunking_strategy, request_type, title, author, content_type, prompt_mode, prompt, retry_count, created_at)
VALUES ${values.join(', ')}
ON CONFLICT (batch_id, custom_id) DO NOTHING`;
}

/**
 * Build bulk upsert SQL for Tier-2 batch item results.
 * @param {{ resultsTable: string, rowCount: number }} opts
 * @returns {string}
 */
function buildT2BatchResultsUpsert(opts) {
  const resultsTable = opts && opts.resultsTable;
  const rowCount = Number(opts && opts.rowCount);
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT2BatchResultsUpsert: resultsTable must be a non-empty string');
  }
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new Error('buildT2BatchResultsUpsert: rowCount must be a positive integer');
  }
  const values = [];
  let idx = 1;
  for (let i = 0; i < rowCount; i++) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}::jsonb, $${idx++}::jsonb, $${idx++}::boolean, now(), now())`);
  }
  return `INSERT INTO ${resultsTable}
  (batch_id, custom_id, status, response_text, parsed, error, raw, applied, updated_at, created_at)
VALUES ${values.join(', ')}
ON CONFLICT (batch_id, custom_id) DO UPDATE SET
  status = EXCLUDED.status,
  response_text = EXCLUDED.response_text,
  parsed = EXCLUDED.parsed,
  error = EXCLUDED.error,
  raw = EXCLUDED.raw,
  applied = COALESCE(EXCLUDED.applied, ${resultsTable}.applied),
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
 * Build SQL for reading stored request payloads for a batch.
 * @param {{ itemsTable: string }} opts
 * @returns {string}
 */
function buildT1BatchItemRequests(opts) {
  const itemsTable = opts && opts.itemsTable;
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT1BatchItemRequests: itemsTable must be a non-empty string');
  }
  return `SELECT custom_id, prompt, prompt_mode, title, author, content_type
FROM ${itemsTable}
WHERE batch_id = $1
ORDER BY created_at ASC`;
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
 * Build SQL for listing Tier-1 batch ids that should be collected.
 * Includes normal non-terminal batches and recovery candidates where a batch
 * was marked completed but has zero persisted item results.
 * @param {{ batchesTable: string, itemsTable: string, resultsTable: string }} opts
 * @returns {string}
 */
function buildT1BatchListCollectCandidates(opts) {
  const batchesTable = opts && opts.batchesTable;
  const itemsTable = opts && opts.itemsTable;
  const resultsTable = opts && opts.resultsTable;
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT1BatchListCollectCandidates: batchesTable must be a non-empty string');
  }
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT1BatchListCollectCandidates: itemsTable must be a non-empty string');
  }
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT1BatchListCollectCandidates: resultsTable must be a non-empty string');
  }
  return `SELECT b.batch_id
FROM ${batchesTable} b
LEFT JOIN (
  SELECT batch_id, COUNT(*)::int AS total_items
  FROM ${itemsTable}
  GROUP BY batch_id
) i ON i.batch_id = b.batch_id
LEFT JOIN (
  SELECT batch_id, COUNT(*)::int AS processed_count
  FROM ${resultsTable}
  GROUP BY batch_id
) r ON r.batch_id = b.batch_id
WHERE (
  b.status IS NULL
  OR b.status = ''
  OR b.status <> ALL($1::text[])
)
OR (
  lower(COALESCE(b.status, '')) = 'completed'
  AND COALESCE(b.request_count, 0) > 0
  AND COALESCE(i.total_items, 0) > 0
  AND COALESCE(r.processed_count, 0) = 0
  AND COALESCE(b.metadata->>'auto_retry_spawned_batch_id', '') = ''
)
ORDER BY b.created_at ASC
LIMIT $2`;
}

/**
 * Build SQL for listing batch status rows with item/result counters.
 * @param {{ batchesTable: string, itemsTable: string, resultsTable: string, includeTerminal?: boolean }} opts
 * @returns {string}
 */
function buildT1BatchStatusList(opts) {
  const batchesTable = opts && opts.batchesTable;
  const itemsTable = opts && opts.itemsTable;
  const resultsTable = opts && opts.resultsTable;
  const includeTerminal = !!(opts && opts.includeTerminal);
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT1BatchStatusList: batchesTable must be a non-empty string');
  }
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT1BatchStatusList: itemsTable must be a non-empty string');
  }
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT1BatchStatusList: resultsTable must be a non-empty string');
  }
  const filter = includeTerminal
    ? ''
    : `WHERE b.status IS NULL
   OR b.status = ''
   OR b.status <> ALL($1::text[])`;
  const limitRef = includeTerminal ? '$1' : '$2';
  return `SELECT
  b.batch_id,
  b.status,
  b.model,
  b.input_file_id,
  b.output_file_id,
  b.error_file_id,
  b.request_count,
  b.metadata,
  b.created_at,
  COALESCE(i.total_items, 0)::int AS total_items,
  COALESCE(r.processed_count, 0)::int AS processed_count,
  COALESCE(r.ok_count, 0)::int AS ok_count,
  COALESCE(r.parse_error_count, 0)::int AS parse_error_count,
  COALESCE(r.error_count, 0)::int AS error_count,
  GREATEST(COALESCE(i.total_items, 0) - COALESCE(r.processed_count, 0), 0)::int AS pending_count
FROM ${batchesTable} b
LEFT JOIN (
  SELECT batch_id, COUNT(*)::int AS total_items
  FROM ${itemsTable}
  GROUP BY batch_id
) i ON i.batch_id = b.batch_id
LEFT JOIN (
  SELECT
    batch_id,
    COUNT(*)::int AS processed_count,
    COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_count,
    COUNT(*) FILTER (WHERE status = 'parse_error')::int AS parse_error_count,
    COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
  FROM ${resultsTable}
  GROUP BY batch_id
) r ON r.batch_id = b.batch_id
${filter}
ORDER BY b.created_at DESC
LIMIT ${limitRef}`;
}

/**
 * Build SQL for one batch status row with item/result counters.
 * @param {{ batchesTable: string, itemsTable: string, resultsTable: string }} opts
 * @returns {string}
 */
function buildT1BatchStatusById(opts) {
  const batchesTable = opts && opts.batchesTable;
  const itemsTable = opts && opts.itemsTable;
  const resultsTable = opts && opts.resultsTable;
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT1BatchStatusById: batchesTable must be a non-empty string');
  }
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT1BatchStatusById: itemsTable must be a non-empty string');
  }
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT1BatchStatusById: resultsTable must be a non-empty string');
  }
  return `SELECT
  b.batch_id,
  b.status,
  b.model,
  b.input_file_id,
  b.output_file_id,
  b.error_file_id,
  b.request_count,
  b.metadata,
  b.created_at,
  COALESCE(i.total_items, 0)::int AS total_items,
  COALESCE(r.processed_count, 0)::int AS processed_count,
  COALESCE(r.ok_count, 0)::int AS ok_count,
  COALESCE(r.parse_error_count, 0)::int AS parse_error_count,
  COALESCE(r.error_count, 0)::int AS error_count,
  GREATEST(COALESCE(i.total_items, 0) - COALESCE(r.processed_count, 0), 0)::int AS pending_count
FROM ${batchesTable} b
LEFT JOIN (
  SELECT batch_id, COUNT(*)::int AS total_items
  FROM ${itemsTable}
  GROUP BY batch_id
) i ON i.batch_id = b.batch_id
LEFT JOIN (
  SELECT
    batch_id,
    COUNT(*)::int AS processed_count,
    COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_count,
    COUNT(*) FILTER (WHERE status = 'parse_error')::int AS parse_error_count,
    COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
  FROM ${resultsTable}
  GROUP BY batch_id
) r ON r.batch_id = b.batch_id
WHERE b.batch_id = $1
LIMIT 1`;
}

/**
 * Build SQL for item-level statuses within one batch.
 * @param {{ itemsTable: string, resultsTable: string }} opts
 * @returns {string}
 */
function buildT1BatchItemStatusList(opts) {
  const itemsTable = opts && opts.itemsTable;
  const resultsTable = opts && opts.resultsTable;
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT1BatchItemStatusList: itemsTable must be a non-empty string');
  }
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT1BatchItemStatusList: resultsTable must be a non-empty string');
  }
  return `SELECT
  i.custom_id,
  i.title,
  i.author,
  i.content_type,
  i.prompt_mode,
  i.created_at,
  COALESCE(r.status, 'pending') AS status,
  COALESCE(
    NULLIF(r.error->>'code', ''),
    CASE
      WHEN r.status IN ('parse_error', 'error') THEN r.status
      ELSE NULL
    END
  ) AS error_code,
  NULLIF(r.error->>'message', '') AS message,
  r.updated_at,
  (r.error IS NOT NULL) AS has_error
FROM ${itemsTable} i
LEFT JOIN ${resultsTable} r
  ON r.batch_id = i.batch_id
 AND r.custom_id = i.custom_id
WHERE i.batch_id = $1
ORDER BY i.created_at ASC
LIMIT $2`;
}

/**
 * Build SQL for Tier-2 item-level statuses within one batch.
 * Includes error payload fields so API can expose failure details.
 * @param {{ itemsTable: string, resultsTable: string }} opts
 * @returns {string}
 */
function buildT2BatchItemStatusList(opts) {
  const itemsTable = opts && opts.itemsTable;
  const resultsTable = opts && opts.resultsTable;
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT2BatchItemStatusList: itemsTable must be a non-empty string');
  }
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT2BatchItemStatusList: resultsTable must be a non-empty string');
  }
  return `SELECT
  i.custom_id,
  i.entry_id,
  i.title,
  i.author,
  i.content_type,
  i.prompt_mode,
  i.created_at,
  COALESCE(r.status, 'pending') AS status,
  COALESCE(
    NULLIF(r.error->>'code', ''),
    CASE
      WHEN r.status IN ('parse_error', 'error') THEN r.status
      ELSE NULL
    END
  ) AS error_code,
  NULLIF(r.error->>'message', '') AS message,
  COALESCE((r.error->>'preserved_current_artifact')::boolean, false) AS preserved_current_artifact,
  r.response_text,
  r.error,
  r.updated_at,
  (
    r.error IS NOT NULL OR
    (
      r.status IS NOT NULL AND
      r.status <> 'ok' AND
      r.status <> 'pending'
    )
  ) AS has_error
FROM ${itemsTable} i
LEFT JOIN ${resultsTable} r
  ON r.batch_id = i.batch_id
 AND r.custom_id = i.custom_id
WHERE i.batch_id = $1
ORDER BY i.created_at ASC
LIMIT $2`;
}

/**
 * Build SQL for loading unapplied Tier-2 batch results with request metadata.
 * @param {{ batchesTable: string, itemsTable: string, resultsTable: string }} opts
 * @returns {string}
 */
function buildT2BatchReconcileRows(opts) {
  const batchesTable = opts && opts.batchesTable;
  const itemsTable = opts && opts.itemsTable;
  const resultsTable = opts && opts.resultsTable;
  if (!batchesTable || typeof batchesTable !== 'string') {
    throw new Error('buildT2BatchReconcileRows: batchesTable must be a non-empty string');
  }
  if (!itemsTable || typeof itemsTable !== 'string') {
    throw new Error('buildT2BatchReconcileRows: itemsTable must be a non-empty string');
  }
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT2BatchReconcileRows: resultsTable must be a non-empty string');
  }
  return `SELECT
  i.batch_id,
  i.custom_id,
  i.entry_id,
  i.content_hash AS expected_content_hash,
  i.route,
  i.chunking_strategy,
  i.request_type,
  i.retry_count,
  i.prompt_mode,
  i.title,
  i.author,
  i.content_type,
  b.model,
  b.metadata AS batch_metadata,
  r.status AS result_status,
  r.response_text,
  r.parsed,
  r.error,
  r.raw,
  r.updated_at
FROM ${itemsTable} i
JOIN ${resultsTable} r
  ON r.batch_id = i.batch_id
 AND r.custom_id = i.custom_id
LEFT JOIN ${batchesTable} b
  ON b.batch_id = i.batch_id
WHERE
  i.batch_id = $1
  AND COALESCE(r.applied, false) = false
ORDER BY i.created_at ASC
LIMIT $2`;
}

/**
 * Build SQL for marking Tier-2 result rows as applied.
 * @param {{ resultsTable: string }} opts
 * @returns {string}
 */
function buildT2BatchMarkResultsApplied(opts) {
  const resultsTable = opts && opts.resultsTable;
  if (!resultsTable || typeof resultsTable !== 'string') {
    throw new Error('buildT2BatchMarkResultsApplied: resultsTable must be a non-empty string');
  }
  return `UPDATE ${resultsTable}
SET
  applied = true,
  applied_at = now(),
  updated_at = now()
WHERE
  batch_id = $1
  AND custom_id = ANY($2::text[])
  AND COALESCE(applied, false) = false
RETURNING custom_id`;
}

/**
 * Build SQL for inserting one pipeline transition event.
 * @param {{ eventsTable: string }} opts
 * @returns {string}
 */
function buildInsertPipelineEvent(opts) {
  const eventsTable = opts && opts.eventsTable;
  if (!eventsTable || typeof eventsTable !== 'string') {
    throw new Error('buildInsertPipelineEvent: eventsTable must be a non-empty string');
  }
  return `INSERT INTO ${eventsTable}
  (run_id, seq, service, pipeline, step, direction, level, duration_ms, entry_id, batch_id, trace_id, input_summary, output_summary, error, artifact_path, meta)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16::jsonb)
RETURNING event_id, ts, run_id, seq`;
}

/**
 * Build SQL for loading events by run id.
 * @param {{ eventsTable: string }} opts
 * @returns {string}
 */
function buildGetPipelineEventsByRunId(opts) {
  const eventsTable = opts && opts.eventsTable;
  if (!eventsTable || typeof eventsTable !== 'string') {
    throw new Error('buildGetPipelineEventsByRunId: eventsTable must be a non-empty string');
  }
  return `SELECT *
FROM ${eventsTable}
WHERE run_id = $1
ORDER BY seq ASC, ts ASC
LIMIT $2`;
}

/**
 * Build SQL for listing recent run summaries from pipeline events.
 * @param {{ eventsTable: string }} opts
 * @returns {string}
 */
function buildGetRecentPipelineRuns(opts) {
  const eventsTable = opts && opts.eventsTable;
  if (!eventsTable || typeof eventsTable !== 'string') {
    throw new Error('buildGetRecentPipelineRuns: eventsTable must be a non-empty string');
  }
  return `WITH runs AS (
  SELECT
    e.run_id,
    MIN(e.ts) AS started_at,
    MAX(e.ts) AS ended_at,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (MAX(e.ts) - MIN(e.ts))) * 1000))::bigint AS total_ms,
    COUNT(*)::int AS event_count,
    COUNT(*) FILTER (WHERE e.direction = 'error')::int AS error_count,
    COUNT(*) FILTER (WHERE e.direction = 'start')::int AS start_count,
    COUNT(*) FILTER (WHERE e.direction = 'end')::int AS end_count,
    COUNT(*) FILTER (WHERE e.direction = 'error')::int AS error_event_count
  FROM ${eventsTable} e
  WHERE
    ($1::timestamptz IS NULL OR e.ts < $1::timestamptz)
    AND (
      ($4::text IS NULL AND $5::text IS NULL)
      OR EXISTS (
        SELECT 1
        FROM ${eventsTable} f
        WHERE
          f.run_id = e.run_id
          AND ($4::text IS NULL OR COALESCE(f.pipeline, '') ILIKE ('%' || $4::text || '%'))
          AND ($5::text IS NULL OR COALESCE(f.step, '') ILIKE ('%' || $5::text || '%'))
      )
    )
  GROUP BY e.run_id
)
SELECT
  run_id,
  started_at,
  ended_at,
  total_ms,
  event_count,
  error_count,
  GREATEST(start_count - end_count - error_event_count, 0)::int AS missing_end_count
FROM runs
WHERE (
  $2::boolean IS NULL OR
  ($2::boolean = true AND error_count > 0) OR
  ($2::boolean = false AND error_count = 0)
)
ORDER BY ended_at DESC
LIMIT $3`;
}

/**
 * Build SQL for retrieving the most recent run id.
 * @param {{ eventsTable: string }} opts
 * @returns {string}
 */
function buildGetLastPipelineRunId(opts) {
  const eventsTable = opts && opts.eventsTable;
  const excludeRunId = !!(opts && opts.excludeRunId);
  if (!eventsTable || typeof eventsTable !== 'string') {
    throw new Error('buildGetLastPipelineRunId: eventsTable must be a non-empty string');
  }
  const where = excludeRunId ? 'WHERE run_id <> $1' : '';
  return `SELECT run_id
FROM ${eventsTable}
${where}
GROUP BY run_id
ORDER BY MAX(ts) DESC
LIMIT 1`;
}

/**
 * Build SQL for pruning old pipeline events by retention days.
 * @param {{ eventsTable: string }} opts
 * @returns {string}
 */
function buildPrunePipelineEvents(opts) {
  const eventsTable = opts && opts.eventsTable;
  if (!eventsTable || typeof eventsTable !== 'string') {
    throw new Error('buildPrunePipelineEvents: eventsTable must be a non-empty string');
  }
  return `DELETE FROM ${eventsTable}
WHERE ts < now() - ($1::int * interval '1 day')`;
}

/**
 * Build SQL for upserting one failure-pack row by root_execution_id.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildUpsertFailurePack(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildUpsertFailurePack: failurePacksTable must be a non-empty string');
  }
  return `INSERT INTO ${failurePacksTable} AS fp (
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  has_sidecars,
  sidecar_root,
  pack,
  updated_at
)
VALUES (
  $1,
  $2,
  $3::text[],
  $4,
  $5,
  $6,
  $7,
  $8::timestamptz,
  $9,
  $10,
  $11,
  $12,
  $13,
  $14::boolean,
  $15,
  $16::jsonb,
  now()
)
ON CONFLICT (root_execution_id) DO UPDATE SET
  reporting_workflow_names = (
    SELECT COALESCE(array_agg(name ORDER BY name), '{}'::text[])
    FROM (
      SELECT DISTINCT name
      FROM unnest(
        COALESCE(fp.reporting_workflow_names, '{}'::text[])
        || COALESCE(EXCLUDED.reporting_workflow_names, '{}'::text[])
      ) AS name
      WHERE name IS NOT NULL AND btrim(name) <> ''
    ) merged
  ),
  has_sidecars = (fp.has_sidecars OR EXCLUDED.has_sidecars),
  sidecar_root = COALESCE(fp.sidecar_root, EXCLUDED.sidecar_root),
  pack = COALESCE(fp.pack, EXCLUDED.pack),
  failed_at = COALESCE(fp.failed_at, EXCLUDED.failed_at),
  mode = COALESCE(fp.mode, EXCLUDED.mode),
  updated_at = now()
RETURNING
  failure_id,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  status,
  CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END AS upsert_action`;
}

/**
 * Build SQL for loading one failure-pack row by failure_id.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildGetFailurePackById(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildGetFailurePackById: failurePacksTable must be a non-empty string');
  }
  return `SELECT
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  analysis_reason,
  proposed_fix,
  analyzed_at,
  has_sidecars,
  sidecar_root,
  pack
FROM ${failurePacksTable}
WHERE failure_id = $1::uuid
LIMIT 1`;
}

/**
 * Build SQL for loading one failure-pack row by run_id.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildGetFailurePackByRootExecutionId(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildGetFailurePackByRootExecutionId: failurePacksTable must be a non-empty string');
  }
  return `SELECT
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  analysis_reason,
  proposed_fix,
  analyzed_at,
  has_sidecars,
  sidecar_root,
  pack
FROM ${failurePacksTable}
WHERE root_execution_id = $1
LIMIT 1`;
}

/**
 * Build SQL for loading one failure-pack row by run_id.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildGetFailurePackByRunId(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildGetFailurePackByRunId: failurePacksTable must be a non-empty string');
  }
  return `SELECT
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  analysis_reason,
  proposed_fix,
  analyzed_at,
  has_sidecars,
  sidecar_root,
  pack
FROM ${failurePacksTable}
WHERE run_id = $1
LIMIT 1`;
}

/**
 * Build SQL for listing recent failure-pack summaries.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildListFailurePacks(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildListFailurePacks: failurePacksTable must be a non-empty string');
  }
  return `SELECT
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  analysis_reason,
  proposed_fix,
  analyzed_at,
  has_sidecars,
  sidecar_root
FROM ${failurePacksTable}
WHERE
  ($1::timestamptz IS NULL OR failed_at < $1::timestamptz)
  AND ($2::text IS NULL OR workflow_name ILIKE ('%' || $2 || '%'))
  AND ($3::text IS NULL OR node_name ILIKE ('%' || $3 || '%'))
  AND ($4::text IS NULL OR mode = $4::text)
ORDER BY failed_at DESC NULLS LAST, created_at DESC
LIMIT $5::int`;
}

/**
 * Build SQL for listing currently open (captured) failure packs.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildListOpenFailurePacks(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildListOpenFailurePacks: failurePacksTable must be a non-empty string');
  }
  return `SELECT
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  has_sidecars,
  sidecar_root
FROM ${failurePacksTable}
WHERE status = 'captured'
ORDER BY failed_at DESC NULLS LAST, created_at DESC
LIMIT $1::int`;
}

/**
 * Build SQL for writing analysis text and transitioning to analyzed.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildAnalyzeFailurePackById(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildAnalyzeFailurePackById: failurePacksTable must be a non-empty string');
  }
  return `UPDATE ${failurePacksTable}
SET
  analysis_reason = $2::text,
  proposed_fix = $3::text,
  analyzed_at = now(),
  status = 'analyzed',
  updated_at = now()
WHERE
  failure_id = $1::uuid
  AND status IN ('captured', 'analyzed')
RETURNING
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  analysis_reason,
  proposed_fix,
  analyzed_at,
  has_sidecars,
  sidecar_root,
  pack`;
}

/**
 * Build SQL for resolving one failure row.
 * @param {{ failurePacksTable: string }} opts
 * @returns {string}
 */
function buildResolveFailurePackById(opts) {
  const failurePacksTable = opts && opts.failurePacksTable;
  if (!failurePacksTable || typeof failurePacksTable !== 'string') {
    throw new Error('buildResolveFailurePackById: failurePacksTable must be a non-empty string');
  }
  return `UPDATE ${failurePacksTable}
SET
  status = 'resolved',
  updated_at = now()
WHERE failure_id = $1::uuid
RETURNING
  failure_id,
  created_at,
  updated_at,
  run_id,
  root_execution_id,
  reporting_workflow_names,
  execution_id,
  workflow_id,
  workflow_name,
  mode,
  failed_at,
  node_name,
  node_type,
  error_name,
  error_message,
  status,
  analysis_reason,
  proposed_fix,
  analyzed_at,
  has_sidecars,
  sidecar_root,
  pack`;
}

function buildTier2MarkStale(opts) {
  const entriesTable = opts && opts.entriesTable;
  if (!entriesTable || typeof entriesTable !== 'string') {
    throw new Error('buildTier2MarkStale: entriesTable must be a non-empty string');
  }
  return `UPDATE ${entriesTable}
SET
  distill_status = 'stale',
  distill_metadata = COALESCE(distill_metadata, '{}'::jsonb) || jsonb_build_object('stale_marked_at', now())
WHERE
  distill_status = 'completed'
  AND content_hash IS DISTINCT FROM distill_created_from_hash
RETURNING id`;
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
    COALESCE(e.distill_summary,'') AS distill_summary,
    COALESCE(e.distill_why_it_matters,'') AS distill_why_it_matters,
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
    NULL::text AS distill_summary,
    NULL::text AS distill_why_it_matters,
    NULL::text AS gist,
    NULL::text AS excerpt,
    NULL::text[] AS keywords,
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
    h.distill_summary,
    h.distill_why_it_matters,
    h.gist,
    h.excerpt,
    h.keywords,
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
    COALESCE(e.distill_summary,'') AS distill_summary,
    COALESCE(e.distill_why_it_matters,'') AS distill_why_it_matters,
    COALESCE(e.gist,'') AS gist,
    COALESCE(e.retrieval_excerpt, e.metadata #>> '{retrieval,excerpt}', '') AS excerpt,
    COALESCE(e.keywords, ARRAY[]::text[]) AS keywords,

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
  NULL::text AS distill_summary,
  NULL::text AS distill_why_it_matters,
  NULL::text AS gist,
  NULL::text AS excerpt,
  NULL::text[] AS keywords,
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
  h.distill_summary,
  h.distill_why_it_matters,
  h.gist,
  h.excerpt,
  h.keywords,
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
    COALESCE(e.distill_summary,'') AS distill_summary,
    COALESCE(e.distill_why_it_matters,'') AS distill_why_it_matters,
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
    distill_summary,
    distill_why_it_matters,
    gist,
    excerpt,
    keywords,
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
  NULL::text AS distill_summary,
  NULL::text AS distill_why_it_matters,
  NULL::text AS gist,
  NULL::text AS excerpt,
  NULL::text[] AS keywords,
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
  h.distill_summary,
  h.distill_why_it_matters,
  h.gist,
  h.excerpt,
  h.keywords,
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
WITH req AS (
  SELECT ${bigIntLit(entry_id)}::bigint AS requested_entry_id
),
hit AS (
  SELECT
    TRUE AS found,
    e.entry_id,
    e.id,
    e.created_at,
    e.source,
    e.intent,
    e.content_type,
    COALESCE(e.title,'') AS title,
    COALESCE(e.author,'') AS author,
    COALESCE(e.url_canonical, e.url, '') AS url,
    COALESCE(e.topic_primary,'') AS topic_primary,
    COALESCE(e.topic_secondary,'') AS topic_secondary,
    COALESCE(e.distill_summary,'') AS distill_summary,
    COALESCE(e.distill_why_it_matters,'') AS distill_why_it_matters,
    COALESCE(e.gist,'') AS gist,
    COALESCE(e.clean_text, '') AS clean_text,
    e.keywords,

    -- legacy name expected by current telegram message builder
    left(COALESCE(e.retrieval_excerpt, e.metadata #>> '{retrieval,excerpt}', ''), ${shortN}) AS excerpt,

    -- optional long body for later /pull --excerpt
    left(regexp_replace(COALESCE(e.clean_text, e.capture_text), '\\s+', ' ', 'g'), ${longN}) AS excerpt_long
  FROM ${entries_table} e
  JOIN req r ON e.entry_id = r.requested_entry_id
  LIMIT 1
),
miss AS (
  SELECT
    FALSE AS found,
    r.requested_entry_id AS entry_id,
    NULL::uuid AS id,
    NULL::timestamptz AS created_at,
    NULL::text AS source,
    NULL::text AS intent,
    NULL::text AS content_type,
    ''::text AS title,
    ''::text AS author,
    ''::text AS url,
    ''::text AS topic_primary,
    ''::text AS topic_secondary,
    ''::text AS distill_summary,
    ''::text AS distill_why_it_matters,
    ''::text AS gist,
    ''::text AS clean_text,
    NULL::text[] AS keywords,
    ''::text AS excerpt,
    ''::text AS excerpt_long
  FROM req r
  WHERE NOT EXISTS (SELECT 1 FROM hit)
)
SELECT * FROM hit
UNION ALL
SELECT * FROM miss
LIMIT 1;
`.trim();
}

function buildReadWorkingMemory(opts) {
  const entries_table = String(opts && opts.entries_table ? opts.entries_table : '').trim();
  if (!entries_table) {
    throw new Error('buildReadWorkingMemory requires entries_table');
  }
  const topicKey = String(opts && opts.topic_key ? opts.topic_key : '').trim();
  if (!topicKey) {
    throw new Error('buildReadWorkingMemory requires topic_key');
  }
  const keyPrimary = `wm:${topicKey}`;

  return `
WITH req AS (
  SELECT ${lit(topicKey)}::text AS topic_key
),
hit AS (
  SELECT
    TRUE AS found,
    e.entry_id,
    e.id,
    e.created_at,
    e.source,
    e.intent,
    e.content_type,
    COALESCE(e.title, '') AS title,
    COALESCE(e.author, '') AS author,
    COALESCE(e.topic_primary, '') AS topic_primary,
    COALESCE(e.topic_secondary, '') AS topic_secondary,
    e.topic_secondary_confidence,
    COALESCE(e.gist, '') AS gist,
    COALESCE(e.distill_summary, '') AS distill_summary,
    COALESCE(e.distill_why_it_matters, '') AS distill_why_it_matters,
    COALESCE(e.retrieval_excerpt, '') AS excerpt,
    COALESCE(e.capture_text, '') AS capture_text,
    COALESCE(e.clean_text, '') AS clean_text,
    e.content_hash,
    e.metadata
  FROM ${entries_table} e
  JOIN req r ON e.idempotency_key_primary = ('wm:' || r.topic_key)
  WHERE
    e.source = 'chatgpt'
    AND e.content_type = 'working_memory'
    AND e.idempotency_policy_key = 'chatgpt_working_memory_v1'
  ORDER BY e.created_at DESC
  LIMIT 1
),
miss AS (
  SELECT
    FALSE AS found,
    NULL::bigint AS entry_id,
    NULL::uuid AS id,
    NULL::timestamptz AS created_at,
    'chatgpt'::text AS source,
    'thought'::text AS intent,
    'working_memory'::text AS content_type,
    ''::text AS title,
    ''::text AS author,
    ''::text AS topic_primary,
    ''::text AS topic_secondary,
    NULL::double precision AS topic_secondary_confidence,
    ''::text AS gist,
    ''::text AS distill_summary,
    ''::text AS distill_why_it_matters,
    ''::text AS excerpt,
    ''::text AS capture_text,
    ''::text AS clean_text,
    NULL::text AS content_hash,
    NULL::jsonb AS metadata
  FROM req
  WHERE NOT EXISTS (SELECT 1 FROM hit)
)
SELECT * FROM hit
UNION ALL
SELECT * FROM miss
LIMIT 1;
`.trim();
}

function buildReadSmoke(opts) {
  const entries_table = String(opts.entries_table || '').trim();
  if (!entries_table) {
    throw new Error('buildReadSmoke requires entries_table');
  }
  const suite = String(opts.suite ?? '').trim();
  if (!suite) {
    throw new Error('buildReadSmoke requires suite');
  }
  const runIdRaw = opts.run_id;
  const run_id = runIdRaw === null || runIdRaw === undefined ? '' : String(runIdRaw).trim();
  const runIdFilter = run_id
    ? `AND COALESCE(e.metadata #>> '{smoke,run_id}', '') = ${lit(run_id)}`
    : '';

  return `
SELECT
  e.entry_id,
  e.id,
  e.created_at,
  e.source,
  e.intent,
  e.content_type,
  e.metadata
FROM ${entries_table} e
WHERE
  COALESCE(e.metadata #>> '{smoke,suite}', '') = ${lit(suite)}
  ${runIdFilter}
ORDER BY e.entry_id ASC;
`.trim();
}

function buildReadEntities(opts) {
  const entries_table = String((opts && opts.entries_table) || '').trim();
  if (!entries_table) {
    throw new Error('buildReadEntities requires entries_table');
  }

  const pageRaw = Number(opts && opts.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 1;

  const pageSizeRaw = Number(opts && opts.page_size);
  const page_size = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
    ? Math.min(200, Math.trunc(pageSizeRaw))
    : 50;

  const offset = Math.max(0, (page - 1) * page_size);

  const schema = String((opts && opts.schema) || '').trim() || 'pkm';
  const is_test_mode = !!(opts && opts.is_test_mode);
  const topic_primary_options = Array.isArray(opts && opts.topic_primary_options)
    ? opts.topic_primary_options.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const filters = (opts && opts.filters && typeof opts.filters === 'object')
    ? opts.filters
    : {};

  const content_type = String((filters && filters.content_type) || '').trim();
  const source = String((filters && filters.source) || '').trim();
  const status = String((filters && filters.status) || '').trim();
  const intent = String((filters && filters.intent) || '').trim();
  const topic_primary = String((filters && filters.topic_primary) || '').trim();
  const created_from = String((filters && filters.created_from) || '').trim();
  const created_to = String((filters && filters.created_to) || '').trim();
  const quality_flag = String((filters && filters.quality_flag) || '').trim();
  const has_url = Object.prototype.hasOwnProperty.call(filters, 'has_url')
    ? filters.has_url
    : null;
  const has_url_lit = has_url === null || has_url === undefined ? 'NULL' : boolLit(has_url);

  return `
WITH params AS (
  SELECT
    ${page}::int AS page,
    ${page_size}::int AS page_size,
    ${offset}::int AS page_offset,
    NULLIF(${lit(content_type)}, '')::text AS content_type,
    NULLIF(${lit(source)}, '')::text AS source,
    NULLIF(${lit(status)}, '')::text AS status,
    NULLIF(${lit(intent)}, '')::text AS intent,
    NULLIF(${lit(topic_primary)}, '')::text AS topic_primary,
    NULLIF(${lit(created_from)}, '')::date AS created_from_date,
    NULLIF(${lit(created_to)}, '')::date AS created_to_date,
    NULLIF(${lit(quality_flag)}, '')::text AS quality_flag,
    ${has_url_lit}::boolean AS has_url
),
filtered AS (
  SELECT
    e.entry_id,
    e.id,
    e.created_at,
    e.source,
    e.intent,
    e.content_type,
    COALESCE(e.title, '') AS title,
    COALESCE(e.author, '') AS author,
    COALESCE(e.url_canonical, e.url, '') AS url,
    COALESCE(e.topic_primary, '') AS topic_primary,
    COALESCE(e.topic_secondary, '') AS topic_secondary,
    COALESCE(e.gist, '') AS gist,
    COALESCE(e.retrieval_excerpt, e.metadata #>> '{retrieval,excerpt}', '') AS excerpt,
    COALESCE(e.distill_status, 'pending') AS distill_status,
    COALESCE(e.low_signal, false) AS low_signal,
    COALESCE(e.boilerplate_heavy, false) AS boilerplate_heavy
  FROM ${entries_table} e
  CROSS JOIN params p
  WHERE
    (p.content_type IS NULL OR lower(COALESCE(e.content_type, '')) = lower(p.content_type))
    AND (p.source IS NULL OR lower(COALESCE(e.source, '')) = lower(p.source))
    AND (p.status IS NULL OR lower(COALESCE(e.distill_status, 'pending')) = lower(p.status))
    AND (p.intent IS NULL OR lower(COALESCE(e.intent, '')) = lower(p.intent))
    AND (p.topic_primary IS NULL OR lower(COALESCE(e.topic_primary, '')) = lower(p.topic_primary))
    AND (p.created_from_date IS NULL OR e.created_at >= p.created_from_date::timestamptz)
    AND (p.created_to_date IS NULL OR e.created_at < ((p.created_to_date + 1)::timestamptz))
    AND (
      p.has_url IS NULL OR
      (
        p.has_url = true
        AND NULLIF(btrim(COALESCE(e.url_canonical, e.url, '')), '') IS NOT NULL
      ) OR (
        p.has_url = false
        AND NULLIF(btrim(COALESCE(e.url_canonical, e.url, '')), '') IS NULL
      )
    )
    AND (
      p.quality_flag IS NULL OR
      (p.quality_flag = 'low_signal' AND COALESCE(e.low_signal, false) = true) OR
      (p.quality_flag = 'boilerplate_heavy' AND COALESCE(e.boilerplate_heavy, false) = true)
    )
),
totals AS (
  SELECT COUNT(*)::int AS total_count
  FROM filtered
),
page_hits AS (
  SELECT *
  FROM filtered
  ORDER BY created_at DESC, entry_id DESC
  LIMIT (SELECT page_size FROM params)
  OFFSET (SELECT page_offset FROM params)
)
SELECT
  TRUE AS is_meta,
  'entities'::text AS cmd,
  p.page,
  p.page_size,
  t.total_count,
  CASE
    WHEN t.total_count = 0 THEN 0
    ELSE CEIL(t.total_count::numeric / p.page_size::numeric)::int
  END AS total_pages,
  ${lit(schema)}::text AS schema,
  ${boolLit(is_test_mode)}::boolean AS is_test_mode,
  ${jsonbLit(topic_primary_options)} AS topic_primary_options,
  NULL::bigint AS entry_id,
  NULL::uuid AS id,
  NULL::timestamptz AS created_at,
  NULL::text AS source,
  NULL::text AS intent,
  NULL::text AS content_type,
  NULL::text AS title,
  NULL::text AS author,
  NULL::text AS url,
  NULL::text AS topic_primary,
  NULL::text AS topic_secondary,
  NULL::text AS gist,
  NULL::text AS excerpt,
  NULL::text AS distill_status,
  NULL::boolean AS low_signal,
  NULL::boolean AS boilerplate_heavy
FROM params p
CROSS JOIN totals t
UNION ALL
SELECT
  FALSE AS is_meta,
  'entities'::text AS cmd,
  p.page,
  p.page_size,
  t.total_count,
  CASE
    WHEN t.total_count = 0 THEN 0
    ELSE CEIL(t.total_count::numeric / p.page_size::numeric)::int
  END AS total_pages,
  ${lit(schema)}::text AS schema,
  ${boolLit(is_test_mode)}::boolean AS is_test_mode,
  NULL::jsonb AS topic_primary_options,
  h.entry_id,
  h.id,
  h.created_at,
  h.source,
  h.intent,
  h.content_type,
  h.title,
  h.author,
  h.url,
  h.topic_primary,
  h.topic_secondary,
  h.gist,
  h.excerpt,
  h.distill_status,
  h.low_signal,
  h.boilerplate_heavy
FROM page_hits h
CROSS JOIN params p
CROSS JOIN totals t
ORDER BY is_meta DESC, created_at DESC NULLS LAST, entry_id DESC NULLS LAST;
`.trim();
}

function buildTier1UnclassifiedCandidates(opts) {
  const entries_table = opts && opts.entries_table;
  if (!entries_table || typeof entries_table !== 'string') {
    throw new Error('buildTier1UnclassifiedCandidates: entries_table must be a non-empty string');
  }

  const limitRaw = Number(opts && opts.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 0;
  const limitSql = limit > 0 ? `\nLIMIT ${limit}` : '';

  return `
SELECT
  e.id,
  e.entry_id,
  COALESCE(e.title, '') AS title,
  COALESCE(e.author, '') AS author,
  COALESCE(e.content_type, '') AS content_type,
  COALESCE(e.clean_text, '') AS clean_text,
  COALESCE(e.topic_primary, '') AS topic_primary,
  COALESCE(e.gist, '') AS gist
FROM ${entries_table} e
WHERE
  (
    NULLIF(btrim(COALESCE(e.topic_primary, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(e.gist, '')), '') IS NULL
  )
ORDER BY e.entry_id ASC${limitSql};
`.trim();
}

function buildTier2CandidateDiscovery(opts) {
  const entries_table = opts && opts.entries_table;
  if (!entries_table || typeof entries_table !== 'string') {
    throw new Error('buildTier2CandidateDiscovery: entries_table must be a non-empty string');
  }
  const limitRaw = Number(opts && opts.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 250;

  return `
SELECT
  e.id,
  e.entry_id,
  e.content_hash,
  e.intent,
  e.content_type,
  e.author,
  e.topic_primary_confidence,
  e.topic_secondary_confidence,
  e.quality_score,
  e.clean_word_count,
  e.distill_status,
  e.distill_created_from_hash,
  e.created_at,
  (COALESCE(length(btrim(e.clean_text)), 0) > 0) AS has_usable_clean_text
FROM ${entries_table} e
WHERE
  COALESCE(e.distill_status, 'pending') <> 'queued'
  AND (
    e.content_hash IS NULL
    OR e.distill_created_from_hash IS NULL
    OR e.content_hash IS DISTINCT FROM e.distill_created_from_hash
  )
ORDER BY
  CASE WHEN e.content_type = 'newsletter' THEN 0 ELSE 1 END,
  CASE WHEN COALESCE(length(btrim(e.clean_text)), 0) > 0 THEN 0 ELSE 1 END,
  e.created_at ASC,
  e.id ASC
LIMIT ${limit};
`.trim();
}

function buildTier2SelectedDetailQuery(opts) {
  const entries_table = opts && opts.entries_table;
  if (!entries_table || typeof entries_table !== 'string') {
    throw new Error('buildTier2SelectedDetailQuery: entries_table must be a non-empty string');
  }
  const ids = Array.isArray(opts && opts.ids) ? opts.ids : [];
  if (!ids.length) {
    throw new Error('buildTier2SelectedDetailQuery: ids must be a non-empty array');
  }

  const valueRows = ids.map((id, index) => `(${lit(id)}::uuid, ${index + 1})`).join(',\n  ');
  return `
WITH selected_ids (id, ord) AS (
  VALUES
  ${valueRows}
)
SELECT
  e.id,
  e.entry_id,
  e.title,
  e.author,
  e.content_type,
  e.clean_text,
  e.clean_word_count,
  e.content_hash,
  e.distill_status,
  e.distill_created_from_hash,
  e.distill_metadata,
  e.created_at
FROM selected_ids s
JOIN ${entries_table} e ON e.id = s.id
ORDER BY s.ord ASC;
`.trim();
}

function buildTier2EntryByEntryId(opts) {
  const entries_table = opts && opts.entries_table;
  if (!entries_table || typeof entries_table !== 'string') {
    throw new Error('buildTier2EntryByEntryId: entries_table must be a non-empty string');
  }
  const entry_id = opts && opts.entry_id;
  return `
SELECT
  e.id,
  e.entry_id,
  e.title,
  e.author,
  e.content_type,
  e.clean_text,
  e.clean_word_count,
  e.content_hash,
  e.distill_status,
  e.distill_created_from_hash,
  e.distill_metadata,
  e.created_at
FROM ${entries_table} e
WHERE e.entry_id = ${bigIntLit(entry_id)}::bigint
LIMIT 1;
`.trim();
}

function buildTier2EntryStatesByEntryIds(opts) {
  const entries_table = opts && opts.entries_table;
  if (!entries_table || typeof entries_table !== 'string') {
    throw new Error('buildTier2EntryStatesByEntryIds: entries_table must be a non-empty string');
  }
  const entry_ids = Array.isArray(opts && opts.entry_ids) ? opts.entry_ids : [];
  if (!entry_ids.length) {
    throw new Error('buildTier2EntryStatesByEntryIds: entry_ids must be a non-empty array');
  }
  const valuesRows = entry_ids
    .map((value) => `(${bigIntLit(value)}::bigint)`)
    .join(',\n    ');
  return `
WITH ids(entry_id) AS (
  VALUES
    ${valuesRows}
)
SELECT
  e.entry_id,
  e.clean_text,
  e.content_hash,
  e.distill_status,
  e.distill_created_from_hash
FROM ids
LEFT JOIN ${entries_table} e
  ON e.entry_id = ids.entry_id
ORDER BY ids.entry_id ASC;
`.trim();
}

function buildTier2PersistEligibilityStatus(opts) {
  const entries_table = opts && opts.entries_table;
  if (!entries_table || typeof entries_table !== 'string') {
    throw new Error('buildTier2PersistEligibilityStatus: entries_table must be a non-empty string');
  }
  const ids = Array.isArray(opts && opts.ids) ? opts.ids : [];
  if (!ids.length) {
    throw new Error('buildTier2PersistEligibilityStatus: ids must be a non-empty array');
  }
  const status = String((opts && opts.status) || '').trim();
  if (!status) {
    throw new Error('buildTier2PersistEligibilityStatus: status must be a non-empty string');
  }
  const reasonCodeRaw = opts && Object.prototype.hasOwnProperty.call(opts, 'reason_code')
    ? opts.reason_code
    : null;
  const reasonCode = reasonCodeRaw === null || reasonCodeRaw === undefined
    ? null
    : String(reasonCodeRaw).trim();

  const valuesRows = ids.map((id) => `(${lit(id)}::uuid)`).join(',\n    ');
  return `
WITH target_ids (id) AS (
  VALUES
    ${valuesRows}
),
updated AS (
  UPDATE ${entries_table} e
  SET
    distill_status = ${lit(status)}::text,
    distill_metadata = COALESCE(e.distill_metadata, '{}'::jsonb) || jsonb_build_object(
      'eligibility',
      jsonb_build_object(
        'decision', ${lit(status)}::text,
        'reason_code', ${lit(reasonCode)}::text,
        'at', now()
      )
    )
  FROM target_ids t
  WHERE e.id = t.id
  RETURNING e.id, e.entry_id, e.distill_status
)
SELECT * FROM updated;
`.trim();
}
