'use strict';

const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const s = $json || {};
  const lines = [
    'Delete successful',
    `Dry run: ${String(s.dry_run)}`,
    `Schema: ${String(s.schema ?? '')}`,
    `Deleted: ${String(s.deleted_count ?? 0)}`,
  ];
  return [{ json: { ...$json, telegram_message: mdv2Message(lines.join('\n')) } }];
};

