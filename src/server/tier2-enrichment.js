'use strict';

const { getConfig } = require('../libs/config.js');
const { getBraintrustLogger } = require('./observability.js');
const { getLogger } = require('./logger/index.js');
const { createBatchWorkerRuntime } = require('./batch-worker-runtime.js');
const { runTier2ControlPlanePlan } = require('./tier2/planner.js');
const { distillTier2SingleEntrySync } = require('./tier2/service.js');

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
  return value !== false;
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

function createTier2BatchRunner(deps) {
  const dependencies = deps && typeof deps === 'object' ? deps : {};
  const runPlan = dependencies.runPlan || runTier2ControlPlanePlan;
  const distillOne = dependencies.distillOne || distillTier2SingleEntrySync;
  const getLoggerFn = dependencies.getLogger || getLogger;

  async function runTier2BatchCycle(rawOptions) {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const candidateLimit = parsePositiveIntOrNull(options.candidate_limit, 'candidate_limit');
    const maxSyncItems = parsePositiveIntOrNull(options.max_sync_items, 'max_sync_items') || resolveDefaultRunLimit();
    const persistEligibility = parseBooleanDefault(options.persist_eligibility, true);
    const dryRun = options.dry_run === true;

    const logger = getLoggerFn().child({ pipeline: 't2.distill.batch' });

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

    const results = [];
    for (const row of toProcess) {
      try {
        const out = await logger.step(
          't2.batch.sync_one',
          async () => distillOne(row.entry_id),
          {
            input: { entry_id: row.entry_id },
            output: (value) => ({ entry_id: value && value.entry_id, status: value && value.status, error_code: value && value.error_code }),
            meta: { entry_id: row.entry_id },
          }
        );
        results.push({
          entry_id: row.entry_id,
          status: out && out.status ? out.status : 'failed',
          error_code: out && out.error_code ? out.error_code : null,
        });
      } catch (err) {
        results.push({
          entry_id: row.entry_id,
          status: 'failed',
          error_code: 'runner_error',
          message: err && err.message ? err.message : String(err),
        });
      }
    }

    const completedCount = results.filter((row) => row.status === 'completed').length;
    const failedCount = results.length - completedCount;

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
      results,
    };
  }

  return {
    runTier2BatchCycle,
  };
}

const runner = createTier2BatchRunner();
const T2_STATUS_HISTORY_MAX = 1000;
const T2_STATUS_HISTORY_DEFAULT = 200;
let tier2BatchHistory = [];

function resolveTier2StatusHistoryLimit() {
  return parseLimit(process.env.T2_BATCH_STATUS_HISTORY_LIMIT, T2_STATUS_HISTORY_DEFAULT, T2_STATUS_HISTORY_MAX);
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
      pending: willProcess,
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
  return results.map((row) => ({
    custom_id: `entry_${row.entry_id}`,
    entry_id: row.entry_id,
    status: row.status === 'completed' ? 'ok' : (row.error_code || row.status || 'error'),
    title: null,
    author: null,
    content_type: 'newsletter',
    prompt_mode: 't2_sync',
    has_error: row.status !== 'completed',
    created_at: createdAt,
    updated_at: updatedAt,
  }));
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
    return result;
  }
  const endedAt = new Date().toISOString();
  const record = recordTier2BatchRun(result || {}, startedAt, endedAt);
  return {
    ...result,
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
  createTier2BatchRunner,
  runTier2BatchCycle: runner.runTier2BatchCycle,
  runTier2BatchWorkerCycle,
  getTier2BatchStatusList,
  getTier2BatchStatus,
  startTier2BatchWorker,
  stopTier2BatchWorker,
};
