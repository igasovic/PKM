'use strict';

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
  return toDateString(y, m, d);
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

function buildDayList(startDate, count) {
  const days = [];
  for (let i = 0; i < count; i += 1) days.push(addDays(startDate, i));
  return days;
}

module.exports = async function run(ctx) {
  const { $json, $env } = ctx;

  const mode = asText($json.report_kind || $json.report_mode || 'daily').toLowerCase() === 'weekly'
    ? 'weekly'
    : 'daily';

  const timezone = asText(($json.config && $json.config.calendar && $json.config.calendar.timezone) || 'America/Chicago');
  const calendarId = asText($json.family_calendar_id || ($json.config && $json.config.calendar && $json.config.calendar.family_calendar_id)) || 'primary';
  const fallbackChatId = asText(($env && $env.TELEGRAM_ADMIN_CHAT_ID) || '');

  const overrideToday = asText($json.now_local_date);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(overrideToday)
    ? overrideToday
    : nowDateInTz(timezone);

  let startDate = today;
  let endExclusiveDate = addDays(today, 3);
  let dayList = buildDayList(today, 3);
  let reportLabel = 'today + next 2 days';

  if (mode === 'weekly') {
    const currentWeekday = weekdayOf(today);
    const monday = 1;
    const deltaToNextMonday = ((monday - currentWeekday + 7) % 7) || 7;
    startDate = addDays(today, deltaToNextMonday);
    endExclusiveDate = addDays(startDate, 7);
    dayList = buildDayList(startDate, 7);
    reportLabel = 'next Monday-Sunday';
  }

  return [{
    json: {
      ...$json,
      report_kind: mode,
      report_label: reportLabel,
      timezone,
      google_calendar_id: calendarId,
      telegram_chat_id: asText($json.telegram_chat_id) || fallbackChatId,
      report_start_date_local: startDate,
      report_end_exclusive_date_local: endExclusiveDate,
      report_day_list: dayList,
      window_start_local: `${startDate}T00:00:00`,
      window_end_local: `${endExclusiveDate}T00:00:00`,
    },
  }];
};
