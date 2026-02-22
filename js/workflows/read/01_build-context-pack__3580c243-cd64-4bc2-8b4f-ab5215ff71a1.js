/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build Context Pack
 * Node ID: 3580c243-cd64-4bc2-8b4f-ab5215ff71a1
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { buildContextPackMarkdown } = require('../../../src/libs/context-pack-builder.js');

const rows = $input.all().map(i => i.json);
const meta = rows.find((r) => r.is_meta === true) || {};
const hitsRows = rows.filter((r) => r.is_meta === false && r.id);
const method = String(meta.cmd || 'last').toLowerCase();
const query = String(meta.query_text || '').trim();

let msg = buildContextPackMarkdown(
  hitsRows,
  {
    method,
    query,
    days: meta.days,
    limit: meta.limit,
  },
  {
    markdownV2: true,
    maxContentLen: 300,
  },
);

// safety cap (Telegram hard limit is 4096; keep margin for safety)
const MAX_TELEGRAM = 3500;
if (msg.length > MAX_TELEGRAM) {
  msg = msg.slice(0, MAX_TELEGRAM - 1) + '…';
}

return [{ json: { telegram_message: msg } }];
};
