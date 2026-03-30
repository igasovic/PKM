'use strict';

const sb = require('../../libs/sql-builder.js');
const {
  exec,
  getEntriesTableFromConfig,
  getConfigWithTestMode,
} = require('./runtime-store.js');

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

module.exports = {
  readContinue,
  readFind,
  readLast,
  readPull,
  readWorkingMemory,
  readSmoke,
};
