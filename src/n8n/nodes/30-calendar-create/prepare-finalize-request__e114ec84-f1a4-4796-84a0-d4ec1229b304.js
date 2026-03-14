'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const parseRequestIdFromDescription = (description) => {
    const text = asText(description);
    if (!text) return '';
    const m = text.match(/PKM request id:\s*([A-Za-z0-9-]{8,})/i);
    return m ? asText(m[1]) : '';
  };

  const tryRequestIdFromItems = () => {
    if (!ctx || typeof ctx.$items !== 'function') return '';
    const candidateNodes = [
      'Build Google Event Payload',
      'Merge Create Context',
      'PKM Calendar Normalize',
      'Merge Normalize Context',
    ];
    for (const nodeName of candidateNodes) {
      let rows = [];
      try {
        rows = ctx.$items(nodeName);
      } catch (_err) {
        rows = [];
      }
      if (!Array.isArray(rows) || !rows.length) continue;
      for (const item of rows) {
        const row = (item && item.json) || {};
        const fromField = asText(row.request_id);
        if (fromField) return fromField;
        const fromDescription = parseRequestIdFromDescription(row.google_description || row.description);
        if (fromDescription) return fromDescription;
      }
    }
    return '';
  };

  const requestId = asText($json.request_id)
    || parseRequestIdFromDescription($json.google_description || $json.description)
    || tryRequestIdFromItems();
  if (!requestId) throw new Error('request_id is required to finalize calendar create');

  const eventId = asText($json.id || $json.eventId || $json.event_id || $json.google_event_id);
  const nodeError = ($json && $json.error) ? $json.error : null;
  const explicitFailure = $json.create_success === false;
  const success = !explicitFailure && !!eventId;

  const errorPayload = success
    ? null
    : {
        code: nodeError ? 'google_create_failed' : 'google_event_id_missing',
        message: nodeError && nodeError.message ? String(nodeError.message) : (nodeError ? String(nodeError) : 'Google Calendar create did not return an event id'),
      };

  const warningCodes = Array.isArray($json.warning_codes)
    ? $json.warning_codes.map((v) => asText(v)).filter(Boolean)
    : [];
  if (success && nodeError && !warningCodes.includes('calendar_non_blocking_warning')) {
    warningCodes.push('calendar_non_blocking_warning');
  }

  const warningMessage = success && nodeError
    ? (asText(nodeError && nodeError.message ? nodeError.message : nodeError) || null)
    : null;

  return [{
    json: {
      ...$json,
      request_id: requestId,
      success,
      final_status: success ? 'calendar_created' : 'calendar_failed',
      google_event_id: eventId || null,
      error: errorPayload,
      warning_codes: warningCodes,
      warning_message: warningMessage,
    },
  }];
};
