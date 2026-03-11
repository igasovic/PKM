'use strict';

const { extractResponseText } = require('../litellm-client.js');
const { buildDirectDistillPrompt } = require('./prompts.js');
const { parseTier2FinalOutput } = require('./parsing-validation.js');

function parseJsonl(text) {
  const rows = [];
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch (_err) {
      rows.push({ parse_error: true, raw_line: line });
    }
  }
  return rows;
}

function normalizeCode(value, fallback) {
  const code = String(value || '').trim().toLowerCase();
  return code || String(fallback || 'error').trim().toLowerCase();
}

function extractProviderErrorCode(row) {
  const code = row && (
    (row.error && row.error.code) ||
    (row.response && row.response.error && row.response.error.code) ||
    (row.response && row.response.body && row.response.body.error && row.response.body.error.code)
  );
  return normalizeCode(code, 'provider_error');
}

function extractProviderErrorMessage(row) {
  const message = row && (
    (row.error && row.error.message) ||
    (row.response && row.response.error && row.response.error.message) ||
    (row.response && row.response.body && row.response.body.error && row.response.body.error.message)
  );
  const out = String(message || '').trim();
  return out || 'batch item failed';
}

function mapBatchLineToResult(row) {
  const customId = String(row && row.custom_id ? row.custom_id : '').trim();
  if (!customId) return null;

  const responseBody = row && row.response && row.response.body;
  const statusCode = row && row.response && row.response.status_code;
  const isHttpOk = Number(statusCode) >= 200 && Number(statusCode) < 300;

  if (isHttpOk && responseBody) {
    const text = extractResponseText(responseBody);
    try {
      const parsed = parseTier2FinalOutput(text);
      return {
        custom_id: customId,
        status: 'ok',
        response_text: text,
        parsed,
        error: null,
        raw: row,
      };
    } catch (err) {
      return {
        custom_id: customId,
        status: 'parse_error',
        response_text: text || null,
        parsed: null,
        error: {
          code: 'parse_error',
          message: err && err.message ? err.message : 'invalid model output',
        },
        raw: row,
      };
    }
  }

  return {
    custom_id: customId,
    status: 'error',
    response_text: null,
    parsed: null,
    error: {
      code: extractProviderErrorCode(row),
      message: extractProviderErrorMessage(row),
      status_code: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    },
    raw: row,
  };
}

function rankStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'ok') return 3;
  if (s === 'parse_error') return 2;
  if (s === 'error') return 1;
  return 0;
}

function mergeResultRows(rows) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.custom_id) continue;
    const existing = byId.get(row.custom_id);
    if (!existing || rankStatus(row.status) > rankStatus(existing.status)) {
      byId.set(row.custom_id, row);
    }
  }
  return Array.from(byId.values());
}

function buildBatchRequests(rows, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const retryCount = Number.isFinite(Number(options.retry_count)) ? Math.max(0, Math.trunc(Number(options.retry_count))) : 0;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    throw new Error('tier2 batch enqueue requires at least one row');
  }

  return list.map((row, idx) => {
    const entryId = Number(row && row.entry_id);
    if (!Number.isFinite(entryId) || entryId <= 0) {
      throw new Error(`tier2 batch item ${idx} missing entry_id`);
    }

    const cleanText = String(row && row.clean_text ? row.clean_text : '').trim();
    if (!cleanText) {
      throw new Error(`tier2 batch item ${idx} missing clean_text`);
    }

    const prompt = buildDirectDistillPrompt({
      title: row && row.title ? row.title : null,
      author: row && row.author ? row.author : null,
      clean_text: cleanText,
    });

    const route = String((row && row.route) || 'direct').trim().toLowerCase();
    const chunkingStrategy = String((row && row.chunking_strategy) || (route === 'chunked' ? 'structure_paragraph_window_v1' : 'direct')).trim();
    const promptMode = route === 'chunked' ? 'chunked_fallback_direct' : 'direct';

    return {
      custom_id: `entry_${entryId}`,
      entry_id: entryId,
      content_hash: row && row.content_hash ? String(row.content_hash) : null,
      route,
      chunking_strategy: chunkingStrategy,
      request_type: 'batch_direct_generation',
      title: row && row.title ? row.title : null,
      author: row && row.author ? row.author : null,
      content_type: row && row.content_type ? row.content_type : 'newsletter',
      prompt_mode: promptMode,
      prompt: prompt.userPrompt,
      retry_count: Number.isFinite(Number(row && row.retry_count))
        ? Math.max(0, Math.trunc(Number(row.retry_count)))
        : retryCount,
    };
  });
}

module.exports = {
  parseJsonl,
  mapBatchLineToResult,
  mergeResultRows,
  buildBatchRequests,
};
