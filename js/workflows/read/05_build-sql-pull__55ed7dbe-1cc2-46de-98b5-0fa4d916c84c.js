/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build SQL - /PULL
 * Node ID: 55ed7dbe-1cc2-46de-98b5-0fa4d916c84c
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = $items('PKM Config')[0].json.config;
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

  const entry_id = $json.entry_id;
if (!entry_id || !String(entry_id).trim()) throw new Error('pull: missing entry_id');

const shortN = Number($json.config?.scoring?.maxItems?.pull_short_chars || 320);
const longN = Number($json.config?.scoring?.maxItems?.pull_excerpt_chars || 1800);

const sql = sb.buildReadPull({
  entries_table,
  entry_id,
  shortN,
  longN,
});

return [{ json: { ...$json, sql } }];
};
