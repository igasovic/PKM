/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build SQL - /FIND
 * Node ID: d0724507-154e-485c-8b0d-3523be365f6c
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const { getConfig } = require('../../../src/libs/config.js');

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = getConfig();
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

  const q = String($json.q || '').trim();
  const days = Number($json.days || 0);
  const limit = Number($json.limit || 0);

  const sql = sb.buildReadFind({
    config,
    entries_table,
    q,
    days,
    limit,
  });

  return [{ json: { ...$json, sql } }];
};
