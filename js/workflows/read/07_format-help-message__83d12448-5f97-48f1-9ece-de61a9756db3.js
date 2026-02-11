/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format /help Message
 * Node ID: 83d12448-5f97-48f1-9ece-de61a9756db3
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const { getConfig } = require('../../../src/server/config.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const msg =
`/last "query" [--days N] [--limit M]
Best when you vaguely remember something. Ranks using your Tier-1 metadata + full-text + quality + recency.

 /find "needle" [--days N] [--limit M]
Best for exact-ish strings (names, errors, phrases). Prefers literal matches + full-text; returns evidence snippets.

 /continue topic [--days N] [--limit M]
Best to resume a topic. Uses Tier-1-first scoring and tries to return your notes first (if available).

 /pull <id> [--excerpt]
Fetch one entry by its numeric id (#12345). Default shows a short excerpt; --excerpt returns a longer excerpt.

Tips:
- Every result shows #<id> so you can /pull it.
- Reduce --limit if messages truncate.`;

const config = await getConfig();
const isTestMode = config.db.is_test_mode === true;
const banner = isTestMode ? '⚗️🧪 TEST MODE
' : '';
const telegram_message = msg.split('\n').map(l => l.trimEnd()).join('\n').trim();
return [{ json: { ...$json, telegram_message } }];
};
