'use strict';

module.exports = async function run(ctx) {
  const e = (ctx && ctx.$json) || {};

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
        current.forEach((value) => stack.push(value));
      } else {
        Object.keys(current).forEach((k) => stack.push(current[k]));
      }
    }
    return null;
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

  const errorDescription = asText(e.error && e.error.description)
    || asText(e.execution && e.execution.error && e.execution.error.description)
    || asText(findFirstValueByKey(e, 'description'));

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

  const isTelegramNode = /telegram/i.test(nodeName) || /Telegram(?:\/|\\).+\.ts/i.test(stack);
  const telegramReservedMatch = errorDescription.match(/can't parse entities:\s*Character '([^']+)' is reserved and must be escaped/i);
  const isTelegramMarkdownParseError = isTelegramNode && /can't parse entities/i.test(errorDescription);
  const isGenericBadRequest = /^Bad request - please check your parameters$/i.test(message);
  const enrichedMessage = (isTelegramMarkdownParseError && isGenericBadRequest)
    ? `${message}: ${errorDescription}`
    : message;

  const telegramError = (isTelegramNode && (errorDescription || isGenericBadRequest))
    ? {
      provider: 'telegram',
      api_description: errorDescription || null,
      is_markdownv2_parse_error: isTelegramMarkdownParseError,
      reserved_character: telegramReservedMatch ? asText(telegramReservedMatch[1]) : null,
    }
    : null;

  const time = asText(e.execution && e.startedAt)
    || asText(e.execution && e.startTime)
    || asText(e.trigger && e.error && e.error.timestamp)
    || asText(e.timestamp)
    || new Date().toISOString();

  const execId = asText(e.execution && e.id)
    || asText(e.executionId)
    || 'unknown';

  const execUrl = asText(e.execution && e.execution && e.execution.url)
    || (execId && execId !== 'unknown' ? `/execution/${execId}` : '');

  const runId = asText(findFirstValueByKey(e, 'run_id'))
    || asText(e.run_id)
    || (execId && execId !== 'unknown' ? `n8n-exec-${execId}` : `n8n-error-${Date.now()}`);

  const SMOKE_MASTER_WORKFLOW_ID = '2DB1S0mq7UQN4U3InXRM0';
  const SMOKE_MASTER_WORKFLOW_NAME = '00 Smoke - Master';

  return [{
    json: {
      error_event: e,
      workflow_name: workflowName,
      workflow_id: workflowId || null,
      node_name: nodeName,
      error_message: enrichedMessage,
      error_stack: stack || null,
      error_description: errorDescription || null,
      telegram_error: telegramError,
      failed_at: time,
      execution_id: execId,
      execution_url: execUrl || null,
      run_id: runId,
      created_at_iso: new Date().toISOString(),
      is_smoke_master_error: workflowId === SMOKE_MASTER_WORKFLOW_ID || workflowName === SMOKE_MASTER_WORKFLOW_NAME,
    },
  }];
};
