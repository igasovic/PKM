'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();
  const event = ($json && $json.normalized_event) || null;
  if (!event || $json.status !== 'ready_to_create') {
    throw new Error('expected status=ready_to_create with normalized_event');
  }

  const block = event.block_window || {};
  const startDate = asText(block.start_date_local || event.date_local);
  const startTime = asText(block.start_time_local || event.start_time_local);
  const endDate = asText(block.end_date_local || event.end_date_local);
  const endTime = asText(block.end_time_local || event.end_time_local);

  if (!startDate || !startTime || !endDate || !endTime) {
    throw new Error('normalized event block window is incomplete');
  }

  const calendarId = asText($json.family_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id)) || 'primary';
  const requestId = asText($json.request_id);
  const chatId = asText($json.telegram_chat_id);
  const messageId = asText($json.telegram_message_id);
  const subjectCode = asText(event.subject_code || event.title);

  const startLocal = `${startDate}T${startTime}:00`;
  const endLocal = `${endDate}T${endTime}:00`;
  const location = asText(event.location) || null;

  const descriptionParts = [
    `PKM request id: ${requestId || '-'}`,
    `PKM source key: tgcal:${chatId || '-'}:${messageId || '-'}`,
    `Original start: ${event.original_start && event.original_start.date_local ? `${event.original_start.date_local} ${event.original_start.time_local || ''}`.trim() : '-'}`,
  ];

  return [{
    json: {
      ...$json,
      request_id: requestId,
      google_calendar_id: calendarId,
      google_start: startLocal,
      google_end: endLocal,
      google_summary: subjectCode,
      google_description: descriptionParts.join('\n'),
      google_location: location,
      google_color_id: asText(event.color_choice && event.color_choice.google_color_id) || null,
      confirmation_subject: subjectCode,
      confirmation_block_start: `${startDate} ${startTime}`,
      confirmation_block_end: `${endDate} ${endTime}`,
    },
  }];
};
