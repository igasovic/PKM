'use strict';

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function buildSignals(rawText) {
  const s = lower(rawText);

  const hasWeekday = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(s);
  const hasDateWord = /\b(today|tomorrow)\b/.test(s);
  const hasDateLike = /\b\d{4}-\d{2}-\d{2}\b/.test(s) || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(s);
  const hasTimeLike = /\b(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)\b/.test(s) || /\b([01]?\d|2[0-3]):([0-5]\d)\b/.test(s);

  const hasCreateVerb = /\b(add|create|schedule|book|put|set|plan|remind|appointment|appt|dentist|doctor|meeting|party|practice|trip|flight|birthday)\b/.test(s);
  const hasQueryVerb = /\b(what|show|list|do we have|have we got|anything|events?|schedule|calendar|plans?)\b/.test(s);

  const hasCalendarWord = /\b(calendar|events?)\b/.test(s);

  const querySignal = (
    (hasQueryVerb && (hasDateWord || hasWeekday || hasCalendarWord || hasDateLike))
    || /^\/?(calendar|status)\b/.test(s)
  );

  const createSignal = (
    (hasCreateVerb && (hasDateWord || hasWeekday || hasDateLike || hasTimeLike))
    || (hasTimeLike && (hasDateWord || hasWeekday || hasDateLike))
    || (hasTimeLike && /(dentist|doctor|appointment|appt|meeting|party|practice|trip|flight|birthday)\b/.test(s))
    || /^cal:\s*/.test(s)
  );

  return {
    querySignal,
    createSignal,
    hasDateWord,
    hasWeekday,
    hasDateLike,
    hasTimeLike,
    hasCreateVerb,
    hasQueryVerb,
  };
}

function classifyByRules(input, opts) {
  const data = input && typeof input === 'object' ? input : {};
  const options = opts && typeof opts === 'object' ? opts : {};
  const prefixes = options.prefixes && typeof options.prefixes === 'object'
    ? options.prefixes
    : { calendar: 'cal:', pkm: 'pkm:' };

  const rawText = text(data.text || data.raw_text || data.message_text);
  if (!rawText) {
    throw new Error('text is required');
  }

  const s = lower(rawText);
  const calendarPrefix = lower(prefixes.calendar || 'cal:') || 'cal:';
  const pkmPrefix = lower(prefixes.pkm || 'pkm:') || 'pkm:';

  if (s.startsWith(pkmPrefix)) {
    return {
      resolved: true,
      route: 'pkm_capture',
      confidence: 1,
      rule_id: 'prefix_pkm',
    };
  }

  if (s.startsWith(calendarPrefix)) {
    const withoutPrefix = rawText.slice(calendarPrefix.length).trim();
    const signals = buildSignals(withoutPrefix);
    if (signals.querySignal && !signals.createSignal) {
      return {
        resolved: true,
        route: 'calendar_query',
        confidence: 0.96,
        rule_id: 'prefix_calendar_query',
        signals,
      };
    }
    return {
      resolved: true,
      route: 'calendar_create',
      confidence: 1,
      rule_id: 'prefix_calendar_create',
      signals,
    };
  }

  if (s.startsWith('/')) {
    return {
      resolved: true,
      route: 'pkm_capture',
      confidence: 0.99,
      rule_id: 'slash_command_passthrough',
    };
  }

  const signals = buildSignals(rawText);

  if (signals.querySignal && !signals.createSignal) {
    return {
      resolved: true,
      route: 'calendar_query',
      confidence: 0.9,
      rule_id: 'query_keywords',
      signals,
    };
  }

  if (signals.createSignal && !signals.querySignal) {
    return {
      resolved: true,
      route: 'calendar_create',
      confidence: 0.84,
      rule_id: 'create_keywords',
      signals,
    };
  }

  return {
    resolved: false,
    route: null,
    confidence: 0,
    rule_id: 'needs_llm_intent',
    signals,
  };
}

module.exports = {
  classifyByRules,
};
