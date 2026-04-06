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
  const hasTemporalRef = hasDateWord || hasWeekday || hasDateLike;

  const hasCreateVerb = /\b(add|create|schedule|book|put|set|remind|appointment|appt|dentist|doctor|meeting|party|practice|trip|flight|birthday)\b/.test(s);
  const hasCreateFrameVerb = /\b(add|create|schedule|book|put|set|remind)\b/.test(s);
  const hasQueryCue = /\b(what|show|list|do we have|have we got|anything|check)\b/.test(s);
  const hasScheduleNoun = /\b(events?|schedule)\b/.test(s);
  const hasPlanNoun = /\bplans?\b/.test(s);
  const hasEventWord = /\bevents?\b/.test(s);
  const hasQuestionMark = /\?/.test(s);

  const hasCalendarWord = /\b(calendar|cal)\b/.test(s);
  const isTemporalOnlyShort = /^(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\??$/.test(s);
  const startsWithCalendarCommand = /^\/?(calendar|cal|status)\b/.test(s);
  const calendarCommandQuery = startsWithCalendarCommand && (
    hasTemporalRef
    || hasQuestionMark
    || hasQueryCue
    || s === 'calendar'
    || s === 'cal'
    || s === 'status'
  );

  const querySignal = (
    isTemporalOnlyShort
    || (hasQueryCue && (hasTemporalRef || hasCalendarWord || hasScheduleNoun || hasPlanNoun))
    || (hasScheduleNoun && hasTemporalRef)
    || calendarCommandQuery
  );

  const createSignal = (
    (hasCreateVerb && (hasTemporalRef || hasTimeLike))
    || (hasTimeLike && hasTemporalRef)
    || (hasTimeLike && /(dentist|doctor|appointment|appt|meeting|party|practice|trip|flight|birthday)\b/.test(s))
    || (hasCreateFrameVerb && hasEventWord && (hasTemporalRef || hasTimeLike))
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
    hasQueryCue,
    hasScheduleNoun,
    hasPlanNoun,
    hasCalendarWord,
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

  if (/^https?:\/\/(?:maps\.app\.goo\.gl\/|(?:www\.)?google\.com\/maps(?:\/|$)|maps\.apple(?:\.com)?\/)/.test(s)) {
    return {
      resolved: true,
      route: 'calendar_create',
      confidence: 0.95,
      rule_id: 'maps_url_create',
    };
  }

  const signals = buildSignals(rawText);
  const hasCanModal = /\bcan\s+(i|we)\b/.test(s);

  if (hasCanModal && signals.createSignal) {
    return {
      resolved: true,
      route: 'ambiguous',
      confidence: 0.5,
      rule_id: 'modal_create_ambiguous',
      signals,
    };
  }

  const explicitCreateEvent = /\b(create|schedule)\b[\s\S]*\bevent\b/.test(s)
    && (signals.hasDateWord || signals.hasWeekday || signals.hasDateLike || signals.hasTimeLike);

  if (explicitCreateEvent) {
    return {
      resolved: true,
      route: 'calendar_create',
      confidence: 0.92,
      rule_id: 'explicit_create_event',
      signals,
    };
  }

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
