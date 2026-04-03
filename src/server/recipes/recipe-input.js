'use strict';

function asString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNullableString(value) {
  const out = asString(value);
  return out || null;
}

function asNullableInt(value, fieldName, opts = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw badRequest(`${fieldName} must be an integer`);
  }
  if (Number.isFinite(opts.min) && parsed < opts.min) {
    throw badRequest(`${fieldName} must be >= ${opts.min}`);
  }
  return parsed;
}

function asRequiredInt(value, fieldName, opts = {}) {
  const parsed = asNullableInt(value, fieldName, opts);
  if (parsed === null) {
    throw badRequest(`${fieldName} is required`);
  }
  return parsed;
}

function asNullableBool(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw badRequest(`${fieldName} must be boolean`);
}

function asArrayOfText(value, fieldName, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) {
      throw badRequest(`${fieldName} is required`);
    }
    return null;
  }

  let list = null;
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    list = value
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (!list) {
    throw badRequest(`${fieldName} must be an array of strings`);
  }

  const normalized = list
    .map((item) => asString(item))
    .filter(Boolean);

  if (required && normalized.length === 0) {
    throw badRequest(`${fieldName} must contain at least one item`);
  }

  return normalized;
}

function asTags(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const out = value.map((item) => asString(item)).filter(Boolean);
    return out.length ? out : null;
  }
  if (typeof value === 'string') {
    const out = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return out.length ? out : null;
  }
  throw badRequest('tags must be an array or comma-separated string');
}

function parseMinutes(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw badRequest(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }
  const raw = String(value).trim();
  const m = raw.match(/\d+/);
  if (!m) {
    throw badRequest(`${fieldName} must include an integer minute value`);
  }
  const parsed = Number(m[0]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeTitle(title) {
  const out = asString(title).replace(/\s+/g, ' ');
  if (!out) {
    throw badRequest('title is required');
  }
  return out;
}

function normalizeTitleKey(title) {
  return normalizeTitle(title).toLowerCase();
}

function normalizePublicId(value) {
  const raw = asString(value).toUpperCase();
  if (!/^R\d+$/.test(raw)) {
    throw badRequest('public_id must match R<number>');
  }
  return raw;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function parseMetadata(value, fieldName = 'metadata') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('metadata JSON must be an object');
      }
      return parsed;
    } catch (err) {
      throw badRequest(`${fieldName} must be a JSON object`);
    }
  }
  throw badRequest(`${fieldName} must be an object`);
}

function buildSearchText(payload) {
  const chunks = [
    payload.title,
    ...(payload.ingredients || []),
    ...(payload.instructions || []),
    payload.notes,
    payload.cuisine,
    payload.protein,
    payload.difficulty,
    ...(payload.tags || []),
    payload.url_canonical,
    payload.capture_text,
  ];

  return chunks
    .filter((chunk) => chunk !== null && chunk !== undefined)
    .map((chunk) => String(chunk).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildReviewReasons(payload) {
  const reasons = [];
  const checks = [
    ['cuisine', payload.cuisine],
    ['protein', payload.protein],
    ['prep_time_minutes', payload.prep_time_minutes],
    ['cook_time_minutes', payload.cook_time_minutes],
    ['difficulty', payload.difficulty],
    ['servings', payload.servings],
  ];

  for (const [name, value] of checks) {
    if (value === null || value === undefined || value === '') {
      reasons.push(`missing_${name}`);
    }
  }

  return reasons;
}

function reviewStatusFromReasons(reasons) {
  return reasons.length > 0 ? 'needs_review' : 'active';
}

function upsertReviewMetadata(metadata, reasons) {
  const out = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};

  out.review = {
    required: reasons.length > 0,
    reasons,
  };

  return out;
}

function parseSectionsFromCapture(rawCaptureText) {
  const captureText = asString(rawCaptureText);
  if (!captureText) {
    throw badRequest('capture_text is required when recipe fields are missing');
  }

  const lines = captureText.split(/\r?\n/);
  const firstNonEmpty = lines.find((line) => asString(line));
  const headingTitle = lines
    .map((line) => line.match(/^#\s+(.+)$/))
    .find(Boolean);
  const title = headingTitle && headingTitle[1]
    ? headingTitle[1].trim()
    : asString(firstNonEmpty || '').replace(/^#+\s*/, '');

  const metadata = {};
  const sections = {};
  let currentSection = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^##+\s+(.+)$/);
    if (sectionMatch && sectionMatch[1]) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }

    const bulletMeta = line.match(/^\s*[-*]\s*([^:]+):\s*(.+)$/);
    if (bulletMeta && bulletMeta[1] && bulletMeta[2] && !currentSection) {
      metadata[bulletMeta[1].trim().toLowerCase()] = bulletMeta[2].trim();
      continue;
    }

    if (!currentSection) continue;
    sections[currentSection].push(line);
  }

  const sectionByKeyword = (keyword) => {
    const key = Object.keys(sections).find((name) => name.includes(keyword));
    return key ? sections[key] : [];
  };

  const cleanupLines = (list) => list
    .map((line) => String(line || '').replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim())
    .filter(Boolean);

  const ingredients = cleanupLines(sectionByKeyword('ingredient'));
  const instructions = cleanupLines(sectionByKeyword('instruction').length
    ? sectionByKeyword('instruction')
    : sectionByKeyword('method'));
  const notes = cleanupLines(sectionByKeyword('note')).join('\n') || null;

  const servings = asNullableInt(metadata.servings, 'servings', { min: 1 });
  const prep = parseMinutes(metadata['prep time'], 'prep_time_minutes');
  const cook = parseMinutes(metadata['cook time'], 'cook_time_minutes');
  const overnight = asNullableBool(metadata.overnight, 'overnight');

  return {
    parsed: {
      title: title || null,
      servings,
      ingredients,
      instructions,
      notes,
      cuisine: asNullableString(metadata.cuisine),
      protein: asNullableString(metadata.protein),
      prep_time_minutes: prep,
      cook_time_minutes: cook,
      difficulty: asNullableString(metadata.difficulty),
      tags: asTags(metadata.tags),
      overnight: overnight === null ? false : overnight,
      url_canonical: asNullableString(metadata.url || metadata.link),
      capture_text: captureText,
    },
    parserMeta: {
      mode: sectionByKeyword('ingredient').length && sectionByKeyword('instruction').length
        ? 'structured'
        : 'semi_structured',
      warnings: [],
    },
  };
}

function mergeObjects(base, patch) {
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  for (const key of Object.keys(patch)) {
    out[key] = patch[key];
  }
  return out;
}

function buildCreatePayload(input) {
  const body = (input && typeof input === 'object') ? input : {};
  const payload = (body.recipe && typeof body.recipe === 'object') ? body.recipe : body;

  let parsedFromCapture = null;
  const captureText = asNullableString(payload.capture_text || payload.raw_text);
  if (captureText) {
    parsedFromCapture = parseSectionsFromCapture(captureText);
  }

  const merged = {
    ...(parsedFromCapture ? parsedFromCapture.parsed : {}),
    ...payload,
  };

  const normalized = {
    title: normalizeTitle(merged.title),
    title_normalized: normalizeTitleKey(merged.title),
    servings: asRequiredInt(merged.servings, 'servings', { min: 1 }),
    ingredients: asArrayOfText(merged.ingredients, 'ingredients', { required: true }),
    instructions: asArrayOfText(merged.instructions, 'instructions', { required: true }),
    notes: asNullableString(merged.notes),
    source: asNullableString(merged.source) || 'telegram',
    cuisine: asNullableString(merged.cuisine),
    protein: asNullableString(merged.protein),
    prep_time_minutes: parseMinutes(merged.prep_time_minutes, 'prep_time_minutes'),
    cook_time_minutes: parseMinutes(merged.cook_time_minutes, 'cook_time_minutes'),
    difficulty: asNullableString(merged.difficulty),
    tags: asTags(merged.tags),
    url_canonical: asNullableString(merged.url_canonical || merged.url),
    capture_text: asString(merged.capture_text || merged.raw_text || ''),
    overnight: asNullableBool(merged.overnight, 'overnight') ?? false,
    metadata: parseMetadata(merged.metadata),
    requested_status: asNullableString(merged.status),
    parser_meta: parsedFromCapture ? parsedFromCapture.parserMeta : null,
  };

  if (!normalized.capture_text) {
    throw badRequest('capture_text is required');
  }

  normalized.search_text = buildSearchText(normalized);
  if (!normalized.search_text) {
    throw badRequest('search_text cannot be empty');
  }

  return normalized;
}

function buildPatchPayload(input) {
  const body = (input && typeof input === 'object') ? input : {};
  const public_id = normalizePublicId(body.public_id || body.id || body.recipe_id);
  const patchRaw = (body.patch && typeof body.patch === 'object') ? body.patch : body;

  let parsedFromCapture = null;
  const captureText = asNullableString(patchRaw.capture_text || patchRaw.raw_text);
  if (captureText) {
    parsedFromCapture = parseSectionsFromCapture(captureText);
  }

  const merged = {
    ...(parsedFromCapture ? parsedFromCapture.parsed : {}),
    ...patchRaw,
  };

  const patch = {};

  if (Object.prototype.hasOwnProperty.call(merged, 'title')) {
    patch.title = normalizeTitle(merged.title);
    patch.title_normalized = normalizeTitleKey(merged.title);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'servings')) {
    patch.servings = asRequiredInt(merged.servings, 'servings', { min: 1 });
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'ingredients')) {
    patch.ingredients = asArrayOfText(merged.ingredients, 'ingredients', { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'instructions')) {
    patch.instructions = asArrayOfText(merged.instructions, 'instructions', { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'notes')) {
    patch.notes = asNullableString(merged.notes);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'source')) {
    patch.source = asNullableString(merged.source);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'cuisine')) {
    patch.cuisine = asNullableString(merged.cuisine);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'protein')) {
    patch.protein = asNullableString(merged.protein);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'prep_time_minutes')) {
    patch.prep_time_minutes = parseMinutes(merged.prep_time_minutes, 'prep_time_minutes');
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'cook_time_minutes')) {
    patch.cook_time_minutes = parseMinutes(merged.cook_time_minutes, 'cook_time_minutes');
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'difficulty')) {
    patch.difficulty = asNullableString(merged.difficulty);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'tags')) {
    patch.tags = asTags(merged.tags);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'url_canonical') || Object.prototype.hasOwnProperty.call(merged, 'url')) {
    patch.url_canonical = asNullableString(merged.url_canonical || merged.url);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'capture_text') || Object.prototype.hasOwnProperty.call(merged, 'raw_text')) {
    patch.capture_text = asString(merged.capture_text || merged.raw_text || '');
    if (!patch.capture_text) {
      throw badRequest('capture_text cannot be empty when provided');
    }
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'overnight')) {
    const value = asNullableBool(merged.overnight, 'overnight');
    patch.overnight = value === null ? false : value;
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'status')) {
    patch.requested_status = asNullableString(merged.status);
  }
  if (Object.prototype.hasOwnProperty.call(merged, 'metadata')) {
    patch.metadata = parseMetadata(merged.metadata);
  }

  if (!Object.keys(patch).length) {
    throw badRequest('patch requires at least one updatable field');
  }

  patch.parser_meta = parsedFromCapture ? parsedFromCapture.parserMeta : null;

  return { public_id, patch };
}

function buildOverwritePayload(input) {
  const body = (input && typeof input === 'object') ? input : {};
  const public_id = normalizePublicId(body.public_id || body.id || body.recipe_id);
  const overwriteRaw = (body.recipe && typeof body.recipe === 'object') ? body.recipe : body;
  const createPayload = buildCreatePayload(overwriteRaw);
  return {
    public_id,
    recipe: createPayload,
  };
}

function statusForWrite(currentStatus, requestedStatus, reasons) {
  const statusRaw = asNullableString(requestedStatus);
  const statusLower = statusRaw ? statusRaw.toLowerCase() : null;
  const currentLower = asNullableString(currentStatus) ? String(currentStatus).toLowerCase() : null;

  if (statusLower === 'archived') return 'archived';
  if (statusLower && statusLower !== 'active' && statusLower !== 'needs_review') {
    throw badRequest('status must be one of: active, needs_review, archived');
  }

  if (currentLower === 'archived' && !statusLower) {
    return 'archived';
  }

  return reviewStatusFromReasons(reasons);
}

module.exports = {
  normalizePublicId,
  buildSearchText,
  buildReviewReasons,
  upsertReviewMetadata,
  mergeObjects,
  statusForWrite,
  buildCreatePayload,
  buildPatchPayload,
  buildOverwritePayload,
  badRequest,
};
