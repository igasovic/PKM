'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const status = asText($json.status || $json.final_status || $json.request_status);
  const success = status === 'calendar_created' || $json.success === true;
  const chatId = asText($json.telegram_chat_id || ($json.message && $json.message.chat && $json.message.chat.id));

  let telegramMessage = '';
  if (success) {
    const subject = asText($json.confirmation_subject || ($json.normalized_event && $json.normalized_event.subject_code) || 'Event');
    const start = asText($json.confirmation_block_start || (($json.normalized_event && $json.normalized_event.block_window)
      ? `${$json.normalized_event.block_window.start_date_local} ${$json.normalized_event.block_window.start_time_local}`
      : ''));
    const end = asText($json.confirmation_block_end || (($json.normalized_event && $json.normalized_event.block_window)
      ? `${$json.normalized_event.block_window.end_date_local} ${$json.normalized_event.block_window.end_time_local}`
      : ''));

    telegramMessage = `Calendar event created.\n${subject}\n${start} -> ${end}`.trim();
  } else {
    const errorMessage = asText($json.error && $json.error.message)
      || asText($json.message)
      || 'Calendar event could not be created. Please retry.';
    telegramMessage = `Calendar event failed.\n${errorMessage}`;
  }

  return [{
    json: {
      ...$json,
      telegram_chat_id: chatId,
      telegram_message: telegramMessage,
    },
  }];
};
