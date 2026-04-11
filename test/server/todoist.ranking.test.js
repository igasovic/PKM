'use strict';

const {
  buildDailyBrief,
  buildWaitingBrief,
  buildWeeklyBrief,
} = require('../../src/server/todoist/ranking.js');

function task(overrides = {}) {
  return {
    todoist_task_id: overrides.todoist_task_id || `t-${Math.random().toString(16).slice(2)}`,
    project_key: overrides.project_key || 'work',
    lifecycle_status: overrides.lifecycle_status || 'open',
    raw_title: overrides.raw_title || 'Task',
    normalized_title_en: overrides.normalized_title_en || null,
    task_shape: overrides.task_shape || 'next_action',
    suggested_next_action: overrides.suggested_next_action || null,
    todoist_priority: overrides.todoist_priority || 3,
    todoist_due_date: Object.prototype.hasOwnProperty.call(overrides, 'todoist_due_date') ? overrides.todoist_due_date : '2026-04-10',
    parse_confidence: Object.prototype.hasOwnProperty.call(overrides, 'parse_confidence') ? overrides.parse_confidence : 0.9,
    review_status: overrides.review_status || 'no_review_needed',
    waiting_since_at: overrides.waiting_since_at || null,
    todoist_added_at: overrides.todoist_added_at || '2026-04-01T00:00:00.000Z',
    first_seen_at: overrides.first_seen_at || '2026-04-01T00:00:00.000Z',
  };
}

describe('todoist deterministic ranking', () => {
  const now = new Date('2026-04-11T12:00:00.000Z');

  test('daily brief excludes inbox and needs_review items', () => {
    const out = buildDailyBrief([
      task({ todoist_task_id: 'safe-1', raw_title: 'Safe item' }),
      task({ todoist_task_id: 'inbox-1', project_key: 'inbox', raw_title: 'Inbox item' }),
      task({ todoist_task_id: 'review-1', review_status: 'needs_review', raw_title: 'Needs review item' }),
      task({ todoist_task_id: 'wait-1', lifecycle_status: 'waiting', waiting_since_at: '2026-04-01T00:00:00.000Z', raw_title: 'Waiting item' }),
    ], { now });

    const listedIds = new Set([
      ...out.top_3.map((row) => row.todoist_task_id),
      ...out.overdue_now.map((row) => row.todoist_task_id),
      ...out.waiting_nudges.map((row) => row.todoist_task_id),
      ...out.quick_win.map((row) => row.todoist_task_id),
    ]);

    expect(listedIds.has('inbox-1')).toBe(false);
    expect(listedIds.has('review-1')).toBe(false);
    expect(out.summary.candidate_count).toBe(2);
  });

  test('daily top_3 enforces max two work items', () => {
    const out = buildDailyBrief([
      task({ todoist_task_id: 'w1', project_key: 'work', todoist_priority: 4, raw_title: 'Work A' }),
      task({ todoist_task_id: 'w2', project_key: 'work', todoist_priority: 4, raw_title: 'Work B' }),
      task({ todoist_task_id: 'w3', project_key: 'work', todoist_priority: 4, raw_title: 'Work C' }),
      task({ todoist_task_id: 'p1', project_key: 'personal', todoist_priority: 3, raw_title: 'Personal A' }),
    ], { now });

    const workCount = out.top_3.filter((row) => row.project_key === 'work').length;
    expect(out.top_3.length).toBeLessThanOrEqual(3);
    expect(workCount).toBeLessThanOrEqual(2);
  });

  test('waiting brief groups by inferred entity and remains deterministic', () => {
    const out = buildWaitingBrief([
      task({
        todoist_task_id: 'wait-a',
        lifecycle_status: 'waiting',
        suggested_next_action: 'Follow up with Alex',
        waiting_since_at: '2026-04-01T00:00:00.000Z',
      }),
      task({
        todoist_task_id: 'wait-b',
        lifecycle_status: 'waiting',
        suggested_next_action: 'Ask Alex for update',
        waiting_since_at: '2026-04-02T00:00:00.000Z',
      }),
    ], { now });

    expect(out.nudges.length).toBe(2);
    expect(out.groups.length).toBeGreaterThan(0);
    expect(out.groups[0]).toEqual(expect.objectContaining({
      entity: 'Alex',
      task_count: 2,
    }));
  });

  test('weekly brief emits allowed recommendation types only', () => {
    const out = buildWeeklyBrief([
      task({ todoist_task_id: 'wk1', task_shape: 'project', todoist_due_date: '2026-03-01' }),
      task({ todoist_task_id: 'wk2', task_shape: 'micro_task', todoist_due_date: '2026-02-01' }),
      task({ todoist_task_id: 'wk3', task_shape: 'follow_up', lifecycle_status: 'waiting', waiting_since_at: '2026-03-20T00:00:00.000Z' }),
    ], { now });

    const allowed = new Set([
      'delete',
      'defer',
      'convert_to_next_action',
      'keep_waiting',
      'keep_as_note',
      'move_to_someday',
    ]);

    for (const row of out.suggestions) {
      expect(allowed.has(row.recommendation_type)).toBe(true);
    }
  });
});
