'use strict';

const { getRunContext } = require('../context.js');
const { getBraintrustLogger } = require('../braintrust-client.js');
const SINK_WARN_INTERVAL_MS = 60_000;

let modelCostMapCache = {
  raw: null,
  parsed: null,
};

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

function sanitizeModelEnvKey(model) {
  const key = String(model || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return key ? key.toUpperCase() : '';
}

function readRatePair(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const inputPerM = toFinite(
    obj.input_per_1m_usd ??
      obj.input_per_1m ??
      obj.input ??
      obj.prompt_per_1m_usd ??
      obj.prompt
  );
  const outputPerM = toFinite(
    obj.output_per_1m_usd ??
      obj.output_per_1m ??
      obj.output ??
      obj.completion_per_1m_usd ??
      obj.completion
  );
  if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM)) return null;
  return { inputPerM, outputPerM };
}

function getModelCostMap() {
  const raw = String(process.env.LLM_MODEL_COSTS_PER_1M_USD_JSON || '').trim();
  if (!raw) return null;
  if (modelCostMapCache.raw === raw) return modelCostMapCache.parsed;
  let parsed = null;
  try {
    const candidate = JSON.parse(raw);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate;
    }
  } catch (_err) {
    parsed = null;
  }
  modelCostMapCache = { raw, parsed };
  return parsed;
}

function resolveModelName(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const input = opts.input && typeof opts.input === 'object' ? opts.input : {};
  const metadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {};
  const candidates = [
    input.model,
    metadata.model,
    metadata.request_model,
    metadata.requested_provider_model,
    metadata.requested_batch_model,
  ];
  for (const value of candidates) {
    const model = String(value || '').trim();
    if (model) return model;
  }
  return null;
}

function resolveCostRates(model) {
  const modelName = String(model || '').trim();
  if (modelName) {
    const map = getModelCostMap();
    if (map) {
      const fromMap = readRatePair(
        map[modelName] ||
        map[modelName.toLowerCase()] ||
        map[modelName.toUpperCase()]
      );
      if (fromMap) return fromMap;
    }

    const modelKey = sanitizeModelEnvKey(modelName);
    if (modelKey) {
      const modelInputPerM = toFinite(process.env[`LLM_MODEL_${modelKey}_INPUT_COST_PER_1M_USD`]);
      const modelOutputPerM = toFinite(process.env[`LLM_MODEL_${modelKey}_OUTPUT_COST_PER_1M_USD`]);
      if (Number.isFinite(modelInputPerM) && Number.isFinite(modelOutputPerM)) {
        return {
          inputPerM: modelInputPerM,
          outputPerM: modelOutputPerM,
        };
      }
    }
  }

  const inputPerM = toFinite(process.env.LLM_INPUT_COST_PER_1M_USD);
  const outputPerM = toFinite(process.env.LLM_OUTPUT_COST_PER_1M_USD);
  if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM)) return null;
  return { inputPerM, outputPerM };
}

function sinkWarningsEnabled() {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'test') return true;
  return String(process.env.PKM_BRAINTRUST_SINK_WARN_IN_TEST || '').trim() === '1';
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

function estimateCostUsd(usage, model) {
  const promptTokens = toFinite(usage && usage.prompt_tokens);
  const completionTokens = toFinite(usage && usage.completion_tokens);
  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return undefined;

  const rates = resolveCostRates(model);
  if (!rates) return undefined;

  const inCost = Number.isFinite(promptTokens) ? (promptTokens / 1_000_000) * rates.inputPerM : 0;
  const outCost = Number.isFinite(completionTokens) ? (completionTokens / 1_000_000) * rates.outputPerM : 0;
  const total = inCost + outCost;
  return Number.isFinite(total) ? total : undefined;
}

function normalizeMetrics(metrics, usage, model) {
  const out = { ...(metrics && typeof metrics === 'object' ? metrics : {}) };
  const usageNorm = normalizeUsage(usage);
  for (const [k, v] of Object.entries(usageNorm)) {
    if (out[k] === undefined) out[k] = v;
  }
  if (!Number.isFinite(Number(out.estimated_cost_usd))) {
    const derivedCost = estimateCostUsd({ ...usageNorm, ...out }, model);
    if (Number.isFinite(derivedCost)) out.estimated_cost_usd = derivedCost;
  }
  return out;
}

function createBraintrustSink() {
  let totalFailures = 0;
  let consecutiveFailures = 0;
  let lastWarnAt = 0;

  return {
    async log(payload) {
      const data = payload || {};
      try {
        getBraintrustLogger().log(data);
        consecutiveFailures = 0;
      } catch (err) {
        // Keep app flow resilient if Braintrust is unavailable.
        totalFailures += 1;
        consecutiveFailures += 1;
        const now = Date.now();
        const shouldWarn = (
          totalFailures <= 3 ||
          totalFailures % 100 === 0 ||
          (now - lastWarnAt) >= SINK_WARN_INTERVAL_MS
        );
        if (shouldWarn && sinkWarningsEnabled()) {
          lastWarnAt = now;
          const op = data && data.metadata && data.metadata.op ? String(data.metadata.op) : 'unknown';
          const message = err && err.message ? err.message : String(err || 'unknown error');
          console.error(
            `[braintrust-sink] write_failed op=${op} total_failures=${totalFailures} consecutive_failures=${consecutiveFailures} message=${message}`
          );
        }
      }
    },

    async logSuccess(op, opts) {
      const options = opts || {};
      const ctx = resolveContext(options.context);
      const model = resolveModelName(options);
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
        metrics: normalizeMetrics(options.metrics, options.usage, model),
      });
    },

    async logError(op, opts) {
      const options = opts || {};
      const ctx = resolveContext(options.context);
      const model = resolveModelName(options);
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
        metrics: normalizeMetrics(options.metrics, options.usage, model),
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
