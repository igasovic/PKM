'use strict';

const sb = require('../../libs/sql-builder.js');
const { getConfig } = require('../../libs/config.js');
const { getPool } = require('../db-pool.js');
const { braintrustSink } = require('../logger/braintrust.js');

const TERMINAL_BATCH_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled']);

function isMissingRelationError(err) {
  return !!(err && (err.code === '42P01' || err.code === '3F000'));
}

function wrapBatchTableError(err, tableName) {
  if (!isMissingRelationError(err)) return err;
  const wrapped = new Error(`batch table missing: create ${tableName} before using /distill/run or /status?stage=t2`);
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

function getProdSchema() {
  const cfg = getConfig();
  const raw = cfg && cfg.db ? cfg.db.schema_prod : null;
  return sb.isValidIdent(raw) ? raw : 'pkm';
}

function logStoreError(op, meta, err, durationMs) {
  try {
    braintrustSink.logError(op, {
      input: {
        ...(meta || {}),
      },
      error: err,
      metadata: {
        source: 't2_store',
      },
      metrics: {
        duration_ms: durationMs,
      },
    });
  } catch (_err) {
    // keep store errors visible to callers
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

function toStatusPayload(schema, row) {
  const status = String((row && row.status) || '').trim();
  const isTerminal = TERMINAL_BATCH_STATUSES.has(status.toLowerCase());
  return {
    schema,
    batch_id: row.batch_id,
    status: status || null,
    is_terminal: isTerminal,
    model: row.model || null,
    input_file_id: row.input_file_id || null,
    output_file_id: row.output_file_id || null,
    error_file_id: row.error_file_id || null,
    request_count: Number(row.request_count || 0),
    counts: {
      total_items: Number(row.total_items || 0),
      processed: Number(row.processed_count || 0),
      ok: Number(row.ok_count || 0),
      parse_error: Number(row.parse_error_count || 0),
      error: Number(row.error_count || 0),
      pending: Number(row.pending_count || 0),
    },
    metadata: row.metadata || {},
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function upsertBatchRow(schema, batch, requestCountHint, metadataExtra) {
  const batchesTable = tableName(schema, 't2_batches');
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
    const sql = sb.buildT1BatchUpsert({ batchesTable });
    await runQuery(
      't2_batch_upsert',
      { schema, table: batchesTable },
      sql,
      params
    );
  } catch (err) {
    throw wrapBatchTableError(err, batchesTable);
  }
}

async function upsertBatchItems(schema, batchId, requests) {
  if (!Array.isArray(requests) || requests.length === 0) return;

  const itemsTable = tableName(schema, 't2_batch_items');
  const params = [];
  for (const r of requests) {
    params.push(
      batchId,
      r.custom_id,
      Number(r.entry_id),
      r.content_hash || null,
      r.route || null,
      r.chunking_strategy || null,
      r.request_type || null,
      r.title || null,
      r.author || null,
      r.content_type || null,
      r.prompt_mode || null,
      r.prompt || null,
      Number.isFinite(Number(r.retry_count)) ? Math.trunc(Number(r.retry_count)) : 0
    );
  }

  try {
    const sql = sb.buildT2BatchItemsInsert({ itemsTable, rowCount: requests.length });
    await runQuery(
      't2_batch_items_upsert',
      { schema, table: itemsTable, rowCount: requests.length },
      sql,
      params
    );
  } catch (err) {
    throw wrapBatchTableError(err, itemsTable);
  }
}

async function upsertBatchResults(schema, batchId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const resultsTable = tableName(schema, 't2_batch_item_results');
  const params = [];
  for (const r of rows) {
    params.push(
      batchId,
      r.custom_id,
      r.status || 'error',
      r.response_text || null,
      r.parsed ? JSON.stringify(r.parsed) : null,
      r.error ? JSON.stringify(r.error) : null,
      r.raw ? JSON.stringify(r.raw) : null,
      typeof r.applied === 'boolean' ? r.applied : null
    );
  }

  try {
    const sql = sb.buildT2BatchResultsUpsert({ resultsTable, rowCount: rows.length });
    await runQuery(
      't2_batch_results_upsert',
      { schema, table: resultsTable, rowCount: rows.length },
      sql,
      params
    );
  } catch (err) {
    throw wrapBatchTableError(err, resultsTable);
  }

  return rows.length;
}

async function markBatchResultsApplied(schema, batchId, customIds) {
  const ids = Array.isArray(customIds)
    ? customIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (!ids.length) return 0;

  const resultsTable = tableName(schema, 't2_batch_item_results');
  try {
    const sql = sb.buildT2BatchMarkResultsApplied({ resultsTable });
    const res = await runQuery(
      't2_batch_results_mark_applied',
      { schema, table: resultsTable, batch_id: batchId, ids: ids.length },
      sql,
      [batchId, ids]
    );
    return Number(res.rowCount || 0);
  } catch (err) {
    throw wrapBatchTableError(err, resultsTable);
  }
}

async function findBatchRecord(batchId) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');

  const schemas = getConfiguredSchemas();
  for (const schema of schemas) {
    const batchesTable = tableName(schema, 't2_batches');
    try {
      const sql = sb.buildT1BatchFind({ batchesTable });
      const res = await runQuery(
        't2_batch_find',
        { schema, table: batchesTable },
        sql,
        [id]
      );
      if (res.rows && res.rows[0]) return { schema, batch: res.rows[0] };
    } catch (err) {
      if (isMissingRelationError(err)) continue;
      throw err;
    }
  }
  return null;
}

async function getBatchRecordById(schema, batchId) {
  const rawSchema = String(schema || '').trim();
  if (!sb.isValidIdent(rawSchema)) {
    throw new Error(`invalid schema: ${rawSchema}`);
  }
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');
  const batchesTable = tableName(rawSchema, 't2_batches');
  try {
    const sql = sb.buildT1BatchFind({ batchesTable });
    const res = await runQuery(
      't2_batch_get',
      { schema: rawSchema, table: batchesTable, batch_id: id },
      sql,
      [id]
    );
    return res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    throw wrapBatchTableError(err, batchesTable);
  }
}

async function listPendingBatchIds(limit, opts) {
  const options = opts || {};
  const max = Number(limit || 20);
  const take = Number.isFinite(max) && max > 0 ? Math.min(Math.trunc(max), 100) : 20;
  const schemaOverride = String(options.schema || '').trim();
  if (schemaOverride && !sb.isValidIdent(schemaOverride)) {
    throw new Error(`invalid schema: ${schemaOverride}`);
  }
  const schemas = schemaOverride ? [schemaOverride] : getConfiguredSchemas();
  const out = [];

  for (const schema of schemas) {
    if (out.length >= take) break;
    const batchesTable = tableName(schema, 't2_batches');
    try {
      const remaining = take - out.length;
      const sql = sb.buildT1BatchListPending({ batchesTable });
      const res = await runQuery(
        't2_batch_list_pending',
        { schema, table: batchesTable },
        sql,
        [Array.from(TERMINAL_BATCH_STATUSES), remaining]
      );
      for (const row of res.rows || []) {
        out.push({ schema, batch_id: row.batch_id });
      }
    } catch (err) {
      if (isMissingRelationError(err)) continue;
      throw err;
    }
  }

  return out;
}

async function listBatchStatuses(opts) {
  const options = opts || {};
  const includeTerminal = !!options.include_terminal;
  const max = Number(options.limit || 50);
  const take = Number.isFinite(max) && max > 0 ? Math.min(Math.trunc(max), 200) : 50;
  const schemaOverride = String(options.schema || '').trim();
  if (schemaOverride && !sb.isValidIdent(schemaOverride)) {
    throw new Error(`invalid schema: ${schemaOverride}`);
  }

  const schemas = schemaOverride ? [schemaOverride] : getConfiguredSchemas();
  const out = [];

  for (const schema of schemas) {
    if (out.length >= take) break;
    const remaining = take - out.length;
    const batchesTable = tableName(schema, 't2_batches');
    const itemsTable = tableName(schema, 't2_batch_items');
    const resultsTable = tableName(schema, 't2_batch_item_results');
    try {
      const sql = sb.buildT1BatchStatusList({
        batchesTable,
        itemsTable,
        resultsTable,
        includeTerminal,
      });
      const params = includeTerminal
        ? [remaining]
        : [Array.from(TERMINAL_BATCH_STATUSES), remaining];
      const res = await runQuery(
        't2_batch_status_list',
        { schema, table: batchesTable, includeTerminal, limit: remaining },
        sql,
        params
      );
      for (const row of res.rows || []) {
        out.push(toStatusPayload(schema, row));
      }
    } catch (err) {
      if (isMissingRelationError(err)) continue;
      throw err;
    }
  }

  return out;
}

async function getBatchStatus(batchId, opts) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');
  const options = opts || {};
  const includeItems = !!options.include_items;
  const schemaOverride = String(options.schema || '').trim();
  if (schemaOverride && !sb.isValidIdent(schemaOverride)) {
    throw new Error(`invalid schema: ${schemaOverride}`);
  }
  const schemas = schemaOverride ? [schemaOverride] : getConfiguredSchemas();

  for (const schema of schemas) {
    const batchesTable = tableName(schema, 't2_batches');
    const itemsTable = tableName(schema, 't2_batch_items');
    const resultsTable = tableName(schema, 't2_batch_item_results');
    try {
      const sql = sb.buildT1BatchStatusById({
        batchesTable,
        itemsTable,
        resultsTable,
      });
      const res = await runQuery(
        't2_batch_status_get',
        { schema, table: batchesTable, batch_id: id },
        sql,
        [id]
      );
      const row = res.rows && res.rows[0];
      if (!row) continue;

      const out = {
        ...toStatusPayload(schema, row),
      };

      if (includeItems) {
        const max = Number(options.items_limit || 200);
        const itemsLimit = Number.isFinite(max) && max > 0 ? Math.min(Math.trunc(max), 1000) : 200;
        const itemsSql = sb.buildT2BatchItemStatusList({ itemsTable, resultsTable });
        const itemsRes = await runQuery(
          't2_batch_items_status_list',
          { schema, table: itemsTable, batch_id: id, items_limit: itemsLimit },
          itemsSql,
          [id, itemsLimit]
        );
        out.items = (itemsRes.rows || []).map((item) => ({
          custom_id: item.custom_id,
          entry_id: Number(item.entry_id || 0) || null,
          status: item.error_code || item.status || 'pending',
          error_code: item.error_code || null,
          message: item.message || null,
          preserved_current_artifact: item.preserved_current_artifact === true,
          title: item.title || null,
          author: item.author || null,
          content_type: item.content_type || null,
          prompt_mode: item.prompt_mode || null,
          has_error: !!item.has_error,
          created_at: item.created_at || null,
          updated_at: item.updated_at || null,
        }));
      }

      return out;
    } catch (err) {
      if (isMissingRelationError(err)) continue;
      throw err;
    }
  }

  return null;
}

async function getBatchReconcileRows(schema, batchId, limit) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');
  const takeRaw = Number(limit || 5000);
  const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(Math.trunc(takeRaw), 10000) : 5000;
  const batchesTable = tableName(schema, 't2_batches');
  const itemsTable = tableName(schema, 't2_batch_items');
  const resultsTable = tableName(schema, 't2_batch_item_results');

  try {
    const sql = sb.buildT2BatchReconcileRows({ batchesTable, itemsTable, resultsTable });
    const res = await runQuery(
      't2_batch_reconcile_rows',
      { schema, batch_id: id, items_limit: take },
      sql,
      [id, take]
    );
    return res.rows || [];
  } catch (err) {
    throw wrapBatchTableError(err, itemsTable);
  }
}

async function getEntryStatesByEntryIds(schema, entryIds) {
  const ids = Array.isArray(entryIds)
    ? entryIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (!ids.length) return [];

  const entriesTable = tableName(schema, 'entries');
  const sql = sb.buildTier2EntryStatesByEntryIds({
    entries_table: entriesTable,
    entry_ids: ids,
  });

  const res = await runQuery(
    't2_entry_states',
    { schema, table: entriesTable, ids: ids.length },
    sql,
    []
  );
  return res.rows || [];
}

module.exports = {
  TERMINAL_BATCH_STATUSES,
  getConfiguredSchemas,
  getProdSchema,
  tableName,
  upsertBatchRow,
  upsertBatchItems,
  upsertBatchResults,
  markBatchResultsApplied,
  getBatchRecordById,
  findBatchRecord,
  listPendingBatchIds,
  listBatchStatuses,
  getBatchStatus,
  getBatchReconcileRows,
  getEntryStatesByEntryIds,
};
