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

  const nudges = Array.isArray(row.nudges) ? row.nudges : [];
  const lines = [];
  lines.push('Todoist Waiting Radar');
  lines.push('');
  if (!nudges.length) {
    lines.push('No waiting nudges right now.');
  } else {
    for (const item of nudges.slice(0, 12)) {
      lines.push(`- ${titleOf(item)}`);
    }
  }

  return [{
    json: {
      ...row,
      telegram_message: mdv2Message(lines.join('\n').trim(), { maxLen: 4000 }),
    },
  }];
};
