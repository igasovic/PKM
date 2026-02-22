'use strict';

const { getBraintrustLogger } = require('./observability.js');
const { getLogger } = require('./logger/index.js');
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

let workerTimer = null;
let workerActive = false;

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

async function runTier1BatchWorkerCycle() {
  if (workerActive) {
    return { skipped: true, reason: 'worker_busy' };
  }

  workerActive = true;
  try {
    const limitRaw = Number(process.env.T1_BATCH_SYNC_LIMIT || 20);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 20;
    return await syncPendingTier1Batches({ limit });
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

  const intervalRaw = Number(process.env.T1_BATCH_SYNC_INTERVAL_MS || 10 * 60_000);
  const intervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;

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

module.exports = {
  enrichTier1,
  enqueueTier1Batch,
  getTier1BatchStatusList,
  getTier1BatchStatus,
  startTier1BatchWorker,
  stopTier1BatchWorker,
};
