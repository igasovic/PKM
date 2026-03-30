'use strict';

module.exports = async function run(ctx) {
  const input = (ctx && ctx.$json) || {};
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const fallback = (input && input.failure_pack_post && typeof input.failure_pack_post === 'object')
    ? input.failure_pack_post
    : {};

  const envelopeStatus = asText(input && input.failure_pack_envelope && input.failure_pack_envelope.status)
    || asText(fallback.status)
    || 'partial';

  const statusCode = Number(input.statusCode || input.status || 0);
  const responseBody = (input && input.body && typeof input.body === 'object') ? input.body : input;

  const responseFailureId = asText(responseBody.failure_id);
  const responseRunId = asText(responseBody.run_id) || asText(input.run_id) || asText(fallback.run_id);
  const responseStatus = asText(responseBody.status) || envelopeStatus;
  const responseUpsertAction = asText(responseBody.upsert_action);

  const explicitError = asText(responseBody.error)
    || asText(responseBody.message)
    || asText(input.error)
    || asText(fallback.error);

  const ok = !!responseFailureId && !explicitError;

  return [{
    json: {
      ...input,
      failure_pack_post: {
        ok,
        error: ok ? '' : (explicitError || (statusCode >= 400 ? `http ${statusCode}` : 'post_failed')),
        failure_id: responseFailureId || null,
        run_id: responseRunId || null,
        upsert_action: responseUpsertAction || null,
        status: responseStatus,
      },
    },
  }];
};
