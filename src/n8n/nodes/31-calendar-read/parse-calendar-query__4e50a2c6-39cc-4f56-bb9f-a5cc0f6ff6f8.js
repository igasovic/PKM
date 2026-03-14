'use strict';

const WEEKDAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function toDateString(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function nowDateInTz(timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year').value);
  const m = Number(parts.find((p) => p.type === 'month').value);
  const d = Number(parts.find((p) => p.type === 'day').value);
  return { y, m, d };
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return toDateString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDay();
}

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const message = ($json && $json.message) || {};
  const rawText = asText($json.raw_text || message.text || message.caption || '').replace(/^cal:\s*/i, '').trim();
  const textLower = rawText.toLowerCase();

  const timezone = asText(($json.config && $json.config.calendar && $json.config.calendar.timezone) || 'America/Chicago');
  const now = nowDateInTz(timezone);
  const today = toDateString(now.y, now.m, now.d);

  let targetDate = today;
  let label = 'today';

  if (/\btomorrow\b/.test(textLower)) {
    targetDate = addDays(today, 1);
    label = 'tomorrow';
  } else {
    const weekday = Object.keys(WEEKDAY_TO_INDEX).find((k) => new RegExp(`\\b${k}\\b`, 'i').test(textLower));
    if (weekday) {
      const target = WEEKDAY_TO_INDEX[weekday];
      const current = weekdayOf(today);
      const delta = (target - current + 7) % 7;
      targetDate = addDays(today, delta);
      label = weekday;
    }
  }

  const nextDate = addDays(targetDate, 1);
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

  return [{
    json: {
      ...$json,
      raw_text: rawText,
      query_label: label,
      target_date_local: targetDate,
      timezone,
      window_start_local: `${targetDate}T00:00:00`,
      window_end_local: `${nextDate}T00:00:00`,
      google_calendar_id: calendarId,
      smoke_mode: smokeMode,
      calendar_test_mode: calendarTestMode,
      test_calendar_id: testCalendarId || null,
      prod_calendar_id: prodCalendarId || null,
      test_run_id: testRunId || null,
      telegram_chat_id: asText($json.telegram_chat_id || (message.chat && message.chat.id)),
      request_id: asText($json.request_id) || null,
    },
  }];
};
