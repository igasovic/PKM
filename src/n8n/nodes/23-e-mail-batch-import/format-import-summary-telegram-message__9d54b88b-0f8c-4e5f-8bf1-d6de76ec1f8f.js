'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const b = $json || {};
  const batch = Array.isArray(b.tier1_batches) && b.tier1_batches[0] ? b.tier1_batches[0] : {};
  const lines = [
    'Email backlog import update',
    '',
    'Import: ' + String(b.import_id ?? ''),
    'MBOX: ' + String(b.mbox_path ?? ''),
    '',
    'Messages: ' + String(b.total_messages ?? 0),
    'Normalized: ' + String(b.normalized_ok ?? 0) + ' errors ' + String(b.normalize_errors ?? 0),
    '',
    'Schema: ' + String(batch.schema ?? ''),
    'Inserted: ' + String(b.inserted ?? 0) + ' errors ' + String(b.insert_errors ?? 0),
    'Updated: ' + String(b.updated ?? 0),
    'Skipped: ' + String(b.skipped ?? 0),
    '',
    'Tier-1 candidates: ' + String(b.tier1_candidates ?? 0),
    'Tier-1 enqueued: ' + String(b.tier1_enqueued_items ?? 0),
    'Tier-1 requests: ' + String(batch.request_count ?? 0),
    'Status: ' + String(batch.status ?? ''),
  ];
  return [{ json: { ...$json, telegram_message: mdv2Message(lines.join('\n')) } }];
};
