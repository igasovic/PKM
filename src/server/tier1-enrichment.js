'use strict';

const sb = require('../libs/sql-builder.js');
const { getConfig } = require('../libs/config.js');
const { getPool } = require('./db-pool.js');
const { getBraintrustLogger, traceDb } = require('./observability.js');
const { getTestModeStateFromDb } = require('./db.js');
const { buildSampledPrompt, buildWholePrompt } = require('../libs/prompt-builder.js');
const { LiteLLMClient, extractResponseText } = require('./litellm-client.js');
const { buildRetrievalForDb } = require('./quality.js');

const CLEAN_TEXT_SAMPLE_LIMIT = 4000;
const TERMINAL_BATCH_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled']);

let litellmClient = null;
let workerTimer = null;
let workerActive = false;

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function isMissingRelationError(err) {
  return !!(err && (err.code === '42P01' || err.code === '3F000'));
}

function wrapBatchTableError(err, tableName) {
  if (!isMissingRelationError(err)) return err;
  const wrapped = new Error(`batch table missing: create ${tableName} before using /enrich/t1 batch APIs`);
  wrapped.cause = err;
  return wrapped;
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

function tableName(schema, table) {
  return sb.qualifiedTable(schema, table);
}

function parseTier1Json(text) {
  let s = String(text || '').trim();
  if (!s) throw new Error('Tier-1 parse: model output text is empty');

  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  let t1;
  try {
    t1 = JSON.parse(s);
  } catch (e) {
    const preview = s.slice(0, 250);
    throw new Error(`Tier-1 parse: invalid JSON. Preview: ${preview}`);
  }

  const reqStr = (k) => typeof t1[k] === 'string' && t1[k].trim().length > 0;
  if (!reqStr('topic_primary')) throw new Error('Tier-1 parse: missing topic_primary');
  if (!reqStr('topic_secondary')) throw new Error('Tier-1 parse: missing topic_secondary');
  if (!reqStr('gist')) throw new Error('Tier-1 parse: missing gist');
  if (!Array.isArray(t1.keywords)) throw new Error('Tier-1 parse: keywords must be an array');

  t1.topic_primary = t1.topic_primary.trim();
  t1.topic_secondary = t1.topic_secondary.trim();
  t1.gist = t1.gist.trim();

  t1.keywords = t1.keywords
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  t1.keywords = Array.from(new Set(t1.keywords));

  if (t1.keywords.length < 5) throw new Error('Tier-1 parse: keywords must have at least 5 items');
  if (t1.keywords.length > 12) t1.keywords = t1.keywords.slice(0, 12);

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  if (typeof t1.topic_primary_confidence === 'number') {
    t1.topic_primary_confidence = clamp01(t1.topic_primary_confidence);
  }
  if (typeof t1.topic_secondary_confidence === 'number') {
    t1.topic_secondary_confidence = clamp01(t1.topic_secondary_confidence);
  }

  return t1;
}

function buildTier1Prompt(input) {
  const text = String(input.clean_text || '');
  if (text.length > CLEAN_TEXT_SAMPLE_LIMIT) {
    return buildSampledPrompt(input);
  }
  return buildWholePrompt(input);
}

function toTier1Response(t1, quality) {
  const q = quality || {};
  return {
    topic_primary: t1.topic_primary,
    topic_primary_confidence: t1.topic_primary_confidence ?? null,
    topic_secondary: t1.topic_secondary,
    topic_secondary_confidence: t1.topic_secondary_confidence ?? null,
    keywords: t1.keywords,
    gist: t1.gist,
    flags: {
      boilerplate_heavy: !!q.boilerplate_heavy,
      low_signal: !!q.low_signal,
    },
    quality_score: q.quality_score ?? null,
    clean_word_count: q.clean_word_count ?? null,
    clean_char_count: q.clean_char_count ?? null,
    link_count: q.link_count ?? null,
    link_ratio: q.link_ratio ?? null,
    retrieval_excerpt: q.retrieval_excerpt ?? null,
  };
}

function buildBatchRequests(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new Error('enrich/t1 batch requires non-empty items');

  return list.map((item, idx) => {
    const clean_text = item && item.clean_text;
    if (!String(clean_text || '').trim()) {
      throw new Error(`enrich/t1 batch item ${idx} missing clean_text`);
    }
    const promptBuilt = buildTier1Prompt({
      title: item.title ?? null,
      author: item.author ?? null,
      content_type: item.content_type ?? 'other',
      clean_text,
    });
    return {
      custom_id: String(item.custom_id || item.id || `item_${Date.now()}_${idx}`),
      prompt: promptBuilt.prompt,
      prompt_mode: promptBuilt.prompt_mode,
      title: item.title ?? null,
      author: item.author ?? null,
      content_type: item.content_type ?? 'other',
    };
  });
}

async function upsertBatchRow(schema, batch, requestCountHint, metadataExtra) {
  const batchesTable = tableName(schema, 't1_batches');
  const p = getPool();
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
    await traceDb('t1_batch_upsert', { schema, table: batchesTable }, () => p.query(
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
    ));
  } catch (err) {
    throw wrapBatchTableError(err, batchesTable);
  }
}

async function upsertBatchItems(schema, batchId, requests) {
  if (!requests.length) return;

  const itemsTable = tableName(schema, 't1_batch_items');
  const p = getPool();
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
    await traceDb('t1_batch_items_upsert', { schema, table: itemsTable, rowCount: requests.length }, () => p.query(
      `INSERT INTO ${itemsTable} (batch_id, custom_id, title, author, content_type, prompt_mode, prompt, created_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (batch_id, custom_id) DO NOTHING`,
      params
    ));
  } catch (err) {
    throw wrapBatchTableError(err, itemsTable);
  }
}

async function upsertBatchResults(schema, batchId, rows) {
  if (!rows.length) return 0;
  const resultsTable = tableName(schema, 't1_batch_item_results');
  const p = getPool();

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
    await traceDb('t1_batch_results_upsert', { schema, table: resultsTable, rowCount: rows.length }, () => p.query(
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
    ));
  } catch (err) {
    throw wrapBatchTableError(err, resultsTable);
  }

  return rows.length;
}

async function findBatchRecord(batchId) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');

  const schemas = getConfiguredSchemas();
  const p = getPool();
  for (const schema of schemas) {
    const batchesTable = tableName(schema, 't1_batches');
    try {
      const res = await traceDb('t1_batch_find', { schema, table: batchesTable }, () => p.query(
        `SELECT * FROM ${batchesTable} WHERE batch_id = $1 LIMIT 1`,
        [id]
      ));
      if (res.rows && res.rows[0]) return { schema, batch: res.rows[0] };
    } catch (err) {
      if (isMissingRelationError(err)) {
        getBraintrustLogger().log({
          input: { schema, table: batchesTable, batch_id: id },
          metadata: { source: 't1_batch_worker', event: 'schema_missing_skip' },
          error: { message: `missing table in schema scan: ${batchesTable}` },
        });
        continue;
      }
      throw err;
    }
  }
  return null;
}

function parseJsonl(text) {
  const rows = [];
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch (_err) {
      rows.push({ parse_error: true, raw_line: line });
    }
  }
  return rows;
}

function mapBatchLineToResult(row) {
  const custom_id = String(row && row.custom_id ? row.custom_id : '');
  if (!custom_id) return null;

  const responseBody = row && row.response && row.response.body;
  const statusCode = row && row.response && row.response.status_code;
  const isHttpOk = Number(statusCode) >= 200 && Number(statusCode) < 300;
  const hasModelResponse = !!responseBody;

  if (isHttpOk && hasModelResponse) {
    const text = extractResponseText(responseBody);
    try {
      const parsed = parseTier1Json(text);
      return {
        custom_id,
        status: 'ok',
        response_text: text,
        parsed,
        error: null,
        raw: row,
      };
    } catch (err) {
      return {
        custom_id,
        status: 'parse_error',
        response_text: text || null,
        parsed: null,
        error: { message: err.message },
        raw: row,
      };
    }
  }

  return {
    custom_id,
    status: 'error',
    response_text: null,
    parsed: null,
    error: row && (row.error || row.response || { message: 'batch item failed' }),
    raw: row,
  };
}

function mergeResultRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || !row.custom_id) continue;
    const existing = byId.get(row.custom_id);
    if (!existing) {
      byId.set(row.custom_id, row);
      continue;
    }
    if (existing.status !== 'ok' && row.status === 'ok') {
      byId.set(row.custom_id, row);
    }
  }
  return Array.from(byId.values());
}

async function readBatchSummary(schema, batchId) {
  const resultsTable = tableName(schema, 't1_batch_item_results');
  const p = getPool();
  try {
    const res = await traceDb('t1_batch_summary', { schema, table: resultsTable }, () => p.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_count,
         COUNT(*) FILTER (WHERE status = 'parse_error')::int AS parse_error_count,
         COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
       FROM ${resultsTable}
       WHERE batch_id = $1`,
      [batchId]
    ));
    return res.rows && res.rows[0]
      ? res.rows[0]
      : { total: 0, ok_count: 0, parse_error_count: 0, error_count: 0 };
  } catch (err) {
    throw wrapBatchTableError(err, resultsTable);
  }
}

async function syncTier1Batch(batchId) {
  const found = await findBatchRecord(batchId);
  if (!found) {
    throw new Error(`batch_id not found: ${batchId}`);
  }

  const { schema, batch: localBatch } = found;
  const client = getLiteLLMClient();
  const remoteBatch = await client.retrieveBatch(batchId);

  await upsertBatchRow(
    schema,
    remoteBatch,
    localBatch.request_count || 0,
    localBatch.metadata || {}
  );

  const allRows = [];
  if (remoteBatch.output_file_id) {
    const outputText = await client.getFileContent(remoteBatch.output_file_id);
    allRows.push(...parseJsonl(outputText).map(mapBatchLineToResult).filter(Boolean));
  }
  if (remoteBatch.error_file_id) {
    const errorText = await client.getFileContent(remoteBatch.error_file_id);
    allRows.push(...parseJsonl(errorText).map(mapBatchLineToResult).filter(Boolean));
  }

  const mergedRows = mergeResultRows(allRows);
  const updated_items = await upsertBatchResults(schema, batchId, mergedRows);
  const summary = await readBatchSummary(schema, batchId);

  return {
    batch_id: batchId,
    schema,
    status: remoteBatch.status,
    terminal: TERMINAL_BATCH_STATUSES.has(String(remoteBatch.status || '').toLowerCase()),
    updated_items,
    summary,
  };
}

async function listPendingBatchIds(limit) {
  const max = Number(limit || 20);
  const take = Number.isFinite(max) && max > 0 ? Math.min(max, 100) : 20;
  const schemas = getConfiguredSchemas();
  const p = getPool();
  const out = [];

  for (const schema of schemas) {
    if (out.length >= take) break;
    const batchesTable = tableName(schema, 't1_batches');
    try {
      const remaining = take - out.length;
      const res = await traceDb('t1_batch_list_pending', { schema, table: batchesTable }, () => p.query(
        `SELECT batch_id
         FROM ${batchesTable}
         WHERE status IS NULL
            OR status = ''
            OR status <> ALL($1::text[])
         ORDER BY created_at ASC
         LIMIT $2`,
        [Array.from(TERMINAL_BATCH_STATUSES), remaining]
      ));
      for (const row of res.rows || []) {
        out.push(row.batch_id);
      }
    } catch (err) {
      if (isMissingRelationError(err)) {
        getBraintrustLogger().log({
          input: { schema, table: batchesTable },
          metadata: { source: 't1_batch_worker', event: 'schema_missing_skip' },
          error: { message: `missing table in schema scan: ${batchesTable}` },
        });
        continue;
      }
      throw err;
    }
  }

  return out;
}

async function syncPendingTier1Batches(opts) {
  const options = opts || {};
  const ids = await listPendingBatchIds(options.limit);
  const synced = [];
  for (const batch_id of ids) {
    try {
      const result = await syncTier1Batch(batch_id);
      synced.push(result);
    } catch (err) {
      synced.push({
        batch_id,
        error: err.message,
      });
    }
  }
  return {
    requested: ids.length,
    synced,
  };
}

async function runTier1BatchWorkerCycle() {
  if (workerActive) {
    return { skipped: true, reason: 'worker_busy' };
  }
  workerActive = true;
  try {
    const limitRaw = Number(process.env.T1_BATCH_SYNC_LIMIT || 20);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 20;
    const result = await syncPendingTier1Batches({ limit });
    getBraintrustLogger().log({
      input: { limit },
      output: result,
      metadata: {
        source: 't1_batch_worker',
        event: 'cycle',
      },
    });
    return result;
  } catch (err) {
    getBraintrustLogger().log({
      error: {
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
      },
      metadata: {
        source: 't1_batch_worker',
        event: 'cycle_error',
      },
    });
    return { error: err.message };
  } finally {
    workerActive = false;
  }
}

function startTier1BatchWorker() {
  if (workerTimer) {
    return;
  }
  const enabled = String(process.env.T1_BATCH_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return;

  const intervalRaw = Number(process.env.T1_BATCH_SYNC_INTERVAL_MS || 10*60_000);
  const intervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;

  // Kick off an immediate cycle so restart recovery starts right away.
  runTier1BatchWorkerCycle();
  workerTimer = setInterval(() => {
    runTier1BatchWorkerCycle();
  }, intervalMs);
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

function stopTier1BatchWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

async function enrichTier1(input) {
  const payload = input || {};
  const clean_text = payload.clean_text ?? '';
  if (!String(clean_text).trim()) {
    throw new Error('enrich/t1 requires clean_text');
  }

  const promptBuilt = buildTier1Prompt({
    title: payload.title ?? null,
    author: payload.author ?? null,
    content_type: payload.content_type ?? 'other',
    clean_text,
  });

  const client = getLiteLLMClient();
  const { response } = await client.sendMessage(promptBuilt.prompt);
  const text = extractResponseText(response);
  const t1 = parseTier1Json(text);

  // Reevaluate retrieval-quality from canonical clean_text after Tier-1 parse.
  const config = getConfig();
  const quality = buildRetrievalForDb({
    capture_text: clean_text,
    content_type: payload.content_type ?? 'other',
    extracted_text: '',
    url_canonical: null,
    url: null,
    config,
    excerpt_override: null,
    excerpt_source: clean_text,
    quality_source_text: clean_text,
  });

  return toTier1Response(t1, quality);
}

async function enqueueTier1Batch(items, opts) {
  const requests = buildBatchRequests(items);
  const client = getLiteLLMClient();
  const { batch } = await client.createBatch(requests, opts);
  const schema = await getActiveSchema();

  await upsertBatchRow(
    schema,
    batch,
    requests.length,
    {
      request_count: requests.length,
      created_via: 'api',
    }
  );
  await upsertBatchItems(schema, batch.id, requests);

  getBraintrustLogger().log({
    input: {
      batch_id: batch.id,
      request_count: requests.length,
      schema,
    },
    output: {
      status: batch.status,
    },
    metadata: {
      source: 't1_batch',
      event: 'enqueue',
    },
  });

  return {
    batch_id: batch.id,
    status: batch.status,
    schema,
    request_count: requests.length,
  };
}

module.exports = {
  enrichTier1,
  enqueueTier1Batch,
  startTier1BatchWorker,
  stopTier1BatchWorker,
};
