'use strict';

const { createContextPackBuilder } = require('@igasovic/n8n-blocks/shared/context-pack-builder-core.js');
const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
const { buildContextPackMarkdown } = createContextPackBuilder({ mdv2Message });

function resolvePayload(ctx) {
  const inputAll = ctx && ctx.$input && typeof ctx.$input.all === 'function'
    ? ctx.$input.all()
    : null;
  if (Array.isArray(inputAll) && inputAll.length > 0) {
    if (inputAll.length === 1) {
      const one = inputAll[0];
      return (one && typeof one === 'object' && Object.prototype.hasOwnProperty.call(one, 'json'))
        ? one.json
        : one;
    }
    return inputAll.map((item) => (
      item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'json')
        ? item.json
        : item
    ));
  }
  return ctx && Object.prototype.hasOwnProperty.call(ctx, '$json') ? ctx.$json : null;
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function extractHttpError(payload) {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractHttpError(item);
      if (found) return found;
    }
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  const statusRaw = payload.statusCode ?? payload.status ?? payload.http_status;
  const status = Number(statusRaw);
  const safeStatus = Number.isFinite(status) && status >= 400 ? Math.trunc(status) : 502;
  const errorObj = payload.error && typeof payload.error === 'object' ? payload.error : {};
  const message = String(
    payload.message
    || errorObj.message
    || payload.reason
    || payload.description
    || payload.response?.body?.message
    || payload.body?.message
    || '',
  ).trim();
  const hasSignal = Boolean(payload.error || payload.stack || (Number.isFinite(status) && status >= 400));
  if (!hasSignal || !message) return null;

  return {
    http_status: safeStatus,
    code: String(errorObj.code || payload.code || 'backend_error'),
    message,
  };
}

module.exports = async function run(ctx) {
  const payload = resolvePayload(ctx);
  const httpErr = extractHttpError(payload);
  if (httpErr) {
    return [{
      json: {
        response_payload: {
          ok: false,
          action: 'chatgpt_read',
          method: null,
          outcome: 'failure',
          no_result: false,
          context_pack_markdown: null,
          result: null,
          error: {
            code: httpErr.code,
            message: httpErr.message,
          },
        },
        http_status: httpErr.http_status,
      },
    }];
  }

  const rows = normalizeRows(payload);
  const meta = rows.find((row) => row && typeof row === 'object' && row.is_meta === true) || {};
  const hits = rows.filter((row) => !(row && typeof row === 'object' && row.is_meta === true));
  const method = String(meta.cmd || meta.method || 'last').trim().toLowerCase() || 'last';
  const queryText = String(meta.query_text || meta.q || '').trim();

  const contextPackMarkdown = buildContextPackMarkdown(
    hits,
    {
      method,
      query: queryText,
      days: meta.days,
      limit: meta.limit,
    },
    {
      markdownV2: false,
      layout: 'ui',
      maxContentLen: 700,
    },
  );

  return [{
    json: {
      response_payload: {
        ok: true,
        action: 'chatgpt_read',
        method,
        outcome: hits.length > 0 ? 'success' : 'no_result',
        no_result: hits.length === 0,
        context_pack_markdown: contextPackMarkdown,
        result: {
          meta: {
            method,
            query_text: queryText || null,
            days: meta.days ?? null,
            limit: meta.limit ?? null,
            found: hits.length > 0,
            row_count: hits.length,
          },
          rows: hits,
        },
        error: null,
      },
      http_status: 200,
    },
  }];
};
