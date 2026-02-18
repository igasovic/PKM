'use strict';

const { getBraintrustLogger } = require('./observability.js');
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
  return runSyncEnrichmentGraph(input || {});
}

async function enqueueTier1Batch(items, opts) {
  return runBatchScheduleGraph(items || [], opts || {});
}

async function syncPendingTier1Batches(opts) {
  const options = opts || {};
  const ids = await listPendingBatchIds(options.limit);
  const synced = [];

  for (const batch_id of ids) {
    try {
      const result = await runBatchCollectGraph(batch_id, {});
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
  const jobs = await listBatchStatuses(opts || {});
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
  return getBatchStatus(batchId, opts || {});
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
