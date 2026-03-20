'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const raw = $json.stdout ?? '{}';
  let s = {};
  try { s = JSON.parse(raw); } catch (e) { s = {}; }
  
  const get = (k) => s[k] ?? { status: 'missing', ts: '-', rc: '-' };
  const daily = get('pkm_backup_daily');
  const weekly = get('pkm_backup_weekly');
  const monthly = get('pkm_backup_monthly');
  const rotate = get('pkm_backup_rotate');
  const today = new Date().toISOString().slice(0, 10);
  
  const lines = [
    'PKM Cron Summary latest',
    'date: ' + today + ' America/Chicago',
    '',
    'Daily: ' + daily.status + ' rc=' + daily.rc + ' ts=' + daily.ts,
    'Weekly: ' + weekly.status + ' rc=' + weekly.rc + ' ts=' + weekly.ts,
    'Monthly: ' + monthly.status + ' rc=' + monthly.rc + ' ts=' + monthly.ts,
    'Rotate: ' + rotate.status + ' rc=' + rotate.rc + ' ts=' + rotate.ts,
  ];
  
  return [{ json: { ...$json, telegram_message: mdv2Message(lines.join('\n')) } }];
};
