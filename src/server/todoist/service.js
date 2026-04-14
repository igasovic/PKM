'use strict';

const { getPool } = require('../db-pool.js');
const todoistStore = require('../db/todoist-store.js');
const { runTodoistNormalizationGraphWithTrace } = require('./normalization.graph.js');
const { normalizeIncomingTask, buildNextState } = require('./reconcile.js');
const { computeReviewStatus } = require('./review-rules.js');
const { generateRationales } = require('./rationale.js');
const {
  applyRationale,
  buildDailyBrief,
  buildWaitingBrief,
  buildWeeklyBrief,
} = require('./ranking.js');
const {
  asText,
  parseBoolean,
  detectExplicitProjectSignal,
} = require('./constants.js');

function nowIso(input) {
  const d = input ? new Date(input) : new Date();
  if (!Number.isFinite(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function dedupeTasks(tasks) {
  const map = new Map();
  for (const raw of tasks) {
    const normalized = normalizeIncomingTask(raw);
    map.set(normalized.todoist_task_id, normalized);
  }
  return Array.from(map.values());
}

function parsePatchFromExisting(existing) {
  if (!existing) {
    return {
      normalized_title_en: null,
      task_shape: null,
      suggested_next_action: null,
      parse_confidence: 0,
      parse_failed: true,
      parse_failure_reason: 'missing_existing_parse',
    };
  }
  return {
    normalized_title_en: existing.normalized_title_en,
    task_shape: existing.task_shape,
    suggested_next_action: existing.suggested_next_action,
    parse_confidence: Number(existing.parse_confidence || 0),
    parse_failed: false,
    parse_failure_reason: null,
  };
}

function parseEventForNormalization(existing, next, parseOut, reason, ts) {
  const before = existing
    ? {
      normalized_title_en: existing.normalized_title_en,
      task_shape: existing.task_shape,
      suggested_next_action: existing.suggested_next_action,
      parse_confidence: existing.parse_confidence,
      review_status: existing.review_status,
    }
    : null;
  const after = {
    normalized_title_en: next.normalized_title_en,
    task_shape: next.task_shape,
    suggested_next_action: next.suggested_next_action,
    parse_confidence: next.parse_confidence,
    review_status: next.review_status,
  };

  return {
    event_type: parseOut.parse_failed ? 'parse_failed' : 'parse_updated',
    changed_fields: ['normalized_title_en', 'task_shape', 'suggested_next_action', 'parse_confidence', 'review_status'],
    before_json: before,
    after_json: after,
    reason,
    event_at: ts,
  };
}

async function syncTodoistSurface(input, options = {}) {
  const body = input && typeof input === 'object' ? input : {};
  if (!Array.isArray(body.tasks)) {
    const err = new Error('tasks must be an array');
    err.statusCode = 400;
    throw err;
  }
  const runId = asText(body.run_id) || null;
  const timestamp = nowIso(body.fetched_at || body.now || null);
  const rawTasks = body.tasks;
  const tasks = dedupeTasks(rawTasks);

  const existingRows = await todoistStore.listCurrentByTodoistIds(tasks.map((task) => task.todoist_task_id));
  const existingByTodoistId = new Map(existingRows.map((row) => [row.todoist_task_id, row]));

  const pool = getPool();
  const client = await pool.connect();
  const summary = {
    run_id: runId,
    synced_count: 0,
    inserted_count: 0,
    updated_count: 0,
    closed_count: 0,
    parse_trigger_count: 0,
    parse_failed_count: 0,
    review_needs_count: 0,
    accepted_preserved_count: 0,
    overridden_preserved_count: 0,
    tasks: [],
  };

  try {
    await client.query('BEGIN');

    for (const incoming of tasks) {
      const existing = existingByTodoistId.get(incoming.todoist_task_id) || null;
      const state = buildNextState(existing, incoming, timestamp);
      const parseDecision = state.parse_triggered
        ? await runTodoistNormalizationGraphWithTrace({
          raw_title: incoming.raw_title,
          raw_description: incoming.raw_description,
          project_key: incoming.project_key,
          todoist_section_name: incoming.todoist_section_name,
          lifecycle_status: incoming.lifecycle_status,
          has_subtasks: incoming.has_subtasks === true,
          explicit_project_signal: incoming.explicit_project_signal === true,
        })
        : { result: parsePatchFromExisting(existing), trace: { skipped: true, reason: 'no_parse_trigger' } };

      const parseOut = parseDecision && parseDecision.result
        ? parseDecision.result
        : parsePatchFromExisting(existing);

      const review = computeReviewStatus({
        lifecycle_status: incoming.lifecycle_status,
        project_key: incoming.project_key,
        task_shape: parseOut.task_shape,
        suggested_next_action: parseOut.suggested_next_action,
        parse_confidence: parseOut.parse_confidence,
        parse_failed: parseOut.parse_failed,
        has_subtasks: incoming.has_subtasks === true,
        explicit_project_signal: incoming.explicit_project_signal === true,
        previous_review_status: existing ? existing.review_status : null,
        parse_triggered: state.parse_triggered,
      }, options);

      const nextRow = {
        ...incoming,
        normalized_title_en: parseOut.normalized_title_en || incoming.raw_title,
        task_shape: parseOut.task_shape || 'unknown',
        suggested_next_action: parseOut.suggested_next_action || null,
        parse_confidence: Number(parseOut.parse_confidence || 0),
        review_status: review.review_status,
        review_reasons: review.review_reasons,
        todoist_added_at: incoming.todoist_added_at,
        first_seen_at: state.first_seen_at,
        last_seen_at: state.last_seen_at,
        waiting_since_at: state.waiting_since_at,
        closed_at: state.closed_at,
        parsed_at: state.parse_triggered ? state.now_iso : (existing ? existing.parsed_at : state.now_iso),
        created_at: existing ? existing.created_at : state.now_iso,
        updated_at: state.now_iso,
      };

      const saved = await todoistStore.upsertTaskCurrent(nextRow, { client });
      const events = Array.isArray(state.events) ? state.events.slice() : [];
      if (state.parse_triggered) {
        events.push(parseEventForNormalization(existing, nextRow, parseOut, state.parse_trigger_reason || 'parse_triggered', state.now_iso));
      }
      if (events.length) {
        await todoistStore.insertTaskEvents(saved.id, events, { client });
      }

      summary.synced_count += 1;
      if (!existing) summary.inserted_count += 1;
      else summary.updated_count += 1;
      if (state.parse_triggered) summary.parse_trigger_count += 1;
      if (parseOut.parse_failed) summary.parse_failed_count += 1;
      if (review.review_status === 'needs_review') summary.review_needs_count += 1;
      if (!state.parse_triggered && existing && existing.review_status === 'accepted') summary.accepted_preserved_count += 1;
      if (!state.parse_triggered && existing && existing.review_status === 'overridden') summary.overridden_preserved_count += 1;
      summary.tasks.push({
        todoist_task_id: saved.todoist_task_id,
        review_status: saved.review_status,
        parse_triggered: state.parse_triggered,
      });
    }

    const closedRows = await todoistStore.closeMissingTasks(tasks.map((task) => task.todoist_task_id), timestamp, { client });
    for (const row of closedRows) {
      await todoistStore.insertTaskEvents(row.id, [{
        event_type: 'closed',
        changed_fields: ['lifecycle_status', 'closed_at'],
        before_json: { lifecycle_status: row.previous_lifecycle_status || 'open' },
        after_json: { lifecycle_status: 'closed', closed_at: row.closed_at || timestamp },
        reason: 'missing_from_active_fetch',
        event_at: timestamp,
      }], { client });
    }
    summary.closed_count = closedRows.length;

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getReviewQueue(input) {
  const body = input && typeof input === 'object' ? input : {};
  const queue = await todoistStore.listReviewQueue({
    view: body.view,
    limit: body.limit,
    offset: body.offset,
  });

  const selectedTodoistTaskId = asText(body.todoist_task_id);
  if (!selectedTodoistTaskId) {
    return {
      ...queue,
      selected: null,
      events: [],
    };
  }

  const selected = await todoistStore.getTaskByTodoistTaskId(selectedTodoistTaskId);
  if (!selected) {
    return {
      ...queue,
      selected: null,
      events: [],
    };
  }

  const events = await todoistStore.listTaskEvents(selected.id, { limit: body.events_limit || 100 });
  return {
    ...queue,
    selected,
    events,
  };
}

async function acceptReview(input) {
  const body = input && typeof input === 'object' ? input : {};
  const todoistTaskId = asText(body.todoist_task_id);
  if (!todoistTaskId) throw new Error('todoist_task_id is required');
  const existing = await todoistStore.getTaskByTodoistTaskId(todoistTaskId);
  if (!existing) return null;

  const updated = await todoistStore.updateTaskForReviewAction(todoistTaskId, {
    review_status: 'accepted',
    review_reasons: ['manual_accept'],
  });
  if (!updated) return null;

  await todoistStore.insertTaskEvents(updated.id, [{
    event_type: 'review_accepted',
    changed_fields: ['review_status'],
    before_json: { review_status: existing.review_status || null },
    after_json: { review_status: 'accepted' },
    reason: asText(body.reason) || 'manual_accept',
    event_at: nowIso(body.event_at),
  }]);

  return updated;
}

async function overrideReview(input) {
  const body = input && typeof input === 'object' ? input : {};
  const todoistTaskId = asText(body.todoist_task_id);
  if (!todoistTaskId) throw new Error('todoist_task_id is required');

  const existing = await todoistStore.getTaskByTodoistTaskId(todoistTaskId);
  if (!existing) return null;

  const updated = await todoistStore.updateTaskForReviewAction(todoistTaskId, {
    normalized_title_en: body.normalized_title_en,
    task_shape: body.task_shape,
    suggested_next_action: body.suggested_next_action,
    review_status: 'overridden',
    review_reasons: ['manual_override'],
    parsed_at: nowIso(body.event_at),
  });
  if (!updated) return null;

  await todoistStore.insertTaskEvents(updated.id, [{
    event_type: 'override_applied',
    changed_fields: ['normalized_title_en', 'task_shape', 'suggested_next_action', 'review_status'],
    before_json: {
      normalized_title_en: existing.normalized_title_en,
      task_shape: existing.task_shape,
      suggested_next_action: existing.suggested_next_action,
      review_status: existing.review_status,
    },
    after_json: {
      normalized_title_en: updated.normalized_title_en,
      task_shape: updated.task_shape,
      suggested_next_action: updated.suggested_next_action,
      review_status: updated.review_status,
    },
    reason: asText(body.reason) || 'manual_override',
    event_at: nowIso(body.event_at),
  }]);

  return updated;
}

async function reparseReview(input) {
  const body = input && typeof input === 'object' ? input : {};
  const todoistTaskId = asText(body.todoist_task_id);
  if (!todoistTaskId) throw new Error('todoist_task_id is required');

  const existing = await todoistStore.getTaskByTodoistTaskId(todoistTaskId);
  if (!existing) return null;

  const explicitProjectSignal = detectExplicitProjectSignal(existing.raw_title);
  const hasSubtasks = parseBoolean(existing.has_subtasks, false);
  const parseRun = await runTodoistNormalizationGraphWithTrace({
    raw_title: existing.raw_title,
    raw_description: existing.raw_description,
    project_key: existing.project_key,
    todoist_section_name: existing.todoist_section_name,
    lifecycle_status: existing.lifecycle_status,
    has_subtasks: hasSubtasks,
    explicit_project_signal: explicitProjectSignal,
  });

  const parseOut = parseRun && parseRun.result ? parseRun.result : parsePatchFromExisting(existing);
  const review = computeReviewStatus({
    lifecycle_status: existing.lifecycle_status,
    project_key: existing.project_key,
    task_shape: parseOut.task_shape,
    suggested_next_action: parseOut.suggested_next_action,
    parse_confidence: parseOut.parse_confidence,
    parse_failed: parseOut.parse_failed,
    has_subtasks: hasSubtasks,
    explicit_project_signal: explicitProjectSignal,
    previous_review_status: existing.review_status,
    parse_triggered: true,
  });

  const updated = await todoistStore.updateTaskForReviewAction(todoistTaskId, {
    normalized_title_en: parseOut.normalized_title_en || existing.raw_title,
    task_shape: parseOut.task_shape || 'unknown',
    suggested_next_action: parseOut.suggested_next_action || null,
    parse_confidence: Number(parseOut.parse_confidence || 0),
    review_status: review.review_status,
    review_reasons: review.review_reasons,
    parsed_at: nowIso(body.event_at),
  });
  if (!updated) return null;

  await todoistStore.insertTaskEvents(updated.id, [parseEventForNormalization(
    existing,
    updated,
    parseOut,
    'manual_reparse',
    nowIso(body.event_at)
  )]);

  const events = await todoistStore.listTaskEvents(updated.id, { limit: 100 });
  return {
    ...updated,
    events,
  };
}

function uniqueByTodoistTaskId(items) {
  const map = new Map();
  for (const item of items) {
    const key = asText(item && item.todoist_task_id);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function formatDailyTelegramMessage(brief) {
  const lines = [];
  lines.push('Todoist Daily Focus');
  lines.push('');

  lines.push('Top 3');
  if (!brief.top_3.length) lines.push('- none');
  for (const item of brief.top_3) {
    lines.push(`- ${item.normalized_title_en || item.raw_title} (${item.project_key})`);
    if (item.why_now) lines.push(`  ${item.why_now}`);
  }

  lines.push('');
  lines.push('Overdue Now');
  if (!brief.overdue_now.length) lines.push('- none');
  for (const item of brief.overdue_now) {
    lines.push(`- ${item.normalized_title_en || item.raw_title} (${item.overdue_days}d overdue)`);
  }

  lines.push('');
  lines.push('Waiting Nudges');
  if (!brief.waiting_nudges.length) lines.push('- none');
  for (const item of brief.waiting_nudges) {
    const who = item.grouped_entity ? ` -> ${item.grouped_entity}` : '';
    lines.push(`- ${item.normalized_title_en || item.raw_title} (${item.waiting_age_days}d waiting${who})`);
    if (item.why_nudge) lines.push(`  ${item.why_nudge}`);
  }

  if (brief.quick_win.length) {
    lines.push('');
    lines.push('Quick Win');
    lines.push(`- ${brief.quick_win[0].normalized_title_en || brief.quick_win[0].raw_title}`);
  }

  return lines.join('\n').trim();
}

function formatWaitingTelegramMessage(brief) {
  const lines = [];
  lines.push('Todoist Waiting Radar');
  lines.push('');
  if (!brief.nudges.length) {
    lines.push('No waiting nudges right now.');
    return lines.join('\n');
  }

  for (const item of brief.nudges) {
    const who = item.grouped_entity ? ` -> ${item.grouped_entity}` : '';
    lines.push(`- ${item.normalized_title_en || item.raw_title} (${item.waiting_age_days}d${who})`);
    if (item.why_nudge) lines.push(`  ${item.why_nudge}`);
  }
  return lines.join('\n').trim();
}

function formatWeeklyTelegramMessage(brief) {
  const lines = [];
  lines.push('Todoist Weekly Pruning');
  lines.push('');
  if (!brief.suggestions.length) {
    lines.push('No weekly pruning suggestions.');
    return lines.join('\n');
  }

  for (const item of brief.suggestions) {
    lines.push(`- [${item.recommendation_type}] ${item.normalized_title_en || item.raw_title}`);
    if (item.why_recommended) lines.push(`  ${item.why_recommended}`);
  }

  return lines.join('\n').trim();
}

async function buildDailyBriefSurface(input) {
  const body = input && typeof input === 'object' ? input : {};
  const rows = await todoistStore.listCurrentTasks({ includeClosed: false });
  const brief = buildDailyBrief(rows, { now: body.now ? new Date(body.now) : new Date() });

  const dailyReasonItems = uniqueByTodoistTaskId([
    ...brief.top_3,
    ...brief.overdue_now,
    ...brief.quick_win,
  ]);
  const whyNow = await generateRationales('daily', dailyReasonItems);
  const whyNudge = await generateRationales('waiting', brief.waiting_nudges);

  const out = {
    brief_kind: 'daily_focus',
    run_id: asText(body.run_id) || null,
    telegram_chat_id: asText(body.telegram_chat_id) || null,
    ...brief,
    top_3: applyRationale(brief.top_3, whyNow, 'why_now'),
    overdue_now: applyRationale(brief.overdue_now, whyNow, 'why_now'),
    quick_win: applyRationale(brief.quick_win, whyNow, 'why_now'),
    waiting_nudges: applyRationale(brief.waiting_nudges, whyNudge, 'why_nudge'),
  };

  out.telegram_message = formatDailyTelegramMessage(out);
  return out;
}

async function buildWaitingBriefSurface(input) {
  const body = input && typeof input === 'object' ? input : {};
  const rows = await todoistStore.listCurrentTasks({ includeClosed: false });
  const brief = buildWaitingBrief(rows, { now: body.now ? new Date(body.now) : new Date() });
  const reasons = await generateRationales('waiting', brief.nudges);

  const out = {
    brief_kind: 'waiting_radar',
    run_id: asText(body.run_id) || null,
    telegram_chat_id: asText(body.telegram_chat_id) || null,
    ...brief,
    nudges: applyRationale(brief.nudges, reasons, 'why_nudge'),
  };
  out.telegram_message = formatWaitingTelegramMessage(out);
  return out;
}

async function buildWeeklyBriefSurface(input) {
  const body = input && typeof input === 'object' ? input : {};
  const rows = await todoistStore.listCurrentTasks({ includeClosed: false });
  const brief = buildWeeklyBrief(rows, { now: body.now ? new Date(body.now) : new Date() });
  const reasons = await generateRationales('weekly', brief.suggestions);

  const out = {
    brief_kind: 'weekly_pruning',
    run_id: asText(body.run_id) || null,
    telegram_chat_id: asText(body.telegram_chat_id) || null,
    ...brief,
    suggestions: applyRationale(brief.suggestions, reasons, 'why_recommended'),
  };
  out.telegram_message = formatWeeklyTelegramMessage(out);
  return out;
}

async function evaluateTodoistNormalization(input) {
  const body = input && typeof input === 'object' ? input : {};
  const rawTitle = asText(body.raw_title);
  if (!rawTitle) {
    const err = new Error('raw_title is required');
    err.statusCode = 400;
    throw err;
  }

  const parseRun = await runTodoistNormalizationGraphWithTrace({
    raw_title: rawTitle,
    raw_description: asText(body.raw_description) || null,
    project_key: asText(body.project_key) || null,
    todoist_section_name: asText(body.todoist_section_name) || null,
    lifecycle_status: asText(body.lifecycle_status) || 'open',
    has_subtasks: body.has_subtasks === true,
    explicit_project_signal: body.explicit_project_signal === true,
    few_shot_examples: Array.isArray(body.few_shot_examples) ? body.few_shot_examples : [],
  });

  return {
    status: 'ok',
    normalized_task: parseRun && parseRun.result ? parseRun.result : null,
    normalize_trace: parseRun && parseRun.trace ? parseRun.trace : null,
  };
}

module.exports = {
  syncTodoistSurface,
  getReviewQueue,
  acceptReview,
  overrideReview,
  reparseReview,
  buildDailyBriefSurface,
  buildWaitingBriefSurface,
  buildWeeklyBriefSurface,
  evaluateTodoistNormalization,
};
