'use strict';

const sb = require('../../libs/sql-builder.js');
const { getPool } = require('../db-pool.js');
const { traceDb } = require('../logger/braintrust.js');
const { normalizeTopicKey, asText } = require('../chatgpt/topic.js');
const { getConfigWithTestMode } = require('./runtime-store.js');
const { runInTransaction } = require('./shared.js');

function resolveSchemaFromConfig(config) {
  const cfg = config && config.db ? config.db : {};
  const candidate = cfg.is_test_mode ? cfg.schema_test : cfg.schema_prod;
  if (sb.isValidIdent(candidate)) return candidate;
  return cfg.is_test_mode ? 'pkm_test' : 'pkm';
}

function asNullableText(value) {
  const out = asText(value);
  return out || null;
}

function asNullableBigint(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return Math.trunc(n);
}

function requireTopicKey(value) {
  const topicKey = normalizeTopicKey(value);
  if (!topicKey) {
    throw new Error('topic_key is required');
  }
  return topicKey;
}

function ensureJsonObjectOrNull(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${fieldName} must be a JSON object`);
      }
      return parsed;
    } catch (err) {
      if (err && err.message && err.message.includes(`${fieldName} must be`)) {
        throw err;
      }
      throw new Error(`${fieldName} must be valid JSON object text`);
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  throw new Error(`${fieldName} must be a JSON object`);
}

function toQuestionItems(items) {
  if (items === undefined) return null;
  if (!Array.isArray(items)) {
    throw new Error('open_questions must be an array');
  }
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`open_questions[${index}] must be an object`);
    }
    const key = asText(item.question_key || item.item_key || item.id || `q${index + 1}`);
    const text = asText(item.question_text || item.text);
    const status = asText(item.status || 'open').toLowerCase();
    const sortOrderRaw = item.sort_order ?? index;
    const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? Math.trunc(Number(sortOrderRaw)) : index;
    if (!key) throw new Error(`open_questions[${index}].question_key is required`);
    if (!text) throw new Error(`open_questions[${index}].question_text is required`);
    if (status !== 'open' && status !== 'closed') {
      throw new Error(`open_questions[${index}].status must be open|closed`);
    }
    return {
      question_key: key,
      question_text: text,
      status,
      sort_order: sortOrder,
    };
  });
}

function toPatchKeyList(value, fieldName) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const key = asText(value[i]);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function normalizeQuestionPatch(patch) {
  if (patch === undefined || patch === null) return null;
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('open_questions_patch must be an object');
  }
  const upsertRaw = patch.upsert;
  const upsert = upsertRaw === undefined ? [] : toQuestionItems(upsertRaw);
  return {
    upsert,
    close: toPatchKeyList(patch.close, 'open_questions_patch.close'),
    reopen: toPatchKeyList(patch.reopen, 'open_questions_patch.reopen'),
    delete: toPatchKeyList(patch.delete, 'open_questions_patch.delete'),
  };
}

function normalizeActionPatch(patch) {
  if (patch === undefined || patch === null) return null;
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('action_items_patch must be an object');
  }
  const upsertRaw = patch.upsert;
  const upsert = upsertRaw === undefined ? [] : toActionItems(upsertRaw);
  return {
    upsert,
    done: toPatchKeyList(patch.done, 'action_items_patch.done'),
    reopen: toPatchKeyList(patch.reopen, 'action_items_patch.reopen'),
    delete: toPatchKeyList(patch.delete, 'action_items_patch.delete'),
  };
}

function hasStatePatchFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    Object.prototype.hasOwnProperty.call(value, 'title')
    || Object.prototype.hasOwnProperty.call(value, 'why_active_now')
    || Object.prototype.hasOwnProperty.call(value, 'current_mental_model')
    || Object.prototype.hasOwnProperty.call(value, 'tensions_uncertainties')
    || Object.prototype.hasOwnProperty.call(value, 'last_session_id')
    || Object.prototype.hasOwnProperty.call(value, 'migration_source_entry_id')
    || Object.prototype.hasOwnProperty.call(value, 'migration_source_content_hash')
  );
}

function hasQuestionPatchOps(value) {
  if (!value) return false;
  return (
    (Array.isArray(value.upsert) && value.upsert.length > 0)
    || (Array.isArray(value.close) && value.close.length > 0)
    || (Array.isArray(value.reopen) && value.reopen.length > 0)
    || (Array.isArray(value.delete) && value.delete.length > 0)
  );
}

function hasActionPatchOps(value) {
  if (!value) return false;
  return (
    (Array.isArray(value.upsert) && value.upsert.length > 0)
    || (Array.isArray(value.done) && value.done.length > 0)
    || (Array.isArray(value.reopen) && value.reopen.length > 0)
    || (Array.isArray(value.delete) && value.delete.length > 0)
  );
}

function applyQuestionPatchItems(currentRows, patch) {
  const map = new Map();
  const list = Array.isArray(currentRows) ? currentRows : [];
  let maxSort = 0;

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const key = asText(row && row.question_key);
    if (!key) continue;
    const sortOrder = Number.isFinite(Number(row.sort_order)) ? Math.trunc(Number(row.sort_order)) : (i + 1);
    if (sortOrder > maxSort) maxSort = sortOrder;
    map.set(key, {
      question_key: key,
      question_text: asText(row.question_text),
      status: asText(row.status || 'open').toLowerCase() === 'closed' ? 'closed' : 'open',
      sort_order: sortOrder,
    });
  }

  for (const item of patch.upsert) {
    const key = item.question_key;
    const existing = map.get(key);
    const nextSort = Number.isFinite(Number(item.sort_order)) ? Math.trunc(Number(item.sort_order)) : (existing ? existing.sort_order : (maxSort + 1));
    if (!existing && nextSort > maxSort) maxSort = nextSort;
    map.set(key, {
      question_key: key,
      question_text: asText(item.question_text) || (existing ? existing.question_text : ''),
      status: item.status === 'closed' ? 'closed' : (existing ? existing.status : 'open'),
      sort_order: nextSort,
    });
  }

  for (const key of patch.close) {
    const row = map.get(key);
    if (!row) continue;
    row.status = 'closed';
  }
  for (const key of patch.reopen) {
    const row = map.get(key);
    if (!row) continue;
    row.status = 'open';
  }
  for (const key of patch.delete) {
    map.delete(key);
  }

  const next = Array.from(map.values())
    .filter((item) => asText(item.question_text))
    .sort((a, b) => {
      if (a.sort_order === b.sort_order) return a.question_key.localeCompare(b.question_key);
      return a.sort_order - b.sort_order;
    })
    .map((item, index) => ({
      ...item,
      sort_order: index + 1,
    }));
  return next;
}

function applyActionPatchItems(currentRows, patch) {
  const map = new Map();
  const list = Array.isArray(currentRows) ? currentRows : [];
  let maxSort = 0;

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const key = asText(row && row.action_key);
    if (!key) continue;
    const sortOrder = Number.isFinite(Number(row.sort_order)) ? Math.trunc(Number(row.sort_order)) : (i + 1);
    if (sortOrder > maxSort) maxSort = sortOrder;
    map.set(key, {
      action_key: key,
      action_text: asText(row.action_text),
      status: asText(row.status || 'open').toLowerCase() === 'done' ? 'done' : 'open',
      sort_order: sortOrder,
    });
  }

  for (const item of patch.upsert) {
    const key = item.action_key;
    const existing = map.get(key);
    const nextSort = Number.isFinite(Number(item.sort_order)) ? Math.trunc(Number(item.sort_order)) : (existing ? existing.sort_order : (maxSort + 1));
    if (!existing && nextSort > maxSort) maxSort = nextSort;
    map.set(key, {
      action_key: key,
      action_text: asText(item.action_text) || (existing ? existing.action_text : ''),
      status: item.status === 'done' ? 'done' : (existing ? existing.status : 'open'),
      sort_order: nextSort,
    });
  }

  for (const key of patch.done) {
    const row = map.get(key);
    if (!row) continue;
    row.status = 'done';
  }
  for (const key of patch.reopen) {
    const row = map.get(key);
    if (!row) continue;
    row.status = 'open';
  }
  for (const key of patch.delete) {
    map.delete(key);
  }

  const next = Array.from(map.values())
    .filter((item) => asText(item.action_text))
    .sort((a, b) => {
      if (a.sort_order === b.sort_order) return a.action_key.localeCompare(b.action_key);
      return a.sort_order - b.sort_order;
    })
    .map((item, index) => ({
      ...item,
      sort_order: index + 1,
    }));
  return next;
}

function toActionItems(items) {
  if (items === undefined) return null;
  if (!Array.isArray(items)) {
    throw new Error('action_items must be an array');
  }
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`action_items[${index}] must be an object`);
    }
    const key = asText(item.action_key || item.item_key || item.id || `a${index + 1}`);
    const text = asText(item.action_text || item.text);
    const status = asText(item.status || 'open').toLowerCase();
    const sortOrderRaw = item.sort_order ?? index;
    const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? Math.trunc(Number(sortOrderRaw)) : index;
    if (!key) throw new Error(`action_items[${index}].action_key is required`);
    if (!text) throw new Error(`action_items[${index}].action_text is required`);
    if (status !== 'open' && status !== 'done') {
      throw new Error(`action_items[${index}].status must be open|done`);
    }
    return {
      action_key: key,
      action_text: text,
      status,
      sort_order: sortOrder,
    };
  });
}

function toRelatedEntries(items) {
  if (items === undefined) return null;
  if (!Array.isArray(items)) {
    throw new Error('related_entries must be an array');
  }
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`related_entries[${index}] must be an object`);
    }
    const entryId = asNullableBigint(item.entry_id, `related_entries[${index}].entry_id`);
    const relationType = asText(item.relation_type || 'related');
    const metadata = ensureJsonObjectOrNull(item.metadata, `related_entries[${index}].metadata`);
    if (!entryId) throw new Error(`related_entries[${index}].entry_id is required`);
    if (!relationType) throw new Error(`related_entries[${index}].relation_type is required`);
    return {
      entry_id: entryId,
      relation_type: relationType,
      metadata,
    };
  });
}

function wrapActiveTopicTableError(err, tableName) {
  if (!err) return err;
  if (err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(`active topic state tables missing: create ${tableName} before using topic state store`);
    wrapped.cause = err;
    wrapped.statusCode = 500;
    return wrapped;
  }
  return err;
}

function makeTables(schema) {
  return {
    topics: sb.qualifiedTable(schema, 'active_topics'),
    state: sb.qualifiedTable(schema, 'active_topic_state'),
    questions: sb.qualifiedTable(schema, 'active_topic_open_questions'),
    actions: sb.qualifiedTable(schema, 'active_topic_action_items'),
    relatedEntries: sb.qualifiedTable(schema, 'active_topic_related_entries'),
  };
}

async function resolveContext(opts) {
  const options = opts || {};
  const config = options.config || await getConfigWithTestMode();
  const schema = options.schema ? String(options.schema).trim() : resolveSchemaFromConfig(config);
  if (!sb.isValidIdent(schema)) {
    throw new Error(`invalid schema for active topic state: ${schema}`);
  }
  return {
    schema,
    tables: makeTables(schema),
    queryable: options.client || getPool(),
  };
}

async function listActiveTopics(opts) {
  const { schema, tables, queryable } = await resolveContext(opts);
  const sql = `
    SELECT topic_key, title, is_active, created_at, updated_at
    FROM ${tables.topics}
    WHERE is_active = true
    ORDER BY topic_key ASC
  `;
  try {
    const res = await traceDb('active_topics_list', { schema, table: tables.topics }, () => queryable.query(sql));
    return {
      schema,
      rows: Array.isArray(res.rows) ? res.rows : [],
      rowCount: Number(res.rowCount || 0),
    };
  } catch (err) {
    throw wrapActiveTopicTableError(err, tables.topics);
  }
}

async function getTopicState(args, opts) {
  const input = args && typeof args === 'object' ? args : {};
  const topicKey = requireTopicKey(input.topic_key || input.topic || input.key);
  const { schema, tables, queryable } = await resolveContext(opts);

  const topicSql = `
    SELECT
      t.topic_key,
      t.title AS topic_title,
      t.is_active,
      t.created_at AS topic_created_at,
      t.updated_at AS topic_updated_at,
      s.title AS state_title,
      s.why_active_now,
      s.current_mental_model,
      s.tensions_uncertainties,
      s.state_version,
      s.last_session_id,
      s.migration_source_entry_id,
      s.migration_source_content_hash,
      s.created_at AS state_created_at,
      s.updated_at AS state_updated_at
    FROM ${tables.topics} t
    LEFT JOIN ${tables.state} s ON s.topic_key = t.topic_key
    WHERE t.topic_key = $1
    LIMIT 1
  `;
  const questionsSql = `
    SELECT question_key, question_text, status, sort_order, created_at, updated_at
    FROM ${tables.questions}
    WHERE topic_key = $1
    ORDER BY sort_order ASC, id ASC
  `;
  const actionsSql = `
    SELECT action_key, action_text, status, sort_order, created_at, updated_at
    FROM ${tables.actions}
    WHERE topic_key = $1
    ORDER BY sort_order ASC, id ASC
  `;
  const relatedEntriesSql = `
    SELECT entry_id, relation_type, metadata, created_at, updated_at
    FROM ${tables.relatedEntries}
    WHERE topic_key = $1
    ORDER BY entry_id ASC
  `;

  try {
    const topicRes = await traceDb('active_topic_state_get_topic', { schema, topic_key: topicKey }, () =>
      queryable.query(topicSql, [topicKey])
    );
    const topicRow = topicRes.rows && topicRes.rows[0];
    if (!topicRow) {
      return {
        meta: {
          schema,
          topic_key: topicKey,
          found: false,
        },
        topic: null,
        state: null,
        open_questions: [],
        action_items: [],
        related_entries: [],
      };
    }

    const [questionRes, actionRes, relatedEntryRes] = await Promise.all([
      traceDb('active_topic_state_get_questions', { schema, topic_key: topicKey }, () =>
        queryable.query(questionsSql, [topicKey])),
      traceDb('active_topic_state_get_actions', { schema, topic_key: topicKey }, () =>
        queryable.query(actionsSql, [topicKey])),
      traceDb('active_topic_state_get_related_entries', { schema, topic_key: topicKey }, () =>
        queryable.query(relatedEntriesSql, [topicKey])),
    ]);

    return {
      meta: {
        schema,
        topic_key: topicKey,
        found: true,
      },
      topic: {
        topic_key: topicRow.topic_key,
        title: topicRow.topic_title,
        is_active: !!topicRow.is_active,
        created_at: topicRow.topic_created_at || null,
        updated_at: topicRow.topic_updated_at || null,
      },
      state: {
        title: topicRow.state_title || topicRow.topic_title || topicKey,
        why_active_now: topicRow.why_active_now || '',
        current_mental_model: topicRow.current_mental_model || '',
        tensions_uncertainties: topicRow.tensions_uncertainties || '',
        state_version: Number(topicRow.state_version || 1),
        last_session_id: topicRow.last_session_id || null,
        migration_source_entry_id: topicRow.migration_source_entry_id || null,
        migration_source_content_hash: topicRow.migration_source_content_hash || null,
        created_at: topicRow.state_created_at || null,
        updated_at: topicRow.state_updated_at || null,
      },
      open_questions: Array.isArray(questionRes.rows) ? questionRes.rows : [],
      action_items: Array.isArray(actionRes.rows) ? actionRes.rows : [],
      related_entries: Array.isArray(relatedEntryRes.rows) ? relatedEntryRes.rows : [],
    };
  } catch (err) {
    throw wrapActiveTopicTableError(err, tables.topics);
  }
}

function mergeStateInput(stateInput, existingState, topicKey) {
  const input = stateInput && typeof stateInput === 'object' ? stateInput : {};
  const existing = existingState || {};
  const merged = {
    title: input.title === undefined ? (existing.title || topicKey) : asText(input.title) || topicKey,
    why_active_now: input.why_active_now === undefined ? (existing.why_active_now || '') : asText(input.why_active_now),
    current_mental_model: input.current_mental_model === undefined
      ? (existing.current_mental_model || '')
      : asText(input.current_mental_model),
    tensions_uncertainties: input.tensions_uncertainties === undefined
      ? (existing.tensions_uncertainties || '')
      : asText(input.tensions_uncertainties),
    last_session_id: input.last_session_id === undefined
      ? (existing.last_session_id || null)
      : asNullableText(input.last_session_id),
    migration_source_entry_id: input.migration_source_entry_id === undefined
      ? (existing.migration_source_entry_id || null)
      : asNullableBigint(input.migration_source_entry_id, 'state.migration_source_entry_id'),
    migration_source_content_hash: input.migration_source_content_hash === undefined
      ? (existing.migration_source_content_hash || null)
      : asNullableText(input.migration_source_content_hash),
  };
  return merged;
}

async function ensureTopicRow(client, tables, topicKey, topicTitle) {
  const sql = `
    INSERT INTO ${tables.topics} (topic_key, title, is_active, created_at, updated_at)
    VALUES ($1, $2, true, now(), now())
    ON CONFLICT (topic_key) DO UPDATE
    SET title = CASE WHEN EXCLUDED.title <> '' THEN EXCLUDED.title ELSE ${tables.topics}.title END,
        updated_at = now()
    RETURNING topic_key, title
  `;
  const res = await traceDb('active_topic_state_ensure_topic', { table: tables.topics, topic_key: topicKey }, () =>
    client.query(sql, [topicKey, asText(topicTitle) || topicKey])
  );
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function selectCurrentState(client, tables, topicKey) {
  const sql = `
    SELECT
      title,
      why_active_now,
      current_mental_model,
      tensions_uncertainties,
      state_version,
      last_session_id,
      migration_source_entry_id,
      migration_source_content_hash
    FROM ${tables.state}
    WHERE topic_key = $1
    LIMIT 1
  `;
  const res = await traceDb('active_topic_state_select_current', { table: tables.state, topic_key: topicKey }, () =>
    client.query(sql, [topicKey])
  );
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

async function upsertStateRow(client, tables, topicKey, stateInput, topicTitle) {
  const current = await selectCurrentState(client, tables, topicKey);
  const next = mergeStateInput(stateInput, current, topicKey);
  const defaultTitle = asText(topicTitle) || topicKey;
  if (!next.title) next.title = defaultTitle;

  if (current) {
    const sql = `
      UPDATE ${tables.state}
      SET
        title = $2,
        why_active_now = $3,
        current_mental_model = $4,
        tensions_uncertainties = $5,
        state_version = state_version + 1,
        last_session_id = $6,
        migration_source_entry_id = $7,
        migration_source_content_hash = $8,
        updated_at = now()
      WHERE topic_key = $1
      RETURNING topic_key, state_version
    `;
    const params = [
      topicKey,
      next.title,
      next.why_active_now,
      next.current_mental_model,
      next.tensions_uncertainties,
      next.last_session_id,
      next.migration_source_entry_id,
      next.migration_source_content_hash,
    ];
    const res = await traceDb('active_topic_state_update', { table: tables.state, topic_key: topicKey }, () =>
      client.query(sql, params)
    );
    return { action: 'updated', row: res.rows && res.rows[0] ? res.rows[0] : null };
  }

  const insertSql = `
    INSERT INTO ${tables.state} (
      topic_key,
      title,
      why_active_now,
      current_mental_model,
      tensions_uncertainties,
      state_version,
      last_session_id,
      migration_source_entry_id,
      migration_source_content_hash,
      created_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,1,$6,$7,$8,now(),now()
    )
    RETURNING topic_key, state_version
  `;
  const insertParams = [
    topicKey,
    next.title,
    next.why_active_now,
    next.current_mental_model,
    next.tensions_uncertainties,
    next.last_session_id,
    next.migration_source_entry_id,
    next.migration_source_content_hash,
  ];
  const inserted = await traceDb('active_topic_state_insert', { table: tables.state, topic_key: topicKey }, () =>
    client.query(insertSql, insertParams)
  );
  return { action: 'inserted', row: inserted.rows && inserted.rows[0] ? inserted.rows[0] : null };
}

async function replaceOpenQuestions(client, tables, topicKey, questionItems) {
  if (questionItems === null) return;
  await traceDb('active_topic_state_replace_questions_delete', { table: tables.questions, topic_key: topicKey }, () =>
    client.query(`DELETE FROM ${tables.questions} WHERE topic_key = $1`, [topicKey])
  );
  if (!questionItems.length) return;
  const insertSql = `
    INSERT INTO ${tables.questions} (
      topic_key,
      question_key,
      question_text,
      status,
      sort_order,
      created_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,now(),now()
    )
  `;
  for (const item of questionItems) {
    // Order and key are validated by toQuestionItems.
    await traceDb('active_topic_state_replace_questions_insert', { table: tables.questions, topic_key: topicKey }, () =>
      client.query(insertSql, [
        topicKey,
        item.question_key,
        item.question_text,
        item.status,
        item.sort_order,
      ])
    );
  }
}

async function replaceActionItems(client, tables, topicKey, actionItems) {
  if (actionItems === null) return;
  await traceDb('active_topic_state_replace_actions_delete', { table: tables.actions, topic_key: topicKey }, () =>
    client.query(`DELETE FROM ${tables.actions} WHERE topic_key = $1`, [topicKey])
  );
  if (!actionItems.length) return;
  const insertSql = `
    INSERT INTO ${tables.actions} (
      topic_key,
      action_key,
      action_text,
      status,
      sort_order,
      created_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,now(),now()
    )
  `;
  for (const item of actionItems) {
    await traceDb('active_topic_state_replace_actions_insert', { table: tables.actions, topic_key: topicKey }, () =>
      client.query(insertSql, [
        topicKey,
        item.action_key,
        item.action_text,
        item.status,
        item.sort_order,
      ])
    );
  }
}

async function replaceRelatedEntries(client, tables, topicKey, relatedEntries) {
  if (relatedEntries === null) return;
  await traceDb(
    'active_topic_state_replace_related_entries_delete',
    { table: tables.relatedEntries, topic_key: topicKey },
    () => client.query(`DELETE FROM ${tables.relatedEntries} WHERE topic_key = $1`, [topicKey])
  );
  if (!relatedEntries.length) return;
  const insertSql = `
    INSERT INTO ${tables.relatedEntries} (
      topic_key,
      entry_id,
      relation_type,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4::jsonb,now(),now()
    )
  `;
  for (const item of relatedEntries) {
    await traceDb(
      'active_topic_state_replace_related_entries_insert',
      { table: tables.relatedEntries, topic_key: topicKey },
      () => client.query(insertSql, [
        topicKey,
        item.entry_id,
        item.relation_type,
        item.metadata ? JSON.stringify(item.metadata) : null,
      ])
    );
  }
}

async function applyTopicSnapshot(args, opts) {
  const input = args && typeof args === 'object' ? args : {};
  const topicKey = requireTopicKey(input.topic_key || input.topic || input.key);
  const questionItems = toQuestionItems(input.open_questions);
  const actionItems = toActionItems(input.action_items);
  const relatedEntries = toRelatedEntries(input.related_entries);
  const replaceRelatedEntries = input.replace_related_entries === true;
  const stateInput = input.state && typeof input.state === 'object' ? input.state : {};
  const topicTitle = asText(input.topic_title || stateInput.title || topicKey) || topicKey;
  const { schema, tables } = await resolveContext(opts);

  try {
    return runInTransaction('active_topic_state_snapshot', { schema, topic_key: topicKey }, async (client) => {
      await ensureTopicRow(client, tables, topicKey, topicTitle);
      const stateResult = await upsertStateRow(client, tables, topicKey, stateInput, topicTitle);
      await replaceOpenQuestions(client, tables, topicKey, questionItems);
      await replaceActionItems(client, tables, topicKey, actionItems);
      await replaceRelatedEntries(client, tables, topicKey, replaceRelatedEntries ? (relatedEntries || []) : null);
      const snapshot = await getTopicState({ topic_key: topicKey }, { schema, client });
      return {
        ...snapshot,
        write: {
          state: stateResult.action,
          open_questions_replaced: questionItems !== null,
          action_items_replaced: actionItems !== null,
          related_entries_replaced: replaceRelatedEntries,
        },
      };
    });
  } catch (err) {
    throw wrapActiveTopicTableError(err, tables.topics);
  }
}

async function applyTopicPatch(args, opts) {
  const input = args && typeof args === 'object' ? args : {};
  const topicKey = requireTopicKey(input.topic_key || input.topic || input.key);
  const statePatch = input.state_patch && typeof input.state_patch === 'object' && !Array.isArray(input.state_patch)
    ? input.state_patch
    : {};
  const questionPatch = normalizeQuestionPatch(input.open_questions_patch);
  const actionPatch = normalizeActionPatch(input.action_items_patch);
  const topicTitle = asText(input.topic_title || statePatch.title || topicKey) || topicKey;
  const { schema, tables } = await resolveContext(opts);

  const shouldPatchState = hasStatePatchFields(statePatch) || hasQuestionPatchOps(questionPatch) || hasActionPatchOps(actionPatch);
  const shouldPatchQuestions = hasQuestionPatchOps(questionPatch);
  const shouldPatchActions = hasActionPatchOps(actionPatch);

  try {
    return runInTransaction('active_topic_state_patch', { schema, topic_key: topicKey }, async (client) => {
      await ensureTopicRow(client, tables, topicKey, topicTitle);

      let stateWriteAction = 'unchanged';
      if (shouldPatchState) {
        const stateResult = await upsertStateRow(client, tables, topicKey, statePatch, topicTitle);
        stateWriteAction = stateResult && stateResult.action ? stateResult.action : 'updated';
      }

      if (shouldPatchQuestions || shouldPatchActions) {
        const current = await getTopicState({ topic_key: topicKey }, { schema, client });
        if (shouldPatchQuestions) {
          const nextQuestions = applyQuestionPatchItems(current.open_questions, questionPatch);
          await replaceOpenQuestions(client, tables, topicKey, nextQuestions);
        }
        if (shouldPatchActions) {
          const nextActions = applyActionPatchItems(current.action_items, actionPatch);
          await replaceActionItems(client, tables, topicKey, nextActions);
        }
      }

      const snapshot = await getTopicState({ topic_key: topicKey }, { schema, client });
      return {
        ...snapshot,
        write: {
          state: stateWriteAction,
          open_questions_patched: shouldPatchQuestions,
          action_items_patched: shouldPatchActions,
          related_entries_replaced: false,
        },
      };
    });
  } catch (err) {
    throw wrapActiveTopicTableError(err, tables.topics);
  }
}

module.exports = {
  listActiveTopics,
  getTopicState,
  applyTopicSnapshot,
  applyTopicPatch,
};
