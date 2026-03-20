'use strict';

const { buildContextPackMarkdown } = require('@igasovic/n8n-blocks/shared/context-pack-builder.js');
const { mdv2Render } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $input } = ctx;
  const rows = $input.all().map((item) => item.json);
  const meta = rows.find((row) => row.is_meta === true) || {};
  const hitsRows = rows.filter((row) => row.is_meta === false && row.id);
  const method = String(meta.cmd || 'last').toLowerCase();
  const query = String(meta.query_text || '').trim();

  const msg = buildContextPackMarkdown(
    hitsRows,
    {
      method,
      query,
      days: meta.days,
      limit: meta.limit,
    },
    {
      markdownV2: true,
      layout: 'ui',
      maxContentLen: 300,
    },
  );

  return [{ json: { telegram_message: mdv2Render(msg, { maxLen: 3500 }) } }];
};

