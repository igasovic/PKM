'use strict';

const { asText } = require('./constants.js');

function parseDateOnly(value) {
  const text = asText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetweenDates(dateA, dateB) {
  return Math.round((dateA.getTime() - dateB.getTime()) / (24 * 60 * 60 * 1000));
}

function computeDueDeltaDays(task, nowDate) {
  const due = parseDateOnly(task && task.todoist_due_date);
  if (!due) return null;
  return daysBetweenDates(startOfUtcDay(nowDate), startOfUtcDay(due));
}

function waitingAgeDays(task, nowDate) {
  const raw = asText(task && task.waiting_since_at);
  if (!raw) return 0;
  const ts = new Date(raw);
  if (!Number.isFinite(ts.getTime())) return 0;
  return Math.max(0, daysBetweenDates(startOfUtcDay(nowDate), startOfUtcDay(ts)));
}

function ageDays(task, nowDate) {
  const raw = asText(task && task.todoist_added_at) || asText(task && task.first_seen_at);
  if (!raw) return 0;
  const ts = new Date(raw);
  if (!Number.isFinite(ts.getTime())) return 0;
  return Math.max(0, daysBetweenDates(startOfUtcDay(nowDate), startOfUtcDay(ts)));
}

function extractEntity(task) {
  const text = [
    asText(task && task.suggested_next_action),
    asText(task && task.normalized_title_en),
    asText(task && task.raw_title),
  ].filter(Boolean).join(' | ');
  if (!text) return null;

  const at = text.match(/@([A-Za-z][A-Za-z0-9_-]{1,30})/);
  if (at && at[1]) return at[1];

  const waitingOn = text.match(
    /(?:[Ww]aiting\s+[Oo]n|[Ff]ollow\s*[Uu]p\s+[Ww]ith|[Aa]sk|[Pp]ing)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );
  if (waitingOn && waitingOn[1]) return waitingOn[1];

  return null;
}

function sortByScoreThenPriority(rows) {
  return rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ap = Number(a.todoist_priority || 1);
    const bp = Number(b.todoist_priority || 1);
    if (bp !== ap) return bp - ap;
    const at = asText(a.todoist_due_date);
    const bt = asText(b.todoist_due_date);
    return at.localeCompare(bt);
  });
}

function applyRationale(items, reasonsById, fieldName) {
  return items.map((item) => {
    const reason = reasonsById[asText(item.todoist_task_id)] || item[fieldName] || null;
    return {
      ...item,
      [fieldName]: reason,
    };
  });
}

function scoreDaily(task, nowDate) {
  const dueDelta = computeDueDeltaDays(task, nowDate);
  const overdueDays = dueDelta !== null && dueDelta > 0 ? dueDelta : 0;
  const dueSoonBoost = dueDelta !== null && dueDelta <= 1 ? 4 : 0;
  const waitPenalty = asText(task.lifecycle_status) === 'waiting' ? -8 : 0;
  const shape = asText(task.task_shape);
  const shapePenalty = (
    shape === 'project' ? -2
      : (shape === 'vague_note' || shape === 'unknown') ? -4
        : 0
  );
  const confidence = Number(task.parse_confidence || 0);
  const priority = Number(task.todoist_priority || 1);
  const aging = Math.min(14, ageDays(task, nowDate));
  return (overdueDays * 6) + dueSoonBoost + (priority * 3) + confidence + aging + waitPenalty + shapePenalty;
}

function scoreWaiting(task, nowDate) {
  const age = waitingAgeDays(task, nowDate);
  const dueDelta = computeDueDeltaDays(task, nowDate);
  const overdue = dueDelta !== null && dueDelta > 0 ? dueDelta : 0;
  const priority = Number(task.todoist_priority || 1);
  return (age * 3) + (overdue * 2) + priority;
}

function scoreWeekly(task, nowDate) {
  const dueDelta = computeDueDeltaDays(task, nowDate);
  const overdue = dueDelta !== null && dueDelta > 0 ? dueDelta : 0;
  const waitingAge = waitingAgeDays(task, nowDate);
  const reviewPenalty = asText(task.review_status) === 'needs_review' ? 6 : 0;
  return (overdue * 3) + waitingAge + reviewPenalty + Number(task.todoist_priority || 1);
}

function assignWeeklyRecommendation(task, nowDate) {
  const lifecycle = asText(task.lifecycle_status);
  const shape = asText(task.task_shape);
  const dueDelta = computeDueDeltaDays(task, nowDate);
  const overdue = dueDelta !== null && dueDelta > 0 ? dueDelta : 0;
  const waitingAge = waitingAgeDays(task, nowDate);
  const review = asText(task.review_status);

  if (shape === 'micro_task' && overdue >= 30) return 'delete';
  if (overdue >= 21) return 'move_to_someday';
  if (overdue >= 7) return 'defer';
  if (review === 'needs_review') return 'convert_to_next_action';
  if (lifecycle === 'waiting' && waitingAge >= 14) return 'keep_waiting';
  if (shape === 'project') {
    return asText(task.suggested_next_action) ? 'defer' : 'convert_to_next_action';
  }
  if (shape === 'vague_note' || shape === 'unknown') return 'convert_to_next_action';
  if (shape === 'follow_up' && lifecycle === 'waiting') return 'keep_waiting';
  return 'keep_as_note';
}

function groupWaitingByEntity(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = extractEntity(task) || '(ungrouped)';
    if (!groups.has(key)) {
      groups.set(key, {
        entity: key === '(ungrouped)' ? null : key,
        task_count: 0,
        max_waiting_days: 0,
        tasks: [],
      });
    }
    const group = groups.get(key);
    const age = Number(task.waiting_age_days || 0);
    group.task_count += 1;
    group.max_waiting_days = Math.max(group.max_waiting_days, age);
    group.tasks.push(task);
  }

  return Array.from(groups.values())
    .sort((a, b) => {
      if (b.max_waiting_days !== a.max_waiting_days) return b.max_waiting_days - a.max_waiting_days;
      return b.task_count - a.task_count;
    });
}

function compactTask(task) {
  return {
    todoist_task_id: task.todoist_task_id,
    project_key: task.project_key,
    lifecycle_status: task.lifecycle_status,
    raw_title: task.raw_title,
    normalized_title_en: task.normalized_title_en,
    task_shape: task.task_shape,
    suggested_next_action: task.suggested_next_action,
    todoist_priority: task.todoist_priority,
    todoist_due_date: task.todoist_due_date,
    parse_confidence: task.parse_confidence,
    review_status: task.review_status,
    waiting_since_at: task.waiting_since_at,
  };
}

function buildDailyBrief(tasks, options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date();
  const safe = tasks.filter((task) => task.lifecycle_status !== 'closed' && task.review_status !== 'needs_review' && task.project_key !== 'inbox');

  const openSafe = safe.filter((task) => task.lifecycle_status === 'open');
  const overdueSafe = openSafe
    .map((task) => ({
      ...task,
      overdue_days: Math.max(0, computeDueDeltaDays(task, nowDate) || 0),
    }))
    .filter((task) => task.overdue_days > 0);

  const scoredTop = sortByScoreThenPriority(openSafe.map((task) => ({
    ...task,
    score: scoreDaily(task, nowDate),
  })));

  const top_3 = [];
  let workCount = 0;
  for (const candidate of scoredTop) {
    if (top_3.length >= 3) break;
    const isWork = candidate.project_key === 'work';
    if (isWork && workCount >= 2) continue;
    top_3.push({
      ...compactTask(candidate),
      score: candidate.score,
      why_now: null,
    });
    if (isWork) workCount += 1;
  }

  const overdue_now = sortByScoreThenPriority(overdueSafe.map((task) => ({
    ...task,
    score: scoreDaily(task, nowDate),
  }))).slice(0, 5).map((task) => ({
    ...compactTask(task),
    overdue_days: task.overdue_days,
    why_now: null,
  }));

  const waitingCandidates = safe
    .filter((task) => task.lifecycle_status === 'waiting')
    .map((task) => ({
      ...task,
      waiting_age_days: waitingAgeDays(task, nowDate),
      score: scoreWaiting(task, nowDate),
    }));
  sortByScoreThenPriority(waitingCandidates);

  const waiting_nudges = waitingCandidates.slice(0, 8).map((task) => ({
    ...compactTask(task),
    waiting_age_days: task.waiting_age_days,
    grouped_entity: extractEntity(task),
    why_nudge: null,
  }));

  const quick_win = scoredTop
    .filter((task) => ['next_action', 'micro_task'].includes(task.task_shape))
    .slice(0, 1)
    .map((task) => ({
      ...compactTask(task),
      why_now: null,
    }));

  return {
    generated_at: nowDate.toISOString(),
    top_3,
    overdue_now,
    waiting_nudges,
    waiting_groups: groupWaitingByEntity(waiting_nudges),
    quick_win,
    summary: {
      candidate_count: safe.length,
      overdue_count: overdueSafe.length,
      waiting_count: waitingCandidates.length,
    },
  };
}

function buildWaitingBrief(tasks, options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date();
  const safeWaiting = tasks
    .filter((task) => task.lifecycle_status === 'waiting' && task.review_status !== 'needs_review' && task.project_key !== 'inbox')
    .map((task) => ({
      ...task,
      waiting_age_days: waitingAgeDays(task, nowDate),
      score: scoreWaiting(task, nowDate),
    }));
  sortByScoreThenPriority(safeWaiting);

  const nudges = safeWaiting.slice(0, 12).map((task) => ({
    ...compactTask(task),
    waiting_age_days: task.waiting_age_days,
    grouped_entity: extractEntity(task),
    why_nudge: null,
  }));

  return {
    generated_at: nowDate.toISOString(),
    nudges,
    groups: groupWaitingByEntity(nudges),
    summary: {
      candidate_count: safeWaiting.length,
      max_waiting_days: safeWaiting.reduce((max, task) => Math.max(max, task.waiting_age_days), 0),
    },
  };
}

function buildWeeklyBrief(tasks, options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date();
  const candidates = tasks
    .filter((task) => task.lifecycle_status !== 'closed' && task.project_key !== 'inbox')
    .map((task) => ({
      ...task,
      score: scoreWeekly(task, nowDate),
      waiting_age_days: waitingAgeDays(task, nowDate),
      recommendation_type: assignWeeklyRecommendation(task, nowDate),
    }));

  sortByScoreThenPriority(candidates);

  const suggestions = candidates.slice(0, 15).map((task) => ({
    ...compactTask(task),
    waiting_age_days: task.waiting_age_days,
    recommendation_type: task.recommendation_type,
    why_recommended: null,
  }));

  return {
    generated_at: nowDate.toISOString(),
    suggestions,
    summary: {
      candidate_count: candidates.length,
      needs_review_count: candidates.filter((task) => task.review_status === 'needs_review').length,
      waiting_count: candidates.filter((task) => task.lifecycle_status === 'waiting').length,
    },
  };
}

module.exports = {
  computeDueDeltaDays,
  waitingAgeDays,
  extractEntity,
  applyRationale,
  buildDailyBrief,
  buildWaitingBrief,
  buildWeeklyBrief,
};
