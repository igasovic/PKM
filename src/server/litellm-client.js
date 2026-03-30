'use strict';

const { createBraintrustSink } = require('./logger/sinks/braintrust.js');
const { getLiteLLMSettings, getFallbackLlmCostEnv } = require('./runtime-env.js');

const DEFAULT_SYSTEM_PROMPT =
  '\
You are a precise metadata extraction engine for a personal knowledge base.\
Return ONLY valid JSON that matches the requested schema.\
Do not include markdown, comments, or any extra text.\
Be conservative: if unsure, lower confidence and use "other" for primary topic.';

function requireApiKey() {
  const key = getLiteLLMSettings().apiKey;
  if (!key || !String(key).trim()) {
    throw new Error('LITELLM_MASTER_KEY is required');
  }
  return key;
}

function extractResponseText(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  if (Array.isArray(response.output) && response.output.length) {
    for (const msg of response.output) {
      if (Array.isArray(msg.content)) {
        const part = msg.content.find((p) =>
          p &&
          (p.type === 'output_text' || p.type === 'text') &&
          typeof p.text === 'string' &&
          p.text.trim().length > 0
        );
        if (part) return part.text;
        const joined = msg.content
          .map((p) => (typeof p?.text === 'string' ? p.text : ''))
          .join('\n')
          .trim();
        if (joined) return joined;
      }
      if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text;
    }
  }
  return (
    response.responseText ??
    response.text ??
    response.output_text ??
    response.response ??
    response.data ??
    response.message?.content ??
    response.choices?.[0]?.message?.content ??
    response.choices?.[0]?.text ??
    ''
  );
}

function readUsage(response) {
  const usage = response && response.usage;
  if (!usage || typeof usage !== 'object') return {};
  const prompt_tokens = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? 0
  );
  const completion_tokens = Number(
    usage.completion_tokens ?? usage.output_tokens ?? 0
  );
  const tokensRaw = usage.tokens ?? usage.total_tokens;
  const tokens = Number(
    tokensRaw ??
      (Number.isFinite(prompt_tokens) && Number.isFinite(completion_tokens)
        ? prompt_tokens + completion_tokens
        : 0)
  );
  const reasoningRaw =
    usage.reasoning_tokens ??
    (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ??
    (usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens);
  const reasoning_tokens = Number(reasoningRaw ?? 0);
  return {
    prompt_tokens: Number.isFinite(prompt_tokens) ? prompt_tokens : undefined,
    completion_tokens: Number.isFinite(completion_tokens) ? completion_tokens : undefined,
    reasoning_tokens: Number.isFinite(reasoning_tokens) ? reasoning_tokens : undefined,
    tokens: Number.isFinite(tokens) ? tokens : undefined,
    total_tokens: Number.isFinite(tokens) ? tokens : undefined,
  };
}

function readNumberCandidate(values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function readTtftMs(response) {
  return readNumberCandidate([
    response && response.ttft_ms,
    response && response.ttft,
    response && response.timings && response.timings.ttft_ms,
    response && response.timings && response.timings.ttft,
    response && response.usage && response.usage.ttft_ms,
    response && response.usage && response.usage.ttft,
    response && response._hidden_params && response._hidden_params.ttft_ms,
    response && response._hidden_params && response._hidden_params.ttft,
  ]);
}

function readEstimatedCostUsd(response, usage) {
  const direct = readNumberCandidate([
    response && response.response_cost,
    response && response.cost,
    response && response._response_cost,
    response && response._hidden_params && response._hidden_params.response_cost,
    response && response._hidden_params && response._hidden_params.cost,
    usage && usage.estimated_cost_usd,
    usage && usage.estimated_cost,
    usage && usage.cost,
  ]);
  if (direct !== undefined) return direct;

  const promptTokens = Number(usage && usage.prompt_tokens);
  const completionTokens = Number(usage && usage.completion_tokens);
  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return undefined;

  const fallbackCosts = getFallbackLlmCostEnv();
  const inputPerM = Number(fallbackCosts.inputPerM);
  const outputPerM = Number(fallbackCosts.outputPerM);
  if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM)) return undefined;

  const inCost = Number.isFinite(promptTokens) ? (promptTokens / 1_000_000) * inputPerM : 0;
  const outCost = Number.isFinite(completionTokens) ? (completionTokens / 1_000_000) * outputPerM : 0;
  const total = inCost + outCost;
  return Number.isFinite(total) ? total : undefined;
}

function buildLlmMetrics(response, durationMs, usage) {
  const metrics = {
    llm_duration_ms: durationMs,
    duration_ms: durationMs,
  };
  const ttftMs = readTtftMs(response);
  if (Number.isFinite(ttftMs)) metrics.ttft_ms = ttftMs;
  const estimatedCostUsd = readEstimatedCostUsd(response, usage);
  if (Number.isFinite(estimatedCostUsd)) metrics.estimated_cost_usd = estimatedCostUsd;
  return metrics;
}

function formatFetchError(err, url, method) {
  const cause = err && err.cause ? err.cause : null;
  const code = cause && cause.code ? cause.code : null;
  const errno = cause && cause.errno ? cause.errno : null;
  const address = cause && cause.address ? cause.address : null;
  const port = cause && cause.port ? cause.port : null;
  const details = [
    `method=${method}`,
    `url=${url}`,
    code ? `code=${code}` : null,
    errno ? `errno=${errno}` : null,
    address ? `address=${address}` : null,
    port ? `port=${port}` : null,
    err && err.message ? `message=${err.message}` : null,
  ].filter(Boolean).join(', ');
  return new Error(`LiteLLM request failed (${details})`);
}

function requestTimeoutMs() {
  const raw = Number(getLiteLLMSettings().timeoutMs);
  if (!Number.isFinite(raw) || raw < 1000) return 60_000;
  return raw;
}

function normalizeReasoningEffort(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'minimal' || v === 'low' || v === 'medium' || v === 'high') return v;
  return null;
}

function getReasoningEffort() {
  return getLiteLLMSettings().reasoningEffort;
}

function isReasoningEffortValidationError(msg) {
  const s = String(msg || '').toLowerCase();
  return (
    (s.includes('reasoning') || s.includes('reasoning_effort')) &&
    (s.includes('invalid') || s.includes('unsupported') || s.includes('not allowed') || s.includes('must be'))
  );
}

function safeJsonParse(text) {
  if (!String(text || '').trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_err) {
    return {};
  }
}

function extractErrorMessage(json, fallbackText) {
  const fromJson = json && (json.error?.message || json.message || null);
  const fallback = String(fallbackText || '').trim();
  if (fromJson && String(fromJson).trim()) return String(fromJson).trim();
  if (fallback) return fallback;
  return 'unknown error';
}

function withBatchFilesHint(msg, baseUrl) {
  const raw = String(msg || '').trim();
  const lower = raw.toLowerCase();
  if (!lower.includes('files_settings is not set')) return raw;
  const hint = [
    raw,
    `LiteLLM batch prerequisites missing: enable file storage in LiteLLM config.yaml (files_settings) and restart LiteLLM.`,
    `request_target=${baseUrl}/files`,
  ].join(' ');
  return hint;
}

function getDefaultBatchModel() {
  const settings = getLiteLLMSettings();
  return settings.batchModel || settings.batchDefaultModel || 't1-batch';
}

function getDefaultBatchRequestModel(fallback) {
  const settings = getLiteLLMSettings();
  return settings.batchRequestModel || settings.batchProviderModel || fallback || null;
}

function isBatchModelUnsupportedMessage(msg) {
  const s = String(msg || '').toLowerCase();
  return (
    s.includes('model_not_found') ||
    s.includes('not supported by the batch api') ||
    (s.includes('provided model') && s.includes('batch'))
  );
}

function truncate(value, max) {
  const s = String(value || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function errorDetails(err) {
  return {
    name: err && err.name,
    message: err && err.message,
    stack: err && err.stack,
  };
}

class LiteLLMClient {
  constructor(opts) {
    const options = opts || {};
    const settings = getLiteLLMSettings();
    this.apiKey = requireApiKey();
    this.baseUrl = options.baseUrl || settings.baseUrl;
    this.model = options.model || settings.defaultModel;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.braintrustSink = createBraintrustSink();
  }

  logSuccess(op, input, output, metadata, metrics, usage) {
    this.braintrustSink.logSuccess(op, {
      input,
      output,
      metadata: {
        source: 'litellm',
        ...(metadata || {}),
      },
      metrics: metrics || undefined,
      usage: usage || null,
    });
  }

  logError(op, input, err, metadata, metrics, usage) {
    this.braintrustSink.logError(op, {
      input,
      error: errorDetails(err),
      metadata: {
        source: 'litellm',
        ...(metadata || {}),
      },
      metrics: metrics || undefined,
      usage: usage || null,
    });
  }

  async fetchJson(endpoint, fetchOptions) {
    const start = Date.now();
    let res;
    try {
      res = await fetch(endpoint, {
        ...fetchOptions,
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (fetchErr) {
      throw formatFetchError(fetchErr, endpoint, fetchOptions && fetchOptions.method ? fetchOptions.method : 'GET');
    }

    const text = await res.text();
    return {
      res,
      text,
      json: safeJsonParse(text),
      duration_ms: Date.now() - start,
    };
  }

  async fetchText(endpoint, fetchOptions) {
    const start = Date.now();
    let res;
    try {
      res = await fetch(endpoint, {
        ...fetchOptions,
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (fetchErr) {
      throw formatFetchError(fetchErr, endpoint, fetchOptions && fetchOptions.method ? fetchOptions.method : 'GET');
    }

    const text = await res.text();
    return {
      res,
      text,
      duration_ms: Date.now() - start,
    };
  }

  async sendMessage(userPrompt, opts) {
    const options = opts || {};
    const prompt = String(userPrompt || '');
    if (!prompt.trim()) {
      throw new Error('LiteLLM sendMessage requires non-empty prompt');
    }

    const model = options.model || this.model;
    const instructions = options.systemPrompt || this.systemPrompt;
    const endpoint = `${this.baseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    const defaultReasoningEffort = getReasoningEffort();
    const callMetadata = options.metadata && typeof options.metadata === 'object'
      ? options.metadata
      : {};
    const withCallMetadata = (metadata) => ({
      ...callMetadata,
      ...(metadata || {}),
    });
    const methodStart = Date.now();
    const attemptDetails = [];

    const makeBody = (reasoningEffort) => ({
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt },
      ],
      reasoning_effort: reasoningEffort,
    });

    const attempt = async (reasoningEffort, attemptIndex) => {
      const body = makeBody(reasoningEffort);
      const attemptStart = Date.now();
      try {
        const fetchResult = await this.fetchJson(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const { res, json, text, duration_ms } = fetchResult;
        const usage = readUsage(json);
        const msg = extractErrorMessage(json, text);

        if (!res.ok) {
          const err = new Error(`LiteLLM chat completion error: ${msg}`);
          return {
            ok: false,
            error: err,
            message: msg,
            status_code: res.status,
            json,
            usage,
            duration_ms,
            attempt: attemptIndex,
            reasoning_effort: reasoningEffort,
          };
        }

        const responseText = extractResponseText(json);
        return {
          ok: true,
          json,
          text: responseText,
          reasoning_effort: reasoningEffort,
          usage,
          status_code: res.status,
          duration_ms,
          attempt: attemptIndex,
        };
      } catch (err) {
        return {
          ok: false,
          error: err,
          message: err && err.message ? err.message : String(err || 'unknown error'),
          status_code: null,
          json: null,
          usage: null,
          duration_ms: Date.now() - attemptStart,
          attempt: attemptIndex,
          reasoning_effort: reasoningEffort,
        };
      }
    };

    try {
      let result = await attempt(defaultReasoningEffort, 1);
      attemptDetails.push({
        attempt: result.attempt,
        reasoning_effort: result.reasoning_effort,
        status_code: result.status_code,
        ok: result.ok,
        duration_ms: result.duration_ms,
      });
      if (!result.ok) {
        if (defaultReasoningEffort === 'minimal' && isReasoningEffortValidationError(result.message)) {
          result = await attempt('low', 2);
          attemptDetails.push({
            attempt: result.attempt,
            reasoning_effort: result.reasoning_effort,
            status_code: result.status_code,
            ok: result.ok,
            duration_ms: result.duration_ms,
          });
        }
      }

      if (!result.ok) {
        throw result.error || new Error(result.message || 'LiteLLM chat completion failed');
      }

      this.logSuccess(
        'chat.completions',
        {
          model,
          prompt_chars: prompt.length,
        },
        {
          response_chars: String(result.text || '').length,
        },
        withCallMetadata({
          endpoint: 'chat.completions',
          reasoning_effort: result.reasoning_effort,
          attempt_count: attemptDetails.length,
          attempts: attemptDetails,
        }),
        {
          ...buildLlmMetrics(result.json, Date.now() - methodStart, result.usage),
          ...result.usage,
        },
        result.usage
      );

      return { response: result.json, text: result.text };
    } catch (err) {
      this.logError(
        'chat.completions',
        {
          model,
          prompt_chars: prompt.length,
        },
        err,
        withCallMetadata({
          endpoint: 'chat.completions',
          attempt_count: attemptDetails.length,
          attempts: attemptDetails,
        }),
        {
          llm_duration_ms: Date.now() - methodStart,
          duration_ms: Date.now() - methodStart,
        }
      );
      throw err;
    }
  }

  async createBatch(requests, opts) {
    const options = opts || {};
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error('LiteLLM createBatch requires a non-empty requests array');
    }

    const model = options.model || getDefaultBatchModel();
    const requestModel = options.request_model || getDefaultBatchRequestModel(model);
    if (!requestModel) {
      throw new Error(
        'LiteLLM createBatch requires provider model for JSONL body; set T1_BATCH_REQUEST_MODEL (e.g. gpt-5-nano) or pass options.request_model'
      );
    }
    const instructions = options.systemPrompt || this.systemPrompt;
    const completion_window = options.completion_window || '24h';
    const reasoningEffort = getReasoningEffort();
    const methodStart = Date.now();

    for (const r of requests) {
      if (!r || !r.custom_id || !r.prompt) {
        throw new Error('Batch request requires custom_id and prompt');
      }
    }

    const createAttempt = async (modelName, attemptIndex) => {
      const jsonl = requests.map((r) => JSON.stringify({
        custom_id: r.custom_id,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model: requestModel,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: r.prompt },
          ],
          reasoning_effort: reasoningEffort,
        },
      })).join('\n');

      const form = new FormData();
      form.append('purpose', 'batch');
      form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');

      const uploadUrl = `${this.baseUrl}/files`;
      let upload;
      try {
        upload = await this.fetchJson(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'x-litellm-model': modelName,
          },
          body: form,
        });
      } catch (err) {
        this.logError(
          'files.upload',
          {
            model: modelName,
            request_model: requestModel,
            attempt: attemptIndex,
            request_count: requests.length,
            completion_window,
          },
          err,
          {
            endpoint: 'files',
          }
        );
        throw err;
      }

      if (!upload.res.ok) {
        const msg = withBatchFilesHint(
          extractErrorMessage(upload.json, upload.text),
          this.baseUrl
        );
        const err = new Error(`LiteLLM file upload error: ${msg}`);
        this.logError(
          'files.upload',
          {
            model: modelName,
            request_model: requestModel,
            attempt: attemptIndex,
            request_count: requests.length,
            completion_window,
          },
          err,
          {
            endpoint: 'files',
            status_code: upload.res.status,
            response_preview: truncate(msg, 350),
          },
          {
            llm_duration_ms: upload.duration_ms,
            duration_ms: upload.duration_ms,
          }
        );
        throw err;
      }

      const fileId = upload.json && upload.json.id;
      this.logSuccess(
        'files.upload',
        {
          model: modelName,
          request_model: requestModel,
          attempt: attemptIndex,
          request_count: requests.length,
        },
        {
          file_id: fileId || null,
        },
        {
          endpoint: 'files',
          status_code: upload.res.status,
        },
        {
          llm_duration_ms: upload.duration_ms,
          duration_ms: upload.duration_ms,
          input_jsonl_bytes: Buffer.byteLength(jsonl, 'utf8'),
        }
      );

      const batchUrl = `${this.baseUrl}/batches`;
      let batchCreate;
      try {
        batchCreate = await this.fetchJson(batchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'x-litellm-model': modelName,
          },
          body: JSON.stringify({
            input_file_id: fileId,
            endpoint: '/v1/chat/completions',
            completion_window,
            metadata: options.metadata || undefined,
          }),
        });
      } catch (err) {
        this.logError(
          'batches.create',
          {
            model: modelName,
            request_model: requestModel,
            attempt: attemptIndex,
            request_count: requests.length,
            input_file_id: fileId,
            completion_window,
          },
          err,
          {
            endpoint: 'batches',
          }
        );
        throw err;
      }

      if (!batchCreate.res.ok) {
        const msg = extractErrorMessage(batchCreate.json, batchCreate.text);
        const err = new Error(`LiteLLM batch create error: ${msg}`);
        this.logError(
          'batches.create',
          {
            model: modelName,
            request_model: requestModel,
            attempt: attemptIndex,
            request_count: requests.length,
            input_file_id: fileId,
            completion_window,
          },
          err,
          {
            endpoint: 'batches',
            status_code: batchCreate.res.status,
            response_preview: truncate(msg, 350),
          },
          {
            llm_duration_ms: batchCreate.duration_ms,
            duration_ms: batchCreate.duration_ms,
          }
        );
        throw err;
      }

      const batch = batchCreate.json || {};
      this.logSuccess(
        'batches.create',
        {
          model: modelName,
          request_model: requestModel,
          attempt: attemptIndex,
          request_count: requests.length,
          input_file_id: fileId,
          completion_window,
        },
        {
          batch_id: batch.id || null,
          status: batch.status || null,
        },
        {
          endpoint: 'batches',
          status_code: batchCreate.res.status,
          reasoning_effort: reasoningEffort,
        },
        {
          llm_duration_ms: batchCreate.duration_ms,
          duration_ms: batchCreate.duration_ms,
        }
      );

      return {
        batch,
        input_file_id: fileId,
        model_used: modelName,
        request_model_used: requestModel,
      };
    };

    let attempt;
    try {
      attempt = await createAttempt(model, 1);
    } catch (err) {
      const isBatchUnsupported = isBatchModelUnsupportedMessage(err && err.message);
      if (isBatchUnsupported) {
        this.logError(
          'batches.create.model_unsupported',
          {
            model,
            request_count: requests.length,
          },
          err,
          {
            endpoint: 'batches',
            requested_batch_model: model,
            requested_provider_model: requestModel,
            t1_batch_model: getLiteLLMSettings().batchModel,
            t1_batch_default_model: getLiteLLMSettings().batchDefaultModel,
            t1_batch_request_model: getLiteLLMSettings().batchRequestModel,
          }
        );
      }
      throw err;
    }

    const batch = attempt.batch;
    const fileId = attempt.input_file_id;
    const finalModel = attempt.model_used;
    const finalRequestModel = attempt.request_model_used;

    this.logSuccess(
      'createBatch',
      {
        model: finalModel,
        request_model: finalRequestModel,
        request_count: requests.length,
      },
      {
        batch_id: batch.id || null,
        input_file_id: fileId || null,
      },
      {
        endpoint: 'files+batches',
      },
      {
        llm_duration_ms: Date.now() - methodStart,
        duration_ms: Date.now() - methodStart,
      }
    );

    return { batch, input_file_id: fileId };
  }

  async retrieveBatch(batchId) {
    const id = String(batchId || '').trim();
    if (!id) throw new Error('LiteLLM retrieveBatch requires batchId');

    const endpoint = `${this.baseUrl}/batches/${encodeURIComponent(id)}`;
    const methodStart = Date.now();

    let fetchResult;
    try {
      fetchResult = await this.fetchJson(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
    } catch (err) {
      this.logError(
        'batches.retrieve',
        {
          batch_id: id,
        },
        err,
        {
          endpoint: 'batches.retrieve',
        }
      );
      throw err;
    }

    if (!fetchResult.res.ok) {
      const msg = extractErrorMessage(fetchResult.json, fetchResult.text);
      const err = new Error(`LiteLLM batch retrieve error: ${msg}`);
      this.logError(
        'batches.retrieve',
        {
          batch_id: id,
        },
        err,
        {
          endpoint: 'batches.retrieve',
          status_code: fetchResult.res.status,
          response_preview: truncate(msg, 350),
        },
        {
          llm_duration_ms: fetchResult.duration_ms,
          duration_ms: fetchResult.duration_ms,
        }
      );
      throw err;
    }

    const batch = fetchResult.json || {};
    this.logSuccess(
      'batches.retrieve',
      {
        batch_id: id,
      },
      {
        batch_id: batch.id || null,
        status: batch.status || null,
        output_file_id: batch.output_file_id || null,
        error_file_id: batch.error_file_id || null,
      },
      {
        endpoint: 'batches.retrieve',
        status_code: fetchResult.res.status,
      },
      {
        llm_duration_ms: Date.now() - methodStart,
        duration_ms: Date.now() - methodStart,
      }
    );

    return batch;
  }

  async getFileContent(fileId) {
    const id = String(fileId || '').trim();
    if (!id) throw new Error('LiteLLM getFileContent requires fileId');

    const endpoint = `${this.baseUrl}/files/${encodeURIComponent(id)}/content`;
    const methodStart = Date.now();

    let fetchResult;
    try {
      fetchResult = await this.fetchText(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
    } catch (err) {
      this.logError(
        'files.content',
        {
          file_id: id,
        },
        err,
        {
          endpoint: 'files.content',
        }
      );
      throw err;
    }

    if (!fetchResult.res.ok) {
      const msg = String(fetchResult.text || '').trim() || 'unknown error';
      const err = new Error(`LiteLLM file content error: ${msg}`);
      this.logError(
        'files.content',
        {
          file_id: id,
        },
        err,
        {
          endpoint: 'files.content',
          status_code: fetchResult.res.status,
          response_preview: truncate(msg, 350),
        },
        {
          llm_duration_ms: fetchResult.duration_ms,
          duration_ms: fetchResult.duration_ms,
        }
      );
      throw err;
    }

    this.logSuccess(
      'files.content',
      {
        file_id: id,
      },
      {
        bytes: Buffer.byteLength(fetchResult.text || '', 'utf8'),
      },
      {
        endpoint: 'files.content',
        status_code: fetchResult.res.status,
      },
      {
        llm_duration_ms: Date.now() - methodStart,
        duration_ms: Date.now() - methodStart,
      }
    );

    return fetchResult.text;
  }
}

module.exports = {
  LiteLLMClient,
  DEFAULT_SYSTEM_PROMPT,
  extractResponseText,
};
