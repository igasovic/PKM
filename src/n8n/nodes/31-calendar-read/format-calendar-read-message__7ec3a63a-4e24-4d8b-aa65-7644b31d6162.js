'use strict';

const { mdv2Message } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function parseEventStart(value, displayTimezone) {
  if (!value || typeof value !== 'object') return { sortKey: '', label: 'time?' };
  if (value.dateTime) {
    const dt = new Date(value.dateTime);
    if (!Number.isNaN(dt.getTime())) {
      const tz = asText(value.timeZone) || asText(displayTimezone) || 'America/Chicago';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(dt);
      const hh24 = Number((parts.find((p) => p.type === 'hour') || {}).value);
      const mm = Number((parts.find((p) => p.type === 'minute') || {}).value);
      if (!Number.isFinite(hh24) || !Number.isFinite(mm)) {
        return { sortKey: value.dateTime, label: asText(value.dateTime) };
      }
      const suffix = hh24 >= 12 ? 'p' : 'a';
      let hh12 = hh24 % 12;
      if (hh12 === 0) hh12 = 12;
      return {
        sortKey: value.dateTime,
        label: `${hh12}:${String(mm).padStart(2, '0')}${suffix}`,
      };
    }
    return { sortKey: String(value.dateTime), label: asText(value.dateTime) };
  }
  if (value.date) {
    return { sortKey: String(value.date), label: 'all-day' };
  }
  return { sortKey: '', label: 'time?' };
}

function peopleTagFromSummary(summary) {
  const m = String(summary || '').match(/^\[([^\]]+)\]/);
  return m ? m[1] : null;
}

function originalStartFromSummary(summary) {
  const m = String(summary || '').match(/^\[[^\]]+\]\[[^\]]+\]\s+(\d{1,2}:\d{2}[ap])\b/i);
  return m ? asText(m[1]).toLowerCase() : null;
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

module.exports = async function run(ctx) {
  const { $input, $items } = ctx;

  const rows = $input.all().map((i) => (i && i.json) ? i.json : {});
  let contextRow = null;
  if (typeof $items === 'function') {
    try {
      const prior = $items('Parse Calendar Query', 0, 0);
      if (Array.isArray(prior) && prior[0] && prior[0].json) {
        contextRow = prior[0].json;
      }
    } catch (err) {
      // Keep fallback behavior when node-name lookup is unavailable.
    }
  }

  const base = Object.assign({}, contextRow || {}, rows[0] || {});
  const queryLabel = asText(base.query_label) || 'requested period';
  const displayTimezone = asText(base.timezone || (base.config && base.config.calendar && base.config.calendar.timezone)) || 'America/Chicago';
  const chatId = asText(base.telegram_chat_id || (base.message && base.message.chat && base.message.chat.id));
  const requestId = asText(base.request_id) || null;
  const calendarId = asText(base.google_calendar_id) || null;
  const expectedSmokeEventId = asText(base.expected_google_event_id) || asText(base.google_event_id);
  const expectedSmokeRunId = asText(base.test_run_id);

  const events = rows
    .filter((r) => r && (r.id || r.summary || (r.start && (r.start.dateTime || r.start.date))))
    .map((r) => {
      const summary = asText(r.summary) || '(untitled event)';
      const start = parseEventStart(r.start, displayTimezone);
      const end = parseEventStart(r.end, displayTimezone);
      const peopleTag = peopleTagFromSummary(summary);
      const marker = markerFromPeopleTag(peopleTag);
      const isTelegramAuthored = summary.startsWith('[');
      const originalStart = originalStartFromSummary(summary);
      return {
        id: asText(r.id),
        summary,
        start,
        end,
        displayLabel: isTelegramAuthored && originalStart ? originalStart : start.label,
        marker,
        isTelegramAuthored,
        raw: r,
      };
    })
    .sort((a, b) => a.start.sortKey.localeCompare(b.start.sortKey));

  const lines = [];
  if (!events.length) {
    lines.push(`No events for ${queryLabel}.`);
  } else {
    lines.push(`Events for ${queryLabel}:`);
    events.forEach((e) => {
      lines.push(`${e.marker} ${e.displayLabel} ${e.summary}`);
    });
  }

  const observeItems = events
    .filter((e) => !e.isTelegramAuthored && e.id)
    .map((e) => ({
      google_calendar_id: calendarId,
      google_event_id: e.id,
      observation_kind: 'query_seen',
      source_type: 'external_unknown',
      event_snapshot: {
        summary: e.summary,
        start: e.raw.start || null,
        end: e.raw.end || null,
      },
      resolved_people: [],
      resolved_color: 'grey',
      was_reported: true,
    }));

  const foundExpectedEvent = expectedSmokeEventId
    ? events.some((e) => e.id === expectedSmokeEventId)
    : false;
  const foundTaggedEvent = expectedSmokeRunId
    ? events.some((e) => e.summary.includes(`[SMOKE ${expectedSmokeRunId}]`))
    : false;

  return [{
    json: {
      ...base,
      telegram_chat_id: chatId,
      request_id: requestId,
      telegram_message: mdv2Message(lines.join('\n'), { maxLen: 4000 }),
      observe_items: observeItems,
      events_count: events.length,
      smoke_expected_event_found: foundExpectedEvent,
      smoke_tagged_event_found: foundTaggedEvent,
    },
  }];
};
