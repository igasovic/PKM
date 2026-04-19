'use strict';

const sb = require('../../libs/sql-builder.js');
const { getConfig } = require('../../libs/config.js');
const { getPool } = require('../db-pool.js');
const { traceDb, braintrustSink } = require('../logger/braintrust.js');
const { getRuntimeDbSchema, getDeleteMoveMaxBatch, getDbAdminRole } = require('../runtime-env.js');
const { parseFailurePackSummary } = require('../../libs/failure-pack.js');

const IMMUTABLE_UPDATE_COLUMNS = new Set(['id', 'entry_id', 'created_at', 'tsv']);
const IDEMPOTENCY_REQUIRED_SOURCES = new Set(['email', 'email-batch', 'telegram', 'notion']);
const ADMIN_SCHEMAS = new Set(['pkm', 'pkm_test']);
const DELETE_MOVE_MAX_BATCH = getDeleteMoveMaxBatch();
const PREVIEW_LIMIT = 20;
const PIPELINE_EVENTS_SCHEMA = (() => {
  const raw = getRuntimeDbSchema();
  return sb.isValidIdent(raw) ? raw : 'pkm';
})();
const PIPELINE_EVENTS_TABLE = sb.qualifiedTable(PIPELINE_EVENTS_SCHEMA, 'pipeline_events');
const FAILURE_PACKS_TABLE = sb.qualifiedTable('pkm', 'failure_packs');
const CALENDAR_REQUESTS_TABLE = sb.qualifiedTable('pkm', 'calendar_requests');
const CALENDAR_EVENT_OBSERVATIONS_TABLE = sb.qualifiedTable('pkm', 'calendar_event_observations');
const CALENDAR_REQUEST_STATUSES = new Set([
  'received',
  'routed',
  'needs_clarification',
  'clarified',
  'normalized',
  'calendar_write_started',
  'calendar_created',
  'calendar_failed',
  'query_answered',
  'ignored',
]);
const CALENDAR_TERMINAL_STATUSES = new Set([
  'calendar_created',
  'calendar_failed',
  'query_answered',
  'ignored',
]);

const COLUMN_TYPES = {
  source: 'text',
  intent: 'text',
  capture_text: 'text',
  url: 'text',
  url_canonical: 'text',
  extracted_text: 'text',
  clean_text: 'text',
  content_hash: 'text',
  external_ref: 'jsonb',
  metadata: 'jsonb',
  content_type: 'text',
  title: 'text',
  author: 'text',
  topic_primary: 'text',
  topic_primary_confidence: 'real',
  topic_secondary: 'text',
  topic_secondary_confidence: 'real',
  keywords: 'text[]',
  enrichment_status: 'text',
  enrichment_model: 'text',
  prompt_version: 'text',
  gist: 'text',
  retrieval_excerpt: 'text',
  clean_word_count: 'int',
  clean_char_count: 'int',
  extracted_char_count: 'int',
  link_count: 'int',
  link_ratio: 'real',
  boilerplate_heavy: 'boolean',
  low_signal: 'boolean',
  quality_score: 'real',
  idempotency_policy_key: 'text',
  idempotency_key_primary: 'text',
  idempotency_key_secondary: 'text',
  distill_summary: 'text',
  distill_excerpt: 'text',
  distill_version: 'text',
  distill_created_from_hash: 'text',
  distill_why_it_matters: 'text',
  distill_stance: 'text',
  distill_status: 'text',
  distill_metadata: 'jsonb',
  created_at: 'timestamptz',
};

const DISALLOWED_INSERT_COLUMNS = new Set(['id', 'entry_id', 'tsv']);
const DISALLOWED_UPDATE_COLUMNS = new Set(['id', 'entry_id', 'created_at', 'tsv']);
const TIER1_CLASSIFY_UPDATE_COLUMNS = new Set([
  'topic_primary',
  'topic_primary_confidence',
  'topic_secondary',
  'topic_secondary_confidence',
  'keywords',
  'gist',
]);

function wrapTier2EntriesError(err, tableName) {
  if (!err) return err;
  if (err.code === '42703' || err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(
      `tier2 schema missing on ${tableName}: apply Tier-2 distill migration before using distill endpoints`
    );
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

function wrapFailurePacksError(err) {
  if (!err) return err;
  if (err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(
      `failure_packs table missing: create ${FAILURE_PACKS_TABLE} before using failure-pack endpoints`
    );
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

function toSqlValue(type, value) {
  if (type === 'text') return `${sb.lit(value)}::text`;
  if (type === 'int') return `${sb.intLit(value)}::int`;
  if (type === 'real') return `${sb.numLit(value)}::real`;
  if (type === 'boolean') return `${sb.boolLit(value)}::boolean`;
  if (type === 'jsonb') {
    let v = value;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.length > 0) {
        try {
          v = JSON.parse(trimmed);
        } catch (_err) {
          throw new Error('invalid jsonb: expected object/array or valid JSON string');
        }
      }
    }
    return `${sb.jsonbLit(v)}`;
  }
  if (type === 'text[]') return `${sb.textArrayLit(value)}`;
  if (type === 'uuid') return `${sb.lit(value)}::uuid`;
  if (type === 'bigint') return `${sb.bigIntLit(value)}::bigint`;
  if (type === 'timestamptz') {
    if (value === null || value === undefined || value === '') return 'NULL';
    if (value === 'now()') return 'now()';
    return `${sb.lit(value)}::timestamptz`;
  }
  return `${sb.lit(value)}`;
}

function buildGenericInsertPayload(input, returningOverride) {
  if (!input || typeof input !== 'object') {
    throw new Error('insert requires JSON object input');
  }

  const data = input.input || input.data || input;
  if (!data || typeof data !== 'object') {
    throw new Error('insert requires JSON object input');
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'source')) {
    throw new Error('insert requires source');
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'capture_text')) {
    throw new Error('insert requires capture_text');
  }

  const columns = [];
  const values = [];

  columns.push('created_at');
  values.push(Object.prototype.hasOwnProperty.call(data, 'created_at')
    ? toSqlValue('timestamptz', data.created_at)
    : 'now()');

  columns.push('intent');
  values.push(Object.prototype.hasOwnProperty.call(data, 'intent')
    ? toSqlValue('text', data.intent)
    : `${sb.lit('archive')}::text`);

  Object.keys(data).forEach((key) => {
    if (key === 'created_at' || key === 'intent') return;
    if (DISALLOWED_INSERT_COLUMNS.has(key)) return;
    const type = COLUMN_TYPES[key];
    if (!type) return;
    columns.push(key);
    values.push(toSqlValue(type, data[key]));
  });

  const defaultReturning = [
    'entry_id',
    'id',
    'created_at',
    'source',
    'intent',
    'content_type',
    'title',
    'author',
    'url',
    'url_canonical',
  ];
  const returning = Array.isArray(returningOverride) && returningOverride.length > 0
    ? returningOverride
    : defaultReturning;

  return { columns, values, returning };
}

function buildGenericUpdatePayload(input, returningOverride) {
  if (!input || typeof input !== 'object') {
    throw new Error('update requires JSON object input');
  }

  const data = input.input || input.data || input;
  if (!data || typeof data !== 'object') {
    throw new Error('update requires JSON object input');
  }

  const whereData = data.where || {};
  const id = Object.prototype.hasOwnProperty.call(whereData, 'id') ? whereData.id : data.id;
  const entry_id = Object.prototype.hasOwnProperty.call(whereData, 'entry_id') ? whereData.entry_id : data.entry_id;

  let where = null;
  if (id) {
    where = `id = ${toSqlValue('uuid', id)}`;
  } else if (entry_id) {
    where = `entry_id = ${toSqlValue('bigint', entry_id)}`;
  }

  if (!where) {
    throw new Error('update requires where.id or where.entry_id (or top-level id/entry_id)');
  }

  const set = [];
  const tier1WriteFields = [];
  Object.keys(data).forEach((key) => {
    if (key === 'where' || key === 'id' || key === 'entry_id') return;
    if (DISALLOWED_UPDATE_COLUMNS.has(key)) return;
    if (TIER1_CLASSIFY_UPDATE_COLUMNS.has(key)) {
      tier1WriteFields.push(key);
      return;
    }
    const type = COLUMN_TYPES[key];
    if (!type) return;
    set.push(`${key} = ${toSqlValue(type, data[key])}`);
  });

  if (tier1WriteFields.length > 0) {
    throw new Error(
      `generic /db/update does not accept Tier-1 classify fields (${tier1WriteFields.join(', ')}); use /pkm/classify or /enrich/t1/update`
    );
  }

  if (set.length === 0) {
    throw new Error('update requires at least one updatable field');
  }

  const defaultReturning = [
    'entry_id',
    'id',
    'created_at',
    'source',
    'intent',
    'content_type',
    'title',
    'author',
    'url',
    'url_canonical',
  ];
  const returning = Array.isArray(returningOverride) && returningOverride.length > 0
    ? returningOverride
    : defaultReturning;

  return { set, where, returning };
}

function parseQualifiedTable(qualified) {
  const raw = String(qualified || '').trim();
  if (!raw) return null;

  const mq = raw.match(/^"([^"]+)"\."([^"]+)"$/);
  if (mq) return { schema: mq[1], table: mq[2] };

  const m = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (m) return { schema: m[1], table: m[2] };

  const singleQuoted = raw.match(/^"([^"]+)"$/);
  if (singleQuoted) return { schema: null, table: singleQuoted[1] };

  const single = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (single) return { schema: null, table: single[1] };

  return null;
}

function resolveSchemaFromConfig(config) {
  const is_test_mode = !!(config && config.db && config.db.is_test_mode);
  const candidate = is_test_mode
    ? (config && config.db && config.db.schema_test)
    : (config && config.db && config.db.schema_prod);
  return sb.isValidIdent(candidate) ? candidate : 'pkm';
}

function requireSchemaExplicit(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error(`${fieldName} is required`);
  }
  if (!ADMIN_SCHEMAS.has(raw)) {
    throw new Error(`${fieldName} must be one of: pkm, pkm_test`);
  }
  return raw;
}

function parseBooleanStrict(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const v = String(value).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  throw new Error(`${fieldName} must be boolean`);
}

function parsePositiveBigintString(value, fieldName) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  if (s === '0') {
    throw new Error(`${fieldName} must be > 0`);
  }
  return s;
}

function parseEntryIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error('entry_ids must be an array of positive integers');
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const id = parsePositiveBigintString(value[i], `entry_ids[${i}]`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function parseRange(range) {
  if (range === undefined || range === null) return null;
  if (typeof range !== 'object' || Array.isArray(range)) {
    throw new Error('range must be an object: { from, to }');
  }
  const from = parsePositiveBigintString(range.from, 'range.from');
  const to = parsePositiveBigintString(range.to, 'range.to');
  const fromBig = BigInt(from);
  const toBig = BigInt(to);
  if (fromBig > toBig) {
    throw new Error('range.from must be <= range.to');
  }
  return {
    from,
    to,
    span: (toBig - fromBig) + 1n,
  };
}

function resolveSelectors(input) {
  const entry_ids = parseEntryIds(input && input.entry_ids);
  const range = parseRange(input && input.range);
  if (!entry_ids.length && !range) {
    throw new Error('at least one selector is required: entry_ids or range');
  }
  return { entry_ids, range };
}

function enforceSelectorMax({ entry_ids, range, force }) {
  const max = BigInt(DELETE_MOVE_MAX_BATCH);
  let size = BigInt(entry_ids.length);
  if (range) size += range.span;
  if (!force && size > max) {
    throw new Error(`selector size ${size.toString()} exceeds max ${max.toString()} (set force=true to override)`);
  }
  return size;
}

function buildSelectorWhere(selectors) {
  const clauses = [];
  if (selectors.entry_ids && selectors.entry_ids.length) {
    const list = selectors.entry_ids.map((id) => `${sb.bigIntLit(id)}::bigint`).join(', ');
    clauses.push(`entry_id = ANY(ARRAY[${list}]::bigint[])`);
  }
  if (selectors.range) {
    clauses.push(
      `entry_id BETWEEN ${sb.bigIntLit(selectors.range.from)}::bigint AND ${sb.bigIntLit(selectors.range.to)}::bigint`
    );
  }
  if (!clauses.length) {
    throw new Error('at least one selector is required');
  }
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

function withAdminRoleSql(client) {
  const role = getDbAdminRole();
  if (!role) return Promise.resolve();
  if (!sb.isValidIdent(role)) {
    throw new Error('PKM_DB_ADMIN_ROLE must be a valid SQL identifier');
  }
  return client.query(`SET LOCAL ROLE "${role}"`);
}

async function runInTransaction(op, meta, fn) {
  const client = await getPool().connect();
  try {
    await traceDb(op, { ...meta, stage: 'begin' }, () => client.query('BEGIN'));
    await traceDb(op, { ...meta, stage: 'set_role' }, () => withAdminRoleSql(client));
    const out = await fn(client);
    await traceDb(op, { ...meta, stage: 'commit' }, () => client.query('COMMIT'));
    return out;
  } catch (err) {
    try {
      await traceDb(op, { ...meta, stage: 'rollback' }, () => client.query('ROLLBACK'));
    } catch (_rollbackErr) {
      // Ignore rollback failure and surface original error.
    }
    throw err;
  } finally {
    client.release();
  }
}

function buildPreviewSelectSql(table, whereSql) {
  return `SELECT entry_id, id, source, content_type, title, created_at
FROM ${table}
WHERE ${whereSql}
ORDER BY entry_id ASC
LIMIT ${PREVIEW_LIMIT}`;
}

function buildCountSql(table, whereSql) {
  return `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${whereSql}`;
}

function movableInsertColumns() {
  const out = ['id'];
  for (const col of Object.keys(COLUMN_TYPES)) {
    if (col === 'entry_id' || col === 'tsv') continue;
    out.push(col);
  }
  return out;
}

function wrapPolicyTableError(err, tableName) {
  if (!err) return err;
  if (err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(`idempotency policy table missing: create ${tableName}`);
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

function getDataObject(input) {
  const data = (input && (input.input || input.data || input)) || {};
  if (!data || typeof data !== 'object') {
    throw new Error('insert requires JSON object input');
  }
  return data;
}

function hasCustomInsertShape(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  return (
    Object.prototype.hasOwnProperty.call(item, 'columns') ||
    Object.prototype.hasOwnProperty.call(item, 'values') ||
    Object.prototype.hasOwnProperty.call(item, 'table') ||
    Object.prototype.hasOwnProperty.call(item, 'returning')
  );
}

function returningIsSimpleIdentifierList(returning) {
  if (!Array.isArray(returning) || returning.length === 0) return false;
  for (const col of returning) {
    if (!sb.isValidIdent(col)) return false;
  }
  return true;
}

function mapInsertResultRowsForBatch(result, batchIndex) {
  const resultRows = Array.isArray(result && result.rows) ? result.rows : [];
  if (!resultRows.length) {
    return [{ _batch_index: batchIndex, _batch_ok: true, action: 'noop' }];
  }
  return resultRows.map((row) => ({ ...row, _batch_index: batchIndex, _batch_ok: true }));
}

function buildBulkIdempotentSkipSql({ table, columns, returning, rows }) {
  const valuesSql = rows.map((row) => {
    const vals = row.values.map((v) => String(v).trim());
    return `(${Number(row.batch_index)}, ${vals.join(', ')})`;
  }).join(',\n       ');
  const inputCols = ['batch_index', ...columns].join(', ');
  const returningSql = returning.map((col) => `t.${col}`).join(', ');

  return `WITH input_rows (${inputCols}) AS (
  VALUES
       ${valuesSql}
),
inserted AS (
  INSERT INTO ${table} (${columns.join(', ')})
  SELECT ${columns.join(', ')}
  FROM input_rows
  ON CONFLICT DO NOTHING
  RETURNING
    id,
    idempotency_policy_key,
    idempotency_key_primary,
    idempotency_key_secondary
),
resolved AS (
  SELECT
    i.batch_index,
    COALESCE(ins.id, ex.id) AS id,
    CASE WHEN ins.id IS NOT NULL THEN 'inserted' ELSE 'skipped' END AS action
  FROM input_rows i
  LEFT JOIN inserted ins
    ON ins.idempotency_policy_key = i.idempotency_policy_key
   AND (
     (i.idempotency_key_primary IS NOT NULL AND ins.idempotency_key_primary = i.idempotency_key_primary)
     OR
     (i.idempotency_key_secondary IS NOT NULL AND ins.idempotency_key_secondary = i.idempotency_key_secondary)
   )
  LEFT JOIN LATERAL (
    SELECT e.id
    FROM ${table} e
    WHERE e.idempotency_policy_key = i.idempotency_policy_key
      AND (
        (i.idempotency_key_primary IS NOT NULL AND e.idempotency_key_primary = i.idempotency_key_primary)
        OR
        (i.idempotency_key_secondary IS NOT NULL AND e.idempotency_key_secondary = i.idempotency_key_secondary)
      )
    ORDER BY e.created_at DESC
    LIMIT 1
  ) ex ON ins.id IS NULL
)
SELECT
  r.batch_index,
  ${returningSql},
  r.action
FROM resolved r
JOIN ${table} t ON t.id = r.id
ORDER BY r.batch_index ASC;`;
}

function logInsertBatchSuccess(rows, totalInput) {
  try {
    const insertedRows = (Array.isArray(rows) ? rows : []).filter((row) => row && row._batch_ok === true && row.action === 'inserted');
    const insertedEntryIds = insertedRows
      .map((row) => row.entry_id)
      .filter((v) => v !== null && v !== undefined);
    braintrustSink.logSuccess('insert_batch_bulk', {
      input: {
        total_input: Number(totalInput || 0),
      },
      output: {
        inserted_count: insertedRows.length,
        inserted_entry_ids: insertedEntryIds,
      },
      metadata: {
        source: 'db',
        event: 'insert_batch_success',
      },
    });
  } catch (_err) {
    // Logging must never break insert path.
  }
}

function toJsonParam(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ note: 'unserializable' });
  }
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function parseNullableBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error('has_error must be true|false');
}

function getEntriesTableBySchema(schema) {
  const raw = String(schema || '').trim();
  if (!sb.isValidIdent(raw)) {
    throw new Error(`invalid schema: ${raw}`);
  }
  return sb.qualifiedTable(raw, 'entries');
}

function parseUuid(value, fieldName) {
  const v = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${fieldName} must be a valid uuid`);
  }
  return v;
}

function parseUuidList(list, fieldName) {
  if (!Array.isArray(list)) {
    throw new Error(`${fieldName} must be an array of uuids`);
  }
  return list.map((item, index) => parseUuid(item, `${fieldName}[${index}]`));
}

function parseOptionalNumeric01(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a number`);
  }
  if (n < 0 || n > 1) {
    throw new Error(`${fieldName} must be between 0 and 1`);
  }
  return n;
}

function parseCalendarStatus(value, fieldName, fallback) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) {
    if (fallback) return fallback;
    throw new Error(`${fieldName} is required`);
  }
  if (!CALENDAR_REQUEST_STATUSES.has(raw)) {
    throw new Error(`${fieldName} must be one of: ${Array.from(CALENDAR_REQUEST_STATUSES).join(', ')}`);
  }
  return raw;
}

function parseNonEmptyText(value, fieldName) {
  const out = String(value === undefined || value === null ? '' : value).trim();
  if (!out) throw new Error(`${fieldName} is required`);
  return out;
}

function parseOptionalText(value) {
  const out = String(value === undefined || value === null ? '' : value).trim();
  return out || null;
}

function isUniqueViolation(err) {
  return !!(err && err.code === '23505');
}

module.exports = {
  sb,
  getConfig,
  getPool,
  traceDb,
  braintrustSink,
  parseFailurePackSummary,
  IMMUTABLE_UPDATE_COLUMNS,
  IDEMPOTENCY_REQUIRED_SOURCES,
  COLUMN_TYPES,
  PIPELINE_EVENTS_TABLE,
  FAILURE_PACKS_TABLE,
  CALENDAR_REQUESTS_TABLE,
  CALENDAR_EVENT_OBSERVATIONS_TABLE,
  CALENDAR_TERMINAL_STATUSES,
  wrapTier2EntriesError,
  wrapFailurePacksError,
  toSqlValue,
  buildGenericInsertPayload,
  buildGenericUpdatePayload,
  parseQualifiedTable,
  resolveSchemaFromConfig,
  requireSchemaExplicit,
  parseBooleanStrict,
  parsePositiveBigintString,
  resolveSelectors,
  enforceSelectorMax,
  buildSelectorWhere,
  runInTransaction,
  buildPreviewSelectSql,
  buildCountSql,
  movableInsertColumns,
  wrapPolicyTableError,
  getDataObject,
  hasCustomInsertShape,
  returningIsSimpleIdentifierList,
  mapInsertResultRowsForBatch,
  buildBulkIdempotentSkipSql,
  logInsertBatchSuccess,
  toJsonParam,
  parsePositiveInt,
  parseNullableBoolean,
  getEntriesTableBySchema,
  parseUuid,
  parseUuidList,
  parseOptionalNumeric01,
  parseCalendarStatus,
  parseNonEmptyText,
  parseOptionalText,
  isUniqueViolation,
};
