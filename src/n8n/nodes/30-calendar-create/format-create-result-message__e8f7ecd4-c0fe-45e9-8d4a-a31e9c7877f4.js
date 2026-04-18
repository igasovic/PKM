'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();
  const asArray = (value) => Array.isArray(value) ? value : [];
  const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatClock = (date) => {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    const suffix = hours >= 12 ? 'p' : 'a';
    return `${hour12}:${minutes}${suffix}`;
  };
  const formatDayLabel = (date) => `${WEEKDAY_SHORT[date.getDay()]} ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
  const parseDate = (value) => {
    const dt = new Date(String(value || ''));
    return Number.isNaN(dt.getTime()) ? null : dt;
  };
  
  const status = asText($json.status || $json.final_status || $json.request_status);
  const success = status === 'calendar_created' || $json.success === true;
  const chatId = asText($json.telegram_chat_id || ($json.message && $json.message.chat && $json.message.chat.id));
  
  let telegramMessage = '';
  if (success) {
    const subjectRaw = asText($json.confirmation_subject || ($json.normalized_event && $json.normalized_event.subject_code) || 'Event');
    const startDt = parseDate($json.google_start || $json.confirmation_block_start || (($json.normalized_event && $json.normalized_event.block_window)
      ? `${$json.normalized_event.block_window.start_date_local}T${$json.normalized_event.block_window.start_time_local}:00`
      : ''));
    const endDt = parseDate($json.google_end || $json.confirmation_block_end || (($json.normalized_event && $json.normalized_event.block_window)
      ? `${$json.normalized_event.block_window.end_date_local}T${$json.normalized_event.block_window.end_time_local}:00`
      : ''));
    const timeLine = (startDt && endDt)
      ? `${formatDayLabel(startDt)} ${formatClock(startDt)} -> ${formatClock(endDt)}`
      : asText($json.confirmation_block_start) + ' -> ' + asText($json.confirmation_block_end);

    const lines = ['📅 Event created', subjectRaw, timeLine];

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
  
    telegramMessage = mdv2Message(lines.join('\n').trim(), { maxLen: 4000 });
  } else {
    const errorMessage = asText($json.error && $json.error.message) || asText($json.message) || 'Calendar event could not be created. Please retry.';
    telegramMessage = mdv2Message(['Calendar event failed', errorMessage].join('\n'), { maxLen: 4000 });
  }
  
  return [{ json: { ...$json, telegram_chat_id: chatId, telegram_message: telegramMessage } }];
};
