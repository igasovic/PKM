'use strict';

const { buildContextPackMarkdown } = require('@igasovic/n8n-blocks/shared/context-pack-builder.js');

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

function normalizePullRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) return payload.rows;
  if (payload && typeof payload === 'object') {
    // /db/read/pull can return a single row object as one item.
    if (payload.entry_id !== undefined || payload.id !== undefined) return [payload];
  }
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

  let method = 'pull';
  let outcome = 'no_result';
  let rows = [];
  let queryText = '';
  let error = null;

  if (payload && typeof payload === 'object' && payload.action === 'chatgpt_read' && payload.method === 'pull_working_memory') {
    method = 'working_memory';
    outcome = String(payload.outcome || '').trim().toLowerCase() || 'no_result';
    const row = payload.result && payload.result.row ? payload.result.row : null;
    const found = payload.result && payload.result.meta && Object.prototype.hasOwnProperty.call(payload.result.meta, 'found')
      ? !!payload.result.meta.found
      : !!row;
    rows = row && found ? [row] : [];
    queryText = String((payload.result && payload.result.meta && payload.result.meta.topic) || '').trim();
    if (outcome === 'failure') {
      error = payload.error || { message: 'working_memory_failed' };
    } else if (!found) {
      outcome = 'no_result';
    }
  } else {
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

    const allRows = normalizePullRows(payload).filter((row) => !(row && typeof row === 'object' && row.is_meta === true));
    const hasFoundFlag = allRows.length > 0 && allRows[0] && Object.prototype.hasOwnProperty.call(allRows[0], 'found');
    const found = hasFoundFlag
      ? !!allRows[0].found
      : allRows.length > 0;
    rows = found ? allRows : [];
    outcome = found ? 'success' : 'no_result';
    queryText = allRows.length > 0 && allRows[0] && allRows[0].entry_id !== undefined ? String(allRows[0].entry_id) : '';
  }

  const contextPackMarkdown = buildContextPackMarkdown(
    rows,
    {
      method,
      query: queryText,
      days: null,
      limit: null,
    },
    {
      markdownV2: false,
      layout: 'ui',
      maxContentLen: 1200,
    },
  );

  return [{
    json: {
      response_payload: {
        ok: outcome !== 'failure',
        action: 'chatgpt_read',
        method,
        outcome,
        no_result: outcome === 'no_result',
        context_pack_markdown: contextPackMarkdown,
        result: {
          meta: {
            method,
            query_text: queryText || null,
            found: rows.length > 0,
            row_count: rows.length,
          },
          rows,
        },
        error,
      },
      http_status: outcome === 'failure' ? 400 : 200,
    },
  }];
};
