'use strict';

const { getBraintrustLogger } = require('./observability.js');

const DEFAULT_SYSTEM_PROMPT =
  'You are a careful extraction assistant. Return only valid JSON matching the requested schema.';

function requireApiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    throw new Error('OPENAI_API_KEY is required');
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
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

class OpenAIClient {
  constructor(opts) {
    const options = opts || {};
    this.apiKey = requireApiKey();
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
    this.model = options.model || 'gpt5nano';
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.logger = getBraintrustLogger();
  }

  async sendMessage(userPrompt, opts) {
    const options = opts || {};
    const prompt = String(userPrompt || '');
    if (!prompt.trim()) {
      throw new Error('OpenAI sendMessage requires non-empty prompt');
    }

    const model = options.model || this.model;
    const instructions = options.systemPrompt || this.systemPrompt;
    const input = prompt;

    const body = {
      model,
      instructions,
      input,
    };

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json && (json.error?.message || json.message || JSON.stringify(json));
        throw new Error(`OpenAI error: ${msg}`);
      }

      const text = extractResponseText(json);
      const duration_ms = Date.now() - start;
      this.logger.log({
        input: { model, prompt },
        output: { text },
        metadata: { source: 'openai', endpoint: 'responses' },
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
        metadata: { source: 'openai', endpoint: 'responses' },
        metrics: { duration_ms },
      });
      throw err;
    }
  }

  async createBatch(requests, opts) {
    const options = opts || {};
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error('OpenAI createBatch requires a non-empty requests array');
    }

    const model = options.model || this.model;
    const instructions = options.systemPrompt || this.systemPrompt;
    const completion_window = options.completion_window || '24h';

    const jsonl = requests.map((r) => {
      if (!r || !r.custom_id || !r.prompt) {
        throw new Error('Batch request requires custom_id and prompt');
      }
      return JSON.stringify({
        custom_id: r.custom_id,
        method: 'POST',
        url: '/v1/responses',
        body: {
          model,
          instructions,
          input: r.prompt,
        },
      });
    }).join('\n');

    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');

    const uploadStart = Date.now();
    const uploadRes = await fetch(`${this.baseUrl}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });
    const uploadJson = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      const msg = uploadJson && (uploadJson.error?.message || uploadJson.message || JSON.stringify(uploadJson));
      throw new Error(`OpenAI file upload error: ${msg}`);
    }
    const fileId = uploadJson.id;

    const batchStart = Date.now();
    const batchRes = await fetch(`${this.baseUrl}/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input_file_id: fileId,
        endpoint: '/v1/responses',
        completion_window,
        metadata: options.metadata || undefined,
      }),
    });
    const batchJson = await batchRes.json().catch(() => ({}));
    if (!batchRes.ok) {
      const msg = batchJson && (batchJson.error?.message || batchJson.message || JSON.stringify(batchJson));
      throw new Error(`OpenAI batch create error: ${msg}`);
    }

    this.logger.log({
      input: { model, request_count: requests.length },
      output: { batch_id: batchJson.id, input_file_id: fileId },
      metadata: { source: 'openai', endpoint: 'batches' },
      metrics: {
        upload_ms: Date.now() - uploadStart,
        batch_ms: Date.now() - batchStart,
      },
    });

    return { batch: batchJson, input_file_id: fileId };
  }

  async retrieveBatch(batchId) {
    const id = String(batchId || '').trim();
    if (!id) throw new Error('OpenAI retrieveBatch requires batchId');

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/batches/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json && (json.error?.message || json.message || JSON.stringify(json));
        throw new Error(`OpenAI batch retrieve error: ${msg}`);
      }

      this.logger.log({
        input: { batch_id: id },
        output: {
          batch_id: json.id,
          status: json.status,
          output_file_id: json.output_file_id || null,
          error_file_id: json.error_file_id || null,
        },
        metadata: { source: 'openai', endpoint: 'batches.retrieve' },
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
        metadata: { source: 'openai', endpoint: 'batches.retrieve' },
        metrics: { duration_ms: Date.now() - start },
      });
      throw err;
    }
  }

  async getFileContent(fileId) {
    const id = String(fileId || '').trim();
    if (!id) throw new Error('OpenAI getFileContent requires fileId');

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/files/${encodeURIComponent(id)}/content`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`OpenAI file content error: ${text || 'unknown error'}`);
      }

      this.logger.log({
        input: { file_id: id },
        output: { bytes: Buffer.byteLength(text || '', 'utf8') },
        metadata: { source: 'openai', endpoint: 'files.content' },
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
        metadata: { source: 'openai', endpoint: 'files.content' },
        metrics: { duration_ms: Date.now() - start },
      });
      throw err;
    }
  }
}

module.exports = {
  OpenAIClient,
  DEFAULT_SYSTEM_PROMPT,
  extractResponseText,
};
