'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

module.exports = async function run(ctx) {
  const row = (ctx && ctx.$json && typeof ctx.$json === 'object') ? ctx.$json : {};
  const message = row.message && typeof row.message === 'object' ? row.message : {};

  const runId = asText(row.run_id || row.execution_id || row.workflow_run_id) || null;
  const chatId = asText(row.telegram_chat_id || (message.chat && message.chat.id) || (ctx && ctx.$env && ctx.$env.TELEGRAM_ADMIN_CHAT_ID)) || null;
  const now = asText(row.now) || null;

  return [{
    json: {
      ...row,
      run_id: runId,
      telegram_chat_id: chatId,
      now,
    },
  }];
};
