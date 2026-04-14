'use strict';

const PROJECT_KEY_MAP = {
  'home 🏡': 'home',
  home: 'home',
  personal: 'personal',
  work: 'work',
  inbox: 'inbox',
};

const ALLOWED_PROJECT_KEYS = new Set(['home', 'personal', 'work', 'inbox']);
const LIFECYCLE_STATUSES = new Set(['open', 'waiting', 'closed']);
const TASK_SHAPES = new Set(['project', 'next_action', 'micro_task', 'follow_up', 'vague_note', 'unknown']);
const REVIEW_STATUSES = new Set(['needs_review', 'no_review_needed', 'accepted', 'overridden']);
const RISKY_SHAPES = new Set(['project', 'vague_note', 'unknown']);

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function lower(value) {
  return asText(value).toLowerCase();
}

function mapProjectKey(projectName, explicitProjectKey = null) {
  const explicit = lower(explicitProjectKey);
  if (explicit && ALLOWED_PROJECT_KEYS.has(explicit)) return explicit;
  const mapped = PROJECT_KEY_MAP[lower(projectName)] || null;
  if (!mapped) {
    const err = new Error(`unsupported project: ${asText(projectName) || '(missing)'}`);
    err.statusCode = 400;
    throw err;
  }
  return mapped;
}

function lifecycleFromSection(sectionName) {
  return lower(sectionName) === 'waiting' ? 'waiting' : 'open';
}

function parsePriority(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  const out = Math.trunc(n);
  if (out < 1 || out > 4) return 1;
  return out;
}

function parseConfidence(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const norm = asText(value).toLowerCase();
    if (!norm) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(norm)) return true;
    if (['0', 'false', 'no', 'off'].includes(norm)) return false;
  }
  return fallback;
}

function detectExplicitProjectSignal(value) {
  const text = asText(value);
  if (!text) return false;
  return (
    /^prj\s*:/i.test(text)
    || /^\[prj\]/i.test(text)
    || /^project\s*:/i.test(text)
  );
}

function parseOptionalDate(value) {
  const text = asText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

module.exports = {
  PROJECT_KEY_MAP,
  ALLOWED_PROJECT_KEYS,
  LIFECYCLE_STATUSES,
  TASK_SHAPES,
  REVIEW_STATUSES,
  RISKY_SHAPES,
  asText,
  lower,
  mapProjectKey,
  lifecycleFromSection,
  parsePriority,
  parseConfidence,
  parseBoolean,
  detectExplicitProjectSignal,
  parseOptionalDate,
};
