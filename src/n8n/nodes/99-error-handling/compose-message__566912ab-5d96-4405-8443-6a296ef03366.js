'use strict';

module.exports = async function run(ctx) {
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const e = (ctx && ctx.$json) || {};
  const SMOKE_MASTER_WORKFLOW_ID = '2DB1S0mq7UQN4U3InXRM0';
  const SMOKE_MASTER_WORKFLOW_NAME = '00 Smoke - Master';
  const SMOKE_CLEANUP_NODE_PATH = '@igasovic/n8n-blocks/nodes/00-smoke-master/t99-cleanup.js';

  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const findFirstValueByKey = (obj, key) => {
    const target = String(key || '').trim();
    if (!target || obj == null) return null;
    const stack = [obj];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (seen.has(current)) continue;
      seen.add(current);
      if (Object.prototype.hasOwnProperty.call(current, target) && current[target] != null) {
        return current[target];
      }
      if (Array.isArray(current)) {
        current.forEach((v) => stack.push(v));
      } else {
        Object.keys(current).forEach((k) => stack.push(current[k]));
      }
    }
    return null;
  };

  const collectEntryIds = (obj) => {
    const ids = new Set();
    const stack = [obj];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (seen.has(current)) continue;
      seen.add(current);
      if (Array.isArray(current)) {
        current.forEach((v) => stack.push(v));
        continue;
      }
      const maybeEntryId = current.entry_id;
      if (Number.isFinite(Number(maybeEntryId)) && Number(maybeEntryId) > 0) {
        ids.add(Number(maybeEntryId));
      }
      Object.keys(current).forEach((k) => stack.push(current[k]));
    }
    return Array.from(ids);
  };

  const toTitle = (slug) => {
    return asText(slug)
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const parseNodeFromSource = (source) => {
    const s = asText(source);
    if (!s) return '';

    const byQuotedNode = s.match(/Node '([^']+)'/i);
    if (byQuotedNode && asText(byQuotedNode[1])) {
      return asText(byQuotedNode[1]);
    }

    const byRepoPath = s.match(/\/src\/n8n\/nodes\/[^/]+\/([a-z0-9_-]+)__[a-f0-9-]+\.js/i);
    if (byRepoPath && asText(byRepoPath[1])) {
      return toTitle(byRepoPath[1]);
    }

    const byExtjs = s.match(/extjs:[^/]+\/([a-z0-9_-]+)__[a-f0-9-]+\.js/i);
    if (byExtjs && asText(byExtjs[1])) {
      return toTitle(byExtjs[1]);
    }

    return '';
  };

  const workflowName = asText(e.workflow && e.workflow.name)
    || asText(e.workflowName)
    || asText(e.workflow && e.workflow.id)
    || 'unknown-workflow';
  const workflowId = asText(e.workflow && e.workflow.id)
    || asText(e.workflowId)
    || asText(findFirstValueByKey(e, 'workflowId'))
    || '';

  const message = asText(e.error && e.error.message)
    || asText(e.errorMessage)
    || asText(e.execution && e.execution.error && e.execution.error.message)
    || asText(e.trigger && e.trigger.error && e.trigger.error.message)
    || 'unknown error';

  const stack = asText(e.execution && e.execution.error && e.execution.error.stack)
    || asText(e.error && e.error.stack);

  const nodeName = asText(e.execution && e.error && e.error.node && e.error.node.name)
    || asText(e.execution && e.execution.error && e.execution.error.node && e.execution.error.node.name)
    || asText(e.error && e.node && e.node.name)
    || asText(e.node && e.node.name)
    || parseNodeFromSource(stack)
    || parseNodeFromSource(message)
    || asText(e.lastNodeExecuted)
    || asText(e.execution && e.lastNodeExecuted)
    || asText(e.trigger && e.mode)
    || 'unknown-node';

  const time = asText(e.execution && e.startedAt)
    || asText(e.execution && e.startTime)
    || asText(e.trigger && e.error && e.error.timestamp)
    || asText(e.timestamp)
    || new Date().toISOString();

  const execId = asText(e.execution && e.id)
    || asText(e.executionId)
    || 'unknown';

  const execUrl = asText(e.execution && e.url)
    || (execId && execId !== 'unknown' ? `/execution/${execId}` : '');

  const messageLower = message.toLowerCase();
  const nodeLower = nodeName.toLowerCase();
  const suppressImapTriggerAutoDeactivation = (
    nodeLower.includes('email trigger (imap)')
    || messageLower.includes('email trigger (imap)')
  ) && messageLower.includes('there was a problem with the trigger node')
    && messageLower.includes('workflow had to be deactivated');

  if (suppressImapTriggerAutoDeactivation) {
    return [];
  }

  let smokeCleanupSummary = null;
  const isSmokeMasterError = workflowId === SMOKE_MASTER_WORKFLOW_ID || workflowName === SMOKE_MASTER_WORKFLOW_NAME;
  if (isSmokeMasterError) {
    try {
      const cleanupFn = require(SMOKE_CLEANUP_NODE_PATH);
      const extractedRunId = asText(findFirstValueByKey(e, 'test_run_id')) || asText(message.match(/\b(smoke_\d{4}_\d{2}_\d{2}_\d{6})\b/i)?.[1]);
      const extractedPrior = findFirstValueByKey(e, 'prior_test_mode');
      const extractedEntryIds = collectEntryIds(e);
      const cleanupInput = {
        test_run_id: extractedRunId || null,
        prior_test_mode: typeof extractedPrior === 'boolean' ? extractedPrior : false,
        results: [],
        artifacts: {
          telegram_capture_entry_id: extractedEntryIds[0] || null,
          email_capture_entry_id: extractedEntryIds[1] || null,
        },
      };
      const cleanupRows = await cleanupFn({
        ...ctx,
        $json: cleanupInput,
      });
      const cleanupJson = Array.isArray(cleanupRows) && cleanupRows[0] && cleanupRows[0].json ? cleanupRows[0].json : null;
      const cleanupResult = cleanupJson && Array.isArray(cleanupJson.results)
        ? cleanupJson.results.find((row) => row && row.test_case === 'T99-cleanup') || null
        : null;
      smokeCleanupSummary = {
        ok: !!(cleanupResult && cleanupResult.ok === true),
        runId: extractedRunId || null,
        deletedIds: cleanupResult && cleanupResult.artifacts && Array.isArray(cleanupResult.artifacts.deleted_ids)
          ? cleanupResult.artifacts.deleted_ids
          : extractedEntryIds,
        cleanupError: cleanupResult && cleanupResult.error ? asText(cleanupResult.error.message) : '',
      };
    } catch (cleanupErr) {
      smokeCleanupSummary = {
        ok: false,
        runId: null,
        deletedIds: [],
        cleanupError: asText(cleanupErr && cleanupErr.message ? cleanupErr.message : cleanupErr),
      };
    }
  }

  const lines = [
    `n8n error run ${execId}`,
    `WF: ${workflowName}`,
    workflowId ? `WFID: ${workflowId}` : '',
    `Node: ${nodeName}`,
    `When: ${time}`,
    `Msg: ${message.slice(0, 500)}`,
  ].filter(Boolean);
  if (execUrl) lines.push(`Exec: ${execUrl}`);
  if (smokeCleanupSummary) {
    lines.push(`Smoke cleanup: ${smokeCleanupSummary.ok ? 'ok' : 'failed'}`);
    if (smokeCleanupSummary.runId) lines.push(`Smoke run: ${smokeCleanupSummary.runId}`);
    if (Array.isArray(smokeCleanupSummary.deletedIds) && smokeCleanupSummary.deletedIds.length) {
      lines.push(`Deleted IDs: ${smokeCleanupSummary.deletedIds.join(',')}`);
    }
    if (smokeCleanupSummary.cleanupError) {
      lines.push(`Cleanup error: ${smokeCleanupSummary.cleanupError.slice(0, 300)}`);
    }
  }

  return [{ json: { telegram_message: mdv2Message(lines.join('\n')) } }];
};
