'use strict';

const debugStore = require('../db/debug-store.js');

module.exports = {
  upsertFailurePack: (...args) => debugStore.upsertFailurePack(...args),
  getFailurePackById: (...args) => debugStore.getFailurePackById(...args),
  getFailurePackByRunId: (...args) => debugStore.getFailurePackByRunId(...args),
  getFailurePackByRootExecutionId: (...args) => debugStore.getFailurePackByRootExecutionId(...args),
  listFailurePacks: (...args) => debugStore.listFailurePacks(...args),
  listOpenFailurePacks: (...args) => debugStore.listOpenFailurePacks(...args),
  analyzeFailurePack: (...args) => debugStore.analyzeFailurePack(...args),
  resolveFailurePack: (...args) => debugStore.resolveFailurePack(...args),
  getPipelineRun: (...args) => debugStore.getPipelineRun(...args),
  getLastPipelineRun: (...args) => debugStore.getLastPipelineRun(...args),
  getRecentPipelineRuns: (...args) => debugStore.getRecentPipelineRuns(...args),
  prunePipelineEvents: (...args) => debugStore.prunePipelineEvents(...args),
};
