'use strict';

const sb = require('../../libs/sql-builder.js');
const {
  getPool,
  traceDb,
  parseNonEmptyText,
  parseOptionalText,
  parsePositiveInt,
  toJsonParam,
} = require('./shared.js');
const {
  TASK_SHAPES,
  REVIEW_STATUSES,
  asText,
  parseConfidence,
  parseOptionalDate,
  parsePriority,
} = require('../todoist/constants.js');

const TODOIST_TASK_CURRENT_TABLE = sb.qualifiedTable('pkm', 'todoist_task_current');
const TODOIST_TASK_EVENTS_TABLE = sb.qualifiedTable('pkm', 'todoist_task_events');

function mapTaskRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: Number(row.id),
    todoist_task_id: row.todoist_task_id,
    todoist_project_id: row.todoist_project_id || null,
    todoist_project_name: row.todoist_project_name || null,
    todoist_section_id: row.todoist_section_id || null,
    todoist_section_name: row.todoist_section_name || null,
    raw_title: row.raw_title || null,
    raw_description: row.raw_description || null,
    todoist_priority: Number(row.todoist_priority || 1),
    todoist_due_date: row.todoist_due_date || null,
    todoist_due_string: row.todoist_due_string || null,
    todoist_due_is_recurring: row.todoist_due_is_recurring === true,
    project_key: row.project_key || null,
    lifecycle_status: row.lifecycle_status || null,
    normalized_title_en: row.normalized_title_en || null,
    task_shape: row.task_shape || null,
    suggested_next_action: row.suggested_next_action || null,
    parse_confidence: Number.isFinite(Number(row.parse_confidence)) ? Number(row.parse_confidence) : 0,
    review_status: row.review_status || null,
    review_reasons: Array.isArray(row.review_reasons)
      ? row.review_reasons
      : (Array.isArray(row.review_reasons_json) ? row.review_reasons_json : []),
    todoist_added_at: row.todoist_added_at || null,
    first_seen_at: row.first_seen_at || null,
    last_seen_at: row.last_seen_at || null,
    waiting_since_at: row.waiting_since_at || null,
    closed_at: row.closed_at || null,
    parsed_at: row.parsed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    previous_lifecycle_status: row.previous_lifecycle_status || null,
  };
}

function mapEventRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: Number(row.id),
    task_id: Number(row.task_id),
    event_at: row.event_at || null,
    event_type: row.event_type || null,
    changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
    before_json: row.before_json && typeof row.before_json === 'object' ? row.before_json : null,
    after_json: row.after_json && typeof row.after_json === 'object' ? row.after_json : null,
    reason: row.reason || null,
  };
}

function resolveClient(client) {
  return client || getPool();
}

async function listCurrentByTodoistIds(todoistTaskIds, opts = {}) {
  const ids = Array.isArray(todoistTaskIds)
    ? todoistTaskIds.map((id) => asText(id)).filter(Boolean)
    : [];
  if (!ids.length) return [];

  const sql = `
    SELECT *
    FROM ${TODOIST_TASK_CURRENT_TABLE}
    WHERE todoist_task_id = ANY($1::text[])
  `;

  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_current_list_by_ids', {
    table: TODOIST_TASK_CURRENT_TABLE,
    count: ids.length,
  }, () => db.query(sql, [ids]));

  return (res.rows || []).map((row) => mapTaskRow(row)).filter(Boolean);
}

async function listCurrentTasks(opts = {}) {
  const includeClosed = opts.includeClosed !== false;
  const where = includeClosed ? '' : "WHERE lifecycle_status <> 'closed'";
  const sql = `
    SELECT *
    FROM ${TODOIST_TASK_CURRENT_TABLE}
    ${where}
    ORDER BY updated_at DESC
  `;
  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_current_list', {
    table: TODOIST_TASK_CURRENT_TABLE,
    include_closed: includeClosed,
  }, () => db.query(sql));
  return (res.rows || []).map((row) => mapTaskRow(row)).filter(Boolean);
}

async function getTaskByTodoistTaskId(todoistTaskId, opts = {}) {
  const id = parseNonEmptyText(todoistTaskId, 'todoist_task_id');
  const sql = `
    SELECT *
    FROM ${TODOIST_TASK_CURRENT_TABLE}
    WHERE todoist_task_id = $1
    LIMIT 1
  `;
  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_current_get_by_todoist_id', {
    table: TODOIST_TASK_CURRENT_TABLE,
  }, () => db.query(sql, [id]));
  return res.rows && res.rows[0] ? mapTaskRow(res.rows[0]) : null;
}

function normalizeTaskShape(value) {
  const out = asText(value).toLowerCase();
  if (!TASK_SHAPES.has(out)) {
    throw new Error(`task_shape must be one of: ${Array.from(TASK_SHAPES).join(', ')}`);
  }
  return out;
}

function normalizeReviewStatus(value) {
  const out = asText(value).toLowerCase();
  if (!REVIEW_STATUSES.has(out)) {
    throw new Error(`review_status must be one of: ${Array.from(REVIEW_STATUSES).join(', ')}`);
  }
  return out;
}

async function upsertTaskCurrent(input, opts = {}) {
  const data = input && typeof input === 'object' ? input : {};
  const todoist_task_id = parseNonEmptyText(data.todoist_task_id, 'todoist_task_id');
  const todoist_project_id = parseOptionalText(data.todoist_project_id);
  const todoist_project_name = parseNonEmptyText(data.todoist_project_name, 'todoist_project_name');
  const todoist_section_id = parseOptionalText(data.todoist_section_id);
  const todoist_section_name = parseOptionalText(data.todoist_section_name);
  const raw_title = parseNonEmptyText(data.raw_title, 'raw_title');
  const raw_description = parseOptionalText(data.raw_description);
  const todoist_priority = parsePriority(data.todoist_priority);
  const todoist_due_date = parseOptionalDate(data.todoist_due_date);
  const todoist_due_string = parseOptionalText(data.todoist_due_string);
  const todoist_due_is_recurring = data.todoist_due_is_recurring === true;
  const project_key = parseNonEmptyText(data.project_key, 'project_key').toLowerCase();
  const lifecycle_status = parseNonEmptyText(data.lifecycle_status, 'lifecycle_status').toLowerCase();
  const normalized_title_en = parseNonEmptyText(data.normalized_title_en, 'normalized_title_en');
  const task_shape = normalizeTaskShape(data.task_shape || 'unknown');
  const suggested_next_action = parseOptionalText(data.suggested_next_action);
  const parse_confidence = parseConfidence(data.parse_confidence, 0);
  const review_status = normalizeReviewStatus(data.review_status || 'needs_review');
  const review_reasons = Array.isArray(data.review_reasons)
    ? data.review_reasons.map((item) => asText(item)).filter(Boolean)
    : [];

  const sql = `
    INSERT INTO ${TODOIST_TASK_CURRENT_TABLE} AS cur (
      todoist_task_id,
      todoist_project_id,
      todoist_project_name,
      todoist_section_id,
      todoist_section_name,
      raw_title,
      raw_description,
      todoist_priority,
      todoist_due_date,
      todoist_due_string,
      todoist_due_is_recurring,
      project_key,
      lifecycle_status,
      normalized_title_en,
      task_shape,
      suggested_next_action,
      parse_confidence,
      review_status,
      review_reasons,
      todoist_added_at,
      first_seen_at,
      last_seen_at,
      waiting_since_at,
      closed_at,
      parsed_at,
      created_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,$18,$19::jsonb,
      $20,$21,$22,$23,$24,$25,$26,$27
    )
    ON CONFLICT (todoist_task_id) DO UPDATE
    SET
      todoist_project_id = EXCLUDED.todoist_project_id,
      todoist_project_name = EXCLUDED.todoist_project_name,
      todoist_section_id = EXCLUDED.todoist_section_id,
      todoist_section_name = EXCLUDED.todoist_section_name,
      raw_title = EXCLUDED.raw_title,
      raw_description = EXCLUDED.raw_description,
      todoist_priority = EXCLUDED.todoist_priority,
      todoist_due_date = EXCLUDED.todoist_due_date,
      todoist_due_string = EXCLUDED.todoist_due_string,
      todoist_due_is_recurring = EXCLUDED.todoist_due_is_recurring,
      project_key = EXCLUDED.project_key,
      lifecycle_status = EXCLUDED.lifecycle_status,
      normalized_title_en = EXCLUDED.normalized_title_en,
      task_shape = EXCLUDED.task_shape,
      suggested_next_action = EXCLUDED.suggested_next_action,
      parse_confidence = EXCLUDED.parse_confidence,
      review_status = EXCLUDED.review_status,
      review_reasons = EXCLUDED.review_reasons,
      todoist_added_at = COALESCE(EXCLUDED.todoist_added_at, cur.todoist_added_at),
      first_seen_at = LEAST(cur.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = EXCLUDED.last_seen_at,
      waiting_since_at = EXCLUDED.waiting_since_at,
      closed_at = EXCLUDED.closed_at,
      parsed_at = EXCLUDED.parsed_at,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;

  const params = [
    todoist_task_id,
    todoist_project_id,
    todoist_project_name,
    todoist_section_id,
    todoist_section_name,
    raw_title,
    raw_description,
    todoist_priority,
    todoist_due_date,
    todoist_due_string,
    todoist_due_is_recurring,
    project_key,
    lifecycle_status,
    normalized_title_en,
    task_shape,
    suggested_next_action,
    parse_confidence,
    review_status,
    toJsonParam(review_reasons),
    data.todoist_added_at || null,
    data.first_seen_at,
    data.last_seen_at,
    data.waiting_since_at || null,
    data.closed_at || null,
    data.parsed_at || null,
    data.created_at,
    data.updated_at,
  ];

  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_current_upsert', {
    table: TODOIST_TASK_CURRENT_TABLE,
    project_key,
    lifecycle_status,
    review_status,
  }, () => db.query(sql, params));

  return res.rows && res.rows[0] ? mapTaskRow(res.rows[0]) : null;
}

async function insertTaskEvents(taskId, events, opts = {}) {
  const resolvedTaskId = Number(taskId);
  if (!Number.isFinite(resolvedTaskId) || resolvedTaskId <= 0) {
    throw new Error('taskId must be a positive integer');
  }
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return { rowCount: 0, rows: [] };

  const values = [];
  const params = [];
  let idx = 1;
  for (const event of list) {
    const row = event && typeof event === 'object' ? event : {};
    const event_type = parseNonEmptyText(row.event_type, 'event_type');
    const event_at = parseOptionalText(row.event_at) || new Date().toISOString();
    const changed_fields = Array.isArray(row.changed_fields)
      ? row.changed_fields.map((field) => asText(field)).filter(Boolean)
      : [];
    params.push(
      resolvedTaskId,
      event_at,
      event_type,
      changed_fields,
      toJsonParam(row.before_json || null),
      toJsonParam(row.after_json || null),
      parseOptionalText(row.reason)
    );
    values.push(`($${idx++}::bigint, $${idx++}::timestamptz, $${idx++}, $${idx++}::text[], $${idx++}::jsonb, $${idx++}::jsonb, $${idx++})`);
  }

  const sql = `
    INSERT INTO ${TODOIST_TASK_EVENTS_TABLE} (
      task_id,
      event_at,
      event_type,
      changed_fields,
      before_json,
      after_json,
      reason
    )
    VALUES ${values.join(',\n           ')}
    RETURNING *
  `;

  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_events_insert', {
    table: TODOIST_TASK_EVENTS_TABLE,
    count: list.length,
  }, () => db.query(sql, params));

  return {
    rowCount: res.rowCount || 0,
    rows: (res.rows || []).map((row) => mapEventRow(row)).filter(Boolean),
  };
}

async function closeMissingTasks(seenTaskIds, nowIso, opts = {}) {
  const seen = Array.isArray(seenTaskIds)
    ? seenTaskIds.map((id) => asText(id)).filter(Boolean)
    : [];
  const ts = asText(nowIso) || new Date().toISOString();
  const db = resolveClient(opts.client);

  const sql = seen.length
    ? `
      WITH to_close AS (
        SELECT id, lifecycle_status
        FROM ${TODOIST_TASK_CURRENT_TABLE}
        WHERE lifecycle_status <> 'closed'
          AND todoist_task_id <> ALL($1::text[])
      )
      UPDATE ${TODOIST_TASK_CURRENT_TABLE} AS cur
      SET
        lifecycle_status = 'closed',
        closed_at = COALESCE(cur.closed_at, $2::timestamptz),
        waiting_since_at = NULL,
        last_seen_at = $2::timestamptz,
        updated_at = $2::timestamptz
      FROM to_close
      WHERE cur.id = to_close.id
      RETURNING cur.*, to_close.lifecycle_status AS previous_lifecycle_status
    `
    : `
      WITH to_close AS (
        SELECT id, lifecycle_status
        FROM ${TODOIST_TASK_CURRENT_TABLE}
        WHERE lifecycle_status <> 'closed'
      )
      UPDATE ${TODOIST_TASK_CURRENT_TABLE} AS cur
      SET
        lifecycle_status = 'closed',
        closed_at = COALESCE(cur.closed_at, $1::timestamptz),
        waiting_since_at = NULL,
        last_seen_at = $1::timestamptz,
        updated_at = $1::timestamptz
      FROM to_close
      WHERE cur.id = to_close.id
      RETURNING cur.*, to_close.lifecycle_status AS previous_lifecycle_status
    `;

  const params = seen.length ? [seen, ts] : [ts];

  const res = await traceDb('todoist_close_missing', {
    table: TODOIST_TASK_CURRENT_TABLE,
    seen_count: seen.length,
  }, () => db.query(sql, params));

  return (res.rows || []).map((row) => mapTaskRow(row)).filter(Boolean);
}

async function listTaskEvents(taskId, opts = {}) {
  const resolvedTaskId = Number(taskId);
  if (!Number.isFinite(resolvedTaskId) || resolvedTaskId <= 0) {
    throw new Error('taskId must be a positive integer');
  }
  const limit = Math.min(500, parsePositiveInt(opts.limit, 100));
  const db = resolveClient(opts.client);

  const sql = `
    SELECT *
    FROM ${TODOIST_TASK_EVENTS_TABLE}
    WHERE task_id = $1::bigint
    ORDER BY event_at DESC, id DESC
    LIMIT $2::int
  `;

  const res = await traceDb('todoist_events_list', {
    table: TODOIST_TASK_EVENTS_TABLE,
    limit,
  }, () => db.query(sql, [resolvedTaskId, limit]));

  return (res.rows || []).map((row) => mapEventRow(row)).filter(Boolean);
}

function buildReviewWhere(view) {
  const mode = asText(view).toLowerCase() || 'needs_review';
  if (mode === 'needs_review') return "review_status = 'needs_review'";
  if (mode === 'unreviewed') return "review_status IN ('needs_review','no_review_needed')";
  if (mode === 'accepted') return "review_status = 'accepted'";
  if (mode === 'overridden') return "review_status = 'overridden'";
  return 'TRUE';
}

async function listReviewQueue(opts = {}) {
  const view = asText(opts.view).toLowerCase() || 'needs_review';
  const limit = Math.min(200, parsePositiveInt(opts.limit, 50));
  const offset = Math.max(0, parsePositiveInt(opts.offset, 0) || 0);
  const where = buildReviewWhere(view);

  const sql = `
    SELECT *
    FROM ${TODOIST_TASK_CURRENT_TABLE}
    WHERE ${where}
    ORDER BY
      CASE WHEN project_key = 'inbox' THEN 0 ELSE 1 END ASC,
      CASE WHEN lifecycle_status = 'waiting' THEN 0 ELSE 1 END ASC,
      parse_confidence ASC,
      CASE project_key
        WHEN 'work' THEN 0
        WHEN 'personal' THEN 1
        WHEN 'home' THEN 2
        WHEN 'inbox' THEN 3
        ELSE 4
      END ASC,
      COALESCE(todoist_added_at, first_seen_at) ASC,
      id ASC
    LIMIT $1::int
    OFFSET $2::int
  `;

  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_review_queue', {
    table: TODOIST_TASK_CURRENT_TABLE,
    view,
    limit,
    offset,
  }, () => db.query(sql, [limit, offset]));

  return {
    view,
    limit,
    offset,
    rows: (res.rows || []).map((row) => mapTaskRow(row)).filter(Boolean),
  };
}

async function updateTaskForReviewAction(todoistTaskId, patch, opts = {}) {
  const task = await getTaskByTodoistTaskId(todoistTaskId, opts);
  if (!task) return null;
  const data = patch && typeof patch === 'object' ? patch : {};

  const set = [];
  const params = [];
  let idx = 1;
  const add = (expr, value, cast = '') => {
    params.push(value);
    set.push(`${expr} = $${idx++}${cast}`);
  };

  if (Object.prototype.hasOwnProperty.call(data, 'normalized_title_en')) {
    add('normalized_title_en', parseNonEmptyText(data.normalized_title_en, 'normalized_title_en'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'task_shape')) {
    add('task_shape', normalizeTaskShape(data.task_shape));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'suggested_next_action')) {
    add('suggested_next_action', parseOptionalText(data.suggested_next_action));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'parse_confidence')) {
    add('parse_confidence', parseConfidence(data.parse_confidence, 0));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'review_status')) {
    add('review_status', normalizeReviewStatus(data.review_status));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'review_reasons')) {
    const reasons = Array.isArray(data.review_reasons)
      ? data.review_reasons.map((item) => asText(item)).filter(Boolean)
      : [];
    add('review_reasons', toJsonParam(reasons), '::jsonb');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'parsed_at')) {
    add('parsed_at', parseOptionalText(data.parsed_at));
  }

  if (!set.length) return task;
  add('updated_at', new Date().toISOString(), '::timestamptz');
  params.push(task.id);

  const sql = `
    UPDATE ${TODOIST_TASK_CURRENT_TABLE}
    SET ${set.join(',\n        ')}
    WHERE id = $${idx}::bigint
    RETURNING *
  `;

  const db = resolveClient(opts.client);
  const res = await traceDb('todoist_review_action_update', {
    table: TODOIST_TASK_CURRENT_TABLE,
    fields: set.length,
  }, () => db.query(sql, params));

  return res.rows && res.rows[0] ? mapTaskRow(res.rows[0]) : null;
}

module.exports = {
  TODOIST_TASK_CURRENT_TABLE,
  TODOIST_TASK_EVENTS_TABLE,
  mapTaskRow,
  mapEventRow,
  listCurrentByTodoistIds,
  listCurrentTasks,
  getTaskByTodoistTaskId,
  upsertTaskCurrent,
  insertTaskEvents,
  closeMissingTasks,
  listTaskEvents,
  listReviewQueue,
  updateTaskForReviewAction,
};
