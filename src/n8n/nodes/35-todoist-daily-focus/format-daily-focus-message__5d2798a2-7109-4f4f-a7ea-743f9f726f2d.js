'use strict';

const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function titleOf(item) {
  return asText(item && (item.normalized_title_en || item.raw_title)) || 'Untitled task';
}

module.exports = async function run(ctx) {
  const row = (ctx && ctx.$json && typeof ctx.$json === 'object') ? ctx.$json : {};
  const message = asText(row.telegram_message);

  if (message) {
    return [{ json: { ...row, telegram_message: mdv2Message(message, { maxLen: 4000 }) } }];
  }

  const top3 = Array.isArray(row.top_3) ? row.top_3 : [];
  const overdue = Array.isArray(row.overdue_now) ? row.overdue_now : [];
  const waiting = Array.isArray(row.waiting_nudges) ? row.waiting_nudges : [];

  const lines = [];
  lines.push('Todoist Daily Focus');
  lines.push('');
  lines.push('Top 3');
  if (!top3.length) lines.push('- none');
  for (const item of top3.slice(0, 3)) {
    lines.push(`- ${titleOf(item)}`);
  }

  lines.push('');
  lines.push('Overdue Now');
  if (!overdue.length) lines.push('- none');
  for (const item of overdue.slice(0, 5)) {
    lines.push(`- ${titleOf(item)}`);
  }

  lines.push('');
  lines.push('Waiting Nudges');
  if (!waiting.length) lines.push('- none');
  for (const item of waiting.slice(0, 8)) {
    lines.push(`- ${titleOf(item)}`);
  }

  return [{
    json: {
      ...row,
      telegram_message: mdv2Message(lines.join('\n').trim(), { maxLen: 4000 }),
    },
  }];
};
