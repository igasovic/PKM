'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const b = $json.body || $json;
  
  const job = String(b.job ?? '');
  const host = String(b.host ?? '');
  const ts = String(b.ts ?? '');
  const rc = String(b.rc ?? '');
  const cmd = String(b.cmd ?? '');
  const status = String(b.status ?? (Number(b.rc ?? 0) === 0 ? 'ok' : 'fail'));
  const icon = status === 'ok' ? '✅' : '❌';
  
  const lines = [
    icon + ' CRON ' + status,
    'job: ' + job,
    'host: ' + host,
    'ts: ' + ts,
    'rc: ' + rc,
    'cmd: ' + cmd,
  ];
  
  return [{ json: { ...$json, telegram_message: mdv2Message(lines.join('\n')) } }];
};
