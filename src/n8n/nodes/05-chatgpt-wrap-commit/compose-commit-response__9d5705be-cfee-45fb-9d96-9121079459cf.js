'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const body = ($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : {};
  const outcome = String(body.outcome || '').trim().toLowerCase();
  const ok = outcome === 'success';

  return [{
    json: {
      ok,
      action: body.action || 'chatgpt_wrap_commit',
      outcome: body.outcome || null,
      result: body.result || null,
    },
  }];
};
