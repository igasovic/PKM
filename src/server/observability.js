'use strict';

const { getRunContext } = require('./logger/context.js');

let braintrustLogger = null;

function scrubCaptureText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => scrubCaptureText(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === 'capture_text') {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = scrubCaptureText(value[key]);
  }
  return out;
}

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
  const ctx = getRunContext();
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
      run_id: ctx && ctx.run_id ? ctx.run_id : null,
      request_id: ctx && ctx.request_id ? ctx.request_id : null,
    },
  });
}

function logApiSuccess(meta, output, metrics) {
  const logger = getBraintrustLogger();
  const ctx = getRunContext();
  logger.log({
    input: scrubCaptureText({
      ...meta,
    }),
    output,
    metadata: {
      source: 'api',
      run_id: ctx && ctx.run_id ? ctx.run_id : null,
      request_id: ctx && ctx.request_id ? ctx.request_id : null,
    },
    metrics: metrics || undefined,
  });
}

function logApiError(meta, err, metrics) {
  const logger = getBraintrustLogger();
  const ctx = getRunContext();
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
      run_id: ctx && ctx.run_id ? ctx.run_id : null,
      request_id: ctx && ctx.request_id ? ctx.request_id : null,
    },
    metrics: metrics || undefined,
  });
}

async function traceDb(op, meta, fn) {
  const logger = getBraintrustLogger();
  const ctx = getRunContext();
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
        run_id: ctx && ctx.run_id ? ctx.run_id : null,
        request_id: ctx && ctx.request_id ? ctx.request_id : null,
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
        run_id: ctx && ctx.run_id ? ctx.run_id : null,
        request_id: ctx && ctx.request_id ? ctx.request_id : null,
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
