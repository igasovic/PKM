/**
 * PKM / n8n External Code Module (SQL BUILDER — STRING ONLY)
 *
 * PURPOSE
 * - Build a SQL command string for the downstream Postgres node (which accepts "Command" only).
 *
 * WHERE USED (n8n)
 * - Workflow: <workflow name>
 * - Node: <node name>
 * - File: js/workflows/<workflow-slug>/<file>.js
 *
 * INPUTS (ctx)
 * - ctx.$json: object (contains query/cmd/config/etc)
 * - ctx.$input: optional (if building from multiple items)
 *
 * OUTPUTS
 * - Must return Array<{ json: object }>
 * - Must set:
 *   - json.sql: string  (the exact SQL to run in Postgres "Command")
 * - Optional:
 *   - json.sql_debug: object (inputs used to build SQL; ignored by Postgres node)
 *
 * SQL SAFETY
 * - Since params are not supported, DO NOT directly interpolate raw user input.
 * - Use shared helpers esc() and lit() to quote strings safely.
 *
 * FAILURES
 * - throw new Error("message") to fail the node
 *
 * VERSIONING
 * - If semantics change, bump file name (e.g. *_v2.js)
 */

'use strict';

// Shared SQL helpers (create once at: js/libs/sql-builder.js)
const sb = require('../../libs/sql-builder.js');

module.exports = async function buildSql(ctx) {
  const { $json } = ctx;

  // Example inputs:
  // const q = ($json.query || "").trim();
  // if (!q) throw new Error("Missing query");

  // TODO build SQL using lit(...) for values
  const sql = `
    -- TODO: replace with real query
    select now() as ts
  `.trim();

  return [{
    json: {
      ...$json,
      sql,
      sql_debug: {
        // query: q,
      },
    },
  }];
};
