'use strict';

const { deriveContentHashFromCleanText } = require('../../libs/content-hash.js');
const {
  sb,
  getPool,
  traceDb,
  IMMUTABLE_UPDATE_COLUMNS,
  IDEMPOTENCY_REQUIRED_SOURCES,
  COLUMN_TYPES,
  toSqlValue,
  buildGenericInsertPayload,
  buildGenericUpdatePayload,
  parseQualifiedTable,
  resolveSchemaFromConfig,
  requireSchemaExplicit,
  parseBooleanStrict,
  parsePositiveBigintString,
  resolveSelectors,
  enforceSelectorMax,
  buildSelectorWhere,
  runInTransaction,
  buildPreviewSelectSql,
  buildCountSql,
  movableInsertColumns,
  wrapPolicyTableError,
  getDataObject,
  hasCustomInsertShape,
  returningIsSimpleIdentifierList,
  mapInsertResultRowsForBatch,
  buildBulkIdempotentSkipSql,
  logInsertBatchSuccess,
  isUniqueViolation,
} = require('./shared.js');
const {
  getEntriesTableFromConfig,
  getConfigWithTestMode,
  exec,
} = require('./runtime-store.js');

const PKM_INSERT_REQUIRED_FIELDS = [
  'source',
  'intent',
  'content_type',
  'capture_text',
  'clean_text',
  'idempotency_policy_key',
  'idempotency_key_primary',
];

const PKM_INSERT_OPTIONAL_FIELDS = [
  'url',
  'url_canonical',
  'title',
  'author',
  'quality_score',
  'low_signal',
  'boilerplate_heavy',
  'idempotency_key_secondary',
  'external_ref',
  'metadata',
  'link_count',
  'link_ratio',
  'extracted_char_count',
  'clean_char_count',
  'retrieval_excerpt',
  'source_domain',
  'retrieval_version',
];

const PKM_INSERT_ENRICHED_EXTRA_FIELDS = [
  'topic_primary',
  'topic_primary_confidence',
  'topic_secondary',
  'topic_secondary_confidence',
  'gist',
  'keywords',
  'enrichment_model',
  'prompt_version',
  'distill_summary',
  'distill_excerpt',
  'distill_version',
  'distill_created_from_hash',
  'distill_why_it_matters',
  'distill_stance',
  'distill_status',
  'distill_metadata',
  'enrichment_status',
];

const PKM_INSERT_RETURNING = [
  'entry_id',
  'id',
  'created_at',
  'source',
  'intent',
  'content_type',
  'url_canonical',
  'title',
  'author',
  'clean_text',
  'clean_word_count',
  'boilerplate_heavy',
  'low_signal',
  'quality_score',
];

const PKM_INSERT_ENRICHED_RETURNING = [
  ...PKM_INSERT_RETURNING,
  'topic_primary',
  'topic_primary_confidence',
  'topic_secondary',
  'topic_secondary_confidence',
  'gist',
  'distill_summary',
  'distill_excerpt',
  'distill_version',
  'distill_created_from_hash',
  'distill_why_it_matters',
  'distill_stance',
  'distill_status',
  'distill_metadata',
];

async function getPolicyByKey(schema, policyKey) {
  const policiesTable = sb.qualifiedTable(schema, 'idempotency_policies');
  try {
    const res = await traceDb('idempotency_policy_get', { schema, table: policiesTable, policy_key: policyKey }, () =>
      getPool().query(
        `SELECT policy_key, conflict_action, update_fields, enabled
         FROM ${policiesTable}
         WHERE policy_key = $1
         LIMIT 1`,
        [policyKey]
      )
    );
    const row = res.rows && res.rows[0];
    if (!row) {
      throw new Error(`idempotency policy not found: ${policyKey}`);
    }
    if (!row.enabled) {
      throw new Error(`idempotency policy disabled: ${policyKey}`);
    }
    return row;
  } catch (err) {
    throw wrapPolicyTableError(err, policiesTable);
  }
}

function buildReturningSelectSql({ table, returning, id }) {
  const fields = Array.isArray(returning) && returning.length ? returning.join(', ') : '*';
  return `SELECT ${fields} FROM ${table} WHERE id = ${toSqlValue('uuid', id)} LIMIT 1`;
}

async function selectReturningById({ table, returning, id }) {
  const sql = buildReturningSelectSql({ table, returning, id });
  return exec(sql, { op: 'idempotency_select_returning', table });
}

function mergeJsonObjects(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch;
  if (!base || typeof base !== 'object') return patch;
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const next = patch[key];
    const prev = out[key];
    if (
      prev &&
      next &&
      typeof prev === 'object' &&
      typeof next === 'object' &&
      !Array.isArray(prev) &&
      !Array.isArray(next)
    ) {
      out[key] = mergeJsonObjects(prev, next);
    } else {
      out[key] = next;
    }
  }
  return out;
}

function resolveIdempotencyRequest(data) {
  const policyKey = data.idempotency_policy_key;
  const keyPrimaryRaw = data.idempotency_key_primary;
  const keySecondaryRaw = data.idempotency_key_secondary;
  const keyPrimary = keyPrimaryRaw === null || keyPrimaryRaw === undefined
    ? null
    : String(keyPrimaryRaw).trim() || null;
  const keySecondary = keySecondaryRaw === null || keySecondaryRaw === undefined
    ? null
    : String(keySecondaryRaw).trim() || null;
  const hasKeys = !!(keyPrimary || keySecondary);
  const hasPolicy = !!policyKey;
  if (!hasKeys && !hasPolicy) return null;
  if (hasKeys && !hasPolicy) {
    throw new Error('idempotency requires idempotency_policy_key when keys are provided');
  }
  if (hasPolicy && !hasKeys) {
    throw new Error('idempotency requires idempotency_key_primary or idempotency_key_secondary');
  }
  return {
    policy_key: String(policyKey || '').trim(),
    key_primary: keyPrimary,
    key_secondary: keySecondary,
  };
}

async function findExistingIdempotentRow({ table, policy_key, key_primary, key_secondary }) {
  if (!policy_key) return null;
  const res = await traceDb('idempotency_existing_find', { table, policy_key }, () =>
    getPool().query(
      `SELECT *
       FROM ${table}
       WHERE idempotency_policy_key = $1
         AND (
           ($2::text IS NOT NULL AND idempotency_key_primary = $2::text)
           OR ($3::text IS NOT NULL AND idempotency_key_secondary = $3::text)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [policy_key, key_primary || null, key_secondary || null]
    )
  );
  return res.rows && res.rows[0] ? res.rows[0] : null;
}

function buildSetForIdempotentUpdate({ incoming, existing, policyUpdateFields }) {
  const requested = Array.isArray(policyUpdateFields) && policyUpdateFields.length
    ? policyUpdateFields
    : Object.keys(incoming);
  const set = [];
  for (const key of requested) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    if (IMMUTABLE_UPDATE_COLUMNS.has(key)) continue;
    if (key === 'idempotency_policy_key') continue;
    const type = COLUMN_TYPES[key];
    if (!type) continue;
    let value = incoming[key];
    if (
      key === 'metadata' &&
      existing &&
      existing.metadata &&
      value &&
      typeof existing.metadata === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(existing.metadata) &&
      !Array.isArray(value)
    ) {
      value = mergeJsonObjects(existing.metadata, value);
    }
    set.push(`${key} = ${toSqlValue(type, value)}`);
  }
  return set;
}

function hasOwn(obj, key) {
  return !!(obj && Object.prototype.hasOwnProperty.call(obj, key));
}

function isBlankTextValue(value) {
  if (value === null || value === undefined) return true;
  return String(value).trim() === '';
}

function deriveCleanWordCount(cleanText) {
  const text = String(cleanText || '').trim();
  if (!text) return 0;
  return text.split(/\s+/g).filter(Boolean).length;
}

function sanitizeMetadataObject(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('metadata must be a JSON object');
      }
      return parsed;
    } catch {
      throw new Error('metadata must be a JSON object');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metadata must be a JSON object');
  }
  return value;
}

function validateAllowedFields(data, allowedFields) {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      throw new Error(`unsupported field: ${key}`);
    }
  }
}

function parsePkmInsertInput(input, options = {}) {
  const {
    allowEnrichedFields = false,
    requireBaseFields = true,
    allowEnrichmentStatusOverride = false,
  } = options;

  const data = getDataObject(input);
  if (hasOwn(data, 'returning')) throw new Error('returning is not supported');
  if (hasOwn(data, 'content_hash')) throw new Error('content_hash must not be provided');
  if (hasOwn(data, 'extraction_incomplete')) throw new Error('extraction_incomplete is not supported');
  if (hasOwn(data, 'items') || hasOwn(data, 'continue_on_error')) {
    throw new Error('pkm insert item must be a single-row payload');
  }

  const allowedFields = [
    ...PKM_INSERT_REQUIRED_FIELDS,
    ...PKM_INSERT_OPTIONAL_FIELDS,
    ...(allowEnrichedFields ? PKM_INSERT_ENRICHED_EXTRA_FIELDS : []),
  ];
  validateAllowedFields(data, allowedFields);

  const out = { ...data };

  if (!allowEnrichmentStatusOverride) {
    if (hasOwn(out, 'enrichment_status')) {
      throw new Error('enrichment_status override is allowed only on /pkm/insert/enriched');
    }
    out.enrichment_status = 'pending';
  } else if (!hasOwn(out, 'enrichment_status') || out.enrichment_status === null || String(out.enrichment_status).trim() === '') {
    out.enrichment_status = 'pending';
  }

  if (requireBaseFields) {
    for (const field of PKM_INSERT_REQUIRED_FIELDS) {
      if (!hasOwn(out, field) || isBlankTextValue(out[field])) {
        throw new Error(`${field} is required`);
      }
    }
  }

  if (!isBlankTextValue(out.url_canonical) && isBlankTextValue(out.url)) {
    throw new Error('url is required when url_canonical is set');
  }

  if (!hasOwn(out, 'clean_word_count') || out.clean_word_count === null || out.clean_word_count === undefined || out.clean_word_count === '') {
    out.clean_word_count = deriveCleanWordCount(out.clean_text);
  }

  out.content_hash = deriveContentHashFromCleanText(out.clean_text);

  const sourceDomain = hasOwn(out, 'source_domain') ? String(out.source_domain || '').trim() : '';
  const retrievalVersion = hasOwn(out, 'retrieval_version') ? String(out.retrieval_version || '').trim() : '';
  const retrievalExcerpt = hasOwn(out, 'retrieval_excerpt') ? String(out.retrieval_excerpt || '').trim() : '';

  if (sourceDomain || retrievalVersion || retrievalExcerpt) {
    const metadata = sanitizeMetadataObject(out.metadata) || {};
    const retrieval = metadata.retrieval && typeof metadata.retrieval === 'object' && !Array.isArray(metadata.retrieval)
      ? { ...metadata.retrieval }
      : {};
    if (sourceDomain && !retrieval.source_domain) retrieval.source_domain = sourceDomain;
    if (retrievalVersion && !retrieval.version) retrieval.version = retrievalVersion;
    if (retrievalExcerpt && !retrieval.excerpt) retrieval.excerpt = retrievalExcerpt;
    metadata.retrieval = retrieval;
    out.metadata = metadata;
  }

  delete out.source_domain;
  delete out.retrieval_version;

  return out;
}

async function insertBatch(opts) {
  const list = Array.isArray(opts && opts.items) ? opts.items : [];
  if (!list.length) {
    throw new Error('insert batch requires non-empty items');
  }

  const continueOnError = opts && opts.continue_on_error !== false;
  const base = { ...(opts || {}) };
  delete base.items;
  delete base.continue_on_error;
  base.__config = await getConfigWithTestMode();

  const rows = [];
  let okCount = 0;
  const policyCache = new Map();
  const bulkEligible = [];
  const fallback = [];

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    try {
      let one;
      const isObjectItem = item && typeof item === 'object' && !Array.isArray(item);
      if (isObjectItem && (
        Object.prototype.hasOwnProperty.call(item, 'input') ||
        Object.prototype.hasOwnProperty.call(item, 'data') ||
        Object.prototype.hasOwnProperty.call(item, 'columns') ||
        Object.prototype.hasOwnProperty.call(item, 'values') ||
        Object.prototype.hasOwnProperty.call(item, 'table') ||
        Object.prototype.hasOwnProperty.call(item, 'returning')
      )) {
        one = { ...base, ...item };
      } else {
        one = { ...base, input: item };
      }

      if (hasCustomInsertShape(one)) {
        fallback.push({ one, index: i });
        continue;
      }

      const config = one.__config || await getConfigWithTestMode();
      const table = one.table || await getEntriesTableFromConfig(config);
      const data = getDataObject(one);
      const returningOverride = one.returning || data.returning;
      const idempotency = resolveIdempotencyRequest(data);
      const parsedTable = parseQualifiedTable(table);
      const activeSchema = (parsedTable && parsedTable.schema) ? parsedTable.schema : resolveSchemaFromConfig(config);
      const isEntriesTable = !!(parsedTable && parsedTable.table === 'entries');
      const sourceName = String(data.source || '').trim().toLowerCase();
      const requireIdempotency = isEntriesTable && IDEMPOTENCY_REQUIRED_SOURCES.has(sourceName);

      if (requireIdempotency && !idempotency) {
        throw new Error(
          `idempotency fields are required for source "${sourceName}" on ${table}: provide idempotency_policy_key and at least one idempotency key`
        );
      }

      if (!idempotency || !isEntriesTable) {
        fallback.push({ one, index: i });
        continue;
      }

      const policyCacheKey = `${activeSchema}::${idempotency.policy_key}`;
      let policy = policyCache.get(policyCacheKey);
      if (!policy) {
        policy = await getPolicyByKey(activeSchema, idempotency.policy_key);
        policyCache.set(policyCacheKey, policy);
      }
      if (policy.conflict_action !== 'skip') {
        fallback.push({ one, index: i });
        continue;
      }

      const incoming = {
        ...data,
        idempotency_policy_key: policy.policy_key,
        idempotency_key_primary: idempotency.key_primary,
        idempotency_key_secondary: idempotency.key_secondary,
      };
      const built = buildGenericInsertPayload(incoming, returningOverride);
      if (!returningIsSimpleIdentifierList(built.returning)) {
        fallback.push({ one, index: i });
        continue;
      }
      bulkEligible.push({
        one,
        index: i,
        table,
        returning: built.returning,
        columns: built.columns,
        values: built.values,
      });
    } catch (err) {
      if (!continueOnError) throw err;
      rows.push({
        _batch_index: i,
        _batch_ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  const bulkGroups = new Map();
  for (const item of bulkEligible) {
    const key = [item.table, item.columns.join('|'), item.returning.join('|')].join('::');
    if (!bulkGroups.has(key)) {
      bulkGroups.set(key, {
        table: item.table,
        columns: item.columns,
        returning: item.returning,
        rows: [],
      });
    }
    bulkGroups.get(key).rows.push({
      one: item.one,
      batch_index: item.index,
      values: item.values,
    });
  }

  for (const group of bulkGroups.values()) {
    try {
      const sql = buildBulkIdempotentSkipSql({
        table: group.table,
        columns: group.columns,
        returning: group.returning,
        rows: group.rows,
      });
      const result = await exec(sql, {
        op: 'insert_batch_idempotent_skip_bulk',
        table: group.table,
        rowCount: group.rows.length,
      });
      const resultRows = Array.isArray(result && result.rows) ? result.rows : [];
      if (resultRows.length !== group.rows.length) {
        throw new Error(`bulk insert result mismatch: expected ${group.rows.length}, got ${resultRows.length}`);
      }
      for (const row of resultRows) {
        const batchIdx = Number(row.batch_index);
        const out = { ...row };
        delete out.batch_index;
        rows.push({ ...out, _batch_index: batchIdx, _batch_ok: true });
        okCount += 1;
      }
    } catch (err) {
      if (!continueOnError) throw err;
      for (const row of group.rows) {
        try {
          const result = await insert(row.one);
          rows.push(...mapInsertResultRowsForBatch(result, row.batch_index));
          okCount += 1;
        } catch (itemErr) {
          rows.push({
            _batch_index: row.batch_index,
            _batch_ok: false,
            error: itemErr && itemErr.message ? itemErr.message : String(itemErr),
          });
        }
      }
    }
  }

  for (const item of fallback) {
    try {
      const result = await insert(item.one);
      rows.push(...mapInsertResultRowsForBatch(result, item.index));
      okCount += 1;
    } catch (err) {
      if (!continueOnError) throw err;
      rows.push({
        _batch_index: item.index,
        _batch_ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  rows.sort((a, b) => {
    const ai = Number.isFinite(Number(a && a._batch_index)) ? Number(a._batch_index) : Number.MAX_SAFE_INTEGER;
    const bi = Number.isFinite(Number(b && b._batch_index)) ? Number(b._batch_index) : Number.MAX_SAFE_INTEGER;
    if (ai === bi) return 0;
    return ai - bi;
  });

  logInsertBatchSuccess(rows, list.length);

  return {
    rows,
    rowCount: okCount,
  };
}

async function updateBatch(opts) {
  const list = Array.isArray(opts && opts.items) ? opts.items : [];
  if (!list.length) {
    throw new Error('update batch requires non-empty items');
  }

  const continueOnError = opts && opts.continue_on_error !== false;
  const base = { ...(opts || {}) };
  delete base.items;
  delete base.continue_on_error;
  base.__config = await getConfigWithTestMode();

  const rows = [];
  let okCount = 0;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    try {
      let one;
      const isObjectItem = item && typeof item === 'object' && !Array.isArray(item);
      if (isObjectItem && (
        Object.prototype.hasOwnProperty.call(item, 'input') ||
        Object.prototype.hasOwnProperty.call(item, 'data') ||
        Object.prototype.hasOwnProperty.call(item, 'set') ||
        Object.prototype.hasOwnProperty.call(item, 'where') ||
        Object.prototype.hasOwnProperty.call(item, 'table') ||
        Object.prototype.hasOwnProperty.call(item, 'returning')
      )) {
        one = { ...base, ...item };
      } else {
        one = { ...base, input: item };
      }

      const result = await update(one);
      const resultRows = Array.isArray(result && result.rows) ? result.rows : [];
      if (!resultRows.length) {
        rows.push({ _batch_index: i, _batch_ok: true, action: 'noop' });
      } else {
        resultRows.forEach((row) => rows.push({ ...row, _batch_index: i, _batch_ok: true }));
      }
      okCount += 1;
    } catch (err) {
      if (!continueOnError) throw err;
      rows.push({
        _batch_index: i,
        _batch_ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  return {
    rows,
    rowCount: okCount,
  };
}

async function insert(opts) {
  if (Array.isArray(opts && opts.items)) {
    return insertBatch(opts);
  }

  const config = (opts && opts.__config) || await getConfigWithTestMode();
  const table = opts.table || await getEntriesTableFromConfig(config);
  let columns = opts.columns;
  let values = opts.values;
  let returning = opts.returning;

  if (!Array.isArray(columns) || !Array.isArray(values)) {
    const data = getDataObject(opts);
    const returningOverride = opts.returning || data.returning;
    const idempotency = resolveIdempotencyRequest(data);
    const parsedTable = parseQualifiedTable(table);
    const activeSchema = (parsedTable && parsedTable.schema) ? parsedTable.schema : resolveSchemaFromConfig(config);
    const isEntriesTable = !!(parsedTable && parsedTable.table === 'entries');
    const sourceName = String(data.source || '').trim().toLowerCase();
    const requireIdempotency = isEntriesTable && IDEMPOTENCY_REQUIRED_SOURCES.has(sourceName);

    if (requireIdempotency && !idempotency) {
      throw new Error(
        `idempotency fields are required for source "${sourceName}" on ${table}: provide idempotency_policy_key and at least one idempotency key`
      );
    }

    if (!idempotency || !isEntriesTable) {
      const built = buildGenericInsertPayload(data, returningOverride);
      columns = built.columns;
      values = built.values;
      returning = built.returning;
      const sql = sb.buildInsert({ table, columns, values, returning });
      const result = await exec(sql, { op: 'insert', table });
      return {
        ...result,
        rows: (result.rows || []).map((row) => ({ ...row, action: 'inserted' })),
      };
    }

    const policy = await getPolicyByKey(activeSchema, idempotency.policy_key);
    const incoming = {
      ...data,
      idempotency_policy_key: policy.policy_key,
      idempotency_key_primary: idempotency.key_primary,
      idempotency_key_secondary: idempotency.key_secondary,
    };
    const built = buildGenericInsertPayload(incoming, returningOverride);
    columns = built.columns;
    values = built.values;
    returning = built.returning;

    const insertSql = sb.buildInsert({ table, columns, values, returning });

    try {
      const inserted = await exec(insertSql, { op: 'insert_idempotent', table, policy_key: policy.policy_key });
      return {
        ...inserted,
        rows: (inserted.rows || []).map((row) => ({ ...row, action: 'inserted' })),
      };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await findExistingIdempotentRow({
        table,
        policy_key: policy.policy_key,
        key_primary: idempotency.key_primary,
        key_secondary: idempotency.key_secondary,
      });
      if (!existing) throw err;

      if (policy.conflict_action === 'skip') {
        const selected = await selectReturningById({
          table,
          returning,
          id: existing.id,
        });
        return {
          ...selected,
          rows: (selected.rows || []).map((row) => ({ ...row, action: 'skipped' })),
        };
      }

      if (policy.conflict_action === 'update') {
        const set = buildSetForIdempotentUpdate({
          incoming,
          existing,
          policyUpdateFields: policy.update_fields,
        });
        if (!set.length) {
          const selected = await selectReturningById({
            table,
            returning,
            id: existing.id,
          });
          return {
            ...selected,
            rows: (selected.rows || []).map((row) => ({ ...row, action: 'updated' })),
          };
        }
        const updateSql = sb.buildUpdate({
          table,
          set,
          where: `id = ${toSqlValue('uuid', existing.id)}`,
          returning,
        });
        const updated = await exec(updateSql, { op: 'insert_idempotent_update', table, policy_key: policy.policy_key });
        return {
          ...updated,
          rows: (updated.rows || []).map((row) => ({ ...row, action: 'updated' })),
        };
      }

      throw new Error(`unsupported conflict_action: ${policy.conflict_action}`);
    }
  }

  const sql = sb.buildInsert({ table, columns, values, returning });
  const result = await exec(sql, { op: 'insert', table });
  return {
    ...result,
    rows: (result.rows || []).map((row) => ({ ...row, action: 'inserted' })),
  };
}

async function update(opts) {
  if (Array.isArray(opts && opts.items)) {
    return updateBatch(opts);
  }

  const config = (opts && opts.__config) || await getConfigWithTestMode();
  const table = await getEntriesTableFromConfig(config);
  let set = opts.set;
  let where = opts.where;
  let returning = opts.returning;

  if (!Array.isArray(set) || !where) {
    const data = opts.input || opts.data || opts || {};
    const returningOverride = opts.returning || data.returning;
    const built = buildGenericUpdatePayload(data, returningOverride);
    set = built.set;
    where = built.where;
    returning = built.returning;
  }

  const sql = sb.buildUpdate({ table, set, where, returning });
  return exec(sql, { op: 'update', table });
}

async function deleteEntries(opts) {
  const data = (opts && (opts.input || opts.data || opts)) || {};
  if (!data || typeof data !== 'object') {
    throw new Error('delete requires JSON object input');
  }

  const schema = requireSchemaExplicit(data.schema, 'schema');
  const dry_run = parseBooleanStrict(data.dry_run, 'dry_run', false);
  const force = parseBooleanStrict(data.force, 'force', false);
  const selectors = resolveSelectors(data);
  const selector_size = enforceSelectorMax({ ...selectors, force });
  const table = sb.qualifiedTable(schema, 'entries');
  const whereSql = buildSelectorWhere(selectors);
  const previewSql = buildPreviewSelectSql(table, whereSql);
  const countSql = buildCountSql(table, whereSql);

  if (dry_run) {
    const countRes = await traceDb('delete_dry_run_count', { schema, table }, () => getPool().query(countSql));
    const previewRes = await traceDb('delete_dry_run_preview', { schema, table }, () => getPool().query(previewSql));
    const matched_count = Number((countRes.rows && countRes.rows[0] && countRes.rows[0].count) || 0);
    return {
      rows: [{
        dry_run: true,
        schema,
        selector_size: selector_size.toString(),
        matched_count,
        deleted_count: 0,
        preview: previewRes.rows || [],
      }],
      rowCount: 1,
    };
  }

  return runInTransaction('delete', { schema, table }, async (client) => {
    const previewRes = await traceDb('delete_preview', { schema, table }, () => client.query(previewSql));
    const deleteSql = `DELETE FROM ${table} WHERE ${whereSql} RETURNING entry_id, id`;
    const deletedRes = await traceDb('delete_exec', { schema, table }, () => client.query(deleteSql));
    return {
      rows: [{
        dry_run: false,
        schema,
        selector_size: selector_size.toString(),
        matched_count: deletedRes.rowCount || 0,
        deleted_count: deletedRes.rowCount || 0,
        preview: previewRes.rows || [],
      }],
      rowCount: 1,
    };
  });
}

async function moveEntries(opts) {
  const data = (opts && (opts.input || opts.data || opts)) || {};
  if (!data || typeof data !== 'object') {
    throw new Error('move requires JSON object input');
  }

  const from_schema = requireSchemaExplicit(data.from_schema, 'from_schema');
  const to_schema = requireSchemaExplicit(data.to_schema, 'to_schema');
  if (from_schema === to_schema) {
    throw new Error('to_schema must differ from from_schema');
  }

  const dry_run = parseBooleanStrict(data.dry_run, 'dry_run', false);
  const force = parseBooleanStrict(data.force, 'force', false);
  const selectors = resolveSelectors(data);
  const selector_size = enforceSelectorMax({ ...selectors, force });

  const fromTable = sb.qualifiedTable(from_schema, 'entries');
  const toTable = sb.qualifiedTable(to_schema, 'entries');
  const whereSql = buildSelectorWhere(selectors);
  const previewSql = buildPreviewSelectSql(fromTable, whereSql);
  const countSql = buildCountSql(fromTable, whereSql);

  if (dry_run) {
    const countRes = await traceDb('move_dry_run_count', { from_schema, to_schema }, () => getPool().query(countSql));
    const previewRes = await traceDb('move_dry_run_preview', { from_schema, to_schema }, () => getPool().query(previewSql));
    const matched_count = Number((countRes.rows && countRes.rows[0] && countRes.rows[0].count) || 0);
    return {
      rows: [{
        dry_run: true,
        from_schema,
        to_schema,
        selector_size: selector_size.toString(),
        matched_count,
        moved_count: 0,
        preview: previewRes.rows || [],
        mapping: [],
      }],
      rowCount: 1,
    };
  }

  return runInTransaction('move', { from_schema, to_schema }, async (client) => {
    const previewRes = await traceDb('move_preview', { from_schema, to_schema }, () => client.query(previewSql));
    const insertColumns = movableInsertColumns();
    const returningColumns = ['entry_id AS from_entry_id', ...insertColumns];
    const commandValue = String(data.command || '/move').trim() || '/move';
    const commandLit = sb.lit(commandValue);
    const provenanceExpr = `jsonb_build_object(
      'from_schema', ${sb.lit(from_schema)}::text,
      'from_entry_id', d.from_entry_id,
      'moved_at', now(),
      'command', ${commandLit}::text
    )`;

    const selectExprs = insertColumns.map((col) => {
      if (col === 'metadata') {
        return `COALESCE(d.metadata, '{}'::jsonb) || jsonb_build_object('migration', ${provenanceExpr})`;
      }
      if (col === 'external_ref') {
        return `COALESCE(d.external_ref, '{}'::jsonb) || jsonb_build_object('migration', ${provenanceExpr})`;
      }
      return `d.${col}`;
    });

    const moveSql = `WITH moved AS (
  DELETE FROM ${fromTable}
  WHERE ${whereSql}
  RETURNING ${returningColumns.join(', ')}
),
inserted AS (
  INSERT INTO ${toTable} (${insertColumns.join(', ')})
  SELECT ${selectExprs.join(', ')}
  FROM moved d
  RETURNING id, entry_id AS to_entry_id
)
SELECT
  m.from_entry_id,
  i.to_entry_id,
  i.id
FROM inserted i
JOIN moved m ON m.id = i.id
ORDER BY m.from_entry_id ASC`;

    const movedRes = await traceDb('move_exec', { from_schema, to_schema }, () => client.query(moveSql));
    return {
      rows: [{
        dry_run: false,
        from_schema,
        to_schema,
        selector_size: selector_size.toString(),
        matched_count: movedRes.rowCount || 0,
        moved_count: movedRes.rowCount || 0,
        preview: previewRes.rows || [],
        mapping: movedRes.rows || [],
      }],
      rowCount: 1,
    };
  });
}

async function insertPkm(opts) {
  const data = parsePkmInsertInput(opts, {
    allowEnrichedFields: false,
    requireBaseFields: true,
    allowEnrichmentStatusOverride: false,
  });
  return insert({
    input: data,
    returning: PKM_INSERT_RETURNING,
  });
}

async function insertPkmEnriched(opts) {
  const data = parsePkmInsertInput(opts, {
    allowEnrichedFields: true,
    requireBaseFields: true,
    allowEnrichmentStatusOverride: true,
  });
  return insert({
    input: data,
    returning: PKM_INSERT_ENRICHED_RETURNING,
  });
}

async function insertPkmBatch(opts) {
  const data = (opts && (opts.input || opts.data || opts)) || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('pkm/insert/batch requires JSON object input');
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'continue_on_error')) {
    throw new Error('continue_on_error is required');
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'items')) {
    throw new Error('items is required');
  }
  const continue_on_error = parseBooleanStrict(data.continue_on_error, 'continue_on_error', null);
  if (continue_on_error === null) {
    throw new Error('continue_on_error must be boolean');
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error('items must be a non-empty array');
  }

  const items = data.items.map((item, idx) => {
    try {
      return parsePkmInsertInput(item, {
        allowEnrichedFields: false,
        requireBaseFields: true,
        allowEnrichmentStatusOverride: false,
      });
    } catch (err) {
      throw new Error(`items[${idx}]: ${err.message}`);
    }
  });

  return insert({
    items,
    continue_on_error,
    returning: PKM_INSERT_RETURNING,
  });
}

module.exports = {
  insert,
  insertPkm,
  insertPkmBatch,
  insertPkmEnriched,
  update,
  deleteEntries,
  moveEntries,
};
