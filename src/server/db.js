'use strict';

const { Pool } = require('pg');
const sb = require('../../js/libs/sql-builder.js');
const { traceDb } = require('./observability.js');

let pool = null;

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function getPool() {
  if (pool) return pool;

  const user = process.env.PKM_INGEST_USER;
  const password = process.env.PKM_INGEST_PASSWORD;
  if (!user || !password) {
    throw new Error('PKM_INGEST_USER and PKM_INGEST_PASSWORD are required');
  }

  const host = process.env.PKM_DB_HOST || 'postgres';
  const port = Number(process.env.PKM_DB_PORT || 5432);
  const database = process.env.PKM_DB_NAME || 'pkm';
  const ssl = envBool(process.env.PKM_DB_SSL, false);
  const rejectUnauthorized = envBool(process.env.PKM_DB_SSL_REJECT_UNAUTHORIZED, true);

  pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    ssl: ssl ? { rejectUnauthorized } : false,
  });

  return pool;
}

function getEntriesTable() {
  const schema = process.env.PKM_DB_SCHEMA || 'pkm';
  return sb.qualifiedTable(schema, 'entries');
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
  extraction_status: 'text',
  error: 'text',
  people: 'text[]',
  topic_guess: 'text',
  type_guess: 'text',
  duplicate_of: 'uuid',
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
  retrieval_version: 'text',
  source_domain: 'text',
  clean_word_count: 'int',
  clean_char_count: 'int',
  extracted_char_count: 'int',
  link_count: 'int',
  link_ratio: 'real',
  boilerplate_heavy: 'boolean',
  low_signal: 'boolean',
  extraction_incomplete: 'boolean',
  quality_score: 'real',
  created_at: 'timestamptz',
};

const DISALLOWED_INSERT_COLUMNS = new Set([
  'id',
  'entry_id',
  'tsv',
]);

function toSqlValue(type, value) {
  if (type === 'text') return `${sb.lit(value)}::text`;
  if (type === 'int') return `${sb.intLit(value)}::int`;
  if (type === 'real') return `${sb.numLit(value)}::real`;
  if (type === 'boolean') return `${sb.boolLit(value)}::boolean`;
  if (type === 'jsonb') return `${sb.jsonbLit(value)}`;
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

async function insert(opts) {
  const table = opts.table || getEntriesTable();
  let columns = opts.columns;
  let values = opts.values;
  let returning = opts.returning;

  if (!Array.isArray(columns) || !Array.isArray(values)) {
    const data = opts.input || opts.data || opts || {};
    const returningOverride = opts.returning || data.returning;
    const built = buildGenericInsertPayload(data, returningOverride);
    columns = built.columns;
    values = built.values;
    returning = built.returning;
  }

  const sql = sb.buildInsert({
    table,
    columns,
    values,
    returning,
  });
  return exec(sql, { op: 'insert', table });
}

async function update(opts) {
  const table = opts.table || getEntriesTable();
  const sql = sb.buildUpdate({
    table,
    set: opts.set,
    where: opts.where,
    returning: opts.returning,
  });
  return exec(sql, { op: 'update', table });
}

async function readContinue(opts) {
  const sql = sb.buildReadContinue({
    entries_table: opts.entries_table || getEntriesTable(),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
    weights: opts.weights,
    halfLife: opts.halfLife,
    noteQuota: opts.noteQuota,
  });
  return exec(sql, { op: 'read_continue' });
}

async function readFind(opts) {
  const sql = sb.buildReadFind({
    entries_table: opts.entries_table || getEntriesTable(),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
    needle: opts.needle,
    weights: opts.weights,
  });
  return exec(sql, { op: 'read_find' });
}

async function readLast(opts) {
  const sql = sb.buildReadLast({
    entries_table: opts.entries_table || getEntriesTable(),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
    weights: opts.weights,
    halfLife: opts.halfLife,
  });
  return exec(sql, { op: 'read_last' });
}

async function readPull(opts) {
  const sql = sb.buildReadPull({
    entries_table: opts.entries_table || getEntriesTable(),
    entry_id: opts.entry_id,
    shortN: opts.shortN,
    longN: opts.longN,
  });
  return exec(sql, { op: 'read_pull' });
}

module.exports = {
  getPool,
  insert,
  update,
  readContinue,
  readFind,
  readLast,
  readPull,
  buildGenericInsertPayload,
};
