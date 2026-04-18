'use strict';

const {
  sb,
  parseFailurePackSummary,
  PIPELINE_EVENTS_TABLE,
  FAILURE_PACKS_TABLE,
  getPool,
  traceDb,
  wrapFailurePacksError,
  parsePositiveInt,
  parseOptionalText,
  parseNullableBoolean,
  parseNonEmptyText,
  parseUuid,
  toJsonParam,
  isUniqueViolation,
} = require('./shared.js');

async function insertPipelineEvent(event) {
  const row = event && typeof event === 'object' ? { ...event } : {};
  const run_id = String(row.run_id || '').trim();
  const step = String(row.step || '').trim();
  const direction = String(row.direction || '').trim().toLowerCase();
  if (!run_id) throw new Error('insertPipelineEvent requires run_id');
  if (!step) throw new Error('insertPipelineEvent requires step');
  if (!['start', 'end', 'error'].includes(direction)) {
    throw new Error('insertPipelineEvent direction must be start|end|error');
  }

  const sql = sb.buildInsertPipelineEvent({ eventsTable: PIPELINE_EVENTS_TABLE });
  const baseSeq = parsePositiveInt(row.seq, 1);
  const paramsBase = [
    run_id,
    0,
    row.service || null,
    row.pipeline || null,
    step,
    direction,
    row.level || 'info',
    row.duration_ms != null ? Number(row.duration_ms) : null,
    (row.entry_id != null && Number.isFinite(Number(row.entry_id))) ? Number(row.entry_id) : null,
    row.batch_id || null,
    row.trace_id || null,
    toJsonParam(row.input_summary),
    toJsonParam(row.output_summary),
    toJsonParam(row.error),
    row.artifact_path || null,
    toJsonParam(row.meta || {}),
  ];

  let attempt = 0;
  while (attempt < 8) {
    attempt += 1;
    const seq = baseSeq + (attempt - 1);
    const params = [...paramsBase];
    params[1] = seq;
    try {
      const res = await getPool().query(sql, params);
      return res.rows && res.rows[0] ? res.rows[0] : { run_id, seq };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (attempt >= 8) throw err;
    }
  }
  return null;
}

async function getPipelineRun(run_id, opts) {
  const id = String(run_id || '').trim();
  if (!id) throw new Error('run_id is required');
  const options = opts || {};
  const limit = parsePositiveInt(options.limit, 5000);
  const sql = sb.buildGetPipelineEventsByRunId({ eventsTable: PIPELINE_EVENTS_TABLE });
  const res = await getPool().query(sql, [id, limit]);
  return {
    run_id: id,
    rows: res.rows || [],
  };
}

async function getRecentPipelineRuns(opts) {
  const options = opts || {};
  const limitRaw = parsePositiveInt(options.limit, 50);
  const limit = Math.min(limitRaw, 200);
  const beforeRaw = String(options.before_ts || '').trim();
  const beforeTs = beforeRaw ? new Date(beforeRaw) : null;
  if (beforeRaw && (!beforeTs || Number.isNaN(beforeTs.getTime()))) {
    throw new Error('before_ts must be a valid datetime');
  }
  const hasError = parseNullableBoolean(options.has_error);
  const pipeline = parseOptionalText(options.pipeline);
  const step = parseOptionalText(options.step);
  const sql = sb.buildGetRecentPipelineRuns({ eventsTable: PIPELINE_EVENTS_TABLE });
  const params = [
    beforeTs ? beforeTs.toISOString() : null,
    hasError,
    limit,
    pipeline,
    step,
  ];
  const res = await getPool().query(sql, params);
  return {
    rows: res.rows || [],
    limit,
    before_ts: beforeTs ? beforeTs.toISOString() : null,
    has_error: hasError,
    pipeline,
    step,
  };
}

async function getLastPipelineRun(opts) {
  const options = opts || {};
  const limit = parsePositiveInt(options.limit, 5000);
  const excludeRunId = String(options.exclude_run_id || '').trim();
  const latestSql = sb.buildGetLastPipelineRunId({
    eventsTable: PIPELINE_EVENTS_TABLE,
    excludeRunId: !!excludeRunId,
  });
  const latest = await getPool().query(latestSql, excludeRunId ? [excludeRunId] : []);
  const run_id = latest.rows && latest.rows[0] ? latest.rows[0].run_id : null;
  if (!run_id) {
    return { run_id: null, rows: [] };
  }
  return getPipelineRun(run_id, { limit });
}

async function upsertFailurePack(input) {
  const summary = parseFailurePackSummary(input);
  const sql = sb.buildUpsertFailurePack({ failurePacksTable: FAILURE_PACKS_TABLE });
  const params = [
    summary.run_id,
    summary.root_execution_id,
    summary.reporting_workflow_names,
    summary.execution_id,
    summary.workflow_id,
    summary.workflow_name,
    summary.mode,
    summary.failed_at,
    summary.node_name,
    summary.node_type,
    summary.error_name,
    summary.error_message,
    summary.status,
    summary.has_sidecars,
    summary.sidecar_root,
    toJsonParam(summary.pack),
  ];
  try {
    const res = await traceDb('failure_pack_upsert', {
      table: FAILURE_PACKS_TABLE,
      run_id: summary.run_id,
      root_execution_id: summary.root_execution_id,
      status: summary.status,
      has_sidecars: summary.has_sidecars,
    }, () => getPool().query(sql, params));
    return res.rows && res.rows[0]
      ? res.rows[0]
      : {
        run_id: summary.run_id,
        root_execution_id: summary.root_execution_id,
        reporting_workflow_names: summary.reporting_workflow_names,
        status: summary.status,
        upsert_action: 'updated',
      };
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function getFailurePackById(failureId) {
  const id = parseUuid(failureId, 'failure_id');
  const sql = sb.buildGetFailurePackById({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_get_by_id', {
      table: FAILURE_PACKS_TABLE,
      failure_id: id,
    }, () => getPool().query(sql, [id]));
    return res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function getFailurePackByRunId(runId) {
  const run_id = parseNonEmptyText(runId, 'run_id');
  const sql = sb.buildGetFailurePackByRunId({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_get_by_run', {
      table: FAILURE_PACKS_TABLE,
      run_id,
    }, () => getPool().query(sql, [run_id]));
    return res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function getFailurePackByRootExecutionId(rootExecutionId) {
  const root_execution_id = parseNonEmptyText(rootExecutionId, 'root_execution_id');
  const sql = sb.buildGetFailurePackByRootExecutionId({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_get_by_root', {
      table: FAILURE_PACKS_TABLE,
      root_execution_id,
    }, () => getPool().query(sql, [root_execution_id]));
    return res.rows && res.rows[0] ? res.rows[0] : null;
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function listFailurePacks(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const limitRaw = parsePositiveInt(options.limit, 20);
  const limit = Math.min(limitRaw, 100);
  const beforeRaw = parseOptionalText(options.before_ts) || '';
  const beforeTs = beforeRaw ? new Date(beforeRaw) : null;
  if (beforeRaw && (!beforeTs || Number.isNaN(beforeTs.getTime()))) {
    throw new Error('before_ts must be a valid datetime');
  }
  const workflowName = parseOptionalText(options.workflow_name);
  const nodeName = parseOptionalText(options.node_name);
  const mode = parseOptionalText(options.mode);
  const sql = sb.buildListFailurePacks({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_list', {
      table: FAILURE_PACKS_TABLE,
      limit,
      before_ts: beforeTs ? beforeTs.toISOString() : null,
      workflow_name: workflowName,
      node_name: nodeName,
      mode,
    }, () => getPool().query(sql, [
      beforeTs ? beforeTs.toISOString() : null,
      workflowName,
      nodeName,
      mode,
      limit,
    ]));
    return {
      rows: res.rows || [],
      limit,
      before_ts: beforeTs ? beforeTs.toISOString() : null,
      workflow_name: workflowName,
      node_name: nodeName,
      mode,
    };
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function listOpenFailurePacks(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const limitRaw = parsePositiveInt(options.limit, 30);
  const limit = Math.min(limitRaw, 100);
  const sql = sb.buildListOpenFailurePacks({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_list_open', {
      table: FAILURE_PACKS_TABLE,
      limit,
    }, () => getPool().query(sql, [limit]));
    return {
      rows: res.rows || [],
      limit,
    };
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function analyzeFailurePack(failureId, payload) {
  const failure_id = parseUuid(failureId, 'failure_id');
  const body = payload && typeof payload === 'object' ? payload : {};
  const analysis_reason = parseNonEmptyText(body.analysis_reason, 'analysis_reason');
  const proposed_fix = parseNonEmptyText(body.proposed_fix, 'proposed_fix');
  const sql = sb.buildAnalyzeFailurePackById({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_analyze', {
      table: FAILURE_PACKS_TABLE,
      failure_id,
    }, () => getPool().query(sql, [failure_id, analysis_reason, proposed_fix]));
    if (res.rows && res.rows[0]) return res.rows[0];

    const existing = await getFailurePackById(failure_id);
    if (!existing) {
      const err = new Error('failure not found');
      err.statusCode = 404;
      throw err;
    }
    if (existing.status === 'resolved') {
      const err = new Error('resolved failures cannot be analyzed');
      err.statusCode = 409;
      throw err;
    }
    const err = new Error('analyze failed');
    err.statusCode = 409;
    throw err;
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function resolveFailurePack(failureId) {
  const failure_id = parseUuid(failureId, 'failure_id');
  const sql = sb.buildResolveFailurePackById({ failurePacksTable: FAILURE_PACKS_TABLE });
  try {
    const res = await traceDb('failure_pack_resolve', {
      table: FAILURE_PACKS_TABLE,
      failure_id,
    }, () => getPool().query(sql, [failure_id]));
    if (res.rows && res.rows[0]) return res.rows[0];
    const err = new Error('failure not found');
    err.statusCode = 404;
    throw err;
  } catch (err) {
    throw wrapFailurePacksError(err);
  }
}

async function prunePipelineEvents(days) {
  const keepDays = parsePositiveInt(days, 30);
  const sql = sb.buildPrunePipelineEvents({ eventsTable: PIPELINE_EVENTS_TABLE });
  const res = await getPool().query(sql, [keepDays]);
  return {
    deleted: Number(res.rowCount || 0),
    keep_days: keepDays,
  };
}

module.exports = {
  insertPipelineEvent,
  getPipelineRun,
  getRecentPipelineRuns,
  getLastPipelineRun,
  upsertFailurePack,
  getFailurePackById,
  getFailurePackByRunId,
  getFailurePackByRootExecutionId,
  listFailurePacks,
  listOpenFailurePacks,
  analyzeFailurePack,
  resolveFailurePack,
  prunePipelineEvents,
};
