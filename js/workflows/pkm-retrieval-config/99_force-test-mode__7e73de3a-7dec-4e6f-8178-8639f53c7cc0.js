/**
 * PKM / n8n External Code Module (REGULAR)
 *
 * PURPOSE
 * - Force "test mode" ON by setting config.db.is_test_mode = true.
 * - Intended to be used as a toggle node inside the Retrieval Config workflow:
 *   - Node DISABLED (default) => test mode remains OFF
 *   - Node ENABLED            => test mode forced ON for this execution
 *
 * WHERE USED (n8n)
 * - Workflow: pkm-retrieval-config
 * - Node: FORCE TEST MODE (toggle by enabling)
 * - File: js/workflows/pkm-retrieval-config/99_force-test-mode__7e73de3a-7dec-4e6f-8178-8639f53c7cc0.js
 *
 * INPUTS (ctx)
 * - ctx.$json: object (current item JSON; expected to contain json.config from the config builder)
 *
 * OUTPUTS
 * - Returns the same item with:
 *   - json.config.db.is_test_mode = true
 *   - json.__pkm_test_run = true   (extra safety marker you can use downstream)
 */

'use strict';

module.exports = async function run(ctx) {
  const item = ctx.$input.first();
  item.json = item.json || {};

  // Ensure config shape exists
  item.json.config = item.json.config || {};
  item.json.config.db = item.json.config.db || {};

  // Force ON
  item.json.config.db.is_test_mode = true;

  // Extra explicit marker for safety/observability (optional)
  item.json.__pkm_test_run = true;

  return [item];
};
