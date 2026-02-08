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

async function insert(opts) {
  const table = opts.table || getEntriesTable();
  const sql = sb.buildInsert({
    table,
    columns: opts.columns,
    values: opts.values,
    returning: opts.returning,
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
};
