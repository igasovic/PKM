'use strict';

const { buildContextPackMarkdown } = require('@igasovic/n8n-blocks/shared/context-pack-builder.js');

function normalizePullRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const payload = ($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : $json;

  let method = 'pull';
  let outcome = 'no_result';
  let rows = [];
  let queryText = '';
  let error = null;

  if (payload && typeof payload === 'object' && payload.action === 'chatgpt_read' && payload.method === 'pull_working_memory') {
    method = 'working_memory';
    outcome = String(payload.outcome || '').trim().toLowerCase() || 'no_result';
    const row = payload.result && payload.result.row ? payload.result.row : null;
    rows = row ? [row] : [];
    queryText = String((payload.result && payload.result.meta && payload.result.meta.topic) || '').trim();
    if (outcome === 'failure') {
      error = payload.error || { message: 'working_memory_failed' };
    }
  } else {
    rows = normalizePullRows(payload);
    outcome = rows.length > 0 ? 'success' : 'no_result';
    queryText = rows.length > 0 && rows[0] && rows[0].entry_id !== undefined ? String(rows[0].entry_id) : '';
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
  }];
};
