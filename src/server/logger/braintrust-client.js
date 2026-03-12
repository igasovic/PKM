'use strict';

let braintrustLogger = null;

function getBraintrustLogger() {
  if (braintrustLogger !== null) return braintrustLogger;
  if (!process.env.BRAINTRUST_API_KEY) {
    throw new Error('BRAINTRUST_API_KEY is required');
  }
  const { initLogger } = require('braintrust');
  const projectName =
    process.env.BRAINTRUST_PROJECT ||
    process.env.BRAINTRUST_PROJECT_NAME ||
    'pkm-backend';
  if (!projectName || !String(projectName).trim()) {
    throw new Error('BRAINTRUST_PROJECT (or BRAINTRUST_PROJECT_NAME) is required');
  }
  braintrustLogger = initLogger({
    projectName,
    apiKey: process.env.BRAINTRUST_API_KEY,
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
