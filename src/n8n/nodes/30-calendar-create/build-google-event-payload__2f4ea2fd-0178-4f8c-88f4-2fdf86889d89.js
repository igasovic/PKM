'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const parseGmtOffsetMinutes = (token) => {
    const m = String(token || '').match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const hh = Number(m[2] || 0);
    const mm = Number(m[3] || 0);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return sign * (hh * 60 + mm);
  };

  const offsetAtUtcMs = (utcMs, timezone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(utcMs));
    const token = (parts.find((p) => p.type === 'timeZoneName') || {}).value;
    return parseGmtOffsetMinutes(token);
  };

  const formatOffset = (minutes) => {
    const m = Number(minutes || 0);
    const sign = m < 0 ? '-' : '+';
    const abs = Math.abs(m);
    const hh = Math.floor(abs / 60);
    const mm = abs % 60;
    return sign + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };

  const toGoogleDateTime = (dateLocal, timeLocal, timezone) => {
    const dm = String(dateLocal || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tm = String(timeLocal || '').match(/^(\d{2}):(\d{2})$/);
    if (!dm || !tm) return '';

    const y = Number(dm[1]);
    const mo = Number(dm[2]);
    const d = Number(dm[3]);
    const hh = Number(tm[1]);
    const mm = Number(tm[2]);

    const baseUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
    let offset = offsetAtUtcMs(baseUtc, timezone);
    if (!Number.isFinite(offset)) offset = 0;

    let correctedUtc = baseUtc - offset * 60000;
    const correctedOffset = offsetAtUtcMs(correctedUtc, timezone);
    if (Number.isFinite(correctedOffset) && correctedOffset !== offset) {
      offset = correctedOffset;
      correctedUtc = baseUtc - offset * 60000;
    }

    return dateLocal + 'T' + timeLocal + ':00' + formatOffset(offset);
  };

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

  const timezone = asText(event.timezone || ($json.config && $json.config.calendar && $json.config.calendar.timezone)) || 'America/Chicago';
  const calendarTestMode = $json.calendar_test_mode === true;
  const smokeMode = $json.smoke_mode === true;
  const testRunId = asText($json.test_run_id);
  const testCalendarId = asText($json.test_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.test_calendar_id));
  const prodCalendarId = asText($json.prod_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id));
  const configuredCalendarId = asText($json.family_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id)) || 'primary';
  if (calendarTestMode) {
    if (!testCalendarId) throw new Error('calendar_test_mode requires test_calendar_id');
    if (!prodCalendarId) throw new Error('calendar_test_mode requires prod_calendar_id');
    if (testCalendarId === prodCalendarId) {
      throw new Error('calendar_test_mode blocked: test_calendar_id must differ from prod_calendar_id');
    }
  }

  const calendarId = calendarTestMode ? testCalendarId : configuredCalendarId;
  const requestId = asText($json.request_id);
  const chatId = asText($json.telegram_chat_id);
  const messageId = asText($json.telegram_message_id);
  const subjectCode = asText(event.subject_code || event.title);
  const summaryPrefix = calendarTestMode ? ('[SMOKE ' + (testRunId || 'run') + '] ') : '';
  const googleSummary = summaryPrefix + subjectCode;

  const startLocal = toGoogleDateTime(startDate, startTime, timezone);
  const endLocal = toGoogleDateTime(endDate, endTime, timezone);
  const location = asText(event.location) || null;

  const descriptionParts = [
    'PKM request id: ' + (requestId || '-'),
    'PKM source key: tgcal:' + (chatId || '-') + ':' + (messageId || '-'),
    'Original start: ' + (event.original_start && event.original_start.date_local ? (event.original_start.date_local + ' ' + (event.original_start.time_local || '')).trim() : '-'),
  ];
  if (calendarTestMode) descriptionParts.push('SMOKE test run id: ' + (testRunId || '-'));
  if (smokeMode) descriptionParts.push('SMOKE mode: true');

  return [{
    json: {
      ...$json,
      request_id: requestId,
      google_calendar_id: calendarId,
      google_start: startLocal,
      google_end: endLocal,
      google_timezone: timezone,
      google_summary: googleSummary,
      google_description: descriptionParts.join('\n'),
      google_location: location,
      google_color_id: asText(event.color_choice && event.color_choice.google_color_id) || null,
      confirmation_subject: googleSummary,
      confirmation_block_start: startDate + ' ' + startTime,
      confirmation_block_end: endDate + ' ' + endTime,
      smoke_mode: smokeMode,
      calendar_test_mode: calendarTestMode,
      test_calendar_id: testCalendarId || null,
      prod_calendar_id: prodCalendarId || null,
      test_run_id: testRunId || null,
    },
  }];
};
