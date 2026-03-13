'use strict';

module.exports = async function run(ctx) {
  const { $json = {} } = ctx || {};
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const requestId = asText($json.request_id);
  if (!requestId) throw new Error('request_id is required to finalize calendar create');

  const eventId = asText($json.id || $json.eventId || $json.event_id || $json.google_event_id);
  const nodeError = ($json && $json.error) ? $json.error : null;
  const explicitFailure = $json.create_success === false;
  const success = !explicitFailure && !!eventId && !nodeError;

  const errorPayload = success
    ? null
    : {
        code: nodeError ? 'google_create_failed' : 'google_event_id_missing',
        message: nodeError && nodeError.message ? String(nodeError.message) : 'Google Calendar create did not return an event id',
      };

  return [{
    json: {
      ...$json,
      success,
      final_status: success ? 'calendar_created' : 'calendar_failed',
      google_event_id: eventId || null,
      error: errorPayload,
    },
  }];
};

