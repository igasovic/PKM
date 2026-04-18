'use strict';

module.exports = async function run(ctx) {
  const { mdv2Message } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

  const input = (ctx && ctx.$json) || {};
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const workflowName = asText(input.workflow_name) || 'unknown-workflow';
  const workflowId = asText(input.workflow_id);
  const nodeName = asText(input.node_name) || 'unknown-node';
  const failedAt = asText(input.failed_at) || new Date().toISOString();
  const message = asText(input.error_message) || 'unknown error';
  const execId = asText(input.execution_id) || 'unknown';
  const execUrl = asText(input.execution_url);
  const runId = asText(input.run_id) || `n8n-error-${Date.now()}`;

  const sidecarWarnings = Array.isArray(input.sidecar_write_errors) ? input.sidecar_write_errors : [];
  const packPost = (input && input.failure_pack_post && typeof input.failure_pack_post === 'object')
    ? input.failure_pack_post
    : {
      ok: false,
      error: 'missing_failure_pack_post',
      failure_id: null,
      run_id: runId,
      upsert_action: null,
      status: asText(input && input.failure_pack_envelope && input.failure_pack_envelope.status) || 'partial',
    };

  const smokeCleanupSummary = (input && input.smoke_cleanup_summary && typeof input.smoke_cleanup_summary === 'object')
    ? input.smoke_cleanup_summary
    : null;

  const lines = [
    `n8n error run ${execId}`,
    `WF: ${workflowName}`,
    workflowId ? `WFID: ${workflowId}` : '',
    `Node: ${nodeName}`,
    `When: ${failedAt}`,
    `Msg: ${message.slice(0, 500)}`,
  ].filter(Boolean);

  if (execUrl) lines.push(`Exec: ${execUrl}`);
  lines.push(`Run ID: ${runId}`);
  lines.push(`Failure pack: ${packPost.ok ? 'stored' : 'failed'}`);
  lines.push(`Pack status: ${asText(packPost.status) || 'unknown'}`);
  if (packPost.failure_id) lines.push(`Failure ID: ${packPost.failure_id}`);
  if (packPost.upsert_action) lines.push(`Pack write: ${packPost.upsert_action}`);
  if (!packPost.ok && packPost.error) lines.push(`Pack error: ${asText(packPost.error).slice(0, 300)}`);
  if (sidecarWarnings.length) lines.push(`Sidecar warning: ${asText(sidecarWarnings[0]).slice(0, 200)}`);

  if (smokeCleanupSummary) {
    lines.push(`Smoke cleanup: ${smokeCleanupSummary.ok ? 'ok' : 'failed'}`);
    if (smokeCleanupSummary.runId) lines.push(`Smoke run: ${smokeCleanupSummary.runId}`);
    if (Array.isArray(smokeCleanupSummary.deletedIds) && smokeCleanupSummary.deletedIds.length) {
      lines.push(`Deleted IDs: ${smokeCleanupSummary.deletedIds.join(',')}`);
    }
    if (smokeCleanupSummary.cleanupError) {
      lines.push(`Cleanup error: ${asText(smokeCleanupSummary.cleanupError).slice(0, 300)}`);
    }
  }

  return [{
    json: {
      ...input,
      telegram_message: mdv2Message(lines.join('\n')),
      failure_pack: {
        run_id: packPost.run_id || runId,
        failure_id: packPost.failure_id || null,
        status: packPost.status || null,
        ok: packPost.ok === true,
      },
    },
  }];
};
