'use strict';

const { getRunContext } = require('../context.js');
const { getBraintrustLogger } = require('../braintrust-client.js');

function nodeErrorInfo(err) {
  return {
    name: err && err.name,
    message: err && err.message,
    stack: err && err.stack,
  };
}

function resolveContext(ctx) {
  if (ctx && typeof ctx === 'object') return ctx;
  return getRunContext();
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return {};
  const promptTokens = toFinite(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = toFinite(usage.completion_tokens ?? usage.output_tokens);
  const reasoningTokens = toFinite(
    usage.reasoning_tokens ??
      (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ??
      (usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens)
  );
  const totalTokens = toFinite(
    usage.total_tokens ??
      usage.tokens ??
      (
        Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
          ? promptTokens + completionTokens
          : undefined
      )
  );
  const out = {};
  if (Number.isFinite(promptTokens)) out.prompt_tokens = promptTokens;
  if (Number.isFinite(completionTokens)) out.completion_tokens = completionTokens;
  if (Number.isFinite(reasoningTokens)) out.reasoning_tokens = reasoningTokens;
  if (Number.isFinite(totalTokens)) {
    out.total_tokens = totalTokens;
    out.tokens = totalTokens;
  }
  return out;
}

function estimateCostUsd(usage) {
  const promptTokens = toFinite(usage && usage.prompt_tokens);
  const completionTokens = toFinite(usage && usage.completion_tokens);
  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return undefined;

  const inputPerM = Number(process.env.LLM_INPUT_COST_PER_1M_USD);
  const outputPerM = Number(process.env.LLM_OUTPUT_COST_PER_1M_USD);
  if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM)) return undefined;

  const inCost = Number.isFinite(promptTokens) ? (promptTokens / 1_000_000) * inputPerM : 0;
  const outCost = Number.isFinite(completionTokens) ? (completionTokens / 1_000_000) * outputPerM : 0;
  const total = inCost + outCost;
  return Number.isFinite(total) ? total : undefined;
}

function normalizeMetrics(metrics, usage) {
  const out = { ...(metrics && typeof metrics === 'object' ? metrics : {}) };
  const usageNorm = normalizeUsage(usage);
  for (const [k, v] of Object.entries(usageNorm)) {
    if (out[k] === undefined) out[k] = v;
  }
  if (!Number.isFinite(Number(out.estimated_cost_usd))) {
    const derivedCost = estimateCostUsd({ ...usageNorm, ...out });
    if (Number.isFinite(derivedCost)) out.estimated_cost_usd = derivedCost;
  }
  return out;
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

    async logSuccess(op, opts) {
      const options = opts || {};
      const ctx = resolveContext(options.context);
      await this.log({
        input: options.input || {},
        output: options.output || {},
        metadata: {
          op,
          outcome: 'success',
          run_id: ctx && ctx.run_id ? ctx.run_id : null,
          request_id: ctx && ctx.request_id ? ctx.request_id : null,
          ...(options.metadata || {}),
        },
        metrics: normalizeMetrics(options.metrics, options.usage),
      });
    },

    async logError(op, opts) {
      const options = opts || {};
      const ctx = resolveContext(options.context);
      await this.log({
        input: options.input || {},
        error: nodeErrorInfo(options.error),
        metadata: {
          op,
          outcome: 'error',
          run_id: ctx && ctx.run_id ? ctx.run_id : null,
          request_id: ctx && ctx.request_id ? ctx.request_id : null,
          ...(options.metadata || {}),
        },
        metrics: normalizeMetrics(options.metrics, options.usage),
      });
    },

    async llmSpan(name, fn, ctx, opts) {
      const start = Date.now();
      const options = opts || {};
      const meta = {
        source: 'llm',
        span: name,
        run_id: ctx && ctx.run_id ? ctx.run_id : null,
        request_id: ctx && ctx.request_id ? ctx.request_id : null,
        ...(options.modelMeta || {}),
      };
      try {
        const result = await fn();
        const usage = options.usage ||
          (result && result.usage) ||
          (result && result.response && result.response.usage) ||
          null;
        await this.logSuccess(name, {
          input: {
            prompt_meta: options.promptMeta || null,
          },
          output: options.output || { ok: true },
          metadata: meta,
          metrics: {
            duration_ms: Date.now() - start,
          },
          usage,
          context: ctx,
        });
        return result;
      } catch (err) {
        await this.logError(name, {
          input: {
            prompt_meta: options.promptMeta || null,
          },
          error: err,
          metadata: meta,
          metrics: {
            duration_ms: Date.now() - start,
          },
          usage: options.usage || null,
          context: ctx,
        });
        throw err;
      }
    },
  };
}

module.exports = {
  createBraintrustSink,
};
