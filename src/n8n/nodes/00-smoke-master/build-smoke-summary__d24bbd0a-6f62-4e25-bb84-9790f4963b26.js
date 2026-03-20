'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const base = { ...$json };
  const results = Array.isArray(base.results) ? base.results : [];
  
  const passCount = results.filter((r) => r && r.ok === true).length;
  const failRows = results.filter((r) => !r || r.ok !== true);
  const failCount = failRows.length;
  const overallOk = failCount === 0;
  
  const lines = [];
  lines.push(overallOk ? 'Smoke passed' : 'Smoke failed');
  lines.push('Run: ' + String(base.test_run_id || '-'));
  lines.push('Passed: ' + String(passCount));
  lines.push('Failed: ' + String(failCount));
  
  if (failRows.length) {
    lines.push('Failures:');
    failRows.slice(0, 10).forEach((row) => {
      const name = String((row && row.test_case) || 'unknown');
      const msg = String((row && row.error && row.error.message) || 'assertion failure');
      lines.push('- ' + name + ': ' + msg);
    });
  }
  
  const telegram_message = mdv2Message(lines.join('\n'), { maxLen: 4000 });
  
  return [{
    json: {
      ...base,
      ended_at: new Date().toISOString(),
      overall_ok: overallOk,
      passed_count: passCount,
      failed_count: failCount,
      telegram_message,
    },
  }];
};
