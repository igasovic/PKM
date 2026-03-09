'use strict';

const db = require('./db.js');
const { getConfig } = require('../libs/config.js');
const { getBraintrustLogger } = require('./observability.js');
const { getLogger } = require('./logger/index.js');
const { createBatchWorkerRuntime } = require('./batch-worker-runtime.js');
const { runTier2ControlPlanePlan } = require('./tier2/planner.js');
const { distillTier2SingleEntrySync } = require('./tier2/service.js');
const { DISTILL_VALIDATION_ERROR_CODES } = require('./tier2/constants.js');

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

function createTier2BatchRunner(deps) {
  const dependencies = deps && typeof deps === 'object' ? deps : {};
  const runPlan = dependencies.runPlan || runTier2ControlPlanePlan;
  const distillOne = dependencies.distillOne || distillTier2SingleEntrySync;
  const markQueued = dependencies.markQueued || (async () => ({ rowCount: 0 }));
  const persistFailure = dependencies.persistFailure || db.persistTier2SyncFailure;
  const getLoggerFn = dependencies.getLogger || getLogger;
  const getConfigFn = dependencies.getConfig || getConfig;

  async function runTier2BatchCycle(rawOptions) {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const candidateLimit = parsePositiveIntOrNull(options.candidate_limit, 'candidate_limit');
    const maxSyncItems = parsePositiveIntOrNull(options.max_sync_items, 'max_sync_items') || resolveDefaultRunLimit();
    const persistEligibility = parseBooleanDefault(options.persist_eligibility, true);
    const dryRun = parseBooleanDefault(options.dry_run, false);

    const logger = getLoggerFn().child({ pipeline: 't2.distill.batch' });
    const retryConfig = resolveTier2RetryConfig(getConfigFn());

    const plan = await logger.step(
      't2.batch.plan',
      async () => runPlan({
        candidate_limit: candidateLimit || undefined,
        persist_eligibility: persistEligibility,
        include_details: false,
        target_schema: 'pkm',
      }),
      {
        input: {
          candidate_limit: candidateLimit,
          persist_eligibility: persistEligibility,
          max_sync_items: maxSyncItems,
          dry_run: dryRun,
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
          input: {
            ids: toProcessIds.length,
            target_schema: 'pkm',
          },
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
            't2.batch.sync_one',
            async () => distillOne(row.entry_id, { retry_count: attempts - 1 }),
            {
              input: {
                entry_id: row.entry_id,
                attempt: attempts,
                retry_count: attempts - 1,
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
      results,
    };
  }

  return {
    runTier2BatchCycle,
  };
}

const runner = createTier2BatchRunner({
  markQueued: db.persistTier2QueuedStatusByIds,
});
const T2_STATUS_HISTORY_MAX = 1000;
const T2_STATUS_HISTORY_DEFAULT = 200;
let tier2BatchHistory = [];

function resolveTier2StatusHistoryLimit() {
  return parseLimit(process.env.T2_BATCH_STATUS_HISTORY_LIMIT, T2_STATUS_HISTORY_DEFAULT, T2_STATUS_HISTORY_MAX);
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
      prompt_mode: 't2_sync',
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
      prompt_mode: 't2_sync',
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

function recordTier2BatchRun(result, startedAt, endedAt) {
  const record = {
    schema: 'pkm',
    stage: 't2',
    batch_id: buildTier2BatchId(),
    status: computeTier2RunStatus(result),
    is_terminal: true,
    model: null,
    request_count: Number(result && result.planned_selected_count ? result.planned_selected_count : 0),
    counts: buildTier2Counts(result),
    input_file_id: null,
    output_file_id: null,
    error_file_id: null,
    metadata: {
      mode: result && result.mode ? result.mode : null,
      candidate_count: Number(result && result.candidate_count ? result.candidate_count : 0),
      decision_counts: result && result.decision_counts ? result.decision_counts : { proceed: 0, skipped: 0, not_eligible: 0 },
      persisted_eligibility: result && result.persisted_eligibility ? result.persisted_eligibility : { updated: 0, groups: [] },
      processing_limit: Number(result && result.processing_limit ? result.processing_limit : resolveDefaultRunLimit()),
      will_process_count: Number(result && result.will_process_count ? result.will_process_count : 0),
      preserved_current_count: Number(result && result.preserved_current_count ? result.preserved_current_count : 0),
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
    input_file_id: null,
    output_file_id: null,
    error_file_id: null,
    metadata: record.metadata || {},
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
  };
}

function buildTier2StatusSummary(jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const summary = {
    jobs: rows.length,
    in_progress: 0,
    terminal: 0,
    total_items: 0,
    processed: 0,
    pending: 0,
    ok: 0,
    parse_error: 0,
    error: 0,
  };

  for (const row of rows) {
    if (row.is_terminal) summary.terminal += 1;
    else summary.in_progress += 1;
    summary.total_items += Number(row.counts.total_items || 0);
    summary.processed += Number(row.counts.processed || 0);
    summary.pending += Number(row.counts.pending || 0);
    summary.ok += Number(row.counts.ok || 0);
    summary.parse_error += Number(row.counts.parse_error || 0);
    summary.error += Number(row.counts.error || 0);
  }
  return summary;
}

function logTier2WorkerError(err) {
  try {
    getBraintrustLogger().log({
      error: {
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
      },
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
  const intervalRaw = Number(process.env.T2_BATCH_SYNC_INTERVAL_MS || 10 * 60_000);
  return Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;
}

function resolveTier2WorkerSyncLimitFromEnv() {
  const syncLimitRaw = Number(process.env.T2_BATCH_SYNC_LIMIT || resolveDefaultRunLimit());
  return Number.isFinite(syncLimitRaw) && syncLimitRaw > 0
    ? Math.trunc(syncLimitRaw)
    : resolveDefaultRunLimit();
}

function isTier2WorkerEnabled() {
  return String(process.env.T2_BATCH_WORKER_ENABLED || 'false').toLowerCase() === 'true';
}

const tier2WorkerRuntime = createBatchWorkerRuntime({
  isEnabled: isTier2WorkerEnabled,
  resolveIntervalMs: resolveTier2WorkerIntervalMs,
  buildScheduledOptions: () => ({
    max_sync_items: resolveTier2WorkerSyncLimitFromEnv(),
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
    batch_id: record.batch_id,
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
  const includeTerminal = options.include_terminal !== false;
  const take = parseLimit(options.limit, 50, 200);

  const jobs = tier2BatchHistory
    .filter((row) => includeTerminal || !row.is_terminal)
    .slice(0, take)
    .map((row) => toTier2StatusPayload(row));

  return {
    summary: buildTier2StatusSummary(jobs),
    jobs,
  };
}

async function getTier2BatchStatus(batchId, opts) {
  const id = String(batchId || '').trim();
  if (!id) throw new Error('batch_id is required');
  const options = opts || {};

  const found = tier2BatchHistory.find((row) => row.batch_id === id);
  if (!found) return null;

  const out = toTier2StatusPayload(found);
  if (options.include_items) {
    const itemsLimit = parseLimit(options.items_limit, 200, 1000);
    out.items = Array.isArray(found.items) ? found.items.slice(0, itemsLimit) : [];
  }
  return out;
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
