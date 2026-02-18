'use strict';

const sb = require('../../src/libs/sql-builder.js');
const { getPool } = require('./db-pool.js');
const { getConfig } = require('../libs/config.js');
const { traceDb } = require('./observability.js');

const CONFIG_TABLE = sb.qualifiedTable(process.env.PKM_DB_SCHEMA || 'pkm', 'runtime_config');
const IMMUTABLE_UPDATE_COLUMNS = new Set(['id', 'entry_id', 'created_at', 'tsv']);
// For these ingest sources we fail closed unless idempotency keys are present.
const IDEMPOTENCY_REQUIRED_SOURCES = new Set(['email', 'email-batch', 'telegram']);
const ADMIN_SCHEMAS = new Set(['pkm', 'pkm_test']);
const DELETE_MOVE_MAX_BATCH = (() => {
  const raw = Number(process.env.DB_DELETE_MOVE_MAX_BATCH || 200);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 200;
})();
const PREVIEW_LIMIT = 20;

function wrapConfigTableError(err) {
  if (!err) return err;
  if (err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(`runtime_config table missing: create ${CONFIG_TABLE} before using test mode`);
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

async function getTestModeStateFromDb() {
  const p = getPool();
  try {
    const res = await p.query(`SELECT value FROM ${CONFIG_TABLE} WHERE key = $1`, ['is_test_mode']);
    return !!(res.rows && res.rows[0] && res.rows[0].value === true);
  } catch (err) {
    throw wrapConfigTableError(err);
  }
}

async function setTestModeStateInDb(nextState) {
  const p = getPool();
  try {
    await p.query(
      `INSERT INTO ${CONFIG_TABLE} (key, value, updated_at)\n     VALUES ($1, $2::jsonb, now())\n     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      ['is_test_mode', JSON.stringify(!!nextState)]
    );
  } catch (err) {
    throw wrapConfigTableError(err);
  }
}

async function toggleTestModeStateInDb() {
  const current = await getTestModeStateFromDb();
  const next = !current;
  await setTestModeStateInDb(next);
  return next;
}

async function getEntriesTableFromConfig(config) {
  const cfg = config || getConfig();
  return sb.resolveEntriesTable(cfg.db);
}

async function getConfigWithTestMode() {
  const config = getConfig();
  config.db.is_test_mode = await getTestModeStateFromDb();
  return config;
}

async function exec(sql, meta) {
  const p = getPool();
  return traceDb('query', meta, () => p.query(sql));
}

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
  created_at: 'timestamptz',
};

const DISALLOWED_INSERT_COLUMNS = new Set([
  'id',
  'entry_id',
  'tsv',
]);

const DISALLOWED_UPDATE_COLUMNS = new Set([
  'id',
  'entry_id',
  'created_at',
  'tsv',
]);

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
        } catch (err) {
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
  Object.keys(data).forEach((key) => {
    if (key === 'where' || key === 'id' || key === 'entry_id') return;
    if (DISALLOWED_UPDATE_COLUMNS.has(key)) return;
    const type = COLUMN_TYPES[key];
    if (!type) return;
    set.push(`${key} = ${toSqlValue(type, data[key])}`);
  });

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

  // Accept quoted schema-qualified identifiers used by SQL builder.
  const mq = raw.match(/^"([^"]+)"\."([^"]+)"$/);
  if (mq) return { schema: mq[1], table: mq[2] };

  // Also accept unquoted schema.table form from callers.
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
  for (let i = 0; i < value.length; i++) {
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
  const role = String(process.env.PKM_DB_ADMIN_ROLE || '').trim();
  if (!role) return Promise.resolve();
  if (!sb.isValidIdent(role)) {
    throw new Error('PKM_DB_ADMIN_ROLE must be a valid SQL identifier');
  }
  return client.query(`SET LOCAL ROLE "${role}"`);
}

async function runInTransaction(op, meta, fn) {
  const p = getPool();
  const client = await p.connect();
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

async function insertBatch(opts) {
  const list = Array.isArray(opts && opts.items) ? opts.items : [];
  if (!list.length) {
    throw new Error('insert batch requires non-empty items');
  }

  const continueOnError = opts && opts.continue_on_error !== false;
  const base = { ...(opts || {}) };
  delete base.items;
  delete base.continue_on_error;
  // Reuse one resolved config/test-mode state for the whole batch.
  base.__config = await getConfigWithTestMode();

  const rows = [];
  let okCount = 0;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    try {
      let one;
      const isObjectItem = item && typeof item === 'object' && !Array.isArray(item);
      if (isObjectItem && (
        Object.prototype.hasOwnProperty.call(item, 'input') ||
        Object.prototype.hasOwnProperty.call(item, 'data') ||
        Object.prototype.hasOwnProperty.call(item, 'columns') ||
        Object.prototype.hasOwnProperty.call(item, 'values') ||
        Object.prototype.hasOwnProperty.call(item, 'table') ||
        Object.prototype.hasOwnProperty.call(item, 'returning')
      )) {
        one = { ...base, ...item };
      } else {
        one = { ...base, input: item };
      }

      const result = await insert(one);
      const resultRows = Array.isArray(result && result.rows) ? result.rows : [];
      if (!resultRows.length) {
        rows.push({ _batch_index: i, _batch_ok: true, action: 'noop' });
      } else {
        for (const row of resultRows) {
          rows.push({ ...row, _batch_index: i, _batch_ok: true });
        }
      }
      okCount++;
    } catch (err) {
      if (!continueOnError) throw err;
      rows.push({
        _batch_index: i,
        _batch_ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  return {
    rows,
    rowCount: okCount,
  };
}

async function updateBatch(opts) {
  const list = Array.isArray(opts && opts.items) ? opts.items : [];
  if (!list.length) {
    throw new Error('update batch requires non-empty items');
  }

  const continueOnError = opts && opts.continue_on_error !== false;
  const base = { ...(opts || {}) };
  delete base.items;
  delete base.continue_on_error;
  // Reuse one resolved config/test-mode state for the whole batch.
  base.__config = await getConfigWithTestMode();

  const rows = [];
  let okCount = 0;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    try {
      let one;
      const isObjectItem = item && typeof item === 'object' && !Array.isArray(item);
      if (isObjectItem && (
        Object.prototype.hasOwnProperty.call(item, 'input') ||
        Object.prototype.hasOwnProperty.call(item, 'data') ||
        Object.prototype.hasOwnProperty.call(item, 'set') ||
        Object.prototype.hasOwnProperty.call(item, 'where') ||
        Object.prototype.hasOwnProperty.call(item, 'table') ||
        Object.prototype.hasOwnProperty.call(item, 'returning')
      )) {
        one = { ...base, ...item };
      } else {
        one = { ...base, input: item };
      }

      const result = await update(one);
      const resultRows = Array.isArray(result && result.rows) ? result.rows : [];
      if (!resultRows.length) {
        rows.push({ _batch_index: i, _batch_ok: true, action: 'noop' });
      } else {
        for (const row of resultRows) {
          rows.push({ ...row, _batch_index: i, _batch_ok: true });
        }
      }
      okCount++;
    } catch (err) {
      if (!continueOnError) throw err;
      rows.push({
        _batch_index: i,
        _batch_ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  return {
    rows,
    rowCount: okCount,
  };
}

async function getPolicyByKey(schema, policyKey) {
  const p = getPool();
  const policiesTable = sb.qualifiedTable(schema, 'idempotency_policies');
  try {
    const res = await traceDb('idempotency_policy_get', { schema, table: policiesTable, policy_key: policyKey }, () =>
      p.query(
        `SELECT policy_key, conflict_action, update_fields, enabled
         FROM ${policiesTable}
         WHERE policy_key = $1
         LIMIT 1`,
        [policyKey]
      )
    );
    const row = res.rows && res.rows[0];
    if (!row) {
      throw new Error(`idempotency policy not found: ${policyKey}`);
    }
    if (!row.enabled) {
      throw new Error(`idempotency policy disabled: ${policyKey}`);
    }
    return row;
  } catch (err) {
    throw wrapPolicyTableError(err, policiesTable);
  }
}

function buildReturningSelectSql({ table, returning, id }) {
  const fields = Array.isArray(returning) && returning.length ? returning.join(', ') : '*';
  return `SELECT ${fields} FROM ${table} WHERE id = ${toSqlValue('uuid', id)} LIMIT 1`;
}

async function selectReturningById({ table, returning, id }) {
  const sql = buildReturningSelectSql({ table, returning, id });
  return exec(sql, { op: 'idempotency_select_returning', table });
}

function mergeJsonObjects(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch;
  if (!base || typeof base !== 'object') return patch;
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const next = patch[key];
    const prev = out[key];
    if (
      prev &&
      next &&
      typeof prev === 'object' &&
      typeof next === 'object' &&
      !Array.isArray(prev) &&
      !Array.isArray(next)
    ) {
      out[key] = mergeJsonObjects(prev, next);
    } else {
      out[key] = next;
    }
  }
  return out;
}

function isUniqueViolation(err) {
  return !!(err && err.code === '23505');
}

function resolveIdempotencyRequest(data) {
  const policyKey = data.idempotency_policy_key;
  const keyPrimaryRaw = data.idempotency_key_primary;
  const keySecondaryRaw = data.idempotency_key_secondary;
  const keyPrimary = keyPrimaryRaw === null || keyPrimaryRaw === undefined
    ? null
    : String(keyPrimaryRaw).trim() || null;
  const keySecondary = keySecondaryRaw === null || keySecondaryRaw === undefined
    ? null
    : String(keySecondaryRaw).trim() || null;
  const hasKeys = !!(keyPrimary || keySecondary);
  const hasPolicy = !!policyKey;
  if (!hasKeys && !hasPolicy) return null;
  if (hasKeys && !hasPolicy) {
    throw new Error('idempotency requires idempotency_policy_key when keys are provided');
  }
  if (hasPolicy && !hasKeys) {
    throw new Error('idempotency requires idempotency_key_primary or idempotency_key_secondary');
  }
  return {
    policy_key: String(policyKey || '').trim(),
    key_primary: keyPrimary,
    key_secondary: keySecondary,
  };
}

async function findExistingIdempotentRow({ table, policy_key, key_primary, key_secondary }) {
  if (!policy_key) return null;
  const p = getPool();
  const res = await traceDb('idempotency_existing_find', { table, policy_key }, () =>
    p.query(
      `SELECT *
       FROM ${table}
       WHERE idempotency_policy_key = $1
         AND (
           ($2::text IS NOT NULL AND idempotency_key_primary = $2::text)
           OR ($3::text IS NOT NULL AND idempotency_key_secondary = $3::text)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [policy_key, key_primary || null, key_secondary || null]
    )
  );
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

function buildSetForIdempotentUpdate({ incoming, existing, policyUpdateFields }) {
  const requested = Array.isArray(policyUpdateFields) && policyUpdateFields.length
    ? policyUpdateFields
    : Object.keys(incoming);
  const set = [];
  for (const key of requested) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    if (IMMUTABLE_UPDATE_COLUMNS.has(key)) continue;
    if (key === 'idempotency_policy_key') continue;
    const type = COLUMN_TYPES[key];
    if (!type) continue;
    let value = incoming[key];
    if (
      key === 'metadata' &&
      existing &&
      existing.metadata &&
      value &&
      typeof existing.metadata === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(existing.metadata) &&
      !Array.isArray(value)
    ) {
      value = mergeJsonObjects(existing.metadata, value);
    }
    set.push(`${key} = ${toSqlValue(type, value)}`);
  }
  return set;
}

async function insert(opts) {
  if (Array.isArray(opts && opts.items)) {
    return insertBatch(opts);
  }

  const config = (opts && opts.__config) || await getConfigWithTestMode();
  const table = opts.table || await getEntriesTableFromConfig(config);
  let columns = opts.columns;
  let values = opts.values;
  let returning = opts.returning;

  if (!Array.isArray(columns) || !Array.isArray(values)) {
    const data = getDataObject(opts);
    const returningOverride = opts.returning || data.returning;
    const idempotency = resolveIdempotencyRequest(data);
    const parsedTable = parseQualifiedTable(table);
    const activeSchema = (parsedTable && parsedTable.schema) ? parsedTable.schema : resolveSchemaFromConfig(config);
    const isEntriesTable = !!(parsedTable && parsedTable.table === 'entries');
    const sourceName = String(data.source || '').trim().toLowerCase();
    const requireIdempotency = isEntriesTable && IDEMPOTENCY_REQUIRED_SOURCES.has(sourceName);

    if (requireIdempotency && !idempotency) {
      throw new Error(
        `idempotency fields are required for source "${sourceName}" on ${table}: provide idempotency_policy_key and at least one idempotency key`
      );
    }

    if (!idempotency || !isEntriesTable) {
      const built = buildGenericInsertPayload(data, returningOverride);
      columns = built.columns;
      values = built.values;
      returning = built.returning;
      const sql = sb.buildInsert({
        table,
        columns,
        values,
        returning,
      });
      const result = await exec(sql, { op: 'insert', table });
      return {
        ...result,
        rows: (result.rows || []).map((row) => ({ ...row, action: 'inserted' })),
      };
    }

    // Resolve conflict behavior from persisted policy table (schema-specific).
    const policy = await getPolicyByKey(activeSchema, idempotency.policy_key);
    const incoming = {
      ...data,
      idempotency_policy_key: policy.policy_key,
      idempotency_key_primary: idempotency.key_primary,
      idempotency_key_secondary: idempotency.key_secondary,
    };
    const built = buildGenericInsertPayload(incoming, returningOverride);
    columns = built.columns;
    values = built.values;
    returning = built.returning;

    const insertSql = sb.buildInsert({
      table,
      columns,
      values,
      returning,
    });

    try {
      const inserted = await exec(insertSql, { op: 'insert_idempotent', table, policy_key: policy.policy_key });
      return {
        ...inserted,
        rows: (inserted.rows || []).map((row) => ({ ...row, action: 'inserted' })),
      };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await findExistingIdempotentRow({
        table,
        policy_key: policy.policy_key,
        key_primary: idempotency.key_primary,
        key_secondary: idempotency.key_secondary,
      });
      if (!existing) throw err;

      if (policy.conflict_action === 'skip') {
        // Skip conflicts but return the existing row.
        const selected = await selectReturningById({
          table,
          returning,
          id: existing.id,
        });
        return {
          ...selected,
          rows: (selected.rows || []).map((row) => ({ ...row, action: 'skipped' })),
        };
      }

      if (policy.conflict_action === 'update') {
        // Update conflicts in-place based on policy.update_fields / denylist.
        const set = buildSetForIdempotentUpdate({
          incoming,
          existing,
          policyUpdateFields: policy.update_fields,
        });
        if (!set.length) {
          const selected = await selectReturningById({
            table,
            returning,
            id: existing.id,
          });
          return {
            ...selected,
            rows: (selected.rows || []).map((row) => ({ ...row, action: 'updated' })),
          };
        }
        const updateSql = sb.buildUpdate({
          table,
          set,
          where: `id = ${toSqlValue('uuid', existing.id)}`,
          returning,
        });
        const updated = await exec(updateSql, { op: 'insert_idempotent_update', table, policy_key: policy.policy_key });
        return {
          ...updated,
          rows: (updated.rows || []).map((row) => ({ ...row, action: 'updated' })),
        };
      }

      throw new Error(`unsupported conflict_action: ${policy.conflict_action}`);
    }
  }

  const sql = sb.buildInsert({
    table,
    columns,
    values,
    returning,
  });
  const result = await exec(sql, { op: 'insert', table });
  return {
    ...result,
    rows: (result.rows || []).map((row) => ({ ...row, action: 'inserted' })),
  };
}

async function update(opts) {
  if (Array.isArray(opts && opts.items)) {
    return updateBatch(opts);
  }

  const config = (opts && opts.__config) || await getConfigWithTestMode();
  const table = await getEntriesTableFromConfig(config);
  let set = opts.set;
  let where = opts.where;
  let returning = opts.returning;

  if (!Array.isArray(set) || !where) {
    const data = opts.input || opts.data || opts || {};
    const returningOverride = opts.returning || data.returning;
    const built = buildGenericUpdatePayload(data, returningOverride);
    set = built.set;
    where = built.where;
    returning = built.returning;
  }

  const sql = sb.buildUpdate({
    table,
    set,
    where,
    returning,
  });
  return exec(sql, { op: 'update', table });
}

async function deleteEntries(opts) {
  const data = (opts && (opts.input || opts.data || opts)) || {};
  if (!data || typeof data !== 'object') {
    throw new Error('delete requires JSON object input');
  }

  const schema = requireSchemaExplicit(data.schema, 'schema');
  const dry_run = parseBooleanStrict(data.dry_run, 'dry_run', false);
  const force = parseBooleanStrict(data.force, 'force', false);
  const selectors = resolveSelectors(data);
  const selector_size = enforceSelectorMax({ ...selectors, force });
  const table = sb.qualifiedTable(schema, 'entries');
  const whereSql = buildSelectorWhere(selectors);
  const previewSql = buildPreviewSelectSql(table, whereSql);
  const countSql = buildCountSql(table, whereSql);

  if (dry_run) {
    const countRes = await traceDb('delete_dry_run_count', { schema, table }, () => getPool().query(countSql));
    const previewRes = await traceDb('delete_dry_run_preview', { schema, table }, () => getPool().query(previewSql));
    const matched_count = Number((countRes.rows && countRes.rows[0] && countRes.rows[0].count) || 0);
    return {
      rows: [{
        dry_run: true,
        schema,
        selector_size: selector_size.toString(),
        matched_count,
        deleted_count: 0,
        preview: previewRes.rows || [],
      }],
      rowCount: 1,
    };
  }

  return runInTransaction('delete', { schema, table }, async (client) => {
    const previewRes = await traceDb('delete_preview', { schema, table }, () => client.query(previewSql));
    const deleteSql = `DELETE FROM ${table} WHERE ${whereSql} RETURNING entry_id, id`;
    const deletedRes = await traceDb('delete_exec', { schema, table }, () => client.query(deleteSql));
    return {
      rows: [{
        dry_run: false,
        schema,
        selector_size: selector_size.toString(),
        matched_count: deletedRes.rowCount || 0,
        deleted_count: deletedRes.rowCount || 0,
        preview: previewRes.rows || [],
      }],
      rowCount: 1,
    };
  });
}

async function moveEntries(opts) {
  const data = (opts && (opts.input || opts.data || opts)) || {};
  if (!data || typeof data !== 'object') {
    throw new Error('move requires JSON object input');
  }

  const from_schema = requireSchemaExplicit(data.from_schema, 'from_schema');
  const to_schema = requireSchemaExplicit(data.to_schema, 'to_schema');
  if (from_schema === to_schema) {
    throw new Error('to_schema must differ from from_schema');
  }

  const dry_run = parseBooleanStrict(data.dry_run, 'dry_run', false);
  const force = parseBooleanStrict(data.force, 'force', false);
  const selectors = resolveSelectors(data);
  const selector_size = enforceSelectorMax({ ...selectors, force });

  const fromTable = sb.qualifiedTable(from_schema, 'entries');
  const toTable = sb.qualifiedTable(to_schema, 'entries');
  const whereSql = buildSelectorWhere(selectors);
  const previewSql = buildPreviewSelectSql(fromTable, whereSql);
  const countSql = buildCountSql(fromTable, whereSql);

  if (dry_run) {
    const countRes = await traceDb('move_dry_run_count', { from_schema, to_schema }, () => getPool().query(countSql));
    const previewRes = await traceDb('move_dry_run_preview', { from_schema, to_schema }, () => getPool().query(previewSql));
    const matched_count = Number((countRes.rows && countRes.rows[0] && countRes.rows[0].count) || 0);
    return {
      rows: [{
        dry_run: true,
        from_schema,
        to_schema,
        selector_size: selector_size.toString(),
        matched_count,
        moved_count: 0,
        preview: previewRes.rows || [],
        mapping: [],
      }],
      rowCount: 1,
    };
  }

  return runInTransaction('move', { from_schema, to_schema }, async (client) => {
    const previewRes = await traceDb('move_preview', { from_schema, to_schema }, () => client.query(previewSql));
    const insertColumns = movableInsertColumns();
    const returningColumns = ['entry_id AS from_entry_id', ...insertColumns];
    const commandValue = String(data.command || '/move').trim() || '/move';
    const commandLit = sb.lit(commandValue);
    const provenanceExpr = `jsonb_build_object(
      'from_schema', ${sb.lit(from_schema)}::text,
      'from_entry_id', d.from_entry_id,
      'moved_at', now(),
      'command', ${commandLit}::text
    )`;

    const selectExprs = insertColumns.map((col) => {
      if (col === 'metadata') {
        return `COALESCE(d.metadata, '{}'::jsonb) || jsonb_build_object('migration', ${provenanceExpr})`;
      }
      if (col === 'external_ref') {
        return `COALESCE(d.external_ref, '{}'::jsonb) || jsonb_build_object('migration', ${provenanceExpr})`;
      }
      return `d.${col}`;
    });

    const moveSql = `WITH moved AS (
  DELETE FROM ${fromTable}
  WHERE ${whereSql}
  RETURNING ${returningColumns.join(', ')}
),
inserted AS (
  INSERT INTO ${toTable} (${insertColumns.join(', ')})
  SELECT ${selectExprs.join(', ')}
  FROM moved d
  RETURNING id, entry_id AS to_entry_id
)
SELECT
  m.from_entry_id,
  i.to_entry_id,
  i.id
FROM inserted i
JOIN moved m ON m.id = i.id
ORDER BY m.from_entry_id ASC`;

    const movedRes = await traceDb('move_exec', { from_schema, to_schema }, () => client.query(moveSql));
    return {
      rows: [{
        dry_run: false,
        from_schema,
        to_schema,
        selector_size: selector_size.toString(),
        matched_count: movedRes.rowCount || 0,
        moved_count: movedRes.rowCount || 0,
        preview: previewRes.rows || [],
        mapping: movedRes.rows || [],
      }],
      rowCount: 1,
    };
  });
}

async function readContinue(opts) {
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadContinue({
    config,
    entries_table: await getEntriesTableFromConfig(config),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
  });
  return exec(sql, { op: 'read_continue' });
}

async function readFind(opts) {
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadFind({
    config,
    entries_table: await getEntriesTableFromConfig(config),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
  });
  return exec(sql, { op: 'read_find' });
}

async function readLast(opts) {
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadLast({
    config,
    entries_table: await getEntriesTableFromConfig(config),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
  });
  return exec(sql, { op: 'read_last' });
}

async function readPull(opts) {
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadPull({
    entries_table: await getEntriesTableFromConfig(config),
    entry_id: opts.entry_id,
    shortN: opts.shortN,
    longN: opts.longN,
  });
  return exec(sql, { op: 'read_pull' });
}

async function getTestMode() {
  const state = await getTestModeStateFromDb();
  return { rows: [{ is_test_mode: state }], rowCount: 1 };
}

async function toggleTestModeState() {
  const state = await toggleTestModeStateInDb();
  return { rows: [{ is_test_mode: state }], rowCount: 1 };
}

module.exports = {
  getPool,
  insert,
  update,
  delete: deleteEntries,
  move: moveEntries,
  readContinue,
  readFind,
  readLast,
  readPull,
  getTestMode,
  toggleTestModeState,
  getTestModeStateFromDb,
  setTestModeStateInDb,
  buildGenericInsertPayload,
  buildGenericUpdatePayload,
};
