'use strict';

const { mdv2, finalizeMarkdownV2 } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function dateLabel(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return asText(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAY_SHORT[dt.getUTCDay()]} ${MONTH_SHORT[m - 1]} ${d}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = String(dateStr || '').split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function peopleTagFromSummary(summary) {
  const m = String(summary || '').match(/^\[([^\]]+)\]/);
  return m ? m[1] : null;
}

function markerFromPeopleTag(tag) {
  const t = asText(tag);
  if (t === 'FAM') return '🟢';
  if (t === 'M') return '🟣';
  if (t === 'Iv') return '🟡';
  if (t === 'L') return '🟠';
  if (t === 'Ig') return '🔵';
  if (t === 'D') return '⚪';
  return '⚫';
}

function parseEventStart(value) {
  if (!value || typeof value !== 'object') {
    return {
      sortKey: '',
      dayKey: '',
      label: 'time?',
      isAllDay: false,
    };
  }

  const dateTime = asText(value.dateTime);
  if (dateTime) {
    const dayKey = dateTime.slice(0, 10);
    const match = dateTime.match(/T(\d{2}):(\d{2})/);
    if (match) {
      const hour24 = Number(match[1]);
      const minute = match[2];
      if (Number.isFinite(hour24)) {
        const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
        const meridiem = hour24 >= 12 ? 'p' : 'a';
        return {
          sortKey: dateTime,
          dayKey,
          label: `${hour12}:${minute}${meridiem}`,
          isAllDay: false,
        };
      }
    }

    return {
      sortKey: dateTime,
      dayKey,
      label: dateTime,
      isAllDay: false,
    };
  }

  const date = asText(value.date);
  if (date) {
    return {
      sortKey: `${date}T00:00:00`,
      dayKey: date,
      label: 'all-day',
      isAllDay: true,
    };
  }

  return {
    sortKey: '',
    dayKey: '',
    label: 'time?',
    isAllDay: false,
  };
}

function pushEventLines(lines, events) {
  events.forEach((event) => {
    lines.push(`${event.marker} ${event.start.label} ${event.summary}`);
  });
}

module.exports = async function run(ctx) {
  const { $input, $items } = ctx;

  const rows = ($input && typeof $input.all === 'function')
    ? $input.all().map((item) => (item && item.json) || {})
    : [];

  let base = {};
  if (typeof $items === 'function') {
    try {
      const prior = $items('Build Report Window', 0, 0);
      if (Array.isArray(prior) && prior[0] && prior[0].json) {
        base = prior[0].json;
      }
    } catch (err) {
      base = {};
    }
  }

  const reportKind = asText(base.report_kind || 'daily') === 'weekly' ? 'weekly' : 'daily';
  const dayList = Array.isArray(base.report_day_list) ? base.report_day_list : [];
  const calendarId = asText(base.google_calendar_id) || null;
  const chatId = asText(base.telegram_chat_id || (base.message && base.message.chat && base.message.chat.id));

  const events = rows
    .filter((row) => row && (row.id || row.summary || (row.start && (row.start.dateTime || row.start.date))))
    .map((row) => {
      const summary = asText(row.summary) || '(untitled event)';
      const start = parseEventStart(row.start);
      const peopleTag = peopleTagFromSummary(summary);
      const marker = markerFromPeopleTag(peopleTag);
      const isTelegramAuthored = summary.startsWith('[');
      return {
        id: asText(row.id),
        summary,
        start,
        marker,
        isTelegramAuthored,
        raw: row,
      };
    })
    .sort((a, b) => a.start.sortKey.localeCompare(b.start.sortKey));

  const byDay = new Map();
  dayList.forEach((day) => byDay.set(day, []));
  events.forEach((event) => {
    const key = event.start.dayKey;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  });

  const lines = [];
  const todayLabel = dayList.length > 0 ? dateLabel(dayList[0]) : dateLabel(asText(base.report_start_date_local));
  if (reportKind === 'daily') {
    lines.push(`📅 Daily Report - ${todayLabel}`);

    let anyEvents = false;
    dayList.forEach((day, index) => {
      const dayEvents = byDay.get(day) || [];
      const heading = index === 0 ? `PKM_TODAY_BOLD (${dateLabel(day)})` : dateLabel(day);

      if (!dayEvents.length) {
        if (index === 0) {
          lines.push(`${heading}: no events`);
          lines.push('');
        }
        return;
      }

      anyEvents = true;
      lines.push(heading);
      pushEventLines(lines, dayEvents);
      lines.push('');
    });

    if (!anyEvents && dayList.length === 0) {
      lines.push('No events found for the daily window.');
    }
  } else {
    lines.push(`📅 Weekly Report - ${todayLabel}`);

    let emittedDays = 0;
    dayList.forEach((day) => {
      const dayEvents = byDay.get(day) || [];
      if (!dayEvents.length) {
        if (emittedDays === 0 && day === dayList[0]) {
          lines.push(`PKM_TODAY_BOLD (${dateLabel(day)}): no events`);
          lines.push('');
        }
        return;
      }

      emittedDays += 1;
      lines.push(day === dayList[0] ? `PKM_TODAY_BOLD (${dateLabel(day)})` : dateLabel(day));
      pushEventLines(lines, dayEvents);
      lines.push('');
    });

    if (!emittedDays) {
      lines.push('No events scheduled for the next week.');
    }
  }

  const observeKind = reportKind === 'weekly' ? 'weekly_report_seen' : 'daily_report_seen';

  const observeItems = events
    .filter((event) => !event.isTelegramAuthored && event.id)
    .map((event) => ({
      google_calendar_id: calendarId,
      google_event_id: event.id,
      observation_kind: observeKind,
      source_type: 'external_unknown',
      event_snapshot: {
        summary: event.summary,
        start: event.raw.start || null,
        end: event.raw.end || null,
      },
      resolved_people: [],
      resolved_color: 'grey',
      was_reported: true,
    }));

  const cleanLines = lines;
  while (cleanLines.length > 0 && !asText(cleanLines[cleanLines.length - 1])) cleanLines.pop();

  return [{
    json: {
      ...base,
      telegram_chat_id: chatId,
      telegram_message: finalizeMarkdownV2(
        mdv2(cleanLines.join('\n')).replaceAll('PKM\\_TODAY\\_BOLD', '*Today*'),
        { maxLen: 4000 },
      ),
      observe_items: observeItems,
      events_count: events.length,
      report_kind: reportKind,
      report_start_date_local: asText(base.report_start_date_local),
      report_end_date_local: dayList.length ? dayList[dayList.length - 1] : addDays(asText(base.report_start_date_local), 6),
    },
  }];
};
