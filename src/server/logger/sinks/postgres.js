'use strict';

const debugStore = require('../../db/debug-store.js');

function createPostgresSink() {
  return {
    async writePipelineEvent(event) {
      try {
        await debugStore.insertPipelineEvent(event);
      } catch (_err) {
        // Never break business flow on telemetry sink failures.
      }
    },
    async getPipelineRun(run_id, opts) {
      return debugStore.getPipelineRun(run_id, opts);
    },
    async prunePipelineEvents(days) {
      return debugStore.prunePipelineEvents(days);
    },
  };
}

module.exports = {
  createPostgresSink,
};
