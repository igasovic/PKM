'use strict';

const {
  CALENDAR_REQUESTS_TABLE,
  CALENDAR_EVENT_OBSERVATIONS_TABLE,
  CALENDAR_TERMINAL_STATUSES,
  getPool,
  traceDb,
  parseUuid,
  parseNonEmptyText,
  parseOptionalText,
  parseOptionalNumeric01,
  parseCalendarStatus,
  parseBooleanStrict,
  toJsonParam,
} = require('./shared.js');

async function getCalendarRequestById(requestId) {
  const id = parseUuid(requestId, 'request_id');
  const sql = `SELECT *
FROM ${CALENDAR_REQUESTS_TABLE}
WHERE request_id = $1::uuid
LIMIT 1`;
  const res = await traceDb('calendar_request_get_by_id', {
    op: 'calendar_request_get_by_id',
    table: CALENDAR_REQUESTS_TABLE,
  }, () => getPool().query(sql, [id]));
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function getLatestOpenCalendarRequestByChat(chatId) {
  const telegram_chat_id = parseNonEmptyText(chatId, 'telegram_chat_id');
  const sql = `SELECT *
FROM ${CALENDAR_REQUESTS_TABLE}
WHERE telegram_chat_id = $1
  AND status = 'needs_clarification'
ORDER BY updated_at DESC
LIMIT 1`;
  const res = await traceDb('calendar_request_get_latest_open', {
    table: CALENDAR_REQUESTS_TABLE,
    telegram_chat_id,
  }, () => getPool().query(sql, [telegram_chat_id]));
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function upsertCalendarRequest(input) {
  const data = (input && (input.input || input.data || input)) || {};
  if (!data || typeof data !== 'object') {
    throw new Error('calendar request upsert requires object input');
  }
  const run_id = parseNonEmptyText(data.run_id, 'run_id');
  const source_system = parseOptionalText(data.source_system) || 'telegram';
  const actor_code = parseNonEmptyText(data.actor_code, 'actor_code');
  const telegram_chat_id = parseNonEmptyText(data.telegram_chat_id, 'telegram_chat_id');
  const telegram_message_id = parseNonEmptyText(data.telegram_message_id, 'telegram_message_id');
  const route_intent = parseOptionalText(data.route_intent);
  const route_confidence = parseOptionalNumeric01(data.route_confidence, 'route_confidence');
  const status = parseCalendarStatus(data.status, 'status', 'received');
  const raw_text = parseNonEmptyText(data.raw_text, 'raw_text');
  const clarification_turns = Array.isArray(data.clarification_turns) ? data.clarification_turns : [];
  const normalized_event = data.normalized_event && typeof data.normalized_event === 'object'
    ? data.normalized_event
    : null;
  const warning_codes = data.warning_codes && typeof data.warning_codes === 'object'
    ? data.warning_codes
    : null;
  const error = data.error && typeof data.error === 'object'
    ? data.error
    : null;
  const google_calendar_id = parseOptionalText(data.google_calendar_id);
  const google_event_id = parseOptionalText(data.google_event_id);
  const idempotency_key_primary = parseNonEmptyText(data.idempotency_key_primary, 'idempotency_key_primary');
  const idempotency_key_secondary = parseOptionalText(data.idempotency_key_secondary);

  const sql = `INSERT INTO ${CALENDAR_REQUESTS_TABLE} AS cr (
  run_id,
  source_system,
  actor_code,
  telegram_chat_id,
  telegram_message_id,
  route_intent,
  route_confidence,
  status,
  raw_text,
  clarification_turns,
  normalized_event,
  warning_codes,
  error,
  google_calendar_id,
  google_event_id,
  idempotency_key_primary,
  idempotency_key_secondary,
  created_at,
  updated_at
)
VALUES (
  $1, $2, $3, $4, $5,
  $6, $7, $8, $9,
  $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
  $14, $15, $16, $17,
  now(), now()
)
ON CONFLICT (idempotency_key_primary) DO UPDATE
SET
  updated_at = now(),
  run_id = EXCLUDED.run_id,
  route_intent = COALESCE(EXCLUDED.route_intent, cr.route_intent),
  route_confidence = COALESCE(EXCLUDED.route_confidence, cr.route_confidence),
  idempotency_key_secondary = COALESCE(EXCLUDED.idempotency_key_secondary, cr.idempotency_key_secondary)
RETURNING
  *,
  (xmax = 0) AS inserted`;

  const params = [
    run_id,
    source_system,
    actor_code,
    telegram_chat_id,
    telegram_message_id,
    route_intent,
    route_confidence,
    status,
    raw_text,
    toJsonParam(clarification_turns),
    toJsonParam(normalized_event),
    toJsonParam(warning_codes),
    toJsonParam(error),
    google_calendar_id,
    google_event_id,
    idempotency_key_primary,
    idempotency_key_secondary,
  ];

  const res = await traceDb('calendar_request_upsert', {
    table: CALENDAR_REQUESTS_TABLE,
    status,
    route_intent,
  }, () => getPool().query(sql, params));
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function updateCalendarRequestById(requestId, patch) {
  const id = parseUuid(requestId, 'request_id');
  const data = patch && typeof patch === 'object' ? patch : {};
  const set = [];
  const params = [];
  let idx = 1;
  const add = (expr, value) => {
    params.push(value);
    set.push(`${expr} = $${idx++}`);
  };

  if (Object.prototype.hasOwnProperty.call(data, 'run_id')) {
    add('run_id', parseNonEmptyText(data.run_id, 'run_id'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'actor_code')) {
    add('actor_code', parseNonEmptyText(data.actor_code, 'actor_code'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'telegram_message_id')) {
    add('telegram_message_id', parseNonEmptyText(data.telegram_message_id, 'telegram_message_id'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'route_intent')) {
    add('route_intent', parseOptionalText(data.route_intent));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'route_confidence')) {
    add('route_confidence', parseOptionalNumeric01(data.route_confidence, 'route_confidence'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    add('status', parseCalendarStatus(data.status, 'status'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'raw_text')) {
    add('raw_text', parseNonEmptyText(data.raw_text, 'raw_text'));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'clarification_turns')) {
    if (!Array.isArray(data.clarification_turns)) {
      throw new Error('clarification_turns must be an array');
    }
    params.push(toJsonParam(data.clarification_turns));
    set.push(`clarification_turns = $${idx++}::jsonb`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'normalized_event')) {
    params.push(toJsonParam(data.normalized_event && typeof data.normalized_event === 'object' ? data.normalized_event : null));
    set.push(`normalized_event = $${idx++}::jsonb`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'warning_codes')) {
    params.push(toJsonParam(data.warning_codes && typeof data.warning_codes === 'object' ? data.warning_codes : null));
    set.push(`warning_codes = $${idx++}::jsonb`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'error')) {
    params.push(toJsonParam(data.error && typeof data.error === 'object' ? data.error : null));
    set.push(`error = $${idx++}::jsonb`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'google_calendar_id')) {
    add('google_calendar_id', parseOptionalText(data.google_calendar_id));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'google_event_id')) {
    add('google_event_id', parseOptionalText(data.google_event_id));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'idempotency_key_secondary')) {
    add('idempotency_key_secondary', parseOptionalText(data.idempotency_key_secondary));
  }

  if (!set.length) {
    throw new Error('calendar request update requires at least one updatable field');
  }
  set.push('updated_at = now()');
  params.push(id);
  const sql = `UPDATE ${CALENDAR_REQUESTS_TABLE}
SET ${set.join(',\n    ')}
WHERE request_id = $${idx}::uuid
RETURNING *`;
  const res = await traceDb('calendar_request_update', {
    table: CALENDAR_REQUESTS_TABLE,
    fields: set.length - 1,
  }, () => getPool().query(sql, params));
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function finalizeCalendarRequestById(requestId, payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const status = parseCalendarStatus(data.status, 'status');
  if (!CALENDAR_TERMINAL_STATUSES.has(status) && status !== 'calendar_write_started') {
    throw new Error('finalize status must be calendar_write_started|calendar_created|calendar_failed|query_answered|ignored');
  }

  const existing = await getCalendarRequestById(requestId);
  if (!existing) return null;

  const google_event_id = Object.prototype.hasOwnProperty.call(data, 'google_event_id')
    ? parseOptionalText(data.google_event_id)
    : null;
  const google_calendar_id = Object.prototype.hasOwnProperty.call(data, 'google_calendar_id')
    ? parseOptionalText(data.google_calendar_id)
    : null;

  if (
    CALENDAR_TERMINAL_STATUSES.has(existing.status)
    && existing.status === status
    && (!google_event_id || google_event_id === existing.google_event_id)
    && (!google_calendar_id || google_calendar_id === existing.google_calendar_id)
  ) {
    return { ...existing, finalize_action: 'noop' };
  }

  const next = { status };
  if (Object.prototype.hasOwnProperty.call(data, 'run_id')) next.run_id = data.run_id;
  if (Object.prototype.hasOwnProperty.call(data, 'warning_codes')) next.warning_codes = data.warning_codes;
  if (Object.prototype.hasOwnProperty.call(data, 'error')) next.error = data.error;
  if (Object.prototype.hasOwnProperty.call(data, 'google_event_id')) next.google_event_id = google_event_id;
  if (Object.prototype.hasOwnProperty.call(data, 'google_calendar_id')) next.google_calendar_id = google_calendar_id;

  return updateCalendarRequestById(existing.request_id, next);
}

async function insertCalendarObservations(input) {
  const data = (input && (input.input || input.data || input)) || {};
  const items = Array.isArray(data.items) ? data.items : [data];
  if (!items.length) {
    throw new Error('calendar observe requires at least one item');
  }

  const values = [];
  const params = [];
  let idx = 1;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] && typeof items[i] === 'object' ? items[i] : {};
    const run_id = parseNonEmptyText(item.run_id || data.run_id, `items[${i}].run_id`);
    const google_calendar_id = parseNonEmptyText(item.google_calendar_id, `items[${i}].google_calendar_id`);
    const google_event_id = parseNonEmptyText(item.google_event_id, `items[${i}].google_event_id`);
    const observation_kind = parseNonEmptyText(item.observation_kind, `items[${i}].observation_kind`);
    const source_type = parseNonEmptyText(item.source_type, `items[${i}].source_type`);
    const snapshot = item.event_snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error(`items[${i}].event_snapshot must be an object`);
    }
    const resolved_people = item.resolved_people && typeof item.resolved_people === 'object'
      ? item.resolved_people
      : null;
    const resolved_color = parseOptionalText(item.resolved_color);
    const was_reported = parseBooleanStrict(item.was_reported, `items[${i}].was_reported`, false);

    params.push(
      run_id,
      google_calendar_id,
      google_event_id,
      observation_kind,
      source_type,
      toJsonParam(snapshot),
      toJsonParam(resolved_people),
      resolved_color,
      was_reported
    );
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}::jsonb, $${idx++}, $${idx++}::boolean, now(), now())`);
  }

  const sql = `INSERT INTO ${CALENDAR_EVENT_OBSERVATIONS_TABLE} (
  run_id,
  google_calendar_id,
  google_event_id,
  observation_kind,
  source_type,
  event_snapshot,
  resolved_people,
  resolved_color,
  was_reported,
  created_at,
  updated_at
)
VALUES ${values.join(',\n       ')}
RETURNING observation_id, run_id, google_calendar_id, google_event_id, observation_kind, source_type, was_reported, created_at`;
  return traceDb('calendar_observe_insert', {
    table: CALENDAR_EVENT_OBSERVATIONS_TABLE,
    count: items.length,
  }, () => getPool().query(sql, params));
}

module.exports = {
  getCalendarRequestById,
  getLatestOpenCalendarRequestByChat,
  upsertCalendarRequest,
  updateCalendarRequestById,
  finalizeCalendarRequestById,
  insertCalendarObservations,
};
