'use strict';

const { mdv2 } = (() => {
  try {
    return require('/data/src/libs/telegram-markdown.js');
  } catch (err) {
    return require('../../../libs/telegram-markdown.js');
  }
})();

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function parseEventStart(value) {
  if (!value || typeof value !== 'object') return { sortKey: '', label: 'time?' };
  if (value.dateTime) {
    const dt = new Date(value.dateTime);
    if (!Number.isNaN(dt.getTime())) {
      const hh24 = dt.getHours();
      const mm = dt.getMinutes();
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
  const chatId = asText(base.telegram_chat_id || (base.message && base.message.chat && base.message.chat.id));
  const requestId = asText(base.request_id) || null;
  const calendarId = asText(base.google_calendar_id) || null;

  const events = rows
    .filter((r) => r && (r.id || r.summary || (r.start && (r.start.dateTime || r.start.date))))
    .map((r) => {
      const summary = asText(r.summary) || '(untitled event)';
      const start = parseEventStart(r.start);
      const end = parseEventStart(r.end);
      const peopleTag = peopleTagFromSummary(summary);
      const marker = markerFromPeopleTag(peopleTag);
      const isTelegramAuthored = summary.startsWith('[');
      return {
        id: asText(r.id),
        summary,
        start,
        end,
        marker,
        isTelegramAuthored,
        raw: r,
      };
    })
    .sort((a, b) => a.start.sortKey.localeCompare(b.start.sortKey));

  const lines = [];
  if (!events.length) {
    lines.push(mdv2(`No events for ${queryLabel}.`));
  } else {
    lines.push(mdv2(`Events for ${queryLabel}:`));
    events.forEach((e) => {
      lines.push(mdv2(`${e.marker} ${e.start.label} ${e.summary}`));
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

  return [{
    json: {
      ...base,
      telegram_chat_id: chatId,
      request_id: requestId,
      telegram_message: lines.join('\n'),
      observe_items: observeItems,
      events_count: events.length,
    },
  }];
};
