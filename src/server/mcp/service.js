'use strict';

const db = require('../db.js');
const { getLogger } = require('../logger/index.js');
const { deriveContentHashFromCleanText } = require('../../libs/content-hash.js');
const contextPackBuilder = require('../../libs/context-pack-builder-core.js');
const { listTools, TOOL_NAMES } = require('./registry.js');
const { normalizeTopicLabel, normalizeTopicKey, asText } = require('./topic.js');
const {
  renderSessionNoteMarkdown,
  renderWorkingMemoryMarkdown,
} = require('./renderers.js');

const TOOL_METHODS = {
  'pkm.last': runLast,
  'pkm.find': runFind,
  'pkm.continue': runContinue,
  'pkm.pull': runPull,
  'pkm.pull_working_memory': runPullWorkingMemory,
  'pkm.wrap_commit': runWrapCommit,
};

const MCP_METRICS = {
  read_tool_calls_by_tool: {},
  read_tool_success_by_tool: {},
  read_tool_failure_by_tool: {},
  write_tool_calls: 0,
  write_tool_success: 0,
  write_tool_failure: 0,
  missing_required_field_count: 0,
  missing_session_id_count: 0,
  missing_topic_count: 0,
  backend_validation_failure_count: 0,
  visible_failure_count: 0,
  silent_failure_count: 0,
};

class McpError extends Error {
  constructor(message, options) {
    super(message);
    const opts = options || {};
    this.name = 'McpError';
    this.code = opts.code || 'mcp_error';
    this.statusCode = Number.isFinite(Number(opts.statusCode)) ? Number(opts.statusCode) : 400;
    this.field = opts.field || null;
  }
}

class McpValidationError extends McpError {
  constructor(message, options) {
    super(message, { ...(options || {}), code: (options && options.code) || 'validation_error', statusCode: 400 });
    this.name = 'McpValidationError';
  }
}

class McpToolNotFoundError extends McpError {
  constructor(toolName) {
    super(`unknown MCP tool: ${toolName}`, { code: 'tool_not_found', statusCode: 404 });
    this.name = 'McpToolNotFoundError';
  }
}

function cloneMetrics() {
  return JSON.parse(JSON.stringify(MCP_METRICS));
}

function resetMetrics() {
  MCP_METRICS.read_tool_calls_by_tool = {};
  MCP_METRICS.read_tool_success_by_tool = {};
  MCP_METRICS.read_tool_failure_by_tool = {};
  MCP_METRICS.write_tool_calls = 0;
  MCP_METRICS.write_tool_success = 0;
  MCP_METRICS.write_tool_failure = 0;
  MCP_METRICS.missing_required_field_count = 0;
  MCP_METRICS.missing_session_id_count = 0;
  MCP_METRICS.missing_topic_count = 0;
  MCP_METRICS.backend_validation_failure_count = 0;
  MCP_METRICS.visible_failure_count = 0;
  MCP_METRICS.silent_failure_count = 0;
}

function markVisibleFailure() {
  MCP_METRICS.visible_failure_count += 1;
}

function markSilentFailure() {
  MCP_METRICS.silent_failure_count += 1;
}

function bumpCounter(map, key) {
  const safeKey = String(key || '').trim() || 'unknown';
  map[safeKey] = Number(map[safeKey] || 0) + 1;
}

function trackCall(toolName) {
  if (toolName === 'pkm.wrap_commit') {
    MCP_METRICS.write_tool_calls += 1;
    return;
  }
  bumpCounter(MCP_METRICS.read_tool_calls_by_tool, toolName);
}

function trackSuccess(toolName) {
  if (toolName === 'pkm.wrap_commit') {
    MCP_METRICS.write_tool_success += 1;
    return;
  }
  bumpCounter(MCP_METRICS.read_tool_success_by_tool, toolName);
}

function trackFailure(toolName) {
  if (toolName === 'pkm.wrap_commit') {
    MCP_METRICS.write_tool_failure += 1;
    return;
  }
  bumpCounter(MCP_METRICS.read_tool_failure_by_tool, toolName);
}

function missingField(fieldName, message, code) {
  MCP_METRICS.missing_required_field_count += 1;
  if (fieldName === 'session_id') MCP_METRICS.missing_session_id_count += 1;
  if (fieldName === 'resolved_topic_primary') MCP_METRICS.missing_topic_count += 1;
  let resolvedCode = code || 'missing_required_field';
  if (!code && fieldName === 'session_id') resolvedCode = 'missing_session_id';
  if (!code && fieldName === 'resolved_topic_primary') resolvedCode = 'missing_topic';
  throw new McpValidationError(message || `${fieldName} is required`, {
    field: fieldName,
    code: resolvedCode,
  });
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpValidationError(`${fieldName} must be an object`);
  }
  return value;
}

function requireString(value, fieldName) {
  const out = asText(value);
  if (!out) missingField(fieldName, `${fieldName} is required`);
  return out;
}

function optionalString(value) {
  const out = asText(value);
  return out || null;
}

function optionalPositiveInt(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new McpValidationError(`${fieldName} must be a positive integer`, { field: fieldName });
  }
  return Math.trunc(n);
}

function requiredPositiveInt(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    missingField(fieldName, `${fieldName} is required`);
  }
  return optionalPositiveInt(value, fieldName);
}

function optionalBoundedNumber(value, fieldName, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new McpValidationError(`${fieldName} must be within ${min}..${max}`, { field: fieldName });
  }
  return n;
}

function toStringList(value, fieldName) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const one = asText(value);
    return one ? [one] : [];
  }
  throw new McpValidationError(`${fieldName} must be a string or string[]`, { field: fieldName });
}

function toEntryIdList(value, fieldName) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new McpValidationError(`${fieldName} must be an array of positive integers`, { field: fieldName });
  }
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const n = requiredPositiveInt(value[i], `${fieldName}[${i}]`);
    out.push(n);
  }
  return out;
}

function firstSentence(value) {
  const text = asText(value);
  if (!text) return '';
  const cut = text.split(/[.!?]\s/)[0];
  return asText(cut) || text;
}

function textOrFallback(value, fallback) {
  const out = asText(value);
  return out || fallback;
}

function normalizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter(Boolean);
}

function mapReadRow(row) {
  return {
    entry_id: row.entry_id || null,
    content_type: row.content_type || '',
    author: row.author || '',
    title: row.title || '',
    created_at: row.created_at || null,
    topic_primary: row.topic_primary || '',
    topic_secondary: row.topic_secondary || '',
    keywords: normalizeKeywords(row.keywords),
    gist: row.gist || '',
    distill_summary: row.distill_summary || '',
    distill_why_it_matters: row.distill_why_it_matters || '',
    excerpt: row.excerpt || '',
    url: row.url || '',
    snippet: row.snippet || '',
  };
}

function normalizeReadEnvelope(method, queryArgs, result) {
  const rows = Array.isArray(result && result.rows) ? result.rows : [];
  const metaRow = rows.find((row) => row && row.is_meta === true) || null;
  const hitRows = rows
    .filter((row) => !(row && row.is_meta === true))
    .map((row) => mapReadRow(row));

  return {
    meta: {
      method,
      q: (metaRow && metaRow.query_text) || asText(queryArgs && queryArgs.q) || null,
      days: (metaRow && metaRow.days) || (queryArgs && queryArgs.days) || null,
      limit: (metaRow && metaRow.limit) || (queryArgs && queryArgs.limit) || null,
      hits: Number((metaRow && metaRow.hits) || hitRows.length || 0),
    },
    rows: hitRows,
  };
}

function buildLogInputSummary(toolName, args, requestMeta) {
  const data = args && typeof args === 'object' ? args : {};
  return {
    tool: toolName,
    request_id: requestMeta && requestMeta.request_id ? requestMeta.request_id : null,
    run_id: requestMeta && requestMeta.run_id ? requestMeta.run_id : null,
    session_id: asText(data.session_id) || null,
    topic: asText(data.topic || data.resolved_topic_primary) || null,
    days: data.days === undefined ? null : data.days,
    limit: data.limit === undefined ? null : data.limit,
    entry_id: data.entry_id === undefined ? null : data.entry_id,
    arg_keys: Object.keys(data).sort(),
  };
}

function buildLogOutputSummary(toolName, outcome, result) {
  const base = {
    tool: toolName,
    outcome,
  };
  if (!result || typeof result !== 'object') return base;

  if (Array.isArray(result.rows)) {
    return { ...base, rows: result.rows.length };
  }
  if (result.meta && Object.prototype.hasOwnProperty.call(result.meta, 'hits')) {
    return { ...base, hits: result.meta.hits };
  }
  if (result.meta && Object.prototype.hasOwnProperty.call(result.meta, 'found')) {
    return { ...base, found: !!result.meta.found };
  }
  if (result.session_note || result.working_memory) {
    return {
      ...base,
      session_action: result.session_note ? result.session_note.action || null : null,
      working_memory_action: result.working_memory ? result.working_memory.action || null : null,
    };
  }
  return base;
}

function detectOutcome(toolName, result) {
  if (toolName === 'pkm.wrap_commit') return 'success';
  if (toolName === 'pkm.pull') {
    return result && result.meta && result.meta.found ? 'success' : 'no_result';
  }
  if (toolName === 'pkm.pull_working_memory') {
    return result && result.meta && result.meta.found ? 'success' : 'no_result';
  }
  return (result && Array.isArray(result.rows) && result.rows.length > 0) ? 'success' : 'no_result';
}

function extractManualExcerpt(values) {
  const derived = contextPackBuilder.deriveExcerptFromRecord(values, {
    maxLen: 320,
    includeFallbackKeys: false,
  });
  return asText(derived);
}

function deriveKeywords(topicPrimary, topicSecondary) {
  const joined = `${asText(topicPrimary)} ${asText(topicSecondary)}`.trim().toLowerCase();
  if (!joined) return [];
  return Array.from(new Set(
    joined
      .split(/[^a-z0-9]+/g)
      .map((part) => part.trim())
      .filter((part) => part.length > 1),
  )).slice(0, 12);
}

async function runLast(args) {
  const input = requireObject(args || {}, 'arguments');
  const q = requireString(input.q, 'q');
  const days = optionalPositiveInt(input.days, 'days');
  const limit = optionalPositiveInt(input.limit, 'limit');
  const result = await db.readLast({
    q,
    days: days || undefined,
    limit: limit || undefined,
  });
  return normalizeReadEnvelope('last', { q, days, limit }, result);
}

async function runFind(args) {
  const input = requireObject(args || {}, 'arguments');
  const q = requireString(input.q, 'q');
  const days = optionalPositiveInt(input.days, 'days');
  const limit = optionalPositiveInt(input.limit, 'limit');
  const result = await db.readFind({
    q,
    days: days || undefined,
    limit: limit || undefined,
  });
  return normalizeReadEnvelope('find', { q, days, limit }, result);
}

async function runContinue(args) {
  const input = requireObject(args || {}, 'arguments');
  const q = requireString(input.q, 'q');
  const days = optionalPositiveInt(input.days, 'days');
  const limit = optionalPositiveInt(input.limit, 'limit');
  const result = await db.readContinue({
    q,
    days: days || undefined,
    limit: limit || undefined,
  });
  return normalizeReadEnvelope('continue', { q, days, limit }, result);
}

async function runPull(args) {
  const input = requireObject(args || {}, 'arguments');
  const entryId = requiredPositiveInt(input.entry_id, 'entry_id');
  const shortN = optionalPositiveInt(input.shortN, 'shortN');
  const longN = optionalPositiveInt(input.longN, 'longN');
  const result = await db.readPull({
    entry_id: entryId,
    shortN: shortN || undefined,
    longN: longN || undefined,
  });
  const row = Array.isArray(result && result.rows) && result.rows.length > 0 ? result.rows[0] : null;
  return {
    meta: {
      method: 'pull',
      entry_id: entryId,
      shortN: shortN || null,
      longN: longN || null,
      found: !!row,
    },
    row: row ? {
      entry_id: row.entry_id || null,
      content_type: row.content_type || '',
      author: row.author || '',
      title: row.title || '',
      created_at: row.created_at || null,
      topic_primary: row.topic_primary || '',
      topic_secondary: row.topic_secondary || '',
      keywords: normalizeKeywords(row.keywords),
      gist: row.gist || '',
      distill_summary: row.distill_summary || '',
      distill_why_it_matters: row.distill_why_it_matters || '',
      excerpt: row.excerpt || '',
      excerpt_long: row.excerpt_long || '',
      clean_text: row.clean_text || '',
      url: row.url || '',
    } : null,
  };
}

async function runPullWorkingMemory(args) {
  const input = requireObject(args || {}, 'arguments');
  const topic = requireString(input.topic, 'topic');
  const topicLabel = normalizeTopicLabel(topic);
  const topicKey = normalizeTopicKey(topicLabel);
  if (!topicKey) {
    missingField('topic', 'topic must include at least one alphanumeric character', 'missing_topic');
  }

  const result = await db.readWorkingMemory({ topic_key: topicKey });
  const row = Array.isArray(result && result.rows) && result.rows.length > 0 ? result.rows[0] : null;

  return {
    meta: {
      method: 'pull_working_memory',
      topic: topicLabel,
      topic_key: topicKey,
      found: !!row,
    },
    row: row ? {
      entry_id: row.entry_id || null,
      created_at: row.created_at || null,
      topic_primary: row.topic_primary || topicLabel,
      topic_secondary: row.topic_secondary || '',
      topic_secondary_confidence: row.topic_secondary_confidence === undefined ? null : row.topic_secondary_confidence,
      title: row.title || '',
      gist: row.gist || '',
      distill_summary: row.distill_summary || '',
      distill_why_it_matters: row.distill_why_it_matters || '',
      excerpt: row.excerpt || '',
      working_memory_text: row.capture_text || row.clean_text || '',
      content_hash: row.content_hash || null,
      metadata: row.metadata || null,
    } : null,
  };
}

async function runWrapCommit(args) {
  const input = requireObject(args || {}, 'arguments');

  const sessionId = requireString(input.session_id, 'session_id');
  const topicPrimary = normalizeTopicLabel(requireString(input.resolved_topic_primary, 'resolved_topic_primary'));
  const topicKey = normalizeTopicKey(topicPrimary);
  if (!topicKey) {
    missingField(
      'resolved_topic_primary',
      'resolved_topic_primary must include at least one alphanumeric character',
      'missing_topic',
    );
  }
  const topicSecondary = optionalString(input.resolved_topic_secondary);
  const topicSecondaryConfidence = optionalBoundedNumber(input.topic_secondary_confidence, 'topic_secondary_confidence', 0, 1);
  const chatTitle = optionalString(input.chat_title);
  const sessionSummary = textOrFallback(input.session_summary, '');
  const whyItMattersList = toStringList(input.why_it_matters, 'why_it_matters');
  const contextUsed = toStringList(input.context_used, 'context_used');
  const keyInsights = toStringList(input.key_insights, 'key_insights');
  const decisions = toStringList(input.decisions, 'decisions');
  const tensions = toStringList(input.tensions, 'tensions');
  const openQuestions = toStringList(input.open_questions, 'open_questions');
  const nextSteps = toStringList(input.next_steps, 'next_steps');
  const workingMemoryUpdates = toStringList(input.working_memory_updates, 'working_memory_updates');
  const sourceEntryRefs = toEntryIdList(input.source_entry_refs, 'source_entry_refs');

  const sessionRenderInput = {
    ...input,
    resolved_topic_primary: topicPrimary,
    resolved_topic_secondary: topicSecondary,
    topic_secondary_confidence: topicSecondaryConfidence,
    context_used: contextUsed,
    key_insights: keyInsights,
    decisions,
    tensions,
    open_questions: openQuestions,
    next_steps: nextSteps,
    working_memory_updates: workingMemoryUpdates,
    why_it_matters: whyItMattersList,
  };

  const workingMemoryRenderInput = {
    ...sessionRenderInput,
  };

  const sessionMarkdown = renderSessionNoteMarkdown(sessionRenderInput);
  const workingMemoryMarkdown = renderWorkingMemoryMarkdown(workingMemoryRenderInput);

  const sessionCleanText = sessionMarkdown.trim();
  const workingMemoryCleanText = workingMemoryMarkdown.trim();
  const sessionContentHash = deriveContentHashFromCleanText(sessionCleanText);
  const workingMemoryContentHash = deriveContentHashFromCleanText(workingMemoryCleanText);

  const defaultGist = firstSentence(sessionSummary)
    || firstSentence(workingMemoryUpdates[0])
    || `Session update for ${topicPrimary}`;
  const gist = textOrFallback(input.gist, defaultGist);
  const whyItMatters = whyItMattersList.length ? whyItMattersList.join(' ') : textOrFallback(sessionSummary, gist);

  const inferredExcerpt = extractManualExcerpt({
    distill_summary: sessionSummary,
    gist,
    excerpt: optionalString(input.excerpt),
    clean_text: sessionCleanText,
  });
  const excerpt = inferredExcerpt || firstSentence(sessionCleanText);

  const nowIso = new Date().toISOString();
  const dateStamp = nowIso.slice(0, 10);
  const sessionTitle = chatTitle
    ? `Session: ${chatTitle}`
    : `Session: ${topicPrimary} (${dateStamp})`;
  const workingMemoryTitle = `Working Memory: ${topicPrimary}`;
  const keywords = deriveKeywords(topicPrimary, topicSecondary);

  const sessionInsertInput = {
    source: 'chatgpt',
    intent: 'thought',
    content_type: 'note',
    title: sessionTitle,
    author: 'chatgpt',
    capture_text: sessionMarkdown,
    clean_text: sessionCleanText,
    content_hash: sessionContentHash,
    metadata: {
      mcp: {
        artifact_kind: 'session_note',
        session_id: sessionId,
        topic_key: topicKey,
        source_entry_refs: sourceEntryRefs,
        committed_at: nowIso,
      },
    },
    topic_primary: topicPrimary,
    topic_secondary: topicSecondary,
    topic_secondary_confidence: topicSecondaryConfidence,
    keywords,
    enrichment_status: 'completed',
    enrichment_model: 'mcp.wrap_commit_v1',
    prompt_version: 'mcp.wrap_commit_v1',
    gist,
    retrieval_excerpt: excerpt,
    distill_summary: sessionSummary || gist,
    distill_why_it_matters: whyItMatters,
    distill_stance: 'descriptive',
    distill_version: 'mcp.wrap_commit_v1',
    distill_created_from_hash: sessionContentHash,
    distill_status: 'completed',
    distill_metadata: {
      source: 'mcp.wrap_commit',
      session_id: sessionId,
      topic_key: topicKey,
      source_entry_refs: sourceEntryRefs,
    },
    idempotency_policy_key: 'chatgpt_session_note_v1',
    idempotency_key_primary: `chatgpt:${sessionId}`,
    idempotency_key_secondary: sessionContentHash,
  };

  const wmSummary = workingMemoryUpdates.join(' | ')
    || sessionSummary
    || gist;
  const wmExcerpt = firstSentence(workingMemoryCleanText);
  const workingMemoryInsertInput = {
    source: 'chatgpt',
    intent: 'thought',
    content_type: 'working_memory',
    title: workingMemoryTitle,
    author: 'chatgpt',
    capture_text: workingMemoryMarkdown,
    clean_text: workingMemoryCleanText,
    content_hash: workingMemoryContentHash,
    metadata: {
      mcp: {
        artifact_kind: 'working_memory',
        session_id: sessionId,
        topic_key: topicKey,
        source_entry_refs: sourceEntryRefs,
        committed_at: nowIso,
      },
    },
    topic_primary: topicPrimary,
    topic_secondary: topicSecondary,
    topic_secondary_confidence: topicSecondaryConfidence,
    keywords,
    enrichment_status: 'completed',
    enrichment_model: 'mcp.wrap_commit_v1',
    prompt_version: 'mcp.wrap_commit_v1',
    gist: gist || `Working memory for ${topicPrimary}`,
    retrieval_excerpt: wmExcerpt,
    distill_summary: wmSummary,
    distill_why_it_matters: whyItMatters,
    distill_stance: 'descriptive',
    distill_version: 'mcp.wrap_commit_v1',
    distill_created_from_hash: workingMemoryContentHash,
    distill_status: 'completed',
    distill_metadata: {
      source: 'mcp.wrap_commit',
      session_id: sessionId,
      topic_key: topicKey,
      source_entry_refs: sourceEntryRefs,
    },
    idempotency_policy_key: 'chatgpt_working_memory_v1',
    idempotency_key_primary: `wm:${topicKey}`,
    idempotency_key_secondary: workingMemoryContentHash,
  };

  const returning = [
    'entry_id',
    'id',
    'created_at',
    'source',
    'intent',
    'content_type',
    'title',
    'topic_primary',
    'topic_secondary',
    'topic_secondary_confidence',
  ];

  const sessionInsertResult = await db.insert({
    input: sessionInsertInput,
    returning,
  });
  const wmInsertResult = await db.insert({
    input: workingMemoryInsertInput,
    returning,
  });

  const sessionRow = Array.isArray(sessionInsertResult && sessionInsertResult.rows)
    ? sessionInsertResult.rows[0]
    : null;
  const wmRow = Array.isArray(wmInsertResult && wmInsertResult.rows)
    ? wmInsertResult.rows[0]
    : null;

  if (!sessionRow || !wmRow) {
    throw new McpError('wrap_commit did not return both artifact rows', { code: 'tool_error', statusCode: 500 });
  }

  return {
    meta: {
      method: 'wrap_commit',
      session_id: sessionId,
      topic_primary: topicPrimary,
      topic_key: topicKey,
    },
    session_note: {
      entry_id: sessionRow.entry_id || null,
      id: sessionRow.id || null,
      created_at: sessionRow.created_at || null,
      action: sessionRow.action || null,
      title: sessionRow.title || sessionTitle,
      topic_primary: sessionRow.topic_primary || topicPrimary,
      topic_secondary: sessionRow.topic_secondary || topicSecondary || '',
      topic_secondary_confidence: sessionRow.topic_secondary_confidence === undefined
        ? topicSecondaryConfidence
        : sessionRow.topic_secondary_confidence,
      idempotency_key_primary: sessionInsertInput.idempotency_key_primary,
      idempotency_key_secondary: sessionInsertInput.idempotency_key_secondary,
    },
    working_memory: {
      entry_id: wmRow.entry_id || null,
      id: wmRow.id || null,
      created_at: wmRow.created_at || null,
      action: wmRow.action || null,
      title: wmRow.title || workingMemoryTitle,
      topic_primary: wmRow.topic_primary || topicPrimary,
      topic_secondary: wmRow.topic_secondary || topicSecondary || '',
      topic_secondary_confidence: wmRow.topic_secondary_confidence === undefined
        ? topicSecondaryConfidence
        : wmRow.topic_secondary_confidence,
      idempotency_key_primary: workingMemoryInsertInput.idempotency_key_primary,
      idempotency_key_secondary: workingMemoryInsertInput.idempotency_key_secondary,
    },
    artifacts: {
      session_markdown: sessionMarkdown,
      working_memory_markdown: workingMemoryMarkdown,
    },
  };
}

async function callTool(toolName, args, requestMeta) {
  const name = asText(toolName);
  if (!TOOL_NAMES.has(name)) {
    throw new McpToolNotFoundError(name);
  }
  const runFn = TOOL_METHODS[name];
  if (typeof runFn !== 'function') {
    throw new McpToolNotFoundError(name);
  }

  const meta = requestMeta || {};
  const logger = meta.logger || getLogger().child({
    service: 'pkm-server',
    pipeline: 'mcp',
    meta: {
      route: '/mcp',
    },
  });

  trackCall(name);

  try {
    const result = await logger.step(
      `mcp.tool.${name}`,
      async () => runFn(args || {}),
      {
        input: buildLogInputSummary(name, args || {}, meta),
        output: (out) => buildLogOutputSummary(name, detectOutcome(name, out), out),
        meta: {
          mcp_tool: name,
          mcp_request_id: meta.request_id || null,
          session_id: asText((args && args.session_id) || null) || null,
          topic_primary: asText((args && (args.topic || args.resolved_topic_primary)) || null) || null,
        },
      },
    );
    const outcome = detectOutcome(name, result);
    trackSuccess(name);
    return {
      tool: name,
      outcome,
      result,
    };
  } catch (err) {
    trackFailure(name);
    if (err instanceof McpValidationError) {
      MCP_METRICS.backend_validation_failure_count += 1;
    }
    throw err;
  }
}

function summarizeToolCallResult(toolResult) {
  const payload = toolResult && toolResult.result;
  if (!payload || typeof payload !== 'object') return { ok: false };
  if (Array.isArray(payload.rows)) return { rows: payload.rows.length };
  if (payload.meta && Object.prototype.hasOwnProperty.call(payload.meta, 'hits')) {
    return { hits: payload.meta.hits };
  }
  if (payload.meta && Object.prototype.hasOwnProperty.call(payload.meta, 'found')) {
    return { found: !!payload.meta.found };
  }
  if (payload.session_note || payload.working_memory) {
    return {
      session_action: payload.session_note ? payload.session_note.action || null : null,
      working_memory_action: payload.working_memory ? payload.working_memory.action || null : null,
    };
  }
  return { ok: true };
}

module.exports = {
  McpError,
  McpValidationError,
  McpToolNotFoundError,
  listTools,
  callTool,
  getMetrics: cloneMetrics,
  resetMetrics,
  markVisibleFailure,
  markSilentFailure,
  summarizeToolCallResult,
};
