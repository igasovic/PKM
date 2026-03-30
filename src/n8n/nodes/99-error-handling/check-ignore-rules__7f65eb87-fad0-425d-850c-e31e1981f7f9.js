'use strict';

module.exports = async function run(ctx) {
  const input = (ctx && ctx.$json) || {};
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const workflowName = asText(input.workflow_name);
  const message = asText(input.error_message);
  const workflowLower = workflowName.toLowerCase();
  const messageLower = message.toLowerCase();

  const ignoreRules = [
    {
      id: 'wf03_imap_trigger_auto_deactivation',
      workflow_match: '03 e-mail capture',
      message_all: [
        'there was a problem with the trigger node',
        'email trigger (imap)',
        'workflow had to be deactivated',
      ],
    },
    {
      id: 'wf04_gateway_timeout_retry_later',
      workflow_match: '04 notion capture',
      message_all: [
        'gateway timed out - perhaps try again later?',
      ],
    },
  ];

  const matchRule = ignoreRules.find((rule) => {
    const workflowOk = workflowLower.includes(rule.workflow_match);
    const messageOk = Array.isArray(rule.message_all)
      && rule.message_all.every((fragment) => messageLower.includes(String(fragment).toLowerCase()));
    return workflowOk && messageOk;
  }) || null;

  return [{
    json: {
      ...input,
      ignored_error: !!matchRule,
      ignore_rule_id: matchRule ? matchRule.id : null,
      ignore_reason: matchRule ? `ignored by WF99 rule ${matchRule.id}` : null,
    },
  }];
};
