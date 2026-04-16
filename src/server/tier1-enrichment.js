'use strict';

const { braintrustSink } = require('./logger/braintrust.js');
const { getLogger } = require('./logger/index.js');
const { createBatchWorkerRuntime } = require('./batch-worker-runtime.js');
const tier1ClassifyStore = require('./db/tier1-classify-store.js');
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
const { getT1BatchSettings } = require('./runtime-env.js');

async function enrichTier1(input) {
  const logger = getLogger().child({ pipeline: 't1.enrich.sync' });
  return logger.step(
    't1.enrich.sync',
    async () => runSyncEnrichmentGraph(input || {}),
    { input: input || {}, output: (out) => out }
  );
}

async function enrichTier1AndPersist(input) {
  const args = input && typeof input === 'object' ? input : {};
  const selectorId = args.id || null;
  const selectorEntryId = args.entry_id || null;
  if (!selectorId && !selectorEntryId) {
    throw new Error('enrich/t1/update requires id or entry_id');
  }

  const logger = getLogger().child({ pipeline: 't1.enrich.sync.update' });
  return logger.step(
    't1.enrich.sync.update',
    async () => {
      const hasProvidedT1 = !!(
        (args.t1 && typeof args.t1 === 'object' && !Array.isArray(args.t1))
        || (
          (args.topic_primary !== undefined && args.topic_primary !== null)
          && (args.topic_secondary !== undefined && args.topic_secondary !== null)
          && (args.gist !== undefined && args.gist !== null)
        )
      );
      const t1 = hasProvidedT1
        ? ((args.t1 && typeof args.t1 === 'object' && !Array.isArray(args.t1)) ? args.t1 : args)
        : await runSyncEnrichmentGraph({
          title: args.title ?? null,
          author: args.author ?? null,
          clean_text: args.clean_text ?? null,
        });

      return tier1ClassifyStore.applyTier1Update({
        id: selectorId,
        entry_id: selectorEntryId,
        clean_text: args.clean_text ?? null,
        enrichment_model: args.enrichment_model ?? null,
        prompt_version: args.prompt_version ?? null,
        t1,
        schema: args.schema ?? null,
      });
    },
    {
      input: {
        has_id: !!selectorId,
        has_entry_id: !!selectorEntryId,
        has_t1: !!(args.t1 && typeof args.t1 === 'object' && !Array.isArray(args.t1)),
      },
      output: (out) => ({
        schema: out && out.schema ? out.schema : null,
        entry_id: out && out.row ? out.row.entry_id : null,
        topic_primary: out && out.row ? out.row.topic_primary : null,
        linked_topic_key: out && out.topic_link ? out.topic_link.topic_key : null,
      }),
    }
  );
}

async function applyTier1CollectedBatchResults(input) {
  const args = input && typeof input === 'object' ? input : {};
  const logger = getLogger().child({ pipeline: 't1.enrich.batch.apply' });
  return logger.step(
    't1.enrich.batch.apply',
    async () => tier1ClassifyStore.applyCollectedBatchResults({
      schema: args.schema || null,
      rows: Array.isArray(args.rows) ? args.rows : [],
      enrichment_model: args.enrichment_model || null,
      prompt_version: args.prompt_version || null,
    }),
    {
      input: {
        schema: args.schema || null,
        rows: Array.isArray(args.rows) ? args.rows.length : 0,
      },
      output: (out) => ({
        rowCount: out && Number.isFinite(Number(out.rowCount)) ? Number(out.rowCount) : 0,
        skipped_non_ok: out && Number.isFinite(Number(out.skipped_non_ok)) ? Number(out.skipped_non_ok) : 0,
        skipped_no_selector: out && Number.isFinite(Number(out.skipped_no_selector))
          ? Number(out.skipped_no_selector)
          : 0,
      }),
    }
  );
}

async function enrichTier1AndPersistBatch(input) {
  const args = input && typeof input === 'object' ? input : {};
  const rawItems = Array.isArray(args.items) ? args.items : [];
  if (!rawItems.length) {
    throw new Error('enrich/t1/update-batch requires non-empty items');
  }

  const logger = getLogger().child({ pipeline: 't1.enrich.sync.update_batch' });
  return logger.step(
    't1.enrich.sync.update_batch',
    async () => {
      const prepared = [];
      for (let i = 0; i < rawItems.length; i += 1) {
        const item = rawItems[i] && typeof rawItems[i] === 'object' && !Array.isArray(rawItems[i])
          ? rawItems[i]
          : {};
        const hasProvidedT1 = !!(
          (item.t1 && typeof item.t1 === 'object' && !Array.isArray(item.t1))
          || (
            (item.topic_primary !== undefined && item.topic_primary !== null)
            && (item.topic_secondary !== undefined && item.topic_secondary !== null)
            && (item.gist !== undefined && item.gist !== null)
          )
        );
        const t1 = hasProvidedT1
          ? ((item.t1 && typeof item.t1 === 'object' && !Array.isArray(item.t1)) ? item.t1 : item)
          : await runSyncEnrichmentGraph({
            title: item.title ?? null,
            author: item.author ?? null,
            clean_text: item.clean_text ?? null,
          });
        prepared.push({
          id: item.id ?? null,
          entry_id: item.entry_id ?? null,
          clean_text: item.clean_text ?? null,
          enrichment_model: item.enrichment_model ?? args.enrichment_model ?? null,
          prompt_version: item.prompt_version ?? args.prompt_version ?? null,
          t1,
          schema: item.schema ?? args.schema ?? null,
        });
      }

      return tier1ClassifyStore.applyTier1UpdateBatch({
        items: prepared,
        continue_on_error: args.continue_on_error !== false,
        schema: args.schema ?? null,
      });
    },
    {
      input: {
        items_count: rawItems.length,
        continue_on_error: args.continue_on_error !== false,
      },
      output: (out) => ({
        rowCount: out && Number.isFinite(Number(out.rowCount)) ? Number(out.rowCount) : 0,
      }),
    }
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
  return resolveTier1SyncLimit(getT1BatchSettings().syncLimit, 20);
}

function isTier1WorkerEnabled() {
  return getT1BatchSettings().workerEnabled;
}

function resolveTier1WorkerIntervalMs() {
  const intervalRaw = getT1BatchSettings().syncIntervalMs;
  return Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;
}

function logTier1WorkerError(err) {
  try {
    braintrustSink.logError('t1_batch_worker.cycle', {
      error: err,
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
  enrichTier1AndPersist,
  enrichTier1AndPersistBatch,
  applyTier1CollectedBatchResults,
  enqueueTier1Batch,
  getTier1BatchStatusList,
  getTier1BatchStatus,
  startTier1BatchWorker,
  stopTier1BatchWorker,
};
