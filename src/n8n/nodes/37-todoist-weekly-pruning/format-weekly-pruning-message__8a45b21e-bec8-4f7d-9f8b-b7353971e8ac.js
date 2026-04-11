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

  const suggestions = Array.isArray(row.suggestions) ? row.suggestions : [];
  const lines = [];
  lines.push('Todoist Weekly Pruning');
  lines.push('');

  if (!suggestions.length) {
    lines.push('No weekly pruning suggestions.');
  } else {
    for (const item of suggestions.slice(0, 15)) {
      const recommendation = asText(item.recommendation_type) || 'review';
      lines.push(`- [${recommendation}] ${titleOf(item)}`);
    }
  }

  return [{
    json: {
      ...row,
      telegram_message: mdv2Message(lines.join('\n').trim(), { maxLen: 4000 }),
    },
  }];
};
