'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const body = ($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : {};
  const error = (body.error && typeof body.error === 'object') ? body.error : {};

  return [{
    json: {
      response_payload: {
        ok: false,
        action: 'chatgpt_read',
        method: null,
        outcome: 'failure',
        no_result: false,
        context_pack_markdown: null,
        result: null,
        error: {
          code: String(error.code || 'bad_request'),
          message: String(error.message || 'invalid read command payload'),
        },
      },
      http_status: Number(body.http_status) || 400,
    },
  }];
};
