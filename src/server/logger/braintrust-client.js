'use strict';

const { getBraintrustConfig } = require('../runtime-env.js');

let braintrustLogger = null;

function getBraintrustLogger() {
  if (braintrustLogger !== null) return braintrustLogger;
  const braintrustConfig = getBraintrustConfig();
  if (!braintrustConfig.apiKey) {
    throw new Error('BRAINTRUST_API_KEY is required');
  }
  const { initLogger } = require('braintrust');
  const projectName = braintrustConfig.projectName;
  if (!projectName || !String(projectName).trim()) {
    throw new Error('BRAINTRUST_PROJECT (or BRAINTRUST_PROJECT_NAME) is required');
  }
  braintrustLogger = initLogger({
    projectName,
    apiKey: braintrustConfig.apiKey,
    asyncFlush: true,
  });
  if (!braintrustLogger) {
    throw new Error('Braintrust init returned no logger');
  }
  return braintrustLogger;
}

module.exports = {
  getBraintrustLogger,
};
