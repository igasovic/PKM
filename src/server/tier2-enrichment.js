'use strict';

const distillStore = require('./db/distill-store.js');
const { getConfig } = require('../libs/config.js');
const { LiteLLMClient } = require('./litellm-client.js');
const { braintrustSink } = require('./logger/braintrust.js');
const { getLogger } = require('./logger/index.js');
const { createBatchWorkerRuntime } = require('./batch-worker-runtime.js');
const { getT2ModelEnv, getT2BatchSettings, hasLiteLLMKey } = require('./runtime-env.js');
const { runTier2ControlPlanePlan } = require('./tier2/planner.js');
const { distillTier2SingleEntrySync } = require('./tier2/service.js');
const { DISTILL_VALIDATION_ERROR_CODES } = require('./tier2/constants.js');
const {
  buildTier2Artifact,
  validateTier2Artifact,
} = require('./tier2/parsing-validation.js');
const {
  buildBatchRequests,
  parseJsonl,
  mapBatchLineToResult,
  mergeResultRows,
} = require('./tier2/domain.js');
const tier2Store = require('./tier2/store.js');

const DETERMINISTIC_NON_RETRYABLE_CODES = new Set([
  ...Object.values(DISTILL_VALIDATION_ERROR_CODES || {}),
  'currentness_mismatch',
  'missing_clean_text',
  'wrong_content_type',
  'already_current',
  'already_queued',
  'invalid_config',
  'invalid_route',
  'validation_contract_mismatch',
]);

let litellmClient = null;

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function parsePositiveIntOrNull(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return Math.trunc(n);
}

function parseBooleanDefault(value, defaultValue) {
  if (value === null || value === undefined || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return defaultValue;
}

function parseExecutionMode(value, fallback) {
  const fb = String(fallback || 'batch').trim().toLowerCase() === 'sync' ? 'sync' : 'batch';
  if (value === null || value === undefined || value === '') return fb;
  const raw = String(value).trim().toLowerCase();
  if (raw === 'sync') return 'sync';
  if (raw === 'batch') return 'batch';
  throw new Error('execution_mode must be one of: batch, sync');
}

function resolveDefaultRunLimit() {
  const cfg = getConfig();
  const n = Number(cfg && cfg.distill && cfg.distill.max_entries_per_run);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 25;
}

function parseLimit(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

function toNormalizedCodeSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveTier2RetryConfig(config) {
  const cfg = config && config.distill ? config.distill : {};
  const retry = cfg && cfg.retry ? cfg.retry : {};
  const maxAttemptsRaw = Number(retry.max_attempts);
  const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0
    ? Math.trunc(maxAttemptsRaw)
    : 2;
  const retryableCodes = toNormalizedCodeSet(retry.retryable_error_codes);
  const nonRetryableCodes = new Set([
    ...DETERMINISTIC_NON_RETRYABLE_CODES,
    ...toNormalizedCodeSet(retry.non_retryable_error_codes),
  ]);

  return {
    enabled: retry.enabled !== false,
    max_attempts: maxAttempts,
    retryable_codes: retryableCodes,
    has_retryable_filter: retryableCodes.size > 0,
    non_retryable_codes: nonRetryableCodes,
  };
}

function normalizeErrorCode(value) {
  return String(value || 'worker_error').trim().toLowerCase() || 'worker_error';
}

function buildErrorCodeCounts(results) {
  const out = {};
  const rows = Array.isArray(results) ? results : [];
  for (const row of rows) {
    if (!row || row.status === 'completed') continue;
    const code = normalizeErrorCode(row.error_code || row.status || 'worker_error');
    out[code] = Number(out[code] || 0) + 1;
  }
  return out;
}

function mergeErrorCodeCounts(base, delta) {
  const out = { ...(base || {}) };
  const src = delta && typeof delta === 'object' ? delta : {};
  for (const [code, value] of Object.entries(src)) {
    const key = normalizeErrorCode(code);
    out[key] = Number(out[key] || 0) + Number(value || 0);
  }
  return out;
}

function shouldRetryTier2Failure(retryConfig, errorCode, attemptCount) {
  const cfg = retryConfig || {
    enabled: false,
    max_attempts: 1,
    retryable_codes: new Set(),
    has_retryable_filter: false,
    non_retryable_codes: new Set(),
  };
  const code = normalizeErrorCode(errorCode);
  const attempts = Number.isFinite(Number(attemptCount)) ? Number(attemptCount) : 1;

  if (!cfg.enabled) {
    return { retry: false, reason: 'retry_disabled', error_code: code };
  }
  if (attempts >= cfg.max_attempts) {
    return { retry: false, reason: 'max_attempts_reached', error_code: code };
  }
  if (cfg.non_retryable_codes.has(code)) {
    return { retry: false, reason: 'non_retryable_error_code', error_code: code };
  }
  if (cfg.has_retryable_filter && !cfg.retryable_codes.has(code)) {
    return { retry: false, reason: 'not_in_retryable_error_codes', error_code: code };
  }
  return { retry: true, reason: 'retryable', error_code: code };
}

function hasCurrentCompletedArtifact(row) {
  const status = String((row && row.distill_status) || '').trim().toLowerCase();
  const currentHash = String((row && row.content_hash) || '').trim();
  const createdFromHash = String((row && row.distill_created_from_hash) || '').trim();
  return status === 'completed' && !!currentHash && currentHash === createdFromHash;
}

function toFailureMetadata(errorCode, details, model, chunkingStrategy, retryCount) {
  return {
    error: {
      code: errorCode || 'generation_error',
      details: details || null,
      at: new Date().toISOString(),
    },
    model: model || null,
    chunking_strategy: chunkingStrategy || null,
    retry_count: Number.isFinite(Number(retryCount)) ? Math.max(0, Math.trunc(Number(retryCount))) : 0,
  };
}

function getDistillConfig(config) {
  const cfg = config || getConfig();
  return cfg && cfg.distill ? cfg.distill : {};
}

function resolveTier2BatchModel(config) {
  const distill = getDistillConfig(config);
  const models = distill && distill.models ? distill.models : {};
  const modelEnv = getT2ModelEnv();
  return (
    models.batch_direct ||
    models.sync_direct ||
    models.direct ||
    modelEnv.batchDirect ||
    modelEnv.syncDirect ||
    modelEnv.direct ||
    't2-direct'
  );
}

function resolveTier2BatchRequestModel() {
  const modelEnv = getT2ModelEnv();
  return (
    modelEnv.batchRequestModel ||
    modelEnv.t1BatchRequestModel ||
    modelEnv.t1BatchProviderModel ||
    null
  );
}

function toResultStatus(errorCode) {
  if (normalizeErrorCode(errorCode) === 'parse_error') return 'parse_error';
  return 'error';
}

function parseErrorObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function summaryFromJobs(rows) {
  const jobs = Array.isArray(rows) ? rows : [];
  const summary = {
    jobs: jobs.length,
    in_progress: 0,
    terminal: 0,
    total_items: 0,
    processed: 0,
    pending: 0,
    ok: 0,
    parse_error: 0,
    error: 0,
  };

  for (const row of jobs) {
    if (row.is_terminal) summary.terminal += 1;
    else summary.in_progress += 1;
    summary.total_items += Number(row.counts && row.counts.total_items ? row.counts.total_items : 0);
    summary.processed += Number(row.counts && row.counts.processed ? row.counts.processed : 0);
    summary.pending += Number(row.counts && row.counts.pending ? row.counts.pending : 0);
    summary.ok += Number(row.counts && row.counts.ok ? row.counts.ok : 0);
    summary.parse_error += Number(row.counts && row.counts.parse_error ? row.counts.parse_error : 0);
    summary.error += Number(row.counts && row.counts.error ? row.counts.error : 0);
  }

  return summary;
}

const T2_STATUS_HISTORY_MAX = 1000;
const T2_STATUS_HISTORY_DEFAULT = 200;
let tier2BatchHistory = [];

function resolveTier2StatusHistoryLimit() {
  return parseLimit(
    getT2BatchSettings(T2_STATUS_HISTORY_DEFAULT).statusHistoryLimitRaw,
    T2_STATUS_HISTORY_DEFAULT,
    T2_STATUS_HISTORY_MAX
  );
}

function buildTier2BatchId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `t2_${ts}_${rand}`;
}

function computeTier2RunStatus(result) {
  if (result && result.error) return 'failed';
  if (result && result.mode === 'dry_run') return 'dry_run';
  const failed = Number(result && result.failed_count ? result.failed_count : 0);
  const processed = Number(result && result.processed_count ? result.processed_count : 0);
  if (failed > 0 && processed > 0) return 'partial_failed';
  if (failed > 0) return 'failed';
  if (processed === 0 && Number(result && result.planned_selected_count ? result.planned_selected_count : 0) > 0) {
    return 'in_progress';
  }
  return 'completed';
}

function buildTier2Counts(result) {
  if (result && result.error) {
    return {
      total_items: 0,
      processed: 0,
      ok: 0,
      parse_error: 0,
      error: 1,
      pending: 0,
    };
  }

  const planned = Number(result && result.planned_selected_count ? result.planned_selected_count : 0);
  const processed = Number(result && result.processed_count ? result.processed_count : 0);
  const completed = Number(result && result.completed_count ? result.completed_count : 0);
  const failed = Number(result && result.failed_count ? result.failed_count : 0);
  if (result && result.mode === 'dry_run') {
    const willProcess = Number(result.will_process_count || 0);
    return {
      total_items: willProcess,
      processed: 0,
      ok: 0,
      parse_error: 0,
      error: 0,
      pending: 0,
    };
  }
  return {
    total_items: planned,
    processed,
    ok: completed,
    parse_error: 0,
    error: failed,
    pending: Math.max(planned - processed, 0),
  };
}

function buildTier2Items(result, createdAt, updatedAt) {
  const executionMode = parseExecutionMode(result && result.execution_mode, 'batch');
  const promptMode = executionMode === 'sync' ? 't2_sync' : 't2_batch';
  if (result && result.mode === 'dry_run') {
    const selected = Array.isArray(result.selected) ? result.selected : [];
    return selected.map((row) => ({
      custom_id: `entry_${row.entry_id}`,
      entry_id: row.entry_id,
      status: 'planned',
      error_code: null,
      message: null,
      preserved_current_artifact: false,
      title: null,
      author: null,
      content_type: 'newsletter',
      prompt_mode: promptMode,
      has_error: false,
      created_at: createdAt,
      updated_at: updatedAt,
    }));
  }

  const results = Array.isArray(result && result.results) ? result.results : [];
  return results.map((row) => {
    const errorCode = row.status === 'completed' ? null : (row.error_code || row.status || 'error');
    return {
      custom_id: `entry_${row.entry_id}`,
      entry_id: row.entry_id,
      status: row.status === 'completed' ? 'ok' : errorCode,
      error_code: errorCode,
      message: row && row.message ? String(row.message) : null,
      preserved_current_artifact: row.preserved_current_artifact === true,
      title: null,
      author: null,
      content_type: 'newsletter',
      prompt_mode: promptMode,
      has_error: row.status !== 'completed',
      created_at: createdAt,
      updated_at: updatedAt,
    };
  });
}

function trimTier2History() {
  const limit = resolveTier2StatusHistoryLimit();
  if (tier2BatchHistory.length > limit) {
    tier2BatchHistory = tier2BatchHistory.slice(0, limit);
  }
}

function toTier2StatusPayload(record) {
  return {
    schema: record.schema,
    batch_id: record.batch_id,
    status: record.status,
    is_terminal: record.is_terminal,
    model: record.model,
    request_count: Number(record.request_count || 0),
    counts: {
      total_items: Number(record.counts && record.counts.total_items ? record.counts.total_items : 0),
      processed: Number(record.counts && record.counts.processed ? record.counts.processed : 0),
      ok: Number(record.counts && record.counts.ok ? record.counts.ok : 0),
      parse_error: Number(record.counts && record.counts.parse_error ? record.counts.parse_error : 0),
      error: Number(record.counts && record.counts.error ? record.counts.error : 0),
      pending: Number(record.counts && record.counts.pending ? record.counts.pending : 0),
    },
    input_file_id: record.input_file_id || null,
    output_file_id: record.output_file_id || null,
    error_file_id: record.error_file_id || null,
    metadata: record.metadata || {},
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    items: Array.isArray(record.items) ? record.items : undefined,
  };
}

function recordTier2BatchRun(result, startedAt, endedAt) {
  const batchId = result && result.batch_id ? String(result.batch_id) : buildTier2BatchId();
  const record = {
    schema: String((result && result.target_schema) || 'pkm'),
    stage: 't2',
    batch_id: batchId,
    status: computeTier2RunStatus(result),
    is_terminal: !(result && result.mode === 'run' && Number(result && result.processed_count ? result.processed_count : 0) === 0 && !result.error),
    model: null,
    request_count: Number(result && result.planned_selected_count ? result.planned_selected_count : 0),
    counts: buildTier2Counts(result),
    input_file_id: null,
    output_file_id: null,
    error_file_id: null,
    metadata: {
      mode: result && result.mode ? result.mode : null,
      execution_mode: parseExecutionMode(result && result.execution_mode, 'batch'),
      candidate_count: Number(result && result.candidate_count ? result.candidate_count : 0),
      decision_counts: result && result.decision_counts ? result.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
      persisted_eligibility: result && result.persisted_eligibility ? result.persisted_eligibility : { updated: 0, groups: [] },
      processing_limit: Number(result && result.processing_limit ? result.processing_limit : resolveDefaultRunLimit()),
      will_process_count: Number(result && result.will_process_count ? result.will_process_count : 0),
      preserved_current_count: Number(result && result.preserved_current_count ? result.preserved_current_count : 0),
      error_code_counts: result && result.error_code_counts ? result.error_code_counts : {},
      error: result && result.error ? String(result.error) : null,
    },
    created_at: startedAt,
    updated_at: endedAt,
    items: buildTier2Items(result, startedAt, endedAt),
  };
  tier2BatchHistory.unshift(record);
  trimTier2History();
  return record;
}

function shouldUseStatusFallback(err) {
  const code = String(err && err.code ? err.code : '').trim().toUpperCase();
  const message = String(err && err.message ? err.message : '').toLowerCase();
  return !!(
    code === '42P01'
    || code === '3F000'
    || code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || message.includes('batch table missing')
    || message.includes('relation')
    || message.includes('does not exist')
    || message.includes('connection')
    || message.includes('connect')
    || message.includes('refused')
    || message.includes('pkm_ingest_user')
    || message.includes('pkm_ingest_password')
    || message.includes('are required')
  );
}

function buildTier2WorkerBusyResponse() {
  return {
    mode: 'skipped',
    target_schema: 'pkm',
    skipped: true,
    reason: 'worker_busy',
    message: 'Tier-2 batch worker is busy. Try again shortly.',
  };
}

function buildTier2RunErrorResponse(rawOptions, errorValue) {
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  const dryRun = parseBooleanDefault(options.dry_run, false);
  let executionMode = 'batch';
  try {
    executionMode = parseExecutionMode(options.execution_mode || options.mode, 'batch');
  } catch (_err) {
    executionMode = 'batch';
  }
  const maxSyncItemsRaw = Number(options.max_sync_items);
  const processingLimit = Number.isFinite(maxSyncItemsRaw) && maxSyncItemsRaw > 0
    ? Math.trunc(maxSyncItemsRaw)
    : resolveDefaultRunLimit();
  const error = String(errorValue || 'worker_cycle_error');
  const emptyDecisions = { proceed: 0, skipped: 0, not_eligible: 0 };
  const emptyEligibility = { updated: 0, groups: [] };

  if (dryRun) {
    return {
      mode: 'dry_run',
      execution_mode: executionMode,
      target_schema: 'pkm',
      processing_limit: processingLimit,
      candidate_count: 0,
      decision_counts: emptyDecisions,
      persisted_eligibility: emptyEligibility,
      planned_selected_count: 0,
      will_process_count: 0,
      selected: [],
      error,
    };
  }

  return {
    mode: 'run',
    execution_mode: executionMode,
    target_schema: 'pkm',
    processing_limit: processingLimit,
    candidate_count: 0,
    decision_counts: emptyDecisions,
    persisted_eligibility: emptyEligibility,
    planned_selected_count: 0,
    processed_count: 0,
    completed_count: 0,
    failed_count: 1,
    preserved_current_count: 0,
    results: [],
    error,
  };
}

async function enqueueProviderBatch(args) {
  const {
    logger,
    store,
    markQueued,
    schema,
    selectedRows,
    plan,
    maxSyncItems,
    completionWindow,
    config,
    metadataExtra,
    buildRequests,
    createBatch,
  } = args;

  const rows = Array.isArray(selectedRows) ? selectedRows : [];
  const requests = buildRequests(rows);
  const model = resolveTier2BatchModel(config);
  const requestModel = resolveTier2BatchRequestModel();

  const batchCreate = await logger.step(
    't2.batch.enqueue.provider',
    async () => createBatch(requests, {
      model,
      request_model: requestModel,
      completion_window: completionWindow,
    }),
    {
      input: {
        schema,
        request_count: requests.length,
        model,
        request_model: requestModel,
      },
      output: (out) => ({
        batch_id: out && out.batch && out.batch.id,
        status: out && out.batch && out.batch.status,
      }),
    }
  );

  const batch = batchCreate && batchCreate.batch ? batchCreate.batch : null;
  if (!batch || !batch.id) {
    throw new Error('tier2 batch enqueue failed: provider returned no batch id');
  }

  const metadata = {
    mode: 'run',
    execution_mode: 'batch',
    candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
    decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
    persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
    processing_limit: maxSyncItems,
    planned_selected_count: rows.length,
    error_code_counts: {},
    preserved_current_count: 0,
    ...(metadataExtra || {}),
  };

  await logger.step(
    't2.batch.enqueue.persist',
    async () => {
      await store.upsertBatchRow(
        schema,
        {
          id: batch.id,
          status: batch.status || null,
          model,
          input_file_id: batchCreate.input_file_id || null,
          output_file_id: batch.output_file_id || null,
          error_file_id: batch.error_file_id || null,
          request_count: requests.length,
        },
        requests.length,
        metadata
      );
      await store.upsertBatchItems(schema, batch.id, requests);
      return { batch_id: batch.id, request_count: requests.length };
    },
    {
      input: { schema, batch_id: batch.id, request_count: requests.length },
      output: (out) => out,
    }
  );

  const ids = rows
    .map((row) => (row && row.id ? String(row.id).trim() : ''))
    .filter(Boolean);
  if (ids.length > 0) {
    await logger.step(
      't2.batch.mark_queued',
      async () => markQueued(ids, {
        schema,
        reason_code: 'batch_dispatch',
      }),
      {
        input: {
          schema,
          ids: ids.length,
        },
        output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
      }
    );
  }

  return {
    batch_id: batch.id,
    batch_status: batch.status || null,
    request_count: requests.length,
  };
}

async function collectOnePendingBatch(args) {
  const {
    logger,
    store,
    schema,
    batch_id,
    retryConfig,
    config,
    persistFailure,
    buildRequests,
    createBatch,
    retrieveBatch,
    getFileContent,
  } = args;

  const record = await store.getBatchRecordById(schema, batch_id);
  if (!record) {
    return {
      batch_id,
      schema,
      status: 'missing',
      processed: 0,
      completed: 0,
      failed: 0,
      retry_dispatched: 0,
    };
  }

  const metadata = record.metadata && typeof record.metadata === 'object' ? { ...record.metadata } : {};
  const batchModel = record.model || resolveTier2BatchModel(config);
  const distillConfig = getDistillConfig(config);
  const distillVersion = String(distillConfig.version || 'distill_v1').trim() || 'distill_v1';

  const remoteBatch = await logger.step(
    't2.batch.collect.provider',
    async () => retrieveBatch(batch_id),
    {
      input: { schema, batch_id },
      output: (out) => ({
        status: out && out.status,
        output_file_id: out && out.output_file_id,
        error_file_id: out && out.error_file_id,
      }),
      meta: { batch_id },
    }
  );

  let outputText = null;
  let errorText = null;
  if (remoteBatch && remoteBatch.output_file_id) {
    outputText = await getFileContent(remoteBatch.output_file_id);
  }
  if (remoteBatch && remoteBatch.error_file_id) {
    errorText = await getFileContent(remoteBatch.error_file_id);
  }

  const parsedRows = mergeResultRows([
    ...parseJsonl(outputText).map(mapBatchLineToResult).filter(Boolean),
    ...parseJsonl(errorText).map(mapBatchLineToResult).filter(Boolean),
  ]);

  if (parsedRows.length > 0) {
    await store.upsertBatchResults(schema, batch_id, parsedRows.map((row) => ({
      ...row,
      applied: false,
    })));
  }

  const reconcileRows = await store.getBatchReconcileRows(schema, batch_id, 10000);
  if (!reconcileRows.length) {
    await store.upsertBatchRow(
      schema,
      {
        id: batch_id,
        status: remoteBatch && remoteBatch.status ? remoteBatch.status : record.status,
        model: batchModel,
        input_file_id: record.input_file_id || null,
        output_file_id: (remoteBatch && remoteBatch.output_file_id) || record.output_file_id || null,
        error_file_id: (remoteBatch && remoteBatch.error_file_id) || record.error_file_id || null,
        request_count: Number(record.request_count || 0),
      },
      Number(record.request_count || 0),
      metadata
    );
    return {
      batch_id,
      schema,
      status: remoteBatch && remoteBatch.status ? remoteBatch.status : record.status,
      processed: 0,
      completed: 0,
      failed: 0,
      retry_dispatched: 0,
    };
  }

  const entryIds = Array.from(new Set(
    reconcileRows
      .map((row) => Number(row.entry_id))
      .filter((value) => Number.isFinite(value) && value > 0)
  ));
  const entryStates = await store.getEntryStatesByEntryIds(schema, entryIds);
  const entryById = new Map((entryStates || []).map((row) => [Number(row.entry_id), row]));

  const finalResultRows = [];
  const appliedCustomIds = [];
  const retryDispatchRows = [];

  let completed = 0;
  let failed = 0;
  let preservedCurrent = 0;
  let retryDispatched = 0;
  const errorCodeCounts = {};

  for (const row of reconcileRows) {
    const entryId = Number(row.entry_id);
    const customId = String(row.custom_id || '').trim();
    if (!customId || !Number.isFinite(entryId) || entryId <= 0) continue;

    const state = entryById.get(entryId) || null;
    const rowError = parseErrorObject(row.error);
    const expectedHash = String(row.expected_content_hash || '').trim();
    const currentHash = String(state && state.content_hash ? state.content_hash : '').trim();
    const attemptCount = Number.isFinite(Number(row.retry_count))
      ? Math.max(1, Math.trunc(Number(row.retry_count)) + 1)
      : 1;

    let itemStatus = 'ok';
    let parsed = row.parsed || null;
    let errorCode = null;
    let message = null;
    let preserveCurrent = false;

    if (!state) {
      itemStatus = 'error';
      errorCode = 'entry_not_found';
      message = 'entry not found during batch reconciliation';
      parsed = null;
    } else if (String(row.result_status || '').trim().toLowerCase() !== 'ok') {
      itemStatus = toResultStatus(row.result_status);
      errorCode = normalizeErrorCode(rowError.code || row.result_status || 'provider_error');
      message = String(rowError.message || '').trim() || 'batch item failed';
      parsed = null;
    } else if (expectedHash && expectedHash !== currentHash) {
      itemStatus = 'error';
      errorCode = 'currentness_mismatch';
      message = 'entry content changed during batch processing';
      parsed = null;
    } else if (!String(state.clean_text || '').trim()) {
      itemStatus = 'error';
      errorCode = 'missing_clean_text';
      message = 'entry clean_text missing during batch reconciliation';
      parsed = null;
    } else {
      const artifact = buildTier2Artifact(parsed || {}, {
        model: batchModel,
        request_type: row.request_type || 'batch_direct_generation',
        chunking_strategy: row.chunking_strategy || 'direct',
        content_hash: expectedHash || currentHash,
        distill_version: distillVersion,
        retry_count: Number.isFinite(Number(row.retry_count)) ? Math.max(0, Math.trunc(Number(row.retry_count))) : 0,
      });

      const validation = validateTier2Artifact({
        artifact,
        clean_text: state.clean_text,
        content_hash: currentHash,
      });

      if (!validation.accepted) {
        itemStatus = toResultStatus(validation.error_code);
        errorCode = normalizeErrorCode(validation.error_code);
        message = validation.error_details && validation.error_details.message
          ? String(validation.error_details.message)
          : null;
        parsed = null;
      } else {
        const persist = await distillStore.persistTier2SyncSuccess(entryId, artifact);
        if (!persist || Number(persist.rowCount || 0) < 1) {
          itemStatus = 'error';
          errorCode = 'currentness_mismatch';
          message = 'entry content changed during batch persist';
          parsed = null;
        } else {
          completed += 1;
          itemStatus = 'ok';
          errorCode = null;
          message = null;
          parsed = artifact;
        }
      }
    }

    if (itemStatus !== 'ok') {
      const code = normalizeErrorCode(errorCode || 'worker_error');
      const retryDecision = shouldRetryTier2Failure(retryConfig, code, attemptCount);
      if (retryDecision.retry && state && String(state.clean_text || '').trim()) {
        retryDispatchRows.push({
          entry_id: entryId,
          title: row.title || null,
          author: row.author || null,
          content_type: row.content_type || 'newsletter',
          clean_text: state.clean_text,
          content_hash: currentHash || expectedHash || null,
          route: row.route || 'direct',
          chunking_strategy: row.chunking_strategy || 'direct',
          retry_count: attemptCount,
        });
      } else {
        preserveCurrent = !!state && hasCurrentCompletedArtifact(state);
        if (!preserveCurrent) {
          await persistFailure(entryId, {
            status: 'failed',
            metadata: toFailureMetadata(
              code,
              message ? { message } : null,
              batchModel,
              row.chunking_strategy || null,
              attemptCount
            ),
          });
        }
        if (preserveCurrent) preservedCurrent += 1;
      }

      failed += 1;
      errorCodeCounts[code] = Number(errorCodeCounts[code] || 0) + 1;
      finalResultRows.push({
        custom_id: customId,
        status: toResultStatus(code),
        response_text: row.response_text || null,
        parsed: null,
        error: {
          code,
          message: message || null,
          preserved_current_artifact: preserveCurrent,
          retry_dispatched: retryDecision.retry,
          retry_reason: retryDecision.reason,
        },
        raw: row.raw || null,
        applied: true,
      });
    } else {
      finalResultRows.push({
        custom_id: customId,
        status: 'ok',
        response_text: row.response_text || null,
        parsed,
        error: null,
        raw: row.raw || null,
        applied: true,
      });
    }

    appliedCustomIds.push(customId);
  }

  if (finalResultRows.length > 0) {
    await store.upsertBatchResults(schema, batch_id, finalResultRows);
  }
  if (appliedCustomIds.length > 0) {
    await store.markBatchResultsApplied(schema, batch_id, appliedCustomIds);
  }

  if (retryDispatchRows.length > 0) {
    try {
      const retryRequests = buildRequests(retryDispatchRows, { retry_count: 1 });
      const retryModel = resolveTier2BatchModel(config);
      const retryRequestModel = resolveTier2BatchRequestModel();

      const retryBatchCreate = await createBatch(retryRequests, {
        model: retryModel,
        request_model: retryRequestModel,
        completion_window: '24h',
      });

      const retryBatch = retryBatchCreate && retryBatchCreate.batch ? retryBatchCreate.batch : null;
      if (retryBatch && retryBatch.id) {
        await store.upsertBatchRow(
          schema,
          {
            id: retryBatch.id,
            status: retryBatch.status || null,
            model: retryModel,
            input_file_id: retryBatchCreate.input_file_id || null,
            output_file_id: retryBatch.output_file_id || null,
            error_file_id: retryBatch.error_file_id || null,
            request_count: retryRequests.length,
          },
          retryRequests.length,
          {
            mode: 'run',
            execution_mode: 'batch',
            created_via: 'retry',
            parent_batch_id: batch_id,
            retry_dispatched_from: batch_id,
            planned_selected_count: retryRequests.length,
            candidate_count: 0,
            decision_counts: { proceed: retryRequests.length, skipped: 0, not_eligible: 0 },
            persisted_eligibility: { updated: 0, groups: [] },
            processing_limit: retryRequests.length,
            preserved_current_count: 0,
            error_code_counts: {},
          }
        );
        await store.upsertBatchItems(schema, retryBatch.id, retryRequests);
        retryDispatched = retryRequests.length;
      }
    } catch (err) {
      for (const retryRow of retryDispatchRows) {
        await persistFailure(retryRow.entry_id, {
          status: 'failed',
          metadata: toFailureMetadata(
            'retry_dispatch_error',
            { message: err && err.message ? err.message : String(err) },
            batchModel,
            retryRow.chunking_strategy || null,
            retryRow.retry_count
          ),
        });
      }
    }
  }

  const nextMetadata = {
    ...metadata,
    preserved_current_count: Number(metadata.preserved_current_count || 0) + preservedCurrent,
    error_code_counts: mergeErrorCodeCounts(metadata.error_code_counts, errorCodeCounts),
    processed_count: Number(metadata.processed_count || 0) + (completed + failed),
    completed_count: Number(metadata.completed_count || 0) + completed,
    failed_count: Number(metadata.failed_count || 0) + failed,
    retry_dispatched_count: Number(metadata.retry_dispatched_count || 0) + retryDispatched,
  };

  await store.upsertBatchRow(
    schema,
    {
      id: batch_id,
      status: remoteBatch && remoteBatch.status ? remoteBatch.status : record.status,
      model: batchModel,
      input_file_id: record.input_file_id || null,
      output_file_id: (remoteBatch && remoteBatch.output_file_id) || record.output_file_id || null,
      error_file_id: (remoteBatch && remoteBatch.error_file_id) || record.error_file_id || null,
      request_count: Number(record.request_count || 0),
    },
    Number(record.request_count || 0),
    nextMetadata
  );

  return {
    batch_id,
    schema,
    status: remoteBatch && remoteBatch.status ? remoteBatch.status : record.status,
    processed: completed + failed,
    completed,
    failed,
    retry_dispatched: retryDispatched,
    error_code_counts: errorCodeCounts,
  };
}

function createTier2BatchRunner(deps) {
  const dependencies = deps && typeof deps === 'object' ? deps : {};
  const runPlan = dependencies.runPlan || runTier2ControlPlanePlan;
  const distillOne = dependencies.distillOne || distillTier2SingleEntrySync;
  const markQueued = dependencies.markQueued
    || (dependencies.distillOne ? (async () => ({ rowCount: 0 })) : distillStore.persistTier2QueuedStatusByIds);
  const persistFailure = dependencies.persistFailure
    || (dependencies.distillOne ? (async () => ({ rowCount: 0 })) : distillStore.persistTier2SyncFailure);
  const getLoggerFn = dependencies.getLogger || getLogger;
  const getConfigFn = dependencies.getConfig || getConfig;
  const store = dependencies.store || tier2Store;
  const buildRequests = dependencies.buildRequests || buildBatchRequests;

  const createBatch = dependencies.createBatch || (async (requests, options) => {
    const client = dependencies.litellmClient || getLiteLLMClient();
    return client.createBatch(requests, options || {});
  });
  const retrieveBatch = dependencies.retrieveBatch || (async (batchId) => {
    const client = dependencies.litellmClient || getLiteLLMClient();
    return client.retrieveBatch(batchId);
  });
  const getFileContent = dependencies.getFileContent || (async (fileId) => {
    const client = dependencies.litellmClient || getLiteLLMClient();
    return client.getFileContent(fileId);
  });

  const canUseProviderBatch = hasLiteLLMKey() && (
    dependencies.useProviderBatch === true
      || (typeof dependencies.createBatch === 'function')
      || (!dependencies.distillOne && store && typeof store.upsertBatchItems === 'function')
  );

  async function runLegacySyncBatchCycle(options, logger, retryConfig, maxSyncItems, executionMode, dryRun) {
    const plan = await logger.step(
      't2.batch.plan',
      async () => runPlan({
        candidate_limit: options.candidate_limit || undefined,
        persist_eligibility: options.persist_eligibility,
        include_details: false,
        target_schema: 'pkm',
      }),
      {
        input: {
          candidate_limit: options.candidate_limit || null,
          persist_eligibility: options.persist_eligibility,
          max_sync_items: maxSyncItems,
          dry_run: dryRun,
          execution_mode: executionMode,
        },
        output: (out) => ({
          candidate_count: out && out.candidate_count,
          selected_count: out && out.selected_count,
        }),
      }
    );

    const selected = Array.isArray(plan && plan.selected) ? plan.selected : [];
    const toProcess = selected.slice(0, maxSyncItems);

    if (dryRun) {
      return {
        mode: 'dry_run',
        execution_mode: executionMode,
        target_schema: 'pkm',
        processing_limit: maxSyncItems,
        candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
        decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
        persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
        planned_selected_count: Number(plan && plan.selected_count ? plan.selected_count : 0),
        will_process_count: toProcess.length,
        selected: toProcess,
      };
    }

    const toProcessIds = toProcess
      .map((row) => (row && row.id ? String(row.id).trim() : ''))
      .filter(Boolean);
    if (toProcessIds.length > 0) {
      await logger.step(
        't2.batch.mark_queued',
        async () => markQueued(toProcessIds, {
          schema: 'pkm',
          reason_code: 'batch_dispatch',
        }),
        {
          input: { ids: toProcessIds.length, target_schema: 'pkm' },
          output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
        }
      );
    }

    const results = [];
    for (const row of toProcess) {
      let attempts = 0;
      let final = null;

      while (!final) {
        attempts += 1;
        let out;
        try {
          out = await logger.step(
            't2.batch.process_one',
            async () => distillOne(row.entry_id, {
              retry_count: attempts - 1,
              execution_mode: executionMode,
            }),
            {
              input: {
                entry_id: row.entry_id,
                attempt: attempts,
                retry_count: attempts - 1,
                execution_mode: executionMode,
              },
              output: (value) => ({
                entry_id: value && value.entry_id,
                status: value && value.status,
                error_code: value && value.error_code,
              }),
              meta: { entry_id: row.entry_id },
            }
          );
        } catch (err) {
          out = {
            entry_id: row.entry_id,
            status: 'failed',
            error_code: 'worker_error',
            message: err && err.message ? err.message : String(err),
          };
        }

        const status = out && out.status ? out.status : 'failed';
        const errorCode = normalizeErrorCode(out && out.error_code);

        if (status === 'completed') {
          final = {
            entry_id: row.entry_id,
            status: 'completed',
            error_code: null,
          };
          continue;
        }

        const retryDecision = await logger.step(
          't2.batch.retry.evaluate',
          async () => shouldRetryTier2Failure(retryConfig, errorCode, attempts),
          {
            input: {
              entry_id: row.entry_id,
              attempt: attempts,
              error_code: errorCode,
              retry_enabled: retryConfig.enabled,
              max_attempts: retryConfig.max_attempts,
            },
            output: (value) => value,
            meta: { entry_id: row.entry_id },
          }
        );

        if (!retryDecision.retry) {
          if (errorCode === 'currentness_mismatch' && out.preserved_current_artifact !== true) {
            await logger.step(
              't2.batch.persist.currentness_mismatch_failed',
              async () => persistFailure(row.entry_id, {
                status: 'failed',
                metadata: {
                  error: {
                    code: 'currentness_mismatch',
                    details: out && out.message ? { message: String(out.message) } : null,
                    at: new Date().toISOString(),
                  },
                },
              }),
              {
                input: {
                  entry_id: row.entry_id,
                  error_code: errorCode,
                },
                output: (value) => ({ rowCount: value && value.rowCount ? value.rowCount : 0 }),
                meta: { entry_id: row.entry_id },
              }
            );
          }
          final = {
            entry_id: row.entry_id,
            status: 'failed',
            error_code: errorCode,
          };
          if (out && out.message) final.message = out.message;
          if (out && out.preserved_current_artifact === true) {
            final.preserved_current_artifact = true;
          }
          continue;
        }

        await logger.step(
          't2.batch.retry.dispatch',
          async () => ({ entry_id: row.entry_id, retry_count: attempts }),
          {
            input: {
              entry_id: row.entry_id,
              error_code: errorCode,
              next_retry_count: attempts,
            },
            output: (value) => value,
            meta: { entry_id: row.entry_id },
          }
        );
      }

      results.push(final);
    }

    const completedCount = results.filter((row) => row.status === 'completed').length;
    const failedCount = results.length - completedCount;
    const preservedCurrentCount = results.filter((row) => row.preserved_current_artifact === true).length;

    return {
      mode: 'run',
      execution_mode: executionMode,
      target_schema: 'pkm',
      processing_limit: maxSyncItems,
      candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
      decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
      persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
      planned_selected_count: Number(plan && plan.selected_count ? plan.selected_count : 0),
      processed_count: results.length,
      completed_count: completedCount,
      failed_count: failedCount,
      preserved_current_count: preservedCurrentCount,
      error_code_counts: buildErrorCodeCounts(results),
      results,
    };
  }

  async function syncPendingTier2Batches(logger, retryConfig, config, schema, limit) {
    const refs = await logger.step(
      't2.batch.pending.list',
      async () => store.listPendingBatchIds(limit, { schema }),
      {
        input: { schema, limit },
        output: (out) => ({ pending_batches: Array.isArray(out) ? out.length : 0 }),
      }
    );

    const rows = Array.isArray(refs) ? refs : [];
    const synced = [];
    for (const ref of rows) {
      const batchId = ref && ref.batch_id ? String(ref.batch_id) : '';
      const batchSchema = ref && ref.schema ? String(ref.schema) : schema;
      if (!batchId) continue;
      try {
        const one = await logger.step(
          't2.batch.collect.one',
          async () => collectOnePendingBatch({
            logger,
            store,
            schema: batchSchema,
            batch_id: batchId,
            retryConfig,
            config,
            persistFailure,
            buildRequests,
            createBatch,
            retrieveBatch,
            getFileContent,
          }),
          {
            input: { schema: batchSchema, batch_id: batchId },
            output: (out) => ({
              status: out && out.status,
              processed: out && out.processed,
              failed: out && out.failed,
              retry_dispatched: out && out.retry_dispatched,
            }),
            meta: { batch_id: batchId },
          }
        );
        synced.push(one);
      } catch (err) {
        synced.push({
          batch_id: batchId,
          schema: batchSchema,
          error: err && err.message ? err.message : String(err),
        });
      }
    }

    return {
      requested: rows.length,
      synced,
    };
  }

  async function runTier2BatchCycle(rawOptions) {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const candidateLimit = parsePositiveIntOrNull(options.candidate_limit, 'candidate_limit');
    const maxSyncItems = parsePositiveIntOrNull(options.max_sync_items, 'max_sync_items') || resolveDefaultRunLimit();
    const persistEligibility = parseBooleanDefault(options.persist_eligibility, true);
    const dryRun = parseBooleanDefault(options.dry_run, false);
    const executionMode = parseExecutionMode(options.execution_mode || options.mode, 'batch');

    const logger = getLoggerFn().child({ pipeline: 't2.distill.batch' });
    const config = getConfigFn();
    const retryConfig = resolveTier2RetryConfig(config);
    const schema = store.getProdSchema ? store.getProdSchema() : 'pkm';

    if (executionMode === 'sync' || !canUseProviderBatch) {
      return runLegacySyncBatchCycle({
        candidate_limit: candidateLimit,
        persist_eligibility: persistEligibility,
      }, logger, retryConfig, maxSyncItems, executionMode, dryRun);
    }

    if (!dryRun && parseBooleanDefault(options.sync_pending, true)) {
      const collectLimit = parseLimit(options.collect_limit, 20, 100);
      await syncPendingTier2Batches(logger, retryConfig, config, schema, collectLimit);
    }

    const plan = await logger.step(
      't2.batch.plan',
      async () => runPlan({
        candidate_limit: candidateLimit || undefined,
        persist_eligibility: persistEligibility,
        include_details: false,
        target_schema: schema,
      }),
      {
        input: {
          candidate_limit: candidateLimit,
          persist_eligibility: persistEligibility,
          max_sync_items: maxSyncItems,
          dry_run: dryRun,
          execution_mode: executionMode,
        },
        output: (out) => ({
          candidate_count: out && out.candidate_count,
          selected_count: out && out.selected_count,
        }),
      }
    );

    const selected = Array.isArray(plan && plan.selected) ? plan.selected : [];
    const toProcess = selected.slice(0, maxSyncItems);

    if (dryRun) {
      return {
        mode: 'dry_run',
        execution_mode: executionMode,
        target_schema: schema,
        processing_limit: maxSyncItems,
        candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
        decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
        persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
        planned_selected_count: Number(plan && plan.selected_count ? plan.selected_count : 0),
        will_process_count: toProcess.length,
        selected: toProcess,
      };
    }

    if (!toProcess.length) {
      return {
        mode: 'run',
        execution_mode: executionMode,
        target_schema: schema,
        processing_limit: maxSyncItems,
        candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
        decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
        persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
        planned_selected_count: Number(plan && plan.selected_count ? plan.selected_count : 0),
        processed_count: 0,
        completed_count: 0,
        failed_count: 0,
        preserved_current_count: 0,
        error_code_counts: {},
        results: [],
      };
    }

    const toProcessIds = toProcess
      .map((row) => (row && row.id ? String(row.id).trim() : ''))
      .filter(Boolean);
    const detailResult = await logger.step(
      't2.batch.load_selected_details',
      async () => distillStore.getTier2DetailsByIds(toProcessIds, { schema }),
      {
        input: { schema, ids: toProcessIds.length },
        output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
      }
    );
    const detailRows = Array.isArray(detailResult && detailResult.rows) ? detailResult.rows : [];
    const detailById = new Map(detailRows.map((row) => [String(row.id), row]));
    const dispatchRows = toProcess
      .map((row) => {
        const detail = detailById.get(String(row.id));
        if (!detail) return null;
        return {
          ...detail,
          route: row.route || 'direct',
          chunking_strategy: row.chunking_strategy || 'direct',
          priority_score: row.priority_score,
        };
      })
      .filter(Boolean);
    if (!dispatchRows.length) {
      return {
        mode: 'run',
        execution_mode: executionMode,
        target_schema: schema,
        processing_limit: maxSyncItems,
        candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
        decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
        persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
        planned_selected_count: Number(plan && plan.selected_count ? plan.selected_count : 0),
        processed_count: 0,
        completed_count: 0,
        failed_count: 0,
        preserved_current_count: 0,
        error_code_counts: {},
        results: [],
      };
    }

    const enqueue = await enqueueProviderBatch({
      logger,
      store,
      markQueued,
      schema,
      selectedRows: dispatchRows,
      plan,
      maxSyncItems,
      completionWindow: String(options.completion_window || '24h').trim() || '24h',
      config,
      metadataExtra: {
        source: 't2_batch_worker',
      },
      buildRequests,
      createBatch,
    });

    return {
      mode: 'run',
      execution_mode: executionMode,
      target_schema: schema,
      batch_id: enqueue.batch_id,
      batch_status: enqueue.batch_status,
      processing_limit: maxSyncItems,
      candidate_count: Number(plan && plan.candidate_count ? plan.candidate_count : 0),
      decision_counts: plan && plan.decision_counts ? plan.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
      persisted_eligibility: plan && plan.persisted_eligibility ? plan.persisted_eligibility : { updated: 0, groups: [] },
      planned_selected_count: Number(plan && plan.selected_count ? plan.selected_count : 0),
      processed_count: 0,
      completed_count: 0,
      failed_count: 0,
      preserved_current_count: 0,
      error_code_counts: {},
      results: [],
    };
  }

  return {
    runTier2BatchCycle,
    syncPendingTier2Batches: async (rawOpts) => {
      const options = rawOpts && typeof rawOpts === 'object' ? rawOpts : {};
      const logger = getLoggerFn().child({ pipeline: 't2.distill.batch.collect' });
      const config = getConfigFn();
      const retryConfig = resolveTier2RetryConfig(config);
      const schema = store.getProdSchema ? store.getProdSchema() : 'pkm';
      const collectLimit = parseLimit(options.collect_limit, 20, 100);
      return syncPendingTier2Batches(logger, retryConfig, config, schema, collectLimit);
    },
  };
}

const runner = createTier2BatchRunner({
  useProviderBatch: true,
});

function logTier2WorkerError(err) {
  try {
    braintrustSink.logError('t2_batch_worker.cycle', {
      error: err,
      metadata: {
        source: 't2_batch_worker',
        event: 'cycle_error',
      },
    });
  } catch (_err) {
    // best-effort worker error logging
  }
}

function resolveTier2WorkerIntervalMs() {
  const intervalRaw = getT2BatchSettings(resolveDefaultRunLimit()).syncIntervalMs;
  return Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;
}

function resolveTier2WorkerSyncLimitFromEnv() {
  const syncLimitRaw = getT2BatchSettings(resolveDefaultRunLimit()).syncLimit;
  return Number.isFinite(syncLimitRaw) && syncLimitRaw > 0
    ? Math.trunc(syncLimitRaw)
    : resolveDefaultRunLimit();
}

function resolveTier2WorkerCollectLimitFromEnv() {
  const raw = getT2BatchSettings(resolveDefaultRunLimit()).collectLimit;
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 100) : 20;
}

function isTier2WorkerEnabled() {
  return getT2BatchSettings(resolveDefaultRunLimit()).workerEnabled;
}

const tier2WorkerRuntime = createBatchWorkerRuntime({
  isEnabled: isTier2WorkerEnabled,
  resolveIntervalMs: resolveTier2WorkerIntervalMs,
  buildScheduledOptions: () => ({
    execution_mode: 'batch',
    max_sync_items: resolveTier2WorkerSyncLimitFromEnv(),
    collect_limit: resolveTier2WorkerCollectLimitFromEnv(),
    sync_pending: true,
  }),
  runCycle: async (options) => runner.runTier2BatchCycle(options || {}),
  onError: logTier2WorkerError,
});

async function runTier2BatchWorkerCycle(opts) {
  const startedAt = new Date().toISOString();
  const options = opts && typeof opts === 'object' ? opts : {};
  const result = await tier2WorkerRuntime.runCycle(options);
  if (result && result.skipped && result.reason === 'worker_busy') {
    return buildTier2WorkerBusyResponse();
  }

  const endedAt = new Date().toISOString();
  const normalized = result && result.error
    ? buildTier2RunErrorResponse(options, result.error)
    : (result || {});
  const record = recordTier2BatchRun(normalized, startedAt, endedAt);
  return {
    ...normalized,
    batch_id: normalized.batch_id || record.batch_id,
  };
}

function startTier2BatchWorker() {
  tier2WorkerRuntime.start();
}

function stopTier2BatchWorker() {
  tier2WorkerRuntime.stop();
}

async function getTier2BatchStatusList(opts) {
  const options = opts || {};
  try {
    const jobs = await tier2Store.listBatchStatuses({
      limit: options.limit,
      include_terminal: options.include_terminal,
    });
    return {
      summary: summaryFromJobs(jobs),
      jobs,
    };
  } catch (err) {
    if (!shouldUseStatusFallback(err)) throw err;
    const includeTerminal = options.include_terminal !== false;
    const take = parseLimit(options.limit, 50, 200);
    const jobs = tier2BatchHistory
      .filter((row) => includeTerminal || !row.is_terminal)
      .slice(0, take)
      .map((row) => toTier2StatusPayload(row));
    return {
      summary: summaryFromJobs(jobs),
      jobs,
    };
  }
}

async function getTier2BatchStatus(batchId, opts) {
  try {
    return await tier2Store.getBatchStatus(batchId, opts || {});
  } catch (err) {
    if (!shouldUseStatusFallback(err)) throw err;
    const id = String(batchId || '').trim();
    const found = tier2BatchHistory.find((row) => row.batch_id === id);
    if (!found) return null;
    const out = toTier2StatusPayload(found);
    const options = opts || {};
    if (!options.include_items && Object.prototype.hasOwnProperty.call(out, 'items')) {
      delete out.items;
    }
    if (options.include_items && Array.isArray(out.items)) {
      const itemsLimit = parseLimit(options.items_limit, 200, 1000);
      out.items = out.items.slice(0, itemsLimit);
    }
    return out;
  }
}

module.exports = {
  buildTier2RunErrorResponse,
  buildTier2WorkerBusyResponse,
  createTier2BatchRunner,
  resolveTier2RetryConfig,
  shouldRetryTier2Failure,
  runTier2BatchCycle: runner.runTier2BatchCycle,
  runTier2BatchWorkerCycle,
  getTier2BatchStatusList,
  getTier2BatchStatus,
  startTier2BatchWorker,
  stopTier2BatchWorker,
};
