/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Build SQL - /CONTINUE
 * Node ID: 138ce96f-f56c-4bea-9443-67686bd6066b
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const { getConfigStatic } = require('../../../src/server/config.js');

const sb = require('../../libs/sql-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  // --- DB schema routing (prod vs test) ---
  // IMPORTANT:
  // - This module reads config from the *sub-workflow node output* named exactly: "PKM Config"
  // - Your entry workflows must execute that sub-workflow at the very start.

  const config = getConfigStatic();
  const db = config.db;
  const entries_table = sb.resolveEntriesTable(db);

  const q = String($json.q || '').trim();
  const days = Number($json.days || 0);
  const limit = Number($json.limit || 0);

  const sql = sb.buildReadContinue({
    config,
    entries_table,
    q,
    days,
    limit,
  });

  return [{ json: { ...$json, sql } }];
};
