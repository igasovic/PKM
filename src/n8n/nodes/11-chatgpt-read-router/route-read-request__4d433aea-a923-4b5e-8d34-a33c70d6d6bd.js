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

function stripFlagSegment(text, flagName) {
  const re = new RegExp(`(^|\\s)--${flagName}\\s+\\d+(?=\\s|$)`, 'ig');
  return String(text).replace(re, ' ').replace(/\s+/g, ' ').trim();
}

function parseCommandText(body) {
  const raw = asText(body.command || body.text || body.query || body.query_text || body.q);
  if (!raw) return null;

  const match = raw.match(/^\/?(pull|continue|last|find|working_memory|wm)\b\s*(.*)$/i);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const method = command === 'wm' ? 'working_memory' : command;
  const tail = asText(match[2]);
  const daysMatch = tail.match(/(?:^|\s)--days\s+(\d+)(?=\s|$)/i);
  const limitMatch = tail.match(/(?:^|\s)--limit\s+(\d+)(?=\s|$)/i);
  const queryText = stripFlagSegment(stripFlagSegment(tail, 'days'), 'limit');

  return {
    method,
    query_text: queryText,
    days: daysMatch ? asPositiveInt(daysMatch[1], 'days') : null,
    limit: limitMatch ? asPositiveInt(limitMatch[1], 'limit') : null,
  };
}

function resolveMethod(body) {
  const explicit = asText(body.cmd || body.method || body.read_method).toLowerCase();
  if (explicit) {
    if (explicit === 'pull_working_memory' || explicit === 'topic_memory') return 'working_memory';
    if (explicit === 'wm') return 'working_memory';
    return explicit;
  }

  const intent = asText(body.intent || body.read_intent).toLowerCase();
  const mappedIntent = {
    continue: 'continue',
    continue_thread: 'continue',
    last: 'last',
    vague_recall: 'last',
    find: 'find',
    detail_lookup: 'find',
    pull: 'pull',
    source_pull: 'pull',
    working_memory: 'working_memory',
    pull_working_memory: 'working_memory',
    topic_memory: 'working_memory',
  }[intent];
  if (mappedIntent) return mappedIntent;

  const parsedCommand = parseCommandText(body);
  if (parsedCommand && parsedCommand.method) return parsedCommand.method;

  if (body.entry_id !== undefined && body.entry_id !== null && body.entry_id !== '') return 'pull';
  if (asText(body.q || body.query || body.query_text)) return 'continue';
  if (asText(body.topic || body.topic_primary || body.resolved_topic_primary)) return 'working_memory';
  throw new Error('read request requires pull/continue/last/find/working_memory command or intent');
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
  try {
    const body = ($json && typeof $json.body === 'object' && !Array.isArray($json.body))
      ? $json.body
      : (($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : null);

    if (!body) throw new Error('read payload must be a JSON object');

    const method = resolveMethod(body);
    if (!['pull', 'continue', 'last', 'find', 'working_memory'].includes(method)) {
      throw new Error(`unsupported read command: ${method}`);
    }

    const parsedCommand = parseCommandText(body) || {};
    const runId = asText(body.run_id) || `chatgpt-read-${Date.now()}`;

    const payload = {};
    let backendRoute = '';
    let queryText = '';
    let entryId = null;

    if (method === 'pull') {
      entryId = asPositiveInt(body.entry_id, 'entry_id') || asPositiveInt(parsedCommand.query_text, 'entry_id');
      if (!entryId) throw new Error('entry_id is required for pull');
      payload.entry_id = entryId;
      const shortN = asPositiveInt(body.shortN, 'shortN');
      const longN = asPositiveInt(body.longN, 'longN');
      if (shortN) payload.shortN = shortN;
      if (longN) payload.longN = longN;
      backendRoute = '/db/read/pull';
    } else if (method === 'working_memory') {
      queryText = asText(body.topic || body.topic_primary || body.resolved_topic_primary || parsedCommand.query_text);
      if (!queryText) throw new Error('topic is required for working_memory');
      payload.topic = queryText;
      backendRoute = '/chatgpt/working_memory';
    } else {
      queryText = asText(
        body.q
        || body.query
        || body.query_text
        || body.topic
        || body.topic_primary
        || body.resolved_topic_primary
        || parsedCommand.query_text,
      );
      if (!queryText) throw new Error('query text is required for continue/find/last');
      payload.q = queryText;
      const days = asPositiveInt(body.days, 'days') || parsedCommand.days;
      const limit = asPositiveInt(body.limit, 'limit') || parsedCommand.limit;
      if (days) payload.days = days;
      if (limit) payload.limit = limit;
      backendRoute = `/db/read/${method}`;
    }

    return [{
      json: {
        ...$json,
        action: 'chatgpt_read',
        cmd: method,
        read_method: method,
        backend_route: backendRoute,
        backend_payload: payload,
        run_id: runId,
        query_text: queryText || null,
        entry_id: entryId,
        days: payload.days || null,
        limit: payload.limit || null,
        parse_ok: true,
      },
    }];
  } catch (err) {
    return [{
      json: {
        ...$json,
        action: 'chatgpt_read',
        cmd: 'invalid',
        read_method: 'invalid',
        parse_ok: false,
        http_status: 400,
        error: {
          code: 'bad_request',
          message: String(err && err.message ? err.message : err),
        },
      },
    }];
  }
};
