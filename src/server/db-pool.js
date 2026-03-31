'use strict';

const { Pool } = require('pg');
const { getDbPoolConfig } = require('./runtime-env.js');

let pool = null;

function getPool() {
  if (pool) return pool;

  const {
    user,
    password,
    host,
    port,
    database,
    ssl,
    rejectUnauthorized,
  } = getDbPoolConfig();
  if (!user || !password) {
    throw new Error('PKM_INGEST_USER and PKM_INGEST_PASSWORD are required');
  }

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

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

module.exports = {
  getPool,
  closePool,
};
