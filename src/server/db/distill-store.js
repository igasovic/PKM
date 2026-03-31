'use strict';

const {
  sb,
  getConfig,
  getEntriesTableBySchema,
  wrapTier2EntriesError,
  parseUuidList,
  parsePositiveBigintString,
  toSqlValue,
} = require('./shared.js');
const {
  getEntriesTableFromConfig,
  getConfigWithTestMode,
  exec,
} = require('./runtime-store.js');

async function getTier2Candidates(opts) {
  const options = opts || {};
  const schemaOverride = String(options.schema || '').trim();
  const entries_table = schemaOverride
    ? getEntriesTableBySchema(schemaOverride)
    : await getEntriesTableFromConfig(await getConfigWithTestMode());
  const staticConfig = getConfig();
  const distillCfg = staticConfig && staticConfig.distill ? staticConfig.distill : {};
  const defaultScanLimit = Math.max(Number(distillCfg.max_entries_per_run || 0) * 5, 100);
  const scanLimitRaw = Number(options.limit || distillCfg.candidate_scan_limit || defaultScanLimit || 250);
  const scanLimit = Number.isFinite(scanLimitRaw) && scanLimitRaw > 0
    ? Math.min(Math.trunc(scanLimitRaw), 2000)
    : 250;
  const sql = sb.buildTier2CandidateDiscovery({ entries_table, limit: scanLimit });
  return exec(sql, {
    op: 'tier2_candidates',
    table: entries_table,
    schema: schemaOverride || 'active',
    limit: scanLimit,
  });
}

async function getTier2DetailsByIds(ids, opts) {
  const options = opts || {};
  const uuidList = parseUuidList(ids, 'ids');
  if (!uuidList.length) {
    return { rows: [], rowCount: 0 };
  }
  const schemaOverride = String(options.schema || '').trim();
  const entries_table = schemaOverride
    ? getEntriesTableBySchema(schemaOverride)
    : await getEntriesTableFromConfig(await getConfigWithTestMode());
  const sql = sb.buildTier2SelectedDetailQuery({
    entries_table,
    ids: uuidList,
  });
  return exec(sql, {
    op: 'tier2_details',
    table: entries_table,
    schema: schemaOverride || 'active',
    ids: uuidList.length,
  });
}

async function persistTier2EligibilityStatusByIds(ids, opts) {
  const uuidList = parseUuidList(ids, 'ids');
  if (!uuidList.length) {
    return { rows: [], rowCount: 0 };
  }
  const options = opts && typeof opts === 'object' ? opts : {};
  const status = String(options.status || '').trim();
  if (!['queued', 'skipped', 'not_eligible'].includes(status)) {
    throw new Error('status must be queued|skipped|not_eligible');
  }
  const reasonCode = options.reason_code === null || options.reason_code === undefined
    ? null
    : String(options.reason_code).trim();

  const schemaOverride = String(options.schema || '').trim();
  const entriesTable = schemaOverride
    ? getEntriesTableBySchema(schemaOverride)
    : await getEntriesTableFromConfig(await getConfigWithTestMode());
  const sql = sb.buildTier2PersistEligibilityStatus({
    entries_table: entriesTable,
    ids: uuidList,
    status,
    reason_code: reasonCode,
  });
  try {
    return await exec(sql, {
      op: 'tier2_eligibility_status_update',
      table: entriesTable,
      schema: schemaOverride || 'active',
      status,
      ids: uuidList.length,
    });
  } catch (err) {
    throw wrapTier2EntriesError(err, entriesTable);
  }
}

async function persistTier2QueuedStatusByIds(ids, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  return persistTier2EligibilityStatusByIds(ids, {
    status: 'queued',
    reason_code: String(options.reason_code || 'batch_dispatch').trim() || 'batch_dispatch',
    schema: options.schema,
  });
}

async function getTier2SyncEntryByEntryId(entryId) {
  const normalized = parsePositiveBigintString(entryId, 'entry_id');
  const entriesTable = getEntriesTableBySchema('pkm');
  const sql = sb.buildTier2EntryByEntryId({
    entries_table: entriesTable,
    entry_id: normalized,
  });
  let result;
  try {
    result = await exec(sql, {
      op: 'tier2_sync_entry_get',
      table: entriesTable,
      entry_id: normalized,
    });
  } catch (err) {
    throw wrapTier2EntriesError(err, entriesTable);
  }
  return result.rows && result.rows[0] ? result.rows[0] : null;
}

async function persistTier2SyncSuccess(entryId, artifact) {
  const normalized = parsePositiveBigintString(entryId, 'entry_id');
  const entriesTable = getEntriesTableBySchema('pkm');
  const payload = artifact && typeof artifact === 'object' ? artifact : {};
  const expectedContentHashRaw = Object.prototype.hasOwnProperty.call(payload, 'distill_created_from_hash')
    ? payload.distill_created_from_hash
    : null;
  const expectedContentHashValue = expectedContentHashRaw === null || expectedContentHashRaw === undefined
    ? null
    : (String(expectedContentHashRaw).trim() || null);
  const set = [
    `distill_summary = ${toSqlValue('text', payload.distill_summary || null)}`,
    `distill_excerpt = ${toSqlValue('text', payload.distill_excerpt || null)}`,
    `distill_version = ${toSqlValue('text', payload.distill_version || null)}`,
    `distill_created_from_hash = ${toSqlValue('text', payload.distill_created_from_hash || null)}`,
    `distill_why_it_matters = ${toSqlValue('text', payload.distill_why_it_matters || null)}`,
    `distill_stance = ${toSqlValue('text', payload.distill_stance || null)}`,
    `distill_metadata = ${toSqlValue('jsonb', payload.distill_metadata || null)}`,
    `distill_status = ${toSqlValue('text', 'completed')}`,
  ];
  const sql = sb.buildUpdate({
    table: entriesTable,
    set,
    where: [
      `entry_id = ${toSqlValue('bigint', normalized)}`,
      `content_hash IS NOT DISTINCT FROM ${toSqlValue('text', expectedContentHashValue)}`,
    ].join(' AND '),
    returning: ['entry_id', 'distill_status', 'content_hash'],
  });
  try {
    return await exec(sql, {
      op: 'tier2_sync_persist_completed',
      table: entriesTable,
      entry_id: normalized,
      expected_content_hash: expectedContentHashValue,
    });
  } catch (err) {
    throw wrapTier2EntriesError(err, entriesTable);
  }
}

async function persistTier2SyncFailure(entryId, opts) {
  const normalized = parsePositiveBigintString(entryId, 'entry_id');
  const entriesTable = getEntriesTableBySchema('pkm');
  const options = opts && typeof opts === 'object' ? opts : {};
  const status = String(options.status || 'failed').trim() || 'failed';
  const metadata = options.metadata && typeof options.metadata === 'object'
    ? options.metadata
    : {};
  const set = [
    `distill_status = ${toSqlValue('text', status)}`,
    `distill_metadata = ${toSqlValue('jsonb', metadata)}`,
  ];
  const sql = sb.buildUpdate({
    table: entriesTable,
    set,
    where: `entry_id = ${toSqlValue('bigint', normalized)}`,
    returning: ['entry_id', 'distill_status'],
  });
  try {
    return await exec(sql, {
      op: 'tier2_sync_persist_failed',
      table: entriesTable,
      entry_id: normalized,
    });
  } catch (err) {
    throw wrapTier2EntriesError(err, entriesTable);
  }
}

async function markTier2StaleInProd() {
  const entriesTable = getEntriesTableBySchema('pkm');
  const sql = sb.buildTier2MarkStale({ entriesTable });
  let res;
  try {
    res = await exec(sql, {
      op: 'tier2_mark_stale',
      table: entriesTable,
    });
  } catch (err) {
    throw wrapTier2EntriesError(err, entriesTable);
  }
  return {
    updated: Number(res.rowCount || 0),
  };
}

module.exports = {
  getTier2Candidates,
  getTier2DetailsByIds,
  persistTier2EligibilityStatusByIds,
  persistTier2QueuedStatusByIds,
  getTier2SyncEntryByEntryId,
  persistTier2SyncSuccess,
  persistTier2SyncFailure,
  markTier2StaleInProd,
};
