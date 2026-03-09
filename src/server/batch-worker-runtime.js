'use strict';

function createBatchWorkerRuntime(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  if (typeof options.runCycle !== 'function') {
    throw new Error('createBatchWorkerRuntime: runCycle function is required');
  }

  const isEnabled = typeof options.isEnabled === 'function'
    ? options.isEnabled
    : () => true;
  const resolveIntervalMs = typeof options.resolveIntervalMs === 'function'
    ? options.resolveIntervalMs
    : () => 60_000;
  const buildScheduledOptions = typeof options.buildScheduledOptions === 'function'
    ? options.buildScheduledOptions
    : () => ({});
  const onError = typeof options.onError === 'function'
    ? options.onError
    : null;

  let workerTimer = null;
  let workerActive = false;

  async function runCycle(rawOptions) {
    if (workerActive) {
      return { skipped: true, reason: 'worker_busy' };
    }

    workerActive = true;
    try {
      const cycleOptions = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
      return await options.runCycle(cycleOptions);
    } catch (err) {
      if (onError) onError(err);
      return {
        error: err && err.message ? err.message : String(err),
      };
    } finally {
      workerActive = false;
    }
  }

  function start() {
    if (workerTimer) return;
    if (!isEnabled()) return;

    const intervalMs = Number(resolveIntervalMs());
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs >= 5000 ? Math.trunc(intervalMs) : 60_000;

    runCycle(buildScheduledOptions());
    workerTimer = setInterval(() => {
      runCycle(buildScheduledOptions());
    }, safeIntervalMs);
    if (typeof workerTimer.unref === 'function') {
      workerTimer.unref();
    }
  }

  function stop() {
    if (!workerTimer) return;
    clearInterval(workerTimer);
    workerTimer = null;
  }

  function isRunning() {
    return !!workerTimer;
  }

  return {
    runCycle,
    start,
    stop,
    isRunning,
  };
}

module.exports = {
  createBatchWorkerRuntime,
};

