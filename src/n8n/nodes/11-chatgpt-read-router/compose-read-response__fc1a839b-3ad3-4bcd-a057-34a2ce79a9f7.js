'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const body = ($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : {};
  const payload = (body.response_payload && typeof body.response_payload === 'object')
    ? body.response_payload
    : body;
  const status = Number(body.http_status);
  const httpStatus = Number.isFinite(status) && status >= 100 && status <= 599
    ? status
    : (payload && payload.ok === false ? 400 : 200);
  const outcome = String(payload.outcome || '').trim().toLowerCase();
  const ok = Boolean(payload.ok);

  return [{
    json: {
      http_status: httpStatus,
      ok,
      action: payload.action || 'chatgpt_read',
      method: payload.method || null,
      outcome: payload.outcome || null,
      no_result: outcome === 'no_result',
      context_pack_markdown: payload.context_pack_markdown || null,
      result: payload.result || null,
      error: payload.error || null,
    },
  }];
};
