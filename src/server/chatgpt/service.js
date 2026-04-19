'use strict';

const { readWorkingMemory } = require('../db/read-store.js');
const { insertPkmEnriched } = require('../db/write-store.js');
const activeTopicRepository = require('../repositories/active-topic-repository.js');
const { deriveContentHashFromCleanText } = require('../../libs/content-hash.js');
const contextPackBuilder = require('../../libs/context-pack-builder-core.js');
const { normalizeTopicLabel, normalizeTopicKey, asText } = require('./topic.js');
const {
  renderSessionNoteMarkdown,
  renderWorkingMemoryMarkdown,
  renderWorkingMemoryFromTopicState,
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

function toPatchKeyList(value, fieldName) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) {
    throw new ChatgptValidationError(`${fieldName} must be an array`, { field: fieldName });
  }
  return value
    .map((item) => asText(item))
    .filter(Boolean);
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

function normalizeView(view) {
  const normalized = asText(view).toLowerCase();
  if (!normalized) return 'gpt';
  return normalized === 'debug' ? 'debug' : 'gpt';
}

function isMissingTopicStateTableError(err) {
  const message = err && err.message ? String(err.message) : '';
  return message.includes('active topic state tables missing');
}

function normalizeTopicFromInput(topic) {
  const topicLabel = normalizeTopicLabel(topic);
  const topicKey = normalizeTopicKey(topicLabel);
  if (!topicKey) {
    throw new ChatgptValidationError('topic must include at least one alphanumeric character', {
      field: 'topic',
      code: 'missing_topic',
    });
  }
  return { topicLabel, topicKey };
}

function toLegacyRowFromReadStoreRow(row, topicLabel) {
  if (!row) return null;
  const found = Object.prototype.hasOwnProperty.call(row, 'found') ? !!row.found : true;
  return {
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
  };
}

function toTopicStateDebugSnapshot(snapshot) {
  if (!snapshot || !snapshot.meta || !snapshot.meta.found) return null;
  return {
    meta: snapshot.meta,
    topic: snapshot.topic || null,
    state: snapshot.state || null,
    open_questions: Array.isArray(snapshot.open_questions) ? snapshot.open_questions : [],
    action_items: Array.isArray(snapshot.action_items) ? snapshot.action_items : [],
    related_entries: Array.isArray(snapshot.related_entries) ? snapshot.related_entries : [],
  };
}

function toRowFromTopicState(snapshot, fallbackTopicLabel) {
  if (!snapshot || !snapshot.meta || !snapshot.meta.found) return null;
  const topic = snapshot.topic && typeof snapshot.topic === 'object' ? snapshot.topic : {};
  const state = snapshot.state && typeof snapshot.state === 'object' ? snapshot.state : {};
  const workingMemoryMarkdown = renderWorkingMemoryFromTopicState(snapshot);
  const summary = firstSentence(state.current_mental_model)
    || firstSentence(state.why_active_now)
    || `Working memory for ${asText(topic.title || topic.topic_key || fallbackTopicLabel)}`;
  const excerpt = firstSentence(state.tensions_uncertainties);
  const contentHash = deriveContentHashFromCleanText(workingMemoryMarkdown.trim());

  return {
    found: true,
    entry_id: state.migration_source_entry_id || null,
    created_at: state.updated_at || topic.updated_at || null,
    topic_primary: asText(topic.title || topic.topic_key || fallbackTopicLabel) || fallbackTopicLabel,
    topic_secondary: '',
    topic_secondary_confidence: null,
    title: asText(state.title || `Working Memory: ${fallbackTopicLabel}`) || `Working Memory: ${fallbackTopicLabel}`,
    gist: summary,
    distill_summary: asText(state.current_mental_model) || summary,
    distill_why_it_matters: asText(state.why_active_now) || '',
    excerpt: excerpt || '',
    working_memory_text: workingMemoryMarkdown,
    content_hash: contentHash || null,
    metadata: {
      chatgpt: {
        artifact_kind: 'working_memory_topic_state',
        topic_key: topic.topic_key || null,
        state_version: state.state_version || null,
      },
      topic_state: {
        open_questions_count: Array.isArray(snapshot.open_questions) ? snapshot.open_questions.length : 0,
        action_items_count: Array.isArray(snapshot.action_items) ? snapshot.action_items.length : 0,
        related_entries_count: Array.isArray(snapshot.related_entries) ? snapshot.related_entries.length : 0,
      },
    },
  };
}

function buildStableItemKey(prefix, text, index) {
  const base = normalizeTopicKey(text) || prefix;
  return `${prefix}-${index + 1}-${base}`;
}

function toOpenQuestionItems(values) {
  return values.map((text, index) => ({
    question_key: buildStableItemKey('q', text, index),
    question_text: text,
    status: 'open',
    sort_order: index + 1,
  }));
}

function toActionItems(values) {
  return values.map((text, index) => ({
    action_key: buildStableItemKey('a', text, index),
    action_text: text,
    status: 'open',
    sort_order: index + 1,
  }));
}

function normalizeTopicPatchUpsertItems(kind, value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ChatgptValidationError(`${kind}.upsert must be an array`, { field: `${kind}.upsert` });
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ChatgptValidationError(`${kind}.upsert[${index}] must be an object`, {
        field: `${kind}.upsert[${index}]`,
      });
    }
    if (kind === 'open_questions') {
      const text = asText(item.text || item.question_text);
      const key = asText(item.id || item.question_key || item.item_key)
        || buildStableItemKey('q', text || `q${index + 1}`, index);
      if (!text) {
        throw new ChatgptValidationError(`${kind}.upsert[${index}].text is required`, {
          field: `${kind}.upsert[${index}].text`,
        });
      }
      const statusRaw = asText(item.status || 'open').toLowerCase();
      const status = statusRaw === 'closed' ? 'closed' : 'open';
      return {
        question_key: key,
        question_text: text,
        status,
      };
    }

    const text = asText(item.text || item.action_text);
    const key = asText(item.id || item.action_key || item.item_key)
      || buildStableItemKey('a', text || `a${index + 1}`, index);
    if (!text) {
      throw new ChatgptValidationError(`${kind}.upsert[${index}].text is required`, {
        field: `${kind}.upsert[${index}].text`,
      });
    }
    const statusRaw = asText(item.status || 'open').toLowerCase();
    const status = statusRaw === 'done' ? 'done' : 'open';
    return {
      action_key: key,
      action_text: text,
      status,
    };
  });
}

function normalizeTopicPatch(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ChatgptValidationError('topic_patch must be an object', { field: 'topic_patch' });
  }

  const stateInput = value.state && typeof value.state === 'object' && !Array.isArray(value.state)
    ? value.state
    : {};
  const statePatch = {};
  const stateFields = ['title', 'why_active_now', 'current_mental_model', 'tensions_uncertainties', 'last_session_id'];
  for (const field of stateFields) {
    if (Object.prototype.hasOwnProperty.call(stateInput, field)) {
      statePatch[field] = asText(stateInput[field]);
    }
  }

  const openQuestions = value.open_questions && typeof value.open_questions === 'object' && !Array.isArray(value.open_questions)
    ? value.open_questions
    : {};
  const actionItems = value.action_items && typeof value.action_items === 'object' && !Array.isArray(value.action_items)
    ? value.action_items
    : {};

  return {
    state_patch: statePatch,
    open_questions_patch: {
      upsert: normalizeTopicPatchUpsertItems('open_questions', openQuestions.upsert),
      close: toPatchKeyList(openQuestions.close, 'topic_patch.open_questions.close'),
      reopen: toPatchKeyList(openQuestions.reopen, 'topic_patch.open_questions.reopen'),
      delete: toPatchKeyList(openQuestions.delete, 'topic_patch.open_questions.delete'),
    },
    action_items_patch: {
      upsert: normalizeTopicPatchUpsertItems('action_items', actionItems.upsert),
      done: toPatchKeyList(actionItems.done, 'topic_patch.action_items.done'),
      reopen: toPatchKeyList(actionItems.reopen, 'topic_patch.action_items.reopen'),
      delete: toPatchKeyList(actionItems.delete, 'topic_patch.action_items.delete'),
    },
  };
}

function hasTopicPatchOperations(patch) {
  if (!patch) return false;
  const state = patch.state_patch || {};
  const hasState = Object.keys(state).length > 0;
  const oq = patch.open_questions_patch || {};
  const hasOq = (Array.isArray(oq.upsert) && oq.upsert.length > 0)
    || (Array.isArray(oq.close) && oq.close.length > 0)
    || (Array.isArray(oq.reopen) && oq.reopen.length > 0)
    || (Array.isArray(oq.delete) && oq.delete.length > 0);
  const ai = patch.action_items_patch || {};
  const hasAi = (Array.isArray(ai.upsert) && ai.upsert.length > 0)
    || (Array.isArray(ai.done) && ai.done.length > 0)
    || (Array.isArray(ai.reopen) && ai.reopen.length > 0)
    || (Array.isArray(ai.delete) && ai.delete.length > 0);
  return hasState || hasOq || hasAi;
}

async function pullWorkingMemory(args) {
  const input = requireObject(args || {}, 'arguments');
  const topic = requireString(input.topic, 'topic');
  const view = normalizeView(input.view);
  const { topicLabel, topicKey } = normalizeTopicFromInput(topic);

  let topicSnapshot = null;
  try {
    topicSnapshot = await activeTopicRepository.getTopicState({ topic_key: topicKey });
  } catch (err) {
    if (!isMissingTopicStateTableError(err)) throw err;
  }

  if (topicSnapshot && topicSnapshot.meta && topicSnapshot.meta.found) {
    const row = toRowFromTopicState(topicSnapshot, topicLabel);
    const result = {
      meta: {
        method: 'pull_working_memory',
        topic: topicLabel,
        topic_key: topicKey,
        found: true,
        source: 'active_topic_state',
      },
      row,
    };
    if (view === 'debug') {
      result.debug = {
        view,
        topic_state: toTopicStateDebugSnapshot(topicSnapshot),
      };
    }
    return result;
  }

  const legacyResult = await readWorkingMemory({ topic_key: topicKey });
  const legacyRawRow = Array.isArray(legacyResult && legacyResult.rows) && legacyResult.rows.length > 0
    ? legacyResult.rows[0]
    : null;
  const legacyRow = toLegacyRowFromReadStoreRow(legacyRawRow, topicLabel);
  const found = !!(legacyRow && legacyRow.found);

  const result = {
    meta: {
      method: 'pull_working_memory',
      topic: topicLabel,
      topic_key: topicKey,
      found,
      source: 'legacy_entry',
    },
    row: legacyRow,
  };
  if (view === 'debug') {
    result.debug = {
      view,
      topic_state: toTopicStateDebugSnapshot(topicSnapshot),
    };
  }
  return result;
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
  const topicPatch = normalizeTopicPatch(input.topic_patch);
  const hasPatch = hasTopicPatchOperations(topicPatch);

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
  const legacyWorkingMemoryMarkdown = renderWorkingMemoryMarkdown(renderInput);
  const sessionCleanText = sessionMarkdown.trim();
  const sessionContentHash = deriveContentHashFromCleanText(sessionCleanText);

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

  const topicSnapshotResult = hasPatch
    ? await activeTopicRepository.applyTopicPatch({
      topic_key: topicKey,
      topic_title: topicPrimary,
      state_patch: {
        ...(topicPatch.state_patch || {}),
        last_session_id: sessionId,
      },
      open_questions_patch: topicPatch.open_questions_patch,
      action_items_patch: topicPatch.action_items_patch,
    })
    : await activeTopicRepository.applyTopicSnapshot({
      topic_key: topicKey,
      topic_title: topicPrimary,
      state: {
        title: topicPrimary,
        why_active_now: whyItMatters,
        current_mental_model: workingMemoryUpdates.join('\n') || sessionSummary || gist,
        tensions_uncertainties: tensions.join('\n'),
        last_session_id: sessionId,
      },
      open_questions: toOpenQuestionItems(openQuestions),
      action_items: toActionItems(nextSteps),
    });

  const topicStateMarkdown = renderWorkingMemoryFromTopicState(topicSnapshotResult);
  const workingMemoryCleanText = topicStateMarkdown.trim() || legacyWorkingMemoryMarkdown.trim();
  const workingMemoryContentHash = deriveContentHashFromCleanText(workingMemoryCleanText);
  const sessionInsertResult = await insertPkmEnriched(sessionInsertInput);

  const sessionRow = Array.isArray(sessionInsertResult && sessionInsertResult.rows)
    ? sessionInsertResult.rows[0]
    : null;

  if (!sessionRow) {
    throw new ChatgptActionError('wrap_commit did not return session-note row', {
      code: 'tool_error',
      statusCode: 500,
    });
  }

  const topicState = topicSnapshotResult && topicSnapshotResult.state
    ? topicSnapshotResult.state
    : {};
  const openQuestionCount = Array.isArray(topicSnapshotResult && topicSnapshotResult.open_questions)
    ? topicSnapshotResult.open_questions.length
    : 0;
  const actionItemCount = Array.isArray(topicSnapshotResult && topicSnapshotResult.action_items)
    ? topicSnapshotResult.action_items.length
    : 0;
  const relatedEntryCount = Array.isArray(topicSnapshotResult && topicSnapshotResult.related_entries)
    ? topicSnapshotResult.related_entries.length
    : 0;

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
      entry_id: topicState.migration_source_entry_id || null,
      id: null,
      created_at: topicState.updated_at || null,
      action: topicSnapshotResult && topicSnapshotResult.write ? topicSnapshotResult.write.state : 'updated',
      title: topicState.title || `Working Memory: ${topicPrimary}`,
      topic_primary: topicPrimary,
      topic_secondary: '',
      topic_secondary_confidence: null,
      state_version: topicState.state_version || null,
      open_questions_count: openQuestionCount,
      action_items_count: actionItemCount,
      related_entries_count: relatedEntryCount,
      idempotency_key_primary: `wm:${topicKey}`,
      idempotency_key_secondary: workingMemoryContentHash,
    },
    artifacts: {
      session_markdown: sessionMarkdown,
      working_memory_markdown: topicStateMarkdown,
    },
  };
}

async function patchTopicState(args) {
  const input = requireObject(args || {}, 'arguments');
  const topicRaw = requireString(
    input.topic || input.topic_primary || input.resolved_topic_primary || input.topic_key,
    'topic'
  );
  const { topicLabel, topicKey } = normalizeTopicFromInput(topicRaw);
  const topicPatch = normalizeTopicPatch(input.topic_patch);
  if (!hasTopicPatchOperations(topicPatch)) {
    throw new ChatgptValidationError('topic_patch must include at least one operation', {
      field: 'topic_patch',
      code: 'missing_topic_patch',
    });
  }

  const snapshot = await activeTopicRepository.applyTopicPatch({
    topic_key: topicKey,
    topic_title: topicLabel,
    state_patch: topicPatch.state_patch,
    open_questions_patch: topicPatch.open_questions_patch,
    action_items_patch: topicPatch.action_items_patch,
  });

  return {
    meta: {
      method: 'patch_topic_state',
      topic: topicLabel,
      topic_key: topicKey,
      found: !!(snapshot && snapshot.meta && snapshot.meta.found),
    },
    topic_state: snapshot,
  };
}

module.exports = {
  ChatgptActionError,
  ChatgptValidationError,
  pullWorkingMemory,
  wrapCommit,
  patchTopicState,
};
