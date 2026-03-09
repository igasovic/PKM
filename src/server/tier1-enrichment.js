'use strict';

const { getBraintrustLogger } = require('./observability.js');
const { getLogger } = require('./logger/index.js');
const { createBatchWorkerRuntime } = require('./batch-worker-runtime.js');
const {
  listPendingBatchIds,
  listBatchStatuses,
  getBatchStatus,
} = require('./tier1/store.js');
const {
  runSyncEnrichmentGraph,
  runBatchScheduleGraph,
  runBatchCollectGraph,
} = require('./tier1/graphs.js');

async function enrichTier1(input) {
  const logger = getLogger().child({ pipeline: 't1.enrich.sync' });
  return logger.step(
    't1.enrich.sync',
    async () => runSyncEnrichmentGraph(input || {}),
    { input: input || {}, output: (out) => out }
  );
}

async function enqueueTier1Batch(items, opts) {
  const logger = getLogger().child({ pipeline: 't1.enrich.batch.schedule' });
  return logger.step(
    't1.enrich.batch.schedule',
    async () => runBatchScheduleGraph(items || [], opts || {}),
    {
      input: { items_count: Array.isArray(items) ? items.length : 0, options: opts || {} },
      output: (out) => out,
    }
  );
}

async function syncPendingTier1Batches(opts) {
  const logger = getLogger().child({ pipeline: 't1.enrich.batch.collect' });
  const options = opts || {};
  const ids = await logger.step(
    't1.batch.pending.list',
    async () => listPendingBatchIds(options.limit),
    { input: { limit: options.limit }, output: (out) => ({ batch_ids: out }) }
  );
  const synced = [];

  for (const batch_id of ids) {
    try {
      const result = await logger.step(
        't1.batch.collect.one',
        async () => runBatchCollectGraph(batch_id, {}),
        { input: { batch_id }, output: (out) => out, meta: { batch_id } }
      );
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

async function getTier1BatchStatusList(opts) {
  const logger = getLogger().child({ pipeline: 't1.status.list' });
  const jobs = await logger.step(
    't1.batch.status.list',
    async () => listBatchStatuses(opts || {}),
    { input: opts || {}, output: (out) => ({ jobs: Array.isArray(out) ? out.length : 0 }) }
  );
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

  for (const job of jobs) {
    if (job.is_terminal) summary.terminal += 1;
    else summary.in_progress += 1;
    summary.total_items += Number(job.counts.total_items || 0);
    summary.processed += Number(job.counts.processed || 0);
    summary.pending += Number(job.counts.pending || 0);
    summary.ok += Number(job.counts.ok || 0);
    summary.parse_error += Number(job.counts.parse_error || 0);
    summary.error += Number(job.counts.error || 0);
  }

  return { summary, jobs };
}

async function getTier1BatchStatus(batchId, opts) {
  const logger = getLogger().child({ pipeline: 't1.status.one' });
  return logger.step(
    't1.batch.status.get',
    async () => getBatchStatus(batchId, opts || {}),
    { input: { batch_id: batchId, options: opts || {} }, output: (out) => out }
  );
}

function resolveTier1SyncLimit(value, fallback = 20) {
  const raw = Number(value);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.trunc(raw), 200);
  }
  return fallback;
}

function resolveTier1WorkerSyncLimitFromEnv() {
  const raw = Number(process.env.T1_BATCH_SYNC_LIMIT || 20);
  return resolveTier1SyncLimit(raw, 20);
}

function isTier1WorkerEnabled() {
  return String(process.env.T1_BATCH_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
}

function resolveTier1WorkerIntervalMs() {
  const intervalRaw = Number(process.env.T1_BATCH_SYNC_INTERVAL_MS || 10 * 60_000);
  return Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;
}

function logTier1WorkerError(err) {
  try {
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
  } catch (_err) {
    // best-effort worker error logging
  }
}

const tier1WorkerRuntime = createBatchWorkerRuntime({
  isEnabled: isTier1WorkerEnabled,
  resolveIntervalMs: resolveTier1WorkerIntervalMs,
  buildScheduledOptions: () => ({
    limit: resolveTier1WorkerSyncLimitFromEnv(),
  }),
  runCycle: async (options) => {
    const opts = options && typeof options === 'object' ? options : {};
    const fallbackLimit = resolveTier1WorkerSyncLimitFromEnv();
    const limit = resolveTier1SyncLimit(opts.limit, fallbackLimit);
    return syncPendingTier1Batches({ limit });
  },
  onError: logTier1WorkerError,
});

async function runTier1BatchWorkerCycle(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  return tier1WorkerRuntime.runCycle({
    limit: options.limit,
  });
}

function startTier1BatchWorker() {
  tier1WorkerRuntime.start();
}

function stopTier1BatchWorker() {
  tier1WorkerRuntime.stop();
}

module.exports = {
  enrichTier1,
  enqueueTier1Batch,
  getTier1BatchStatusList,
  getTier1BatchStatus,
  startTier1BatchWorker,
  stopTier1BatchWorker,
};
