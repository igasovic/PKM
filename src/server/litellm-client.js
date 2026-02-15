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
    tokensRaw ?? (Number.isFinite(prompt_tokens) && Number.isFinite(completion_tokens)
      ? prompt_tokens + completion_tokens
      : 0)
  );
  return {
    prompt_tokens: Number.isFinite(prompt_tokens) ? prompt_tokens : undefined,
    completion_tokens: Number.isFinite(completion_tokens) ? completion_tokens : undefined,
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

class LiteLLMClient {
  constructor(opts) {
    const options = opts || {};
    this.apiKey = requireApiKey();
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || 'http://litellm:4000/v1';
    this.model = options.model || process.env.T1_DEFAULT_MODEL || 't1-default';
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.logger = getBraintrustLogger();
  }

  async sendMessage(userPrompt, opts) {
    const options = opts || {};
    const prompt = String(userPrompt || '');
    if (!prompt.trim()) {
      throw new Error('LiteLLM sendMessage requires non-empty prompt');
    }

    const model = options.model || this.model;
    const instructions = options.systemPrompt || this.systemPrompt;
    const input = prompt;

    const body = {
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input },
      ],
    };

    const start = Date.now();
    try {
      const endpoint = `${this.baseUrl}/chat/completions`;
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(requestTimeoutMs()),
        });
      } catch (fetchErr) {
        throw formatFetchError(fetchErr, endpoint, 'POST');
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json && (json.error?.message || json.message || JSON.stringify(json));
        throw new Error(`LiteLLM chat completion error: ${msg}`);
      }

      const text = extractResponseText(json);
      const duration_ms = Date.now() - start;
      this.logger.log({
        input: { model, prompt },
        output: { text },
        metadata: { source: 'litellm', endpoint: 'chat.completions', model },
        metrics: {
          duration_ms,
          ...readUsage(json),
        },
      });

      return { response: json, text };
    } catch (err) {
      const duration_ms = Date.now() - start;
      this.logger.log({
        input: { model, prompt },
        error: {
          name: err && err.name,
          message: err && err.message,
          stack: err && err.stack,
        },
        metadata: { source: 'litellm', endpoint: 'chat.completions' },
        metrics: { duration_ms },
      });
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
        },
      });
    }).join('\n');

    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');

    const uploadStart = Date.now();
    const uploadUrl = `${this.baseUrl}/files`;
    let uploadRes;
    try {
      uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (fetchErr) {
      throw formatFetchError(fetchErr, uploadUrl, 'POST');
    }
    const uploadJson = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      const msg = uploadJson && (uploadJson.error?.message || uploadJson.message || JSON.stringify(uploadJson));
      throw new Error(`LiteLLM file upload error: ${msg}`);
    }
    const fileId = uploadJson.id;

    const batchStart = Date.now();
    const batchUrl = `${this.baseUrl}/batches`;
    let batchRes;
    try {
      batchRes = await fetch(batchUrl, {
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
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (fetchErr) {
      throw formatFetchError(fetchErr, batchUrl, 'POST');
    }
    const batchJson = await batchRes.json().catch(() => ({}));
    if (!batchRes.ok) {
      const msg = batchJson && (batchJson.error?.message || batchJson.message || JSON.stringify(batchJson));
      throw new Error(`LiteLLM batch create error: ${msg}`);
    }

    this.logger.log({
      input: { model, request_count: requests.length },
      output: { batch_id: batchJson.id, input_file_id: fileId },
      metadata: { source: 'litellm', endpoint: 'batches' },
      metrics: {
        upload_ms: Date.now() - uploadStart,
        batch_ms: Date.now() - batchStart,
      },
    });

    return { batch: batchJson, input_file_id: fileId };
  }

  async retrieveBatch(batchId) {
    const id = String(batchId || '').trim();
    if (!id) throw new Error('LiteLLM retrieveBatch requires batchId');

    const start = Date.now();
    try {
      const endpoint = `${this.baseUrl}/batches/${encodeURIComponent(id)}`;
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(requestTimeoutMs()),
        });
      } catch (fetchErr) {
        throw formatFetchError(fetchErr, endpoint, 'GET');
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json && (json.error?.message || json.message || JSON.stringify(json));
        throw new Error(`LiteLLM batch retrieve error: ${msg}`);
      }

      this.logger.log({
        input: { batch_id: id },
        output: {
          batch_id: json.id,
          status: json.status,
          output_file_id: json.output_file_id || null,
          error_file_id: json.error_file_id || null,
        },
        metadata: { source: 'litellm', endpoint: 'batches.retrieve' },
        metrics: { duration_ms: Date.now() - start },
      });
      return json;
    } catch (err) {
      this.logger.log({
        input: { batch_id: id },
        error: {
          name: err && err.name,
          message: err && err.message,
          stack: err && err.stack,
        },
        metadata: { source: 'litellm', endpoint: 'batches.retrieve' },
        metrics: { duration_ms: Date.now() - start },
      });
      throw err;
    }
  }

  async getFileContent(fileId) {
    const id = String(fileId || '').trim();
    if (!id) throw new Error('LiteLLM getFileContent requires fileId');

    const start = Date.now();
    try {
      const endpoint = `${this.baseUrl}/files/${encodeURIComponent(id)}/content`;
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(requestTimeoutMs()),
        });
      } catch (fetchErr) {
        throw formatFetchError(fetchErr, endpoint, 'GET');
      }
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`LiteLLM file content error: ${text || 'unknown error'}`);
      }

      this.logger.log({
        input: { file_id: id },
        output: { bytes: Buffer.byteLength(text || '', 'utf8') },
        metadata: { source: 'litellm', endpoint: 'files.content' },
        metrics: { duration_ms: Date.now() - start },
      });
      return text;
    } catch (err) {
      this.logger.log({
        input: { file_id: id },
        error: {
          name: err && err.name,
          message: err && err.message,
          stack: err && err.stack,
        },
        metadata: { source: 'litellm', endpoint: 'files.content' },
        metrics: { duration_ms: Date.now() - start },
      });
      throw err;
    }
  }
}

module.exports = {
  LiteLLMClient,
  DEFAULT_SYSTEM_PROMPT,
  extractResponseText,
};
