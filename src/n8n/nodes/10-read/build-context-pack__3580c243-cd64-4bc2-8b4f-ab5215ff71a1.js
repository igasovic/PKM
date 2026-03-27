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

  const truncated = mdv2Render(msg, { maxLen: 3500 });
  const chars = Array.from(truncated);
  let unescapedStarCount = 0;
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== '*') continue;
    let slashCount = 0;
    for (let j = i - 1; j >= 0 && chars[j] === '\\'; j -= 1) slashCount += 1;
    if (slashCount % 2 === 0) unescapedStarCount += 1;
  }
  if (unescapedStarCount % 2 === 0) {
    return [{ json: { telegram_message: truncated } }];
  }
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (chars[i] !== '*') continue;
    let slashCount = 0;
    for (let j = i - 1; j >= 0 && chars[j] === '\\'; j -= 1) slashCount += 1;
    if (slashCount % 2 !== 0) continue;
    chars.splice(i, 1);
    break;
  }

  return [{ json: { telegram_message: chars.join('') } }];
};
