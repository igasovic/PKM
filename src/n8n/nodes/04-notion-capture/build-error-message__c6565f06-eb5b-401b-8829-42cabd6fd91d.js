'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const s = $json || {};
  const errors = Array.isArray(s.skip_errors) ? s.skip_errors : [];
  const blockTypes = [...new Set(errors.map((e) => e?.block_type).filter(Boolean))].join(', ');
  
  const lines = [
    'Notion capture skipped',
    'Title: ' + String(s.title ?? ''),
    'Skip reason: ' + String(s.skip_reason ?? ''),
    'Block types: ' + String(blockTypes || 'none'),
    '',
    'Notion: ' + String(s?.notion?.page_url || s?.notion?.page_id || 'unknown'),
  ];
  
  return [{ json: { ...$json, telegram_message: mdv2Message(lines.join('\n')) } }];
};
