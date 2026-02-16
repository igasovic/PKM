'use strict';

const sb = require('../../libs/sql-builder.js');
const { getConfig } = require('../../libs/config.js');
const { getPool } = require('../db-pool.js');
const { getBraintrustLogger } = require('../observability.js');
const { getTestModeStateFromDb } = require('../db.js');
const { TERMINAL_BATCH_STATUSES } = require('./constants.js');

function isMissingRelationError(err) {
  return !!(err && (err.code === '42P01' || err.code === '3F000'));
}

function wrapBatchTableError(err, tableName) {
  if (!isMissingRelationError(err)) return err;
  const wrapped = new Error(`batch table missing: create ${tableName} before using /enrich/t1 batch APIs`);
  wrapped.cause = err;
  return wrapped;
}

function tableName(schema, table) {
  return sb.qualifiedTable(schema, table);
}

function getConfiguredSchemas() {
  const cfg = getConfig();
  const prod = cfg && cfg.db && cfg.db.schema_prod;
  const test = cfg && cfg.db && cfg.db.schema_test;
  const candidates = [prod, test];
  const out = [];
  for (const c of candidates) {
    if (!sb.isValidIdent(c)) continue;
    if (!out.includes(c)) out.push(c);
  }
  if (!out.length) out.push('pkm');
  return out;
}

async function getActiveSchema() {
  const cfg = getConfig();
  const is_test_mode = await getTestModeStateFromDb();
  const raw = is_test_mode ? cfg.db.schema_test : cfg.db.schema_prod;
  return sb.isValidIdent(raw) ? raw : 'pkm';
}

function logStoreError(op, meta, err, duration_ms) {
  try {
    getBraintrustLogger().log({
      input: {
        op,
        ...(meta || {}),
      },
      error: {
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
      },
      metadata: {
        source: 't1_store',
      },
      metrics: {
        duration_ms,
      },
    });
  } catch (_err) {
    // Keep storage failures visible to callers if logging fails.
  }
}

async function runQuery(op, meta, sql, params) {
  const start = Date.now();
  try {
    return await getPool().query(sql, params);
  } catch (err) {
    logStoreError(op, meta, err, Date.now() - start);
    throw err;
  }
}

async function upsertBatchRow(schema, batch, requestCountHint, metadataExtra) {
  const batchesTable = tableName(schema, 't1_batches');
  const batchId = batch && batch.id;
  if (!batchId) throw new Error('batch id is required');

  const params = [
    batchId,
    batch.status || null,
    batch.model || null,
    batch.input_file_id || null,
    batch.output_file_id || null,
    batch.error_file_id || null,
    Number(batch.request_count || requestCountHint || 0),
    JSON.stringify(metadataExtra || batch.metadata || {}),
  ];

  try {
    await runQuery(
      't1_batch_upsert',
      { schema, table: batchesTable },
      `INSERT INTO ${batchesTable} (batch_id, status, model, input_file_id, output_file_id, error_file_id, request_count, metadata, created_at)
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
         metadata = COALESCE(EXCLUDED.metadata, ${batchesTable}.metadata)`,
      params
    );
  } catch (err) {
    throw wrapBatchTableError(err, batchesTable);
  }
}

async function upsertBatchItems(schema, batchId, requests) {
  if (!requests.length) return;

  const itemsTable = tableName(schema, 't1_batch_items');
  const values = [];
  const params = [];
  let idx = 1;
  for (const r of requests) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, now())`);
    params.push(
      batchId,
      r.custom_id,
      r.title || null,
      r.author || null,
      r.content_type || null,
      r.prompt_mode || null,
      r.prompt || null
    );
  }

  try {
    await runQuery(
      't1_batch_items_upsert',
      { schema, table: itemsTable, rowCount: requests.length },
      `INSERT INTO ${itemsTable} (batch_id, custom_id, title, author, content_type, prompt_mode, prompt, created_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (batch_id, custom_id) DO NOTHING`,
      params
    );
  } catch (err) {
    throw wrapBatchTableError(err, itemsTable);
  }
}

async function upsertBatchResults(schema, batchId, rows) {
  if (!rows.length) return 0;
  const resultsTable = tableName(schema, 't1_batch_item_results');

  const values = [];
  const params = [];
  let idx = 1;
  for (const r of rows) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}::jsonb, $${idx++}::jsonb, now(), now())`);
    params.push(
      batchId,
      r.custom_id,
      r.status,
      r.response_text || null,
      r.parsed ? JSON.stringify(r.parsed) : null,
      r.error ? JSON.stringify(r.error) : null,
      r.raw ? JSON.stringify(r.raw) : null
    );
  }

  try {
    await runQuery(
      't1_batch_results_upsert',
      { schema, table: resultsTable, rowCount: rows.length },
      `INSERT INTO ${resultsTable}
       (batch_id, custom_id, status, response_text, parsed, error, raw, updated_at, created_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (batch_id, custom_id) DO UPDATE SET
         status = EXCLUDED.status,
         response_text = EXCLUDED.response_text,
         parsed = EXCLUDED.parsed,
         error = EXCLUDED.error,
         raw = EXCLUDED.raw,
         updated_at = now()`,
      params
    );
  } catch (err) {
    throw wrapBatchTableError(err, resultsTable);
  }

  return rows.length;
}

async function readBatchSummary(schema, batchId) {
  const resultsTable = tableName(schema, 't1_batch_item_results');
  try {
    const res = await runQuery(
      't1_batch_summary',
      { schema, table: resultsTable },
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_count,
         COUNT(*) FILTER (WHERE status = 'parse_error')::int AS parse_error_count,
         COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
       FROM ${resultsTable}
       WHERE batch_id = $1`,
      [batchId]
    );
    return res.rows && res.rows[0]
      ? res.rows[0]
      : { total: 0, ok_count: 0, parse_error_count: 0, error_count: 0 };
  } catch (err) {
    throw wrapBatchTableError(err, resultsTable);
  }
}

async function findBatchRecord(batchId) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');

  const schemas = getConfiguredSchemas();
  for (const schema of schemas) {
    const batchesTable = tableName(schema, 't1_batches');
    try {
      const res = await runQuery(
        't1_batch_find',
        { schema, table: batchesTable },
        `SELECT * FROM ${batchesTable} WHERE batch_id = $1 LIMIT 1`,
        [id]
      );
      if (res.rows && res.rows[0]) return { schema, batch: res.rows[0] };
    } catch (err) {
      if (isMissingRelationError(err)) {
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function listPendingBatchIds(limit) {
  const max = Number(limit || 20);
  const take = Number.isFinite(max) && max > 0 ? Math.min(max, 100) : 20;
  const schemas = getConfiguredSchemas();
  const out = [];

  for (const schema of schemas) {
    if (out.length >= take) break;
    const batchesTable = tableName(schema, 't1_batches');
    try {
      const remaining = take - out.length;
      const res = await runQuery(
        't1_batch_list_pending',
        { schema, table: batchesTable },
        `SELECT batch_id
         FROM ${batchesTable}
         WHERE status IS NULL
            OR status = ''
            OR status <> ALL($1::text[])
         ORDER BY created_at ASC
         LIMIT $2`,
        [Array.from(TERMINAL_BATCH_STATUSES), remaining]
      );
      for (const row of res.rows || []) {
        out.push(row.batch_id);
      }
    } catch (err) {
      if (isMissingRelationError(err)) {
        continue;
      }
      throw err;
    }
  }

  return out;
}

module.exports = {
  TERMINAL_BATCH_STATUSES,
  getActiveSchema,
  getConfiguredSchemas,
  tableName,
  upsertBatchRow,
  upsertBatchItems,
  upsertBatchResults,
  readBatchSummary,
  findBatchRecord,
  listPendingBatchIds,
};
