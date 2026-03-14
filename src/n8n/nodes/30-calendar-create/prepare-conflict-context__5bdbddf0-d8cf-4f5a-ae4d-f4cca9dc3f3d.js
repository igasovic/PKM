'use strict';

module.exports = async function run(ctx) {
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const base = (() => {
    if (ctx.$items) {
      try {
        const baseItems = ctx.$items('Build Google Event Payload');
        if (Array.isArray(baseItems) && baseItems[0] && baseItems[0].json) {
          return baseItems[0].json;
        }
      } catch (err) {
        // Branch-safe fallback when "Build Google Event Payload" did not execute.
      }
    }
    return ctx.$json || {};
  })();

  const rawItems = (ctx.$input && typeof ctx.$input.all === 'function') ? ctx.$input.all() : [];

  const toTimeLabel = (start) => {
    const dateOnly = asText(start && start.date);
    if (dateOnly) return `${dateOnly} all-day`;

    const dateTime = asText(start && start.dateTime);
    if (!dateTime) return 'time unknown';

    const m = dateTime.match(/T(\d{2}):(\d{2})/);
    if (!m) return dateTime;

    const hour24 = Number(m[1]);
    const minute = m[2];
    if (!Number.isFinite(hour24)) return dateTime;

    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const meridiem = hour24 >= 12 ? 'p' : 'a';
    return `${hour12}:${minute}${meridiem}`;
  };

  const conflicts = rawItems
    .map((item) => (item && item.json) || {})
    .filter((event) => {
      const hasSignal = asText(event.id) || asText(event.summary) || asText(event.start && (event.start.dateTime || event.start.date));
      if (!hasSignal) return false;
      return asText(event.status).toLowerCase() !== 'cancelled';
    })
    .map((event) => {
      const summary = asText(event.summary) || 'Untitled event';
      const when = toTimeLabel(event.start || {});
      return `${when} ${summary}`.trim();
    });

  const existingWarningCodes = Array.isArray(base.warning_codes)
    ? base.warning_codes.filter((value) => asText(value))
    : [];

  if (conflicts.length > 0 && !existingWarningCodes.includes('calendar_conflict_possible')) {
    existingWarningCodes.push('calendar_conflict_possible');
  }

  return [{
    json: {
      ...base,
      conflict_count: conflicts.length,
      conflict_preview: conflicts.slice(0, 3),
      warning_codes: existingWarningCodes,
    },
  }];
};
