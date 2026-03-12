'use strict';

const { getRunContext } = require('./context.js');
const { createBraintrustSink } = require('./sinks/braintrust.js');
const { getBraintrustLogger } = require('./braintrust-client.js');

const braintrustSink = createBraintrustSink();

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

function logError(err, req) {
  braintrustSink.logError('server.request_error', {
    input: {
      method: req && req.method ? String(req.method).toUpperCase() : null,
      path: req && req.url ? String(req.url) : null,
    },
    error: err,
    metadata: {
      source: 'server',
    },
  });
}

function logApiSuccess(meta, output, metrics) {
  braintrustSink.logSuccess('api.request', {
    input: scrubCaptureText({
      ...(meta || {}),
    }),
    output: output || {},
    metadata: {
      source: 'api',
    },
    metrics: metrics || undefined,
  });
}

function logApiError(meta, err, metrics) {
  braintrustSink.logError('api.request', {
    input: scrubCaptureText({
      ...(meta || {}),
    }),
    error: err,
    metadata: {
      source: 'api',
    },
    metrics: metrics || undefined,
  });
}

async function traceDb(op, meta, fn) {
  const start = Date.now();
  const ctx = getRunContext();
  const input = {
    op,
    ...(meta || {}),
  };
  try {
    const result = await fn();
    await braintrustSink.logSuccess(op, {
      input,
      output: {
        rowCount: result && result.rowCount,
      },
      metadata: {
        source: 'db',
      },
      metrics: {
        duration_ms: Date.now() - start,
      },
      context: ctx,
    });
    return result;
  } catch (err) {
    await braintrustSink.logError(op, {
      input,
      error: err,
      metadata: {
        source: 'db',
      },
      metrics: {
        duration_ms: Date.now() - start,
      },
      context: ctx,
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
  braintrustSink,
};
