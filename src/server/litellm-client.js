'use strict';

const { getBraintrustLogger } = require('./observability.js');

const DEFAULT_SYSTEM_PROMPT =
  '\
You are a precise metadata extraction engine for a personal knowledge base.\
Return ONLY valid JSON that matches the requested schema.\
Do not include markdown, comments, or any extra text.\
Be conservative: if unsure, lower confidence and use "other" for primary topic.';

function requireApiKey() {
  const key = process.env.LITELLM_MASTER_KEY;
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
  const raw = Number(process.env.LITELLM_TIMEOUT_MS || 60_000);
  if (!Number.isFinite(raw) || raw < 1000) return 60_000;
  return raw;
}

function normalizeReasoningEffort(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'minimal' || v === 'low' || v === 'medium' || v === 'high') return v;
  return null;
}

function getReasoningEffort() {
  return normalizeReasoningEffort(process.env.T1_REASONING_EFFORT) || 'minimal';
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
    this.apiKey = requireApiKey();
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'http://litellm:4000/v1';
    this.model = options.model || process.env.T1_DEFAULT_MODEL || 't1-default';
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.logger = getBraintrustLogger();
  }

  logSuccess(op, input, output, metadata, metrics) {
    this.logger.log({
      input,
      output,
      metadata: {
        source: 'litellm',
        op,
        ...(metadata || {}),
      },
      metrics: metrics || undefined,
    });
  }

  logError(op, input, err, metadata, metrics) {
    this.logger.log({
      input,
      error: errorDetails(err),
      metadata: {
        source: 'litellm',
        op,
        ...(metadata || {}),
      },
      metrics: metrics || undefined,
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
    const methodStart = Date.now();

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
      let fetchResult;
      try {
        fetchResult = await this.fetchJson(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (err) {
        this.logError(
          'chat.completions.attempt',
          {
            model,
            attempt: attemptIndex,
            reasoning_effort: reasoningEffort,
            prompt_chars: prompt.length,
          },
          err,
          {
            endpoint: 'chat.completions',
          }
        );
        throw err;
      }

      const { res, json, text, duration_ms } = fetchResult;
      const usage = readUsage(json);
      const msg = extractErrorMessage(json, text);

      if (!res.ok) {
        const err = new Error(`LiteLLM chat completion error: ${msg}`);
        this.logError(
          'chat.completions.attempt',
          {
            model,
            attempt: attemptIndex,
            reasoning_effort: reasoningEffort,
            prompt_chars: prompt.length,
          },
          err,
          {
            endpoint: 'chat.completions',
            status_code: res.status,
            response_preview: truncate(msg, 350),
          },
          {
            duration_ms,
          }
        );
        return {
          ok: false,
          error: err,
          message: msg,
          status_code: res.status,
          json,
        };
      }

      const responseText = extractResponseText(json);
      this.logSuccess(
        'chat.completions.attempt',
        {
          model,
          attempt: attemptIndex,
          reasoning_effort: reasoningEffort,
          prompt_chars: prompt.length,
        },
        {
          response_chars: String(responseText || '').length,
        },
        {
          endpoint: 'chat.completions',
          status_code: res.status,
        },
        {
          duration_ms,
          ...usage,
        }
      );

      return {
        ok: true,
        json,
        text: responseText,
        reasoning_effort: reasoningEffort,
        usage,
      };
    };

    try {
      let result = await attempt(defaultReasoningEffort, 1);
      if (!result.ok) {
        if (defaultReasoningEffort === 'minimal' && isReasoningEffortValidationError(result.message)) {
          result = await attempt('low', 2);
        }
      }

      if (!result.ok) {
        throw result.error;
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
        {
          endpoint: 'chat.completions',
          reasoning_effort: result.reasoning_effort,
        },
        {
          duration_ms: Date.now() - methodStart,
          ...result.usage,
        }
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
        {
          endpoint: 'chat.completions',
        },
        {
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

    const model = options.model || process.env.T1_BATCH_MODEL || this.model;
    const instructions = options.systemPrompt || this.systemPrompt;
    const completion_window = options.completion_window || '24h';
    const reasoningEffort = getReasoningEffort();
    const methodStart = Date.now();

    const jsonl = requests.map((r) => {
      if (!r || !r.custom_id || !r.prompt) {
        throw new Error('Batch request requires custom_id and prompt');
      }
      return JSON.stringify({
        custom_id: r.custom_id,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: r.prompt },
          ],
          reasoning_effort: reasoningEffort,
        },
      });
    }).join('\n');

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
        },
        body: form,
      });
    } catch (err) {
      this.logError(
        'files.upload',
        {
          model,
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
          model,
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
          duration_ms: upload.duration_ms,
        }
      );
      throw err;
    }

    const fileId = upload.json && upload.json.id;
    this.logSuccess(
      'files.upload',
      {
        model,
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
          model,
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
          model,
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
          duration_ms: batchCreate.duration_ms,
        }
      );
      throw err;
    }

    const batch = batchCreate.json || {};
    this.logSuccess(
      'batches.create',
      {
        model,
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
        duration_ms: batchCreate.duration_ms,
      }
    );

    this.logSuccess(
      'createBatch',
      {
        model,
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
