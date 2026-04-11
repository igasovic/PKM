'use strict';

const {
  normalizeIncomingTask,
  shouldTriggerParse,
  buildNextState,
} = require('../../src/server/todoist/reconcile.js');

describe('todoist reconcile semantics', () => {
  test('normalizeIncomingTask maps project and waiting lifecycle', () => {
    const row = normalizeIncomingTask({
      id: 't1',
      content: 'Follow up with Alex',
      description: 'status update',
      project_name: 'Home 🏡',
      section_name: 'Waiting',
      due: { date: '2026-04-11', string: 'today', is_recurring: false },
      priority: 4,
      added_at: '2026-04-10T00:00:00.000Z',
    });

    expect(row).toEqual(expect.objectContaining({
      todoist_task_id: 't1',
      project_key: 'home',
      lifecycle_status: 'waiting',
      todoist_due_date: '2026-04-11',
      todoist_priority: 4,
    }));
  });

  test('parse trigger matrix includes title/project/waiting/reopen and excludes due-only changes', () => {
    const existing = {
      raw_title: 'Title A',
      raw_description: 'Desc A',
      project_key: 'work',
      lifecycle_status: 'open',
    };

    expect(shouldTriggerParse(null, {
      raw_title: 'New task',
      raw_description: 'x',
      project_key: 'work',
      lifecycle_status: 'open',
    })).toEqual({ parse_triggered: true, trigger_reason: 'first_seen' });

    expect(shouldTriggerParse(existing, {
      ...existing,
      todoist_due_date: '2026-04-20',
      todoist_priority: 2,
    })).toEqual({ parse_triggered: false, trigger_reason: null });

    expect(shouldTriggerParse(existing, {
      ...existing,
      raw_title: 'Title B',
    })).toEqual({ parse_triggered: true, trigger_reason: 'title_changed' });

    expect(shouldTriggerParse(existing, {
      ...existing,
      project_key: 'personal',
    })).toEqual({ parse_triggered: true, trigger_reason: 'project_key_changed' });

    expect(shouldTriggerParse(existing, {
      ...existing,
      lifecycle_status: 'waiting',
    })).toEqual({ parse_triggered: true, trigger_reason: 'entered_waiting' });

    expect(shouldTriggerParse({ ...existing, lifecycle_status: 'waiting' }, {
      ...existing,
      lifecycle_status: 'open',
    })).toEqual({ parse_triggered: true, trigger_reason: 'left_waiting' });

    expect(shouldTriggerParse({ ...existing, lifecycle_status: 'closed' }, {
      ...existing,
      lifecycle_status: 'open',
    })).toEqual({ parse_triggered: true, trigger_reason: 'reopened' });
  });

  test('buildNextState tracks waiting timestamps and reopen events', () => {
    const now = '2026-04-11T11:00:00.000Z';

    const enteredWaiting = buildNextState({
      first_seen_at: '2026-04-01T10:00:00.000Z',
      lifecycle_status: 'open',
      waiting_since_at: null,
      closed_at: null,
      raw_title: 'foo',
      raw_description: '',
      project_key: 'work',
      todoist_section_name: 'Now',
    }, {
      raw_title: 'foo',
      raw_description: '',
      project_key: 'work',
      lifecycle_status: 'waiting',
      todoist_section_name: 'Waiting',
    }, now);

    expect(enteredWaiting.waiting_since_at).toBe(now);
    expect(enteredWaiting.parse_triggered).toBe(true);
    expect(enteredWaiting.parse_trigger_reason).toBe('entered_waiting');
    expect(enteredWaiting.events.map((event) => event.event_type)).toContain('entered_waiting');

    const reopened = buildNextState({
      first_seen_at: '2026-04-01T10:00:00.000Z',
      lifecycle_status: 'closed',
      waiting_since_at: null,
      closed_at: '2026-04-10T09:00:00.000Z',
      raw_title: 'foo',
      raw_description: '',
      project_key: 'work',
      todoist_section_name: 'Waiting',
    }, {
      raw_title: 'foo',
      raw_description: '',
      project_key: 'work',
      lifecycle_status: 'open',
      todoist_section_name: 'Now',
    }, now);

    expect(reopened.closed_at).toBeNull();
    expect(reopened.parse_trigger_reason).toBe('reopened');
    expect(reopened.events.map((event) => event.event_type)).toContain('reopened');
  });
});
