'use strict';

const db = require('../../db.js');

function createPostgresSink() {
  return {
    async writePipelineEvent(event) {
      try {
        await db.insertPipelineEvent(event);
      } catch (_err) {
        // Never break business flow on telemetry sink failures.
      }
    },
    async getPipelineRun(run_id, opts) {
      return db.getPipelineRun(run_id, opts);
    },
    async prunePipelineEvents(days) {
      return db.prunePipelineEvents(days);
    },
  };
}

module.exports = {
  createPostgresSink,
};
