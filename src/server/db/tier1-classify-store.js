'use strict';

const {
  sb,
  traceDb,
  runInTransaction,
  resolveSchemaFromConfig,
  parseUuid,
  parsePositiveBigintString,
} = require('./shared.js');
const { getConfigWithTestMode } = require('./runtime-store.js');

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function asNullableText(value) {
  const out = asText(value);
  return out || null;
}

function parseSelector(input) {
  const idRaw = asText(input && input.id);
  if (idRaw) {
    if (/^\d+$/.test(idRaw) && (!input || input.entry_id === undefined || input.entry_id === null || String(input.entry_id).trim() === '')) {
      return {
        kind: 'entry_id',
        value: parsePositiveBigintString(idRaw, 'entry_id'),
      };
    }
    return {
      kind: 'id',
      value: parseUuid(idRaw, 'id'),
    };
  }

  const entryIdRaw = input && input.entry_id;
  if (entryIdRaw !== undefined && entryIdRaw !== null && String(entryIdRaw).trim() !== '') {
    return {
      kind: 'entry_id',
      value: parsePositiveBigintString(entryIdRaw, 'entry_id'),
    };
  }

  throw new Error('tier1 update requires id or entry_id');
}

function parseOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${fieldName} must be numeric`);
  return n;
}

function parseOptionalConfidence(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${fieldName} must be numeric`);
  if (n < 0 || n > 1) throw new Error(`${fieldName} must be between 0 and 1`);
  return n;
}

function normalizeTopicKey(value) {
  const label = asText(value).toLowerCase();
  if (!label) return '';
  return label
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function parseKeywords(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!Array.isArray(value)) throw new Error('keywords must be an array of strings');
  const unique = [];
  const seen = new Set();
  for (const raw of value) {
    const item = asText(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 12) break;
  }
  return unique.length ? unique : null;
}

function parseTier1Payload(input) {
  const source = input && input.t1 && typeof input.t1 === 'object' && !Array.isArray(input.t1)
    ? input.t1
    : input;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('tier1 payload must be an object');
  }

  const topicPrimary = asText(source.topic_primary);
  const topicSecondary = asText(source.topic_secondary);
  const gist = asText(source.gist);
  if (!topicPrimary) throw new Error('topic_primary is required');
  if (!topicSecondary) throw new Error('topic_secondary is required');
  if (!gist) throw new Error('gist is required');

  const qualitySource = source.flags && typeof source.flags === 'object' && !Array.isArray(source.flags)
    ? source.flags
    : null;

  return {
    topic_primary: topicPrimary,
    topic_primary_confidence: parseOptionalConfidence(source.topic_primary_confidence, 'topic_primary_confidence'),
    topic_secondary: topicSecondary,
    topic_secondary_confidence: parseOptionalConfidence(source.topic_secondary_confidence, 'topic_secondary_confidence'),
    keywords: parseKeywords(source.keywords),
    gist,
    quality_score: parseOptionalNumber(source.quality_score, 'quality_score'),
    clean_word_count: parseOptionalNumber(source.clean_word_count, 'clean_word_count'),
    clean_char_count: parseOptionalNumber(source.clean_char_count, 'clean_char_count'),
    link_count: parseOptionalNumber(source.link_count, 'link_count'),
    link_ratio: parseOptionalNumber(source.link_ratio, 'link_ratio'),
    retrieval_excerpt: asNullableText(source.retrieval_excerpt),
    flags: qualitySource,
    raw: source,
  };
}

function resolveSchema(rawSchema, config) {
  const explicit = asText(rawSchema);
  if (explicit) {
    if (!sb.isValidIdent(explicit)) {
      throw new Error(`invalid schema: ${explicit}`);
    }
    return explicit;
  }
  return resolveSchemaFromConfig(config);
}

function buildUpdateSql({ schema, selector, includeCleanText }) {
  const entriesTable = sb.qualifiedTable(schema, 'entries');
  const whereSql = selector.kind === 'id'
    ? 'id = $1::uuid'
    : 'entry_id = $1::bigint';
  const cleanTextSql = includeCleanText ? ', clean_text = $16::text' : '';

  return `
    UPDATE ${entriesTable}
    SET
      topic_primary = $2::text,
      topic_primary_confidence = $3::real,
      topic_secondary = $4::text,
      topic_secondary_confidence = $5::real,
      keywords = $6::text[],
      gist = $7::text,
      quality_score = $8::real,
      clean_word_count = $9::int,
      clean_char_count = $10::int,
      link_count = $11::int,
      link_ratio = $12::real,
      retrieval_excerpt = $13::text,
      enrichment_status = 'done',
      enrichment_model = $14::text,
      prompt_version = $15::text,
      metadata = $17::jsonb
      ${cleanTextSql}
    WHERE ${whereSql}
    RETURNING
      entry_id,
      id,
      created_at,
      source,
      intent,
      content_type,
      url_canonical,
      COALESCE(title,'') AS title,
      COALESCE(author,'') AS author,
      clean_text,
      capture_text,
      topic_primary,
      topic_secondary,
      gist,
      COALESCE(char_length(clean_text), 0) AS clean_len,
      array_length(keywords, 1) AS kw_count,
      enrichment_status
  `;
}

async function syncActiveTopicClassificationLink(client, schema, row, tier1, enrichmentModel) {
  const relatedTable = sb.qualifiedTable(schema, 'active_topic_related_entries');
  const topicsTable = sb.qualifiedTable(schema, 'active_topics');
  const entryId = row && row.entry_id ? String(row.entry_id) : null;

  if (!entryId) {
    return {
      linked: false,
      topic_key: null,
      reason: 'missing_entry_id',
    };
  }

  await traceDb(
    't1_update_link_delete_prior',
    { schema, table: relatedTable, entry_id: entryId },
    () => client.query(
      `DELETE FROM ${relatedTable}
       WHERE entry_id = $1::bigint
         AND relation_type = 'classified_primary'`,
      [entryId]
    )
  );

  const topicKey = normalizeTopicKey(tier1.topic_primary);
  if (!topicKey) {
    return {
      linked: false,
      topic_key: null,
      reason: 'empty_topic_key',
    };
  }

  const activeTopicRes = await traceDb(
    't1_update_link_check_topic',
    { schema, table: topicsTable, topic_key: topicKey },
    () => client.query(
      `SELECT topic_key
       FROM ${topicsTable}
       WHERE topic_key = $1
         AND is_active = true
       LIMIT 1`,
      [topicKey]
    )
  );
  if (!activeTopicRes.rows || !activeTopicRes.rows[0]) {
    return {
      linked: false,
      topic_key: null,
      reason: 'topic_not_active',
    };
  }

  const metadata = {
    source: 'tier1',
    topic_primary: tier1.topic_primary,
    topic_secondary: tier1.topic_secondary,
    topic_primary_confidence: tier1.topic_primary_confidence,
    topic_secondary_confidence: tier1.topic_secondary_confidence,
    enrichment_model: enrichmentModel,
  };

  await traceDb(
    't1_update_link_upsert',
    { schema, table: relatedTable, topic_key: topicKey, entry_id: entryId },
    () => client.query(
      `INSERT INTO ${relatedTable} (
         topic_key,
         entry_id,
         relation_type,
         metadata,
         created_at,
         updated_at
       ) VALUES (
         $1::text,
         $2::bigint,
         'classified_primary',
         $3::jsonb,
         now(),
         now()
       )
       ON CONFLICT (topic_key, entry_id)
       DO UPDATE SET
         relation_type = EXCLUDED.relation_type,
         metadata = EXCLUDED.metadata,
         updated_at = now()`,
      [topicKey, entryId, JSON.stringify(metadata)]
    )
  );

  return {
    linked: true,
    topic_key: topicKey,
    reason: null,
  };
}

function parseCollectedSelector(customId) {
  const raw = asText(customId);
  if (!raw) return null;
  const entryMatch = raw.match(/^entry_(\d+)$/);
  if (entryMatch) {
    return {
      entry_id: entryMatch[1],
      id: null,
    };
  }

  const idMatch = raw.match(/^id_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (idMatch) {
    return {
      entry_id: null,
      id: idMatch[1],
    };
  }
  return null;
}

async function applyTier1Update(input, opts) {
  const options = opts || {};
  const args = input && typeof input === 'object' ? input : {};
  const config = options.config || await getConfigWithTestMode();
  const schema = resolveSchema(options.schema || args.schema, config);
  const selector = parseSelector(args);
  const tier1 = parseTier1Payload(args);
  const enrichmentModel = asText(args.enrichment_model) || 'unknown';
  const promptVersion = asText(args.prompt_version) || 'unknown';
  const cleanText = asText(args.clean_text);
  const metadata = {
    t1_raw: tier1.raw,
    t1_flags: tier1.flags,
  };

  const params = [
    selector.value,
    tier1.topic_primary,
    tier1.topic_primary_confidence,
    tier1.topic_secondary,
    tier1.topic_secondary_confidence,
    tier1.keywords,
    tier1.gist,
    tier1.quality_score,
    tier1.clean_word_count,
    tier1.clean_char_count,
    tier1.link_count,
    tier1.link_ratio,
    tier1.retrieval_excerpt,
    enrichmentModel,
    promptVersion,
    cleanText || null,
    JSON.stringify(metadata),
  ];
  const updateSql = buildUpdateSql({
    schema,
    selector,
    includeCleanText: !!cleanText,
  });

  const txResult = await runInTransaction(
    't1_update_single',
    {
      schema,
      selector_kind: selector.kind,
      selector_value: selector.value,
    },
    async (client) => {
      const res = await traceDb('t1_update_entry', { schema }, () => client.query(updateSql, params));
      const row = Array.isArray(res.rows) ? res.rows[0] : null;
      if (!row) {
        throw new Error('tier1 update target not found');
      }
      const topicLink = await syncActiveTopicClassificationLink(client, schema, row, tier1, enrichmentModel);
      return {
        row: {
          ...row,
          action: 'updated',
        },
        topic_link: topicLink,
      };
    }
  );

  return {
    schema,
    row: txResult.row,
    topic_link: txResult.topic_link,
  };
}

async function applyTier1UpdateBatch(input, opts) {
  const options = opts || {};
  const args = input && typeof input === 'object' ? input : {};
  const items = Array.isArray(args.items) ? args.items : [];
  if (!items.length) {
    throw new Error('items must be a non-empty array');
  }
  const continueOnError = args.continue_on_error !== false;
  const rows = [];
  let okCount = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      const out = await applyTier1Update(
        {
          ...(item && typeof item === 'object' && !Array.isArray(item) ? item : {}),
          schema: options.schema || args.schema,
        },
        { config: options.config, schema: options.schema || args.schema }
      );
      rows.push({
        ...(out.row || {}),
        topic_link: out.topic_link || null,
        _batch_index: i,
        _batch_ok: true,
      });
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

function buildBatchItemsFromCollectedRows(rows, opts) {
  const options = opts || {};
  const list = Array.isArray(rows) ? rows : [];
  const items = [];
  let skippedNonOk = 0;
  let skippedNoSelector = 0;

  for (const row of list) {
    if (!row || row.status !== 'ok' || !row.parsed) {
      skippedNonOk += 1;
      continue;
    }

    const selector = parseCollectedSelector(row.custom_id);
    if (!selector) {
      skippedNoSelector += 1;
      continue;
    }

    items.push({
      ...selector,
      t1: row.parsed,
      enrichment_model: asText(options.enrichment_model) || 't1-batch',
      prompt_version: asText(options.prompt_version) || 't1_batch_collect_v1',
    });
  }

  return {
    items,
    skipped_non_ok: skippedNonOk,
    skipped_no_selector: skippedNoSelector,
  };
}

async function applyCollectedBatchResults(input, opts) {
  const options = opts || {};
  const args = input && typeof input === 'object' ? input : {};
  const schema = asText(options.schema || args.schema) || null;
  const prepared = buildBatchItemsFromCollectedRows(args.rows, {
    enrichment_model: args.enrichment_model,
    prompt_version: args.prompt_version,
  });

  if (!prepared.items.length) {
    return {
      rows: [],
      rowCount: 0,
      skipped_non_ok: prepared.skipped_non_ok,
      skipped_no_selector: prepared.skipped_no_selector,
    };
  }

  const result = await applyTier1UpdateBatch(
    {
      items: prepared.items,
      continue_on_error: true,
      schema,
    },
    {
      schema,
      config: options.config,
    }
  );

  return {
    ...result,
    skipped_non_ok: prepared.skipped_non_ok,
    skipped_no_selector: prepared.skipped_no_selector,
  };
}

module.exports = {
  applyTier1Update,
  applyTier1UpdateBatch,
  applyCollectedBatchResults,
  buildBatchItemsFromCollectedRows,
};
