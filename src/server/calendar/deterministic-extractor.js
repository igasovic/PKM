'use strict';

const { getConfig } = require('../../libs/config.js');

const WEEKDAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function text(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function lower(v) {
  return text(v).toLowerCase();
}

function listMissingFieldsMessage(missing) {
  const labels = {
    title: 'title',
    date: 'date',
    start_time: 'start time',
    duration: 'duration',
    people: 'people',
    category: 'category',
  };
  const parts = missing.map((k) => labels[k] || k);
  if (parts.length <= 1) {
    return `I can add this, but I still need the ${parts[0] || 'missing details'}.`;
  }
  if (parts.length === 2) {
    return `I can add this, but I still need the ${parts[0]} and ${parts[1]}.`;
  }
  const head = parts.slice(0, -1).join(', ');
  const tail = parts[parts.length - 1];
  return `I can add this, but I still need the ${head}, and ${tail}.`;
}

function resolveClarificationQuestion(llmExtraction, missing) {
  const raw = text(llmExtraction && llmExtraction.clarification_question);
  if (raw) {
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (compact.length >= 8 && compact.length <= 280) {
      return compact;
    }
  }
  return listMissingFieldsMessage(missing);
}

function nowDateInTz(timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return { y, m, d };
}

function toDateString(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(dateStr, deltaDays) {
  const [y, m, d] = String(dateStr).split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m - 1), d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return toDateString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m - 1), d));
  return dt.getUTCDay();
}

function detectDateLocal(rawText, timezone) {
  const s = lower(rawText);
  const now = nowDateInTz(timezone);
  const today = toDateString(now.y, now.m, now.d);

  const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const md = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (md) {
    const mm = Number(md[1]);
    const dd = Number(md[2]);
    let yy = Number(md[3] || now.y);
    if (yy < 100) yy += 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return toDateString(yy, mm, dd);
    }
  }

  if (/\btoday\b/.test(s)) return today;
  if (/\btomorrow\b/.test(s)) return addDays(today, 1);

  const weekday = Object.keys(WEEKDAY_TO_INDEX).find((k) => new RegExp(`\\b${k}\\b`).test(s));
  if (weekday) {
    const target = WEEKDAY_TO_INDEX[weekday];
    const current = weekdayOf(today);
    const delta = (target - current + 7) % 7;
    return addDays(today, delta);
  }

  return null;
}

function detectTimeLocal(rawText) {
  const s = lower(rawText);
  const twelve = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)\b/);
  if (twelve) {
    let hh = Number(twelve[1]);
    const mm = Number(twelve[2] || 0);
    const mer = twelve[3];
    if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
    if (mer === 'p' || mer === 'pm') {
      if (hh !== 12) hh += 12;
    } else if (hh === 12) {
      hh = 0;
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  const twentyFour = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFour) {
    const hh = Number(twentyFour[1]);
    const mm = Number(twentyFour[2]);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  return null;
}

function hhmmToMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHhmm(totalMinutes) {
  const day = 24 * 60;
  let m = totalMinutes % day;
  if (m < 0) m += day;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function addMinutesWithDate(dateLocal, hhmm, deltaMinutes) {
  const startMin = hhmmToMinutes(hhmm);
  if (!Number.isFinite(startMin)) return null;
  const raw = startMin + Number(deltaMinutes || 0);
  const day = 24 * 60;
  const dayOffset = Math.floor(raw / day);
  const timeLocal = minutesToHhmm(raw);
  const date = addDays(dateLocal, dayOffset);
  return {
    date_local: date,
    time_local: timeLocal,
  };
}

function formatClock12(hhmm) {
  const minutes = hhmmToMinutes(hhmm);
  if (!Number.isFinite(minutes)) return hhmm;
  const hh24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const mer = hh24 >= 12 ? 'p' : 'a';
  let hh12 = hh24 % 12;
  if (hh12 === 0) hh12 = 12;
  return `${hh12}:${String(mm).padStart(2, '0')}${mer}`;
}

function detectDurationMinutes(rawText, categoryCode, config) {
  const s = lower(rawText);
  const mins = s.match(/\bfor\s+(\d{1,3})\s*(m|min|mins|minute|minutes)\b/);
  if (mins) return Number(mins[1]);
  const hours = s.match(/\bfor\s+(\d{1,2})(?:\s*(h|hr|hrs|hour|hours))\b/);
  if (hours) return Number(hours[1]) * 60;
  if (/\bbirthday\b/.test(s)) return Number(config.default_duration_minutes.birthday_override || 180);
  const byCategory = Number(config.default_duration_minutes[categoryCode] || 0);
  if (Number.isFinite(byCategory) && byCategory > 0) return byCategory;
  return Number(config.default_duration_minutes.fallback || 60);
}

function detectPeople(rawText, config) {
  const s = lower(rawText);
  const peopleMap = config.people && config.people.map ? config.people.map : {};
  const found = [];
  for (const key of Object.keys(peopleMap)) {
    if (key === 'fam') continue;
    const pattern = new RegExp(`\\b${key}\\b`, 'i');
    if (pattern.test(s)) {
      found.push(peopleMap[key].code);
    }
  }
  return normalizePeopleCodes(found, config);
}

function detectCategory(rawText, config) {
  const s = lower(rawText);
  const keywords = [
    { k: 'MED', words: ['doctor', 'dentist', 'medical', 'clinic', 'checkup', 'appointment', 'appt'] },
    { k: 'KID', words: ['kid', 'kids', 'school', 'swim', 'soccer', 'practice'] },
    { k: 'DOG', words: ['dog', 'louie', 'vet', 'walk'] },
    { k: 'TRV', words: ['trip', 'flight', 'travel', 'airport'] },
    { k: 'ADM', words: ['paperwork', 'admin', 'meeting', 'call'] },
    { k: 'HOME', words: ['home', 'house', 'repair', 'cleaning'] },
    { k: 'EVT', words: ['party', 'event', 'birthday', 'concert'] },
  ];
  for (const row of keywords) {
    if (row.words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s))) return row.k;
  }
  return config.categories.OTH ? 'OTH' : null;
}

function detectLocation(rawText) {
  const s = text(rawText);
  const maps = s.match(/\bhttps?:\/\/[^\s<>()]*(google\.[^\s<>()]*\/maps|maps\.apple\.com)[^\s<>()]*/i);
  if (maps) return maps[0];
  const at = s.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9 ,.'-]{1,120})$/i);
  if (at) return text(at[1]);
  return null;
}

function deriveTitle(rawText) {
  let s = text(rawText);
  s = s.replace(/^cal:\s*/i, '');
  s = s.replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig, ' ');
  s = s.replace(/\b(at|on)\s+(?=(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)\b)/ig, ' ');
  s = s.replace(/\b(at|on)\s+\d{1,2}:\d{2}\b/ig, ' ');
  s = s.replace(/\bfor\s+\d{1,3}\s*(m|min|mins|minute|minutes)\b/ig, ' ');
  s = s.replace(/\bfor\s+\d{1,2}\s*(h|hr|hrs|hour|hours)\b/ig, ' ');
  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)\b/ig, ' ');
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, ' ');
  s = s.replace(/\b(at|on|for|with|to)\b$/i, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > 80) return s.slice(0, 80).trim();
  return s;
}

function resolveSubjectPeopleTag(peopleCodes, config) {
  const order = Array.isArray(config.people && config.people.order) ? config.people.order : [];
  const unique = Array.from(new Set(Array.isArray(peopleCodes) ? peopleCodes : []));
  unique.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    const ra = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const rb = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    return ra - rb;
  });
  const familyAlias = text(config.people && config.people.family_alias) || 'FAM';
  if (unique.length && order.length && unique.length === order.length && order.every((c) => unique.includes(c))) {
    return familyAlias;
  }
  return unique.join(',');
}

function resolveColor(peopleCodes, config) {
  const order = Array.isArray(config.people && config.people.order) ? config.people.order : [];
  const peopleTag = resolveSubjectPeopleTag(peopleCodes, config);
  if (peopleTag === (text(config.people && config.people.family_alias) || 'FAM')) {
    const fam = config.people && config.people.map && config.people.map.fam;
    return {
      logical_color: fam && fam.color ? fam.color : 'green',
      google_color_id: fam && fam.google_color_id ? fam.google_color_id : '10',
      telegram_marker: fam && fam.telegram_marker ? fam.telegram_marker : 'green',
    };
  }
  const one = Array.isArray(peopleCodes) && peopleCodes.length === 1 ? peopleCodes[0] : null;
  if (one) {
    const row = Object.values(config.people.map || {}).find((p) => p && p.code === one);
    if (row) {
      return {
        logical_color: row.color,
        google_color_id: row.google_color_id,
        telegram_marker: row.telegram_marker,
      };
    }
  }
  const first = order.find((code) => Array.isArray(peopleCodes) && peopleCodes.includes(code));
  if (first) {
    const row = Object.values(config.people.map || {}).find((p) => p && p.code === first);
    if (row) {
      return {
        logical_color: row.color,
        google_color_id: row.google_color_id,
        telegram_marker: row.telegram_marker,
      };
    }
  }
  const unresolved = config.people && config.people.unresolved_external ? config.people.unresolved_external : {};
  return {
    logical_color: unresolved.color || 'grey',
    google_color_id: null,
    telegram_marker: unresolved.telegram_marker || 'grey',
  };
}

function mergeTextWithClarificationTurns(rawText, clarificationTurns) {
  const turns = Array.isArray(clarificationTurns) ? clarificationTurns : [];
  if (!turns.length) return text(rawText);
  const answers = turns
    .map((t) => text(t && t.answer_text))
    .filter(Boolean);
  if (!answers.length) return text(rawText);
  return `${text(rawText)}\n${answers.join('\n')}`.trim();
}

function normalizeDateLocal(value) {
  const s = text(value);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeTimeLocal(value) {
  const s = text(value);
  if (!s) return null;

  if (/^\d{2}:\d{2}$/.test(s)) {
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(3, 5));
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return s;
  }

  const parsed = detectTimeLocal(s);
  return parsed || null;
}

function normalizeDurationMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.trunc(n);
  if (rounded <= 0 || rounded > 24 * 60) return null;
  return rounded;
}

function normalizeCategoryCode(value, config) {
  const code = text(value).toUpperCase();
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(config.categories || {}, code) ? code : null;
}

function normalizePeopleCodes(values, config) {
  const incoming = Array.isArray(values) ? values : [];
  const map = config.people && config.people.map ? config.people.map : {};
  const order = Array.isArray(config.people && config.people.order) ? config.people.order : [];
  const allowed = new Set(order);

  const codes = [];
  for (const item of incoming) {
    const token = text(item);
    if (!token) continue;

    if (allowed.has(token)) {
      codes.push(token);
      continue;
    }

    const tokenLower = lower(token);
    if (map[tokenLower] && map[tokenLower].code && allowed.has(map[tokenLower].code)) {
      codes.push(map[tokenLower].code);
      continue;
    }

    const asUpper = token.toUpperCase();
    const match = order.find((code) => code.toUpperCase() === asUpper);
    if (match) {
      codes.push(match);
    }
  }

  const unique = Array.from(new Set(codes));
  unique.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    const ra = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const rb = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    return ra - rb;
  });
  return unique;
}

function computeDurationFromEnd(startDate, startTime, endDate, endTime) {
  const start = normalizeTimeLocal(startTime);
  const end = normalizeTimeLocal(endTime);
  const startD = normalizeDateLocal(startDate);
  const endD = normalizeDateLocal(endDate);
  if (!start || !end || !startD || !endD) return null;

  const startDateTime = new Date(`${startD}T${start}:00Z`);
  const endDateTime = new Date(`${endD}T${end}:00Z`);
  if (!Number.isFinite(startDateTime.getTime()) || !Number.isFinite(endDateTime.getTime())) return null;

  const diffMin = Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000);
  if (!Number.isFinite(diffMin) || diffMin <= 0 || diffMin > 24 * 60) return null;
  return diffMin;
}

function buildDeterministicDraft(input, config) {
  const timezone = text(input.timezone || config.timezone || 'America/Chicago');
  const rawText = text(input.raw_text || input.text);
  const mergedText = mergeTextWithClarificationTurns(rawText, input.clarification_turns);

  const llm = input && input.llm_extraction && typeof input.llm_extraction === 'object'
    ? input.llm_extraction
    : null;

  const categoryFromLlm = normalizeCategoryCode(llm && llm.category_code, config);
  const peopleFromLlm = normalizePeopleCodes(llm && llm.people_codes, config);
  const dateFromLlm = normalizeDateLocal(llm && (llm.date_local || llm.date));
  const startFromLlm = normalizeTimeLocal(llm && (llm.start_time_local || llm.start_time));
  const durationFromLlm = normalizeDurationMinutes(llm && llm.duration_minutes);
  const endDateFromLlm = normalizeDateLocal(llm && llm.end_date_local);
  const endTimeFromLlm = normalizeTimeLocal(llm && llm.end_time_local);
  const durationFromEnd = computeDurationFromEnd(
    dateFromLlm,
    startFromLlm,
    endDateFromLlm,
    endTimeFromLlm
  );

  const category_code = categoryFromLlm || detectCategory(mergedText, config);
  const people_codes = peopleFromLlm.length ? peopleFromLlm : detectPeople(mergedText, config);
  const date_local = dateFromLlm || detectDateLocal(mergedText, timezone);
  const start_time_local = startFromLlm || detectTimeLocal(mergedText);

  let duration_minutes = durationFromLlm || durationFromEnd;
  if (!duration_minutes && category_code) {
    duration_minutes = detectDurationMinutes(mergedText, category_code, config);
  }

  const title = text(llm && llm.title) || deriveTitle(mergedText);
  const location = text(llm && llm.location) || detectLocation(mergedText);

  return {
    timezone,
    merged_text: mergedText,
    title: title || null,
    date_local: date_local || null,
    start_time_local: start_time_local || null,
    duration_minutes: duration_minutes || null,
    people_codes,
    category_code: category_code || null,
    location: location || null,
  };
}

function normalizeCalendarRequestDeterministic(input) {
  const data = input && typeof input === 'object' ? input : {};
  const config = getConfig().calendar;
  const rawText = text(data.raw_text || data.text);
  const llmExtraction = (
    data &&
    data.llm_extraction &&
    typeof data.llm_extraction === 'object'
  )
    ? data.llm_extraction
    : null;
  if (!rawText) throw new Error('raw_text is required');

  if (/\ball[- ]day\b/i.test(rawText)) {
    return {
      status: 'rejected',
      reason_code: 'all_day_not_supported',
      message: 'All-day event creation is not supported in v1. Please provide a start time and duration.',
      missing_fields: [],
      normalized_event: null,
      warning_codes: [],
    };
  }

  const draft = buildDeterministicDraft(data, config);

  const missing = [];
  if (!draft.title) missing.push('title');
  if (!draft.date_local) missing.push('date');
  if (!draft.start_time_local) missing.push('start_time');
  if (!draft.duration_minutes) missing.push('duration');
  if (!draft.people_codes.length) missing.push('people');
  if (!draft.category_code) missing.push('category');

  if (missing.length) {
    return {
      status: 'needs_clarification',
      missing_fields: missing,
      clarification_question: resolveClarificationQuestion(llmExtraction, missing),
      normalized_event: null,
      warning_codes: [],
      message: null,
    };
  }

  const startPlusDuration = addMinutesWithDate(draft.date_local, draft.start_time_local, draft.duration_minutes);
  const end_date_local = startPlusDuration ? startPlusDuration.date_local : draft.date_local;
  const end_time_local = startPlusDuration ? startPlusDuration.time_local : draft.start_time_local;
  const isHome = draft.location && (config.padding.home_literals || []).some((v) => lower(v) === lower(draft.location));
  const padBefore = isHome ? 0 : Number(config.padding.before_minutes || 0);
  const padAfter = isHome ? 0 : Number(config.padding.after_minutes || 0);
  const blockStart = addMinutesWithDate(draft.date_local, draft.start_time_local, -padBefore);
  const blockEnd = addMinutesWithDate(end_date_local, end_time_local, padAfter);

  const peopleTag = resolveSubjectPeopleTag(draft.people_codes, config);
  const subjectCode = `[${peopleTag}][${draft.category_code}] ${formatClock12(draft.start_time_local)} ${draft.title}`;
  const color = resolveColor(draft.people_codes, config);

  return {
    status: 'ready_to_create',
    missing_fields: [],
    clarification_question: null,
    message: null,
    warning_codes: [],
    normalized_event: {
      timezone: draft.timezone,
      title: draft.title,
      date_local: draft.date_local,
      start_time_local: draft.start_time_local,
      end_date_local,
      end_time_local,
      duration_minutes: draft.duration_minutes,
      people_codes: draft.people_codes,
      category_code: draft.category_code,
      location: draft.location || null,
      subject_code: subjectCode,
      subject_people_tag: peopleTag,
      color_choice: color,
      original_start: {
        date_local: draft.date_local,
        time_local: draft.start_time_local,
      },
      block_window: {
        start_date_local: blockStart ? blockStart.date_local : draft.date_local,
        start_time_local: blockStart ? blockStart.time_local : draft.start_time_local,
        end_date_local: blockEnd ? blockEnd.date_local : end_date_local,
        end_time_local: blockEnd ? blockEnd.time_local : end_time_local,
        padded: !isHome,
        pad_before_minutes: padBefore,
        pad_after_minutes: padAfter,
      },
      source: {
        type: 'telegram',
      },
    },
  };
}

module.exports = {
  listMissingFieldsMessage,
  resolveClarificationQuestion,
  mergeTextWithClarificationTurns,
  normalizeCalendarRequestDeterministic,
  buildDeterministicDraft,
};
