'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const s = ($json?.[0]) || {};
  
  const badge = (() => {
    const a = String(s.action || '').toLowerCase();
    if (a === 'inserted') return '🆕';
    if (a === 'updated') return '♻️';
    if (a === 'skipped') return '⏭️';
    return '✅';
  })();
  
  const lines = [
    badge + ' Notion captured',
    String(s.title ?? ''),
    '',
    'Entry: ' + String(s.entry_id ?? ''),
    'Type: ' + String(s.content_type ?? ''),
    'Result: ' + String(s.action ?? ''),
    'Clean: ' + String(s.clean_len ?? ''),
    'Topic: ' + String(s.topic_primary ?? '') + ' -> ' + String(s.topic_secondary ?? ''),
    '',
    String(s.gist ?? ''),
    '',
    String(s.url_canonical ?? ''),
  ];
  
  return [{ json: { ...$json, telegram_message: mdv2Message(lines.join('\n').trim()) } }];
};
