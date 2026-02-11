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

function logError(err, req) {
  const logger = getBraintrustLogger();
  logger.log({
    input: {
      method: req && req.method,
      path: req && req.url,
    },
    error: {
      name: err && err.name,
      message: err && err.message,
      stack: err && err.stack,
    },
    metadata: {
      source: 'server',
    },
  });
}

function logApiSuccess(meta, output, metrics) {
  const logger = getBraintrustLogger();
  logger.log({
    input: {
      ...meta,
    },
    output,
    metadata: {
      source: 'api',
    },
    metrics: metrics || undefined,
  });
}

function logApiError(meta, err, metrics) {
  const logger = getBraintrustLogger();
  logger.log({
    input: {
      ...meta,
    },
    error: {
      name: err && err.name,
      message: err && err.message,
      stack: err && err.stack,
    },
    metadata: {
      source: 'api',
    },
    metrics: metrics || undefined,
  });
}

async function traceDb(op, meta, fn) {
  const logger = getBraintrustLogger();
  const start = Date.now();
  try {
    const result = await fn();
    const duration_ms = Date.now() - start;
    logger.log({
      input: {
        op,
        ...meta,
      },
      output: {
        rowCount: result && result.rowCount,
      },
      metadata: {
        source: 'db',
      },
      metrics: {
        duration_ms,
      },
    });
    return result;
  } catch (err) {
    const duration_ms = Date.now() - start;
    logger.log({
      input: {
        op,
        ...meta,
      },
      error: {
        name: err && err.name,
        message: err && err.message,
        stack: err && err.stack,
      },
      metadata: {
        source: 'db',
      },
      metrics: {
        duration_ms,
      },
    });
    throw err;
  }
}

module.exports = {
  getBraintrustLogger,
  logError,
  logApiSuccess,
  logApiError,
  traceDb,
};
