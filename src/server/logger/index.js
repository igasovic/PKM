'use strict';

const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { summarize, sha256 } = require('./summarize.js');
const {
  getContext,
  getRunContext,
  nextSeq,
  setContextPatch,
} = require('./context.js');
const { createPostgresSink } = require('./sinks/postgres.js');
const { createBraintrustSink } = require('./sinks/braintrust.js');

const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];
const BIG_TEXT_FIELDS = new Set(['capture_text', 'extracted_text', 'clean_text']);

function levelValue(level) {
  const idx = LEVELS.indexOf(String(level || '').toLowerCase());
  return idx === -1 ? LEVELS.indexOf('info') : idx;
}

function getLogLevel() {
  const raw = String(process.env.PKM_LOG_LEVEL || 'info').toLowerCase();
  return LEVELS.includes(raw) ? raw : 'info';
}

function shouldLog(level) {
  return levelValue(level) <= levelValue(getLogLevel());
}

function truncateStack(err) {
  const stack = String(err && err.stack ? err.stack : '');
  if (!stack) return null;
  const lines = stack.split('\n').slice(0, 8);
  return lines.join('\n');
}

function errorSummary(err) {
  const message = String(err && err.message ? err.message : String(err || 'unknown error'));
  const stack = truncateStack(err);
  return {
    name: err && err.name ? err.name : 'Error',
    message,
    stack_hash: sha256(stack || message),
    stack_sample: stack || null,
  };
}

function debugCaptureEnabled() {
  return String(process.env.PKM_DEBUG_CAPTURE || '').trim() === '1';
}

function debugCaptureDir() {
  const fromEnv = String(process.env.PKM_DEBUG_CAPTURE_DIR || '').trim();
  return fromEnv || '/data/pipeline-debug';
}

async function writeDebugBundle(runId, label, payload) {
  const dir = debugCaptureDir();
  await fs.mkdir(dir, { recursive: true });
  const file = `${Date.now()}_${runId || 'run'}_${label || 'bundle'}_${randomUUID()}.json`;
  const full = path.join(dir, file);
  await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
  return full;
}

function buildSummary(value, opts) {
  const includeSamples = shouldLog('trace') && !!(opts && opts.allow_text_samples);
  return summarize(value, {
    include_text_samples: includeSamples,
    max_bytes: Number(process.env.PKM_LOG_SUMMARY_MAX_BYTES || 12 * 1024),
    max_depth: 2,
    max_array_items: 5,
    max_object_keys: 20,
  });
}

class PipelineLogger {
  constructor(meta, sinks) {
    this.meta = { ...(meta || {}) };
    this.sinks = sinks || {
      postgres: createPostgresSink(),
      braintrust: createBraintrustSink(),
    };
  }

  child(meta) {
    return new PipelineLogger({ ...this.meta, ...(meta || {}) }, this.sinks);
  }

  async persistEvent(row) {
    if (!shouldLog(row.level || 'info')) return;
    await this.sinks.postgres.writePipelineEvent(row);
  }

  baseEvent(step, direction, level, extra) {
    const extras = extra || {};
    const ctx = getContext() || {};
    const seq = Number.isFinite(Number(extras.seq)) ? Number(extras.seq) : nextSeq();
    const run_id = extras.run_id || ctx.run_id || randomUUID();
    const base = {
      run_id,
      seq,
      service: this.meta.service || 'pkm-server',
      pipeline: this.meta.pipeline || ctx.pipeline || null,
      step,
      direction,
      level,
      entry_id: this.meta.entry_id || null,
      batch_id: this.meta.batch_id || null,
      trace_id: this.meta.trace_id || null,
      meta: {
        request_id: ctx.request_id || null,
        route: ctx.route || null,
        method: ctx.method || null,
        ...(this.meta.meta || {}),
        ...(extras.meta || {}),
      },
    };
    return { ...base, ...extras };
  }

  async event(level, message, opts) {
    const row = this.baseEvent(
      String((opts && opts.step) || message || 'event'),
      'end',
      level || 'info',
      {
        output_summary: buildSummary({ message, data: opts && opts.data }, {}),
        meta: (opts && opts.meta) || {},
      }
    );
    await this.persistEvent(row);
  }

  async step(stepName, fn, opts) {
    const options = opts || {};
    const startMs = Date.now();
    const ctx = getContext();
    const localRunId = (ctx && ctx.run_id) ? ctx.run_id : randomUUID();
    let localSeq = 0;
    const allocSeq = () => {
      if (ctx && ctx.run_id) return nextSeq();
      localSeq += 1;
      return localSeq;
    };
    const startRow = this.baseEvent(stepName, 'start', options.level || 'info', {
      run_id: localRunId,
      seq: allocSeq(),
      input_summary: buildSummary(options.input, {
        allow_text_samples: !!options.allow_text_samples,
      }),
      meta: options.meta || {},
    });
    await this.persistEvent(startRow);

    try {
      const result = await fn();
      const outputPayload = typeof options.output === 'function'
        ? options.output(result)
        : (options.output !== undefined ? options.output : result);

      const endRow = this.baseEvent(stepName, 'end', options.level || 'info', {
        run_id: localRunId,
        seq: allocSeq(),
        duration_ms: Date.now() - startMs,
        output_summary: buildSummary(outputPayload, {
          allow_text_samples: !!options.allow_text_samples,
        }),
        meta: options.meta || {},
      });
      await this.persistEvent(endRow);
      return result;
    } catch (err) {
      let artifact_path = null;
      if (debugCaptureEnabled() || options.capture_on_error) {
        try {
          artifact_path = await writeDebugBundle(startRow.run_id, stepName, {
            step: stepName,
            input: options.input,
            error: errorSummary(err),
          });
        } catch (_err) {
          artifact_path = null;
        }
      }

      const errorRow = this.baseEvent(stepName, 'error', 'error', {
        run_id: localRunId,
        seq: allocSeq(),
        duration_ms: Date.now() - startMs,
        error: errorSummary(err),
        artifact_path,
        input_summary: buildSummary(options.input, {
          allow_text_samples: false,
        }),
        meta: options.meta || {},
      });
      await this.persistEvent(errorRow);
      throw err;
    }
  }

  async llmSpan(name, fn, opts) {
    const ctx = getRunContext();
    return this.sinks.braintrust.llmSpan(name, fn, ctx, opts || {});
  }

  async captureDebugBundle(label, payload) {
    if (!debugCaptureEnabled()) return null;
    const ctx = getContext() || {};
    const filtered = { ...(payload || {}) };
    for (const field of BIG_TEXT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(filtered, field)) {
        const value = String(filtered[field] || '');
        filtered[field] = {
          char_count: value.length,
          sha256: sha256(value),
        };
      }
    }
    return writeDebugBundle(ctx.run_id || randomUUID(), label, filtered);
  }
}

function getLogger() {
  return new PipelineLogger({}, {
    postgres: createPostgresSink(),
    braintrust: createBraintrustSink(),
  });
}

module.exports = {
  getLogger,
  shouldLog,
  getLogLevel,
  setContextPatch,
};
