'use strict';

const {
  asText,
  mapProjectKey,
  lifecycleFromSection,
  parsePriority,
  parseBoolean,
  detectExplicitProjectSignal,
  parseOptionalDate,
} = require('./constants.js');

function toIso(value) {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function parseTodoistAddedAt(task) {
  const candidates = [
    task && task.todoist_added_at,
    task && task.added_at,
    task && task.created_at,
    task && task.createdAt,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (!text) continue;
    const d = new Date(text);
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return null;
}

function normalizeIncomingTask(task) {
  const raw = task && typeof task === 'object' ? task : {};

  const todoist_task_id = asText(raw.todoist_task_id || raw.id);
  if (!todoist_task_id) {
    throw new Error('todoist sync task requires todoist_task_id');
  }

  const todoist_project_name = asText(raw.todoist_project_name || raw.project_name || raw.project || '');
  const project_key = mapProjectKey(todoist_project_name, raw.project_key);

  const todoist_section_name = asText(raw.todoist_section_name || raw.section_name || raw.section || '');
  const raw_title = asText(raw.raw_title || raw.content || raw.title || '');

  const due = raw.due && typeof raw.due === 'object' ? raw.due : {};

  return {
    todoist_task_id,
    todoist_project_id: asText(raw.todoist_project_id || raw.project_id || ''),
    todoist_project_name,
    todoist_section_id: asText(raw.todoist_section_id || raw.section_id || '') || null,
    todoist_section_name: todoist_section_name || null,
    raw_title,
    raw_description: asText(raw.raw_description || raw.description || '') || null,
    todoist_priority: parsePriority(raw.todoist_priority || raw.priority),
    todoist_due_date: parseOptionalDate(raw.todoist_due_date || due.date),
    todoist_due_string: asText(raw.todoist_due_string || due.string || '') || null,
    todoist_due_is_recurring: (raw.todoist_due_is_recurring === true || due.is_recurring === true),
    project_key,
    lifecycle_status: lifecycleFromSection(todoist_section_name),
    todoist_added_at: parseTodoistAddedAt(raw),
    has_subtasks: parseBoolean(raw.has_subtasks ?? raw.hasSubtasks, false),
    explicit_project_signal: parseBoolean(
      raw.explicit_project_signal ?? raw.explicitProjectSignal,
      detectExplicitProjectSignal(raw_title)
    ),
  };
}

function changedFields(existing, incoming) {
  const oldRow = existing && typeof existing === 'object' ? existing : null;
  if (!oldRow) return [];

  const changed = [];
  if ((oldRow.raw_title || '') !== (incoming.raw_title || '')) changed.push('raw_title');
  if ((oldRow.raw_description || '') !== (incoming.raw_description || '')) changed.push('raw_description');
  if ((oldRow.todoist_project_id || '') !== (incoming.todoist_project_id || '') || (oldRow.todoist_project_name || '') !== (incoming.todoist_project_name || '')) changed.push('project');
  if ((oldRow.todoist_section_id || '') !== (incoming.todoist_section_id || '') || (oldRow.todoist_section_name || '') !== (incoming.todoist_section_name || '')) changed.push('section');
  if ((oldRow.todoist_due_date || null) !== (incoming.todoist_due_date || null)) changed.push('due_date');
  if ((oldRow.todoist_due_string || '') !== (incoming.todoist_due_string || '')) changed.push('due_string');
  if (Boolean(oldRow.todoist_due_is_recurring) !== Boolean(incoming.todoist_due_is_recurring)) changed.push('due_is_recurring');
  if (Number(oldRow.todoist_priority || 1) !== Number(incoming.todoist_priority || 1)) changed.push('priority');
  if ((oldRow.project_key || '') !== (incoming.project_key || '')) changed.push('project_key');
  if ((oldRow.lifecycle_status || '') !== (incoming.lifecycle_status || '')) changed.push('lifecycle_status');
  return changed;
}

function buildEvents(existing, incoming, nowIso) {
  const oldRow = existing && typeof existing === 'object' ? existing : null;
  const events = [];
  const changed = changedFields(oldRow, incoming);

  if (!oldRow) {
    events.push({
      event_type: 'first_seen',
      changed_fields: ['all'],
      before_json: null,
      after_json: incoming,
      reason: 'sync_new_task',
      event_at: nowIso,
    });
    return events;
  }

  if (changed.includes('raw_title')) {
    events.push({
      event_type: 'title_changed',
      changed_fields: ['raw_title'],
      before_json: { raw_title: oldRow.raw_title },
      after_json: { raw_title: incoming.raw_title },
      reason: 'sync_title_change',
      event_at: nowIso,
    });
  }
  if (changed.includes('raw_description')) {
    events.push({
      event_type: 'description_changed',
      changed_fields: ['raw_description'],
      before_json: { raw_description: oldRow.raw_description },
      after_json: { raw_description: incoming.raw_description },
      reason: 'sync_description_change',
      event_at: nowIso,
    });
  }
  if (changed.includes('project')) {
    events.push({
      event_type: 'project_changed',
      changed_fields: ['todoist_project_id', 'todoist_project_name', 'project_key'],
      before_json: {
        todoist_project_id: oldRow.todoist_project_id,
        todoist_project_name: oldRow.todoist_project_name,
        project_key: oldRow.project_key,
      },
      after_json: {
        todoist_project_id: incoming.todoist_project_id,
        todoist_project_name: incoming.todoist_project_name,
        project_key: incoming.project_key,
      },
      reason: 'sync_project_change',
      event_at: nowIso,
    });
  }
  if (changed.includes('section')) {
    events.push({
      event_type: 'section_changed',
      changed_fields: ['todoist_section_id', 'todoist_section_name'],
      before_json: {
        todoist_section_id: oldRow.todoist_section_id,
        todoist_section_name: oldRow.todoist_section_name,
      },
      after_json: {
        todoist_section_id: incoming.todoist_section_id,
        todoist_section_name: incoming.todoist_section_name,
      },
      reason: 'sync_section_change',
      event_at: nowIso,
    });
  }

  const oldLifecycle = asText(oldRow.lifecycle_status).toLowerCase();
  const newLifecycle = asText(incoming.lifecycle_status).toLowerCase();
  if (oldLifecycle !== 'waiting' && newLifecycle === 'waiting') {
    events.push({
      event_type: 'entered_waiting',
      changed_fields: ['lifecycle_status', 'waiting_since_at'],
      before_json: { lifecycle_status: oldLifecycle, waiting_since_at: oldRow.waiting_since_at || null },
      after_json: { lifecycle_status: newLifecycle, waiting_since_at: nowIso },
      reason: 'sync_waiting_transition',
      event_at: nowIso,
    });
  }
  if (oldLifecycle === 'waiting' && newLifecycle !== 'waiting') {
    events.push({
      event_type: 'left_waiting',
      changed_fields: ['lifecycle_status', 'waiting_since_at'],
      before_json: { lifecycle_status: oldLifecycle, waiting_since_at: oldRow.waiting_since_at || null },
      after_json: { lifecycle_status: newLifecycle, waiting_since_at: null },
      reason: 'sync_waiting_transition',
      event_at: nowIso,
    });
  }

  if (oldLifecycle === 'closed' && (newLifecycle === 'open' || newLifecycle === 'waiting')) {
    events.push({
      event_type: 'reopened',
      changed_fields: ['lifecycle_status', 'closed_at'],
      before_json: { lifecycle_status: oldLifecycle, closed_at: oldRow.closed_at || null },
      after_json: { lifecycle_status: newLifecycle, closed_at: null },
      reason: 'sync_reappeared_in_active_fetch',
      event_at: nowIso,
    });
  }

  return events;
}

function shouldTriggerParse(existing, incoming) {
  const oldRow = existing && typeof existing === 'object' ? existing : null;
  if (!oldRow) {
    return { parse_triggered: true, trigger_reason: 'first_seen' };
  }

  const oldLifecycle = asText(oldRow.lifecycle_status).toLowerCase();
  const newLifecycle = asText(incoming.lifecycle_status).toLowerCase();
  const oldProjectKey = asText(oldRow.project_key).toLowerCase();
  const newProjectKey = asText(incoming.project_key).toLowerCase();

  if ((oldRow.raw_title || '') !== (incoming.raw_title || '')) {
    return { parse_triggered: true, trigger_reason: 'title_changed' };
  }
  if ((oldRow.raw_description || '') !== (incoming.raw_description || '')) {
    return { parse_triggered: true, trigger_reason: 'description_changed' };
  }
  if (oldProjectKey !== newProjectKey) {
    return { parse_triggered: true, trigger_reason: 'project_key_changed' };
  }
  if (oldLifecycle !== 'waiting' && newLifecycle === 'waiting') {
    return { parse_triggered: true, trigger_reason: 'entered_waiting' };
  }
  if (oldLifecycle === 'waiting' && newLifecycle !== 'waiting') {
    return { parse_triggered: true, trigger_reason: 'left_waiting' };
  }
  if (oldLifecycle === 'closed' && (newLifecycle === 'open' || newLifecycle === 'waiting')) {
    return { parse_triggered: true, trigger_reason: 'reopened' };
  }

  return { parse_triggered: false, trigger_reason: null };
}

function buildNextState(existing, incoming, nowInput) {
  const nowIso = toIso(nowInput);
  const oldRow = existing && typeof existing === 'object' ? existing : null;
  const lifecycle = asText(incoming.lifecycle_status).toLowerCase();

  const first_seen_at = oldRow && oldRow.first_seen_at ? oldRow.first_seen_at : nowIso;
  let waiting_since_at = oldRow && oldRow.waiting_since_at ? oldRow.waiting_since_at : null;
  let closed_at = oldRow && oldRow.closed_at ? oldRow.closed_at : null;

  if (lifecycle === 'waiting') {
    waiting_since_at = waiting_since_at || nowIso;
    closed_at = null;
  } else if (lifecycle === 'open') {
    waiting_since_at = null;
    closed_at = null;
  }

  const parseDecision = shouldTriggerParse(oldRow, incoming);
  const events = buildEvents(oldRow, incoming, nowIso);

  return {
    now_iso: nowIso,
    first_seen_at,
    waiting_since_at,
    closed_at,
    last_seen_at: nowIso,
    parse_triggered: parseDecision.parse_triggered,
    parse_trigger_reason: parseDecision.trigger_reason,
    events,
  };
}

module.exports = {
  normalizeIncomingTask,
  changedFields,
  buildEvents,
  shouldTriggerParse,
  buildNextState,
};
