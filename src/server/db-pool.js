'use strict';

const { Pool } = require('pg');

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

module.exports = {
  getPool,
  envBool,
};
