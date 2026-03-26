'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const body = ($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : {};
  const outcome = String(body.outcome || '').trim().toLowerCase();
  const ok = outcome === 'success' || outcome === 'no_result';

  return [{
    json: {
      ok,
      action: body.action || 'chatgpt_read',
      method: body.method || null,
      outcome: body.outcome || null,
      no_result: outcome === 'no_result',
      result: body.result || null,
    },
  }];
};
