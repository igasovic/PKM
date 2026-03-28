'use strict';

const { buildContextPackMarkdown } = require('@igasovic/n8n-blocks/shared/context-pack-builder.js');

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const rows = normalizeRows($json);
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
