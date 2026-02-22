'use strict';

const { getBraintrustLogger } = require('../../observability.js');

function nodeErrorInfo(err) {
  return {
    name: err && err.name,
    message: err && err.message,
    stack: err && err.stack,
  };
}

function createBraintrustSink() {
  return {
    async log(payload) {
      try {
        getBraintrustLogger().log(payload || {});
      } catch (_err) {
        // Keep app flow resilient if Braintrust is unavailable.
      }
    },

    async llmSpan(name, fn, ctx, opts) {
      const start = Date.now();
      const meta = {
        source: 'llm',
        span: name,
        run_id: ctx && ctx.run_id ? ctx.run_id : null,
        request_id: ctx && ctx.request_id ? ctx.request_id : null,
        ...(opts && opts.modelMeta ? opts.modelMeta : {}),
      };
      try {
        const result = await fn();
        await this.log({
          input: {
            prompt_meta: opts && opts.promptMeta ? opts.promptMeta : null,
          },
          output: {
            ok: true,
          },
          metadata: meta,
          metrics: {
            duration_ms: Date.now() - start,
          },
        });
        return result;
      } catch (err) {
        await this.log({
          input: {
            prompt_meta: opts && opts.promptMeta ? opts.promptMeta : null,
          },
          error: nodeErrorInfo(err),
          metadata: meta,
          metrics: {
            duration_ms: Date.now() - start,
          },
        });
        throw err;
      }
    },
  };
}

module.exports = {
  createBraintrustSink,
};
