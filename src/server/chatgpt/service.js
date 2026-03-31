'use strict';

const { readWorkingMemory } = require('../db/read-store.js');
const { insert } = require('../db/write-store.js');
const { deriveContentHashFromCleanText } = require('../../libs/content-hash.js');
const contextPackBuilder = require('../../libs/context-pack-builder-core.js');
const { normalizeTopicLabel, normalizeTopicKey, asText } = require('./topic.js');
const {
  renderSessionNoteMarkdown,
  renderWorkingMemoryMarkdown,
} = require('./renderers.js');

class ChatgptActionError extends Error {
  constructor(message, options) {
    super(message);
    const opts = options || {};
    this.name = 'ChatgptActionError';
    this.code = opts.code || 'chatgpt_action_error';
    this.statusCode = Number.isFinite(Number(opts.statusCode)) ? Number(opts.statusCode) : 400;
    this.field = opts.field || null;
  }
}

class ChatgptValidationError extends ChatgptActionError {
  constructor(message, options) {
    super(message, {
      ...(options || {}),
      code: (options && options.code) || 'validation_error',
      statusCode: 400,
    });
    this.name = 'ChatgptValidationError';
  }
}

function missingField(fieldName, message, code) {
  let resolvedCode = code || 'missing_required_field';
  if (!code && fieldName === 'session_id') resolvedCode = 'missing_session_id';
  if (!code && fieldName === 'resolved_topic_primary') resolvedCode = 'missing_topic';
  throw new ChatgptValidationError(message || `${fieldName} is required`, {
    field: fieldName,
    code: resolvedCode,
  });
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChatgptValidationError(`${fieldName} must be an object`);
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

function optionalBoundedNumber(value, fieldName, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ChatgptValidationError(`${fieldName} must be within ${min}..${max}`, { field: fieldName });
  }
  return n;
}

function requiredPositiveInt(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    missingField(fieldName, `${fieldName} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ChatgptValidationError(`${fieldName} must be a positive integer`, { field: fieldName });
  }
  return Math.trunc(n);
}

function toStringList(value, fieldName) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const single = asText(value);
    return single ? [single] : [];
  }
  throw new ChatgptValidationError(`${fieldName} must be a string or string[]`, { field: fieldName });
}

function toEntryIdList(value, fieldName) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ChatgptValidationError(`${fieldName} must be an array of positive integers`, { field: fieldName });
  }
  return value.map((item, index) => requiredPositiveInt(item, `${fieldName}[${index}]`));
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
      .filter((part) => part.length > 1)
  )).slice(0, 12);
}

async function pullWorkingMemory(args) {
  const input = requireObject(args || {}, 'arguments');
  const topic = requireString(input.topic, 'topic');
  const topicLabel = normalizeTopicLabel(topic);
  const topicKey = normalizeTopicKey(topicLabel);
  if (!topicKey) {
    throw new ChatgptValidationError('topic must include at least one alphanumeric character', {
      field: 'topic',
      code: 'missing_topic',
    });
  }

  const result = await readWorkingMemory({ topic_key: topicKey });
  const row = Array.isArray(result && result.rows) && result.rows.length > 0 ? result.rows[0] : null;
  const found = row && Object.prototype.hasOwnProperty.call(row, 'found') ? !!row.found : !!row;

  return {
    meta: {
      method: 'pull_working_memory',
      topic: topicLabel,
      topic_key: topicKey,
      found,
    },
    row: row ? {
      found,
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

async function wrapCommit(args) {
  const input = requireObject(args || {}, 'arguments');

  const sessionId = requireString(input.session_id, 'session_id');
  const topicPrimary = normalizeTopicLabel(requireString(input.resolved_topic_primary, 'resolved_topic_primary'));
  const topicKey = normalizeTopicKey(topicPrimary);
  if (!topicKey) {
    missingField(
      'resolved_topic_primary',
      'resolved_topic_primary must include at least one alphanumeric character',
      'missing_topic'
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

  const renderInput = {
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

  const sessionMarkdown = renderSessionNoteMarkdown(renderInput);
  const workingMemoryMarkdown = renderWorkingMemoryMarkdown(renderInput);
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
  const writeVersion = 'chatgpt.wrap_commit_v1';

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
      chatgpt: {
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
    enrichment_model: writeVersion,
    prompt_version: writeVersion,
    gist,
    retrieval_excerpt: excerpt,
    distill_summary: sessionSummary || gist,
    distill_why_it_matters: whyItMatters,
    distill_stance: 'descriptive',
    distill_version: writeVersion,
    distill_created_from_hash: sessionContentHash,
    distill_status: 'completed',
    distill_metadata: {
      source: 'chatgpt.wrap_commit',
      session_id: sessionId,
      topic_key: topicKey,
      source_entry_refs: sourceEntryRefs,
    },
    idempotency_policy_key: 'chatgpt_session_note_v1',
    idempotency_key_primary: `chatgpt:${sessionId}`,
    idempotency_key_secondary: sessionContentHash,
  };

  const wmSummary = workingMemoryUpdates.join(' | ') || sessionSummary || gist;
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
      chatgpt: {
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
    enrichment_model: writeVersion,
    prompt_version: writeVersion,
    gist: gist || `Working memory for ${topicPrimary}`,
    retrieval_excerpt: wmExcerpt,
    distill_summary: wmSummary,
    distill_why_it_matters: whyItMatters,
    distill_stance: 'descriptive',
    distill_version: writeVersion,
    distill_created_from_hash: workingMemoryContentHash,
    distill_status: 'completed',
    distill_metadata: {
      source: 'chatgpt.wrap_commit',
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

  const sessionInsertResult = await insert({
    input: sessionInsertInput,
    returning,
  });
  const workingMemoryInsertResult = await insert({
    input: workingMemoryInsertInput,
    returning,
  });

  const sessionRow = Array.isArray(sessionInsertResult && sessionInsertResult.rows)
    ? sessionInsertResult.rows[0]
    : null;
  const workingMemoryRow = Array.isArray(workingMemoryInsertResult && workingMemoryInsertResult.rows)
    ? workingMemoryInsertResult.rows[0]
    : null;

  if (!sessionRow || !workingMemoryRow) {
    throw new ChatgptActionError('wrap_commit did not return both artifact rows', {
      code: 'tool_error',
      statusCode: 500,
    });
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
      entry_id: workingMemoryRow.entry_id || null,
      id: workingMemoryRow.id || null,
      created_at: workingMemoryRow.created_at || null,
      action: workingMemoryRow.action || null,
      title: workingMemoryRow.title || workingMemoryTitle,
      topic_primary: workingMemoryRow.topic_primary || topicPrimary,
      topic_secondary: workingMemoryRow.topic_secondary || topicSecondary || '',
      topic_secondary_confidence: workingMemoryRow.topic_secondary_confidence === undefined
        ? topicSecondaryConfidence
        : workingMemoryRow.topic_secondary_confidence,
      idempotency_key_primary: workingMemoryInsertInput.idempotency_key_primary,
      idempotency_key_secondary: workingMemoryInsertInput.idempotency_key_secondary,
    },
    artifacts: {
      session_markdown: sessionMarkdown,
      working_memory_markdown: workingMemoryMarkdown,
    },
  };
}

module.exports = {
  ChatgptActionError,
  ChatgptValidationError,
  pullWorkingMemory,
  wrapCommit,
};
