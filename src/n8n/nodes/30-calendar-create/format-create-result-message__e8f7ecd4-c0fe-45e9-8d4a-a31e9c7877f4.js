'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();
  const asArray = (value) => Array.isArray(value) ? value : [];
  
  const status = asText($json.status || $json.final_status || $json.request_status);
  const success = status === 'calendar_created' || $json.success === true;
  const chatId = asText($json.telegram_chat_id || ($json.message && $json.message.chat && $json.message.chat.id));
  
  let telegramMessage = '';
  if (success) {
    const subjectRaw = asText($json.confirmation_subject || ($json.normalized_event && $json.normalized_event.subject_code) || 'Event');
    const start = asText($json.confirmation_block_start || (($json.normalized_event && $json.normalized_event.block_window)
      ? $json.normalized_event.block_window.start_date_local + ' ' + $json.normalized_event.block_window.start_time_local
      : ''));
    const end = asText($json.confirmation_block_end || (($json.normalized_event && $json.normalized_event.block_window)
      ? $json.normalized_event.block_window.end_date_local + ' ' + $json.normalized_event.block_window.end_time_local
      : ''));
  
    const lines = ['Calendar event created', subjectRaw, start + ' -> ' + end];
  
    const conflictCount = Number($json.conflict_count || 0);
    if (Number.isFinite(conflictCount) && conflictCount > 0) {
      lines.push('Potential conflicts: ' + conflictCount);
      asArray($json.conflict_preview).map(asText).filter(Boolean).slice(0, 3).forEach((entry) => {
        lines.push('- ' + entry);
      });
    }
  
    if (asArray($json.warning_codes).includes('calendar_conflict_check_failed')) {
      lines.push('Conflict check unavailable; event created anyway.');
    }
  
    telegramMessage = mdv2Message(lines.join('\n').trim());
  } else {
    const errorMessage = asText($json.error && $json.error.message) || asText($json.message) || 'Calendar event could not be created. Please retry.';
    telegramMessage = mdv2Message(['Calendar event failed', errorMessage].join('\n'));
  }
  
  return [{ json: { ...$json, telegram_chat_id: chatId, telegram_message: telegramMessage } }];
};
