'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function asPositiveInt(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return Math.trunc(n);
}

function normalizeReadMethod(body) {
  const explicit = asText(body.method || body.read_method).toLowerCase();
  if (explicit) return explicit;

  const intent = asText(body.intent || body.read_intent).toLowerCase();
  const fromIntent = {
    continue: 'continue',
    continue_thread: 'continue',
    last: 'last',
    vague_recall: 'last',
    find: 'find',
    detail_lookup: 'find',
    pull: 'pull',
    source_pull: 'pull',
    pull_working_memory: 'pull_working_memory',
    topic_memory: 'pull_working_memory',
  }[intent];
  if (fromIntent) return fromIntent;

  if (body.entry_id !== undefined && body.entry_id !== null && body.entry_id !== '') return 'pull';
  if (asText(body.topic || body.topic_primary || body.resolved_topic_primary)) return 'pull_working_memory';
  if (asText(body.q || body.query || body.query_text)) return 'continue';
  throw new Error('read request requires read intent or retrievable input');
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const body = ($json && typeof $json.body === 'object' && !Array.isArray($json.body))
    ? $json.body
    : (($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : null);

  if (!body) {
    throw new Error('read payload must be a JSON object');
  }

  const method = normalizeReadMethod(body);
  const payload = {
    method,
    request_id: asText(body.request_id) || null,
    run_id: asText(body.run_id) || null,
  };

  if (method === 'pull_working_memory') {
    const topic = asText(body.topic || body.topic_primary || body.resolved_topic_primary || body.q);
    if (!topic) throw new Error('topic is required for pull_working_memory');
    payload.topic = topic;
  } else if (method === 'pull') {
    payload.entry_id = asPositiveInt(body.entry_id, 'entry_id');
    if (!payload.entry_id) throw new Error('entry_id is required for pull');
    const shortN = asPositiveInt(body.shortN, 'shortN');
    const longN = asPositiveInt(body.longN, 'longN');
    if (shortN) payload.shortN = shortN;
    if (longN) payload.longN = longN;
  } else {
    const q = asText(body.q || body.query || body.query_text || body.topic || body.topic_primary);
    if (!q) throw new Error('q is required for continue/find/last');
    payload.q = q;
    const days = asPositiveInt(body.days, 'days');
    const limit = asPositiveInt(body.limit, 'limit');
    if (days) payload.days = days;
    if (limit) payload.limit = limit;
  }

  return [{
    json: {
      ...$json,
      read_method: method,
      backend_payload: payload,
      action: 'chatgpt_read',
    },
  }];
};
