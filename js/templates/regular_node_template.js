/**
 * PKM / n8n External Code Module (REGULAR)
 *
 * PURPOSE
 * - <what this module does>
 *
 * WHERE USED (n8n)
 * - Workflow: <workflow name>
 * - Node: <node name>
 * - File: js/workflows/<workflow-slug>/<file>.js
 *
 * INPUTS (ctx)
 * - ctx.$json: object (current item JSON)
 * - ctx.$input: use ctx.$input.all() for all incoming items
 * - ctx.$items / ctx.$node: optional access to other nodes
 *
 * OUTPUTS
 * - Must return Array<{ json: object }>
 * - Typical: return [{ json: { ...ctx.$json, <new fields> } }]
 *
 * FAILURES
 * - throw new Error("message") to fail the node (keeps n8n Execute Node behavior)
 *
 * VERSIONING
 * - If output schema/semantics change, bump file name (e.g. *_v2.js)
 */

'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  // TODO implement
  return [{
    json: {
      ...$json,
    },
  }];
};
