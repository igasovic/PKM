'use strict';

const sb = require('../../libs/sql-builder.js');
const {
  exec,
  getEntriesTableFromConfig,
  getConfigWithTestMode,
} = require('./runtime-store.js');

function toPositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const out = Math.trunc(n);
  return Math.min(max, out);
}

function parseNullableBoolean(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  throw new Error(`${fieldName} must be boolean`);
}

function sanitizeText(value) {
  return String(value || '').trim();
}

async function readContinue(opts) {
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadContinue({
    config,
    entries_table: getEntriesTableFromConfig(config),
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
    entries_table: getEntriesTableFromConfig(config),
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
    entries_table: getEntriesTableFromConfig(config),
    q: opts.q,
    days: opts.days,
    limit: opts.limit,
  });
  return exec(sql, { op: 'read_last' });
}

async function readPull(opts) {
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadPull({
    entries_table: getEntriesTableFromConfig(config),
    entry_id: opts.entry_id,
    shortN: opts.shortN,
    longN: opts.longN,
  });
  return exec(sql, { op: 'read_pull' });
}

async function readWorkingMemory(opts) {
  const topicKey = String((opts && opts.topic_key) || '').trim();
  if (!topicKey) {
    throw new Error('read_working_memory requires topic_key');
  }
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadWorkingMemory({
    entries_table: getEntriesTableFromConfig(config),
    topic_key: topicKey,
  });
  return exec(sql, { op: 'read_working_memory' });
}

async function readSmoke(opts) {
  const suite = String((opts && opts.suite) ?? '').trim();
  if (!suite) {
    throw new Error('read_smoke requires suite');
  }
  const run_id = opts && Object.prototype.hasOwnProperty.call(opts, 'run_id')
    ? String(opts.run_id ?? '').trim()
    : '';
  const config = await getConfigWithTestMode();
  const sql = sb.buildReadSmoke({
    entries_table: getEntriesTableFromConfig(config),
    suite,
    run_id: run_id || null,
  });
  return exec(sql, { op: 'read_smoke' });
}

async function readEntities(opts) {
  const config = await getConfigWithTestMode();
  const dbConfig = (config && config.db) || {};
  const filtersInput = (opts && opts.filters && typeof opts.filters === 'object')
    ? opts.filters
    : {};

  const filters = {
    content_type: sanitizeText(filtersInput.content_type),
    source: sanitizeText(filtersInput.source),
    status: sanitizeText(filtersInput.status),
    intent: sanitizeText(filtersInput.intent),
    topic_primary: sanitizeText(filtersInput.topic_primary),
    created_from: sanitizeText(filtersInput.created_from),
    created_to: sanitizeText(filtersInput.created_to),
    quality_flag: sanitizeText(filtersInput.quality_flag),
    has_url: parseNullableBoolean(filtersInput.has_url, 'filters.has_url'),
  };

  if (filters.quality_flag && filters.quality_flag !== 'low_signal' && filters.quality_flag !== 'boilerplate_heavy') {
    throw new Error('filters.quality_flag must be one of: low_signal, boilerplate_heavy');
  }

  const page = toPositiveInt(opts && opts.page, 1, 100000);
  const page_size = toPositiveInt(opts && opts.page_size, 50, 200);
  const schema = dbConfig.is_test_mode
    ? (dbConfig.schema_test || 'pkm_test')
    : (dbConfig.schema_prod || 'pkm');
  const topic_primary_options = Array.isArray(config && config.topics)
    ? config.topics
    : [];

  const sql = sb.buildReadEntities({
    entries_table: getEntriesTableFromConfig(config),
    schema,
    is_test_mode: !!dbConfig.is_test_mode,
    topic_primary_options,
    page,
    page_size,
    filters,
  });

  return exec(sql, { op: 'read_entities' });
}

module.exports = {
  readContinue,
  readFind,
  readLast,
  readPull,
  readWorkingMemory,
  readSmoke,
  readEntities,
};
