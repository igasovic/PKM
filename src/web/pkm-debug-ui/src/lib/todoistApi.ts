import type {
  TodoistReviewQueueResult,
  TodoistReviewView,
  TodoistTaskCurrent,
  TodoistTaskEvent,
  TodoistTaskShape,
} from '../types';

const DEFAULT_TIMEOUT_MS = 20000;

type JsonObject = Record<string, unknown>;

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out || null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }
  return false;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function requestJson(path: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });

    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('server returned invalid JSON');
    }

    if (!res.ok) {
      const err = asRecord(payload);
      throw new Error(asText(err.message) || asText(err.error) || `http_${res.status}`);
    }

    return payload;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTask(value: unknown): TodoistTaskCurrent {
  const row = asRecord(value);
  const reviewReasons = asArray(row.review_reasons)
    .map((item) => asText(item))
    .filter((item): item is string => !!item);

  return {
    id: asNumber(row.id),
    todoist_task_id: asText(row.todoist_task_id) || '',
    todoist_project_id: asText(row.todoist_project_id),
    todoist_project_name: asText(row.todoist_project_name),
    todoist_section_id: asText(row.todoist_section_id),
    todoist_section_name: asText(row.todoist_section_name),
    raw_title: asText(row.raw_title),
    raw_description: asText(row.raw_description),
    todoist_priority: asNumber(row.todoist_priority, 1),
    todoist_due_date: asText(row.todoist_due_date),
    todoist_due_string: asText(row.todoist_due_string),
    todoist_due_is_recurring: asBoolean(row.todoist_due_is_recurring),
    project_key: asText(row.project_key),
    lifecycle_status: asText(row.lifecycle_status),
    normalized_title_en: asText(row.normalized_title_en),
    task_shape: asText(row.task_shape),
    suggested_next_action: asText(row.suggested_next_action),
    parse_confidence: asNumber(row.parse_confidence, 0),
    review_status: asText(row.review_status),
    review_reasons: reviewReasons,
    todoist_added_at: asText(row.todoist_added_at),
    first_seen_at: asText(row.first_seen_at),
    last_seen_at: asText(row.last_seen_at),
    waiting_since_at: asText(row.waiting_since_at),
    closed_at: asText(row.closed_at),
    parsed_at: asText(row.parsed_at),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
  };
}

function normalizeEvent(value: unknown): TodoistTaskEvent {
  const row = asRecord(value);
  const changedFields = asArray(row.changed_fields)
    .map((item) => asText(item))
    .filter((item): item is string => !!item);

  const before = row.before_json && typeof row.before_json === 'object' && !Array.isArray(row.before_json)
    ? row.before_json as Record<string, unknown>
    : null;
  const after = row.after_json && typeof row.after_json === 'object' && !Array.isArray(row.after_json)
    ? row.after_json as Record<string, unknown>
    : null;

  return {
    id: asNumber(row.id),
    task_id: asNumber(row.task_id),
    event_at: asText(row.event_at),
    event_type: asText(row.event_type) || 'event',
    changed_fields: changedFields,
    before_json: before,
    after_json: after,
    reason: asText(row.reason),
  };
}

function normalizeReviewQueue(value: unknown): TodoistReviewQueueResult {
  const data = asRecord(value);
  const rows = asArray(data.rows).map((row) => normalizeTask(row));
  const selectedRaw = data.selected;
  const selected = selectedRaw && typeof selectedRaw === 'object' ? normalizeTask(selectedRaw) : null;
  const events = asArray(data.events).map((row) => normalizeEvent(row));

  return {
    view: asText(data.view) || 'needs_review',
    limit: asNumber(data.limit, 50),
    offset: asNumber(data.offset, 0),
    rows,
    selected,
    events,
  };
}

export async function todoistReviewQueue(input: {
  view: TodoistReviewView;
  limit?: number;
  offset?: number;
  todoist_task_id?: string | null;
  events_limit?: number;
}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TodoistReviewQueueResult> {
  const params = new URLSearchParams();
  params.set('view', input.view);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.offset !== undefined) params.set('offset', String(input.offset));
  if (input.todoist_task_id) params.set('todoist_task_id', input.todoist_task_id);
  if (input.events_limit !== undefined) params.set('events_limit', String(input.events_limit));

  const payload = await requestJson(`/todoist/review?${params.toString()}`, {
    method: 'GET',
  }, timeoutMs);
  return normalizeReviewQueue(payload);
}

export async function todoistReviewAccept(todoist_task_id: string, reason?: string | null): Promise<TodoistTaskCurrent> {
  const payload = await requestJson('/todoist/review/accept', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ todoist_task_id, reason: reason || null }),
  });
  return normalizeTask(payload);
}

export async function todoistReviewOverride(input: {
  todoist_task_id: string;
  normalized_title_en: string;
  task_shape: TodoistTaskShape;
  suggested_next_action: string | null;
  reason?: string | null;
}): Promise<TodoistTaskCurrent> {
  const payload = await requestJson('/todoist/review/override', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      todoist_task_id: input.todoist_task_id,
      normalized_title_en: input.normalized_title_en,
      task_shape: input.task_shape,
      suggested_next_action: input.suggested_next_action,
      reason: input.reason || null,
    }),
  });
  return normalizeTask(payload);
}

export async function todoistReviewReparse(todoist_task_id: string, reason?: string | null): Promise<{ task: TodoistTaskCurrent; events: TodoistTaskEvent[] }> {
  const payload = await requestJson('/todoist/review/reparse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ todoist_task_id, reason: reason || null }),
  });
  const row = asRecord(payload);
  return {
    task: normalizeTask(row),
    events: asArray(row.events).map((item) => normalizeEvent(item)),
  };
}
