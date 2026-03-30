'use strict';

const db = require('../db.js');

module.exports = {
  upsertFailurePack: (...args) => db.upsertFailurePack(...args),
  getFailurePackById: (...args) => db.getFailurePackById(...args),
  getFailurePackByRunId: (...args) => db.getFailurePackByRunId(...args),
  listFailurePacks: (...args) => db.listFailurePacks(...args),
  getPipelineRun: (...args) => db.getPipelineRun(...args),
  getLastPipelineRun: (...args) => db.getLastPipelineRun(...args),
  getRecentPipelineRuns: (...args) => db.getRecentPipelineRuns(...args),
  prunePipelineEvents: (...args) => db.prunePipelineEvents(...args),
};
