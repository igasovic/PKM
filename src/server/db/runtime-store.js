'use strict';

const sb = require('../../libs/sql-builder.js');
const { getPool } = require('../db-pool.js');
const { getConfig } = require('../../libs/config.js');
const { traceDb } = require('../logger/braintrust.js');
const { getRuntimeDbSchema } = require('../runtime-env.js');

const CONFIG_TABLE = sb.qualifiedTable(getRuntimeDbSchema(), 'runtime_config');

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
  const pool = getPool();
  try {
    const res = await pool.query(`SELECT value FROM ${CONFIG_TABLE} WHERE key = $1`, ['is_test_mode']);
    return !!(res.rows && res.rows[0] && res.rows[0].value === true);
  } catch (err) {
    throw wrapConfigTableError(err);
  }
}

async function setTestModeStateInDb(nextState) {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO ${CONFIG_TABLE} (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
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

function getEntriesTableFromConfig(config) {
  const cfg = config || getConfig();
  return sb.resolveEntriesTable(cfg.db);
}

async function getConfigWithTestMode() {
  const config = getConfig();
  config.db.is_test_mode = await getTestModeStateFromDb();
  return config;
}

async function exec(sql, meta) {
  const pool = getPool();
  return traceDb('query', meta, () => pool.query(sql));
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
  getTestModeStateFromDb,
  setTestModeStateInDb,
  toggleTestModeStateInDb,
  getEntriesTableFromConfig,
  getConfigWithTestMode,
  exec,
  getTestMode,
  toggleTestModeState,
};
