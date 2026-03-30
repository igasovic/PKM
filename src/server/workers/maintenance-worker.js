'use strict';

const debugRepository = require('../repositories/debug-repository.js');
const distillRepository = require('../repositories/distill-repository.js');
const { getMaintenanceConfig } = require('../runtime-env.js');

function startMaintenanceWorker(logger) {
  const maintenanceConfig = getMaintenanceConfig();
  const retentionDays = maintenanceConfig.pipelineRetentionDays;
  const pruneOnce = async () => {
    try {
      await logger.step(
        'maintenance.pipeline_events.prune',
        async () => debugRepository.prunePipelineEvents(retentionDays),
        {
          input: { retention_days: retentionDays },
          output: (out) => out,
          meta: { schedule: 'daily' },
        }
      );
    } catch (_err) {
      // prune is best-effort only
    }
  };
  pruneOnce();
  const pruneTimer = setInterval(pruneOnce, 24 * 60 * 60 * 1000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  const staleEnabled = maintenanceConfig.distillStaleMarkEnabled;
  const staleIntervalMs = maintenanceConfig.distillStaleMarkIntervalMs;
  const runStaleMark = async () => {
    if (!staleEnabled) return;
    try {
      await logger.step(
        'maintenance.distill.stale_mark',
        async () => distillRepository.markDistillStaleInProd(),
        { output: (out) => out, meta: { schedule: 'distill_stale_mark' } }
      );
    } catch (_err) {
      // stale mark is best-effort only
    }
  };
  runStaleMark();
  const staleTimer = setInterval(runStaleMark, staleIntervalMs);
  if (typeof staleTimer.unref === 'function') staleTimer.unref();

  return () => {
    clearInterval(pruneTimer);
    clearInterval(staleTimer);
  };
}

module.exports = {
  startMaintenanceWorker,
};
