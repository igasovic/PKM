'use strict';

const { getConfig } = require('../libs/config.js');
const { getBraintrustLogger } = require('./observability.js');
const { getLogger } = require('./logger/index.js');
const { runTier2ControlPlanePlan } = require('./tier2/planner.js');
const { distillTier2SingleEntrySync } = require('./tier2/service.js');

let workerTimer = null;
let workerActive = false;

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

async function runTier2BatchWorkerCycle(opts) {
  if (workerActive) {
    return { skipped: true, reason: 'worker_busy' };
  }

  workerActive = true;
  try {
    return await runner.runTier2BatchCycle(opts || {});
  } catch (err) {
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
    return { error: err && err.message ? err.message : String(err) };
  } finally {
    workerActive = false;
  }
}

function startTier2BatchWorker() {
  if (workerTimer) return;

  const enabled = String(process.env.T2_BATCH_WORKER_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return;

  const intervalRaw = Number(process.env.T2_BATCH_SYNC_INTERVAL_MS || 10 * 60_000);
  const intervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 5_000 ? intervalRaw : 60_000;
  const syncLimitRaw = Number(process.env.T2_BATCH_SYNC_LIMIT || resolveDefaultRunLimit());
  const syncLimit = Number.isFinite(syncLimitRaw) && syncLimitRaw > 0
    ? Math.trunc(syncLimitRaw)
    : resolveDefaultRunLimit();

  runTier2BatchWorkerCycle({ max_sync_items: syncLimit });
  workerTimer = setInterval(() => {
    runTier2BatchWorkerCycle({ max_sync_items: syncLimit });
  }, intervalMs);
  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }
}

function stopTier2BatchWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

module.exports = {
  createTier2BatchRunner,
  runTier2BatchCycle: runner.runTier2BatchCycle,
  runTier2BatchWorkerCycle,
  startTier2BatchWorker,
  stopTier2BatchWorker,
};
