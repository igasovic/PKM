'use strict';

module.exports = async function run(ctx) {
  let mdv2Message;
  try {
    ({ mdv2Message } = require('/data/src/libs/telegram-markdown.js'));
  } catch (_err) {
    ({ mdv2Message } = require('../../../libs/telegram-markdown.js'));
  }
  const e = (ctx && ctx.$json) || {};

  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

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

  const lines = [
    `n8n error run ${execId}`,
    `WF: ${workflowName}`,
    `Node: ${nodeName}`,
    `When: ${time}`,
    `Msg: ${message.slice(0, 500)}`,
  ];
  if (execUrl) lines.push(`Exec: ${execUrl}`);

  return [{ json: { telegram_message: mdv2Message(lines.join('\n')) } }];
};
