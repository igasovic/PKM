'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function mdv2(value) {
  return asText(value).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

module.exports = async function run(ctx) {
  const { $json = {} } = ctx || {};
  const status = asText($json.status).toLowerCase();
  const entryId = asText($json.entry_id || '-');

  let telegramMessage = '';
  if (status === 'completed') {
    const summary = mdv2($json.summary || 'n/a');
    const why = mdv2($json.why_it_matters || 'n/a');
    const excerpt = mdv2($json.excerpt || '');
    const stance = mdv2($json.stance || 'n/a');
    const lines = [
      '*Tier\\_2 distill completed*',
      `• Entry: ${mdv2(entryId)}`,
      `• Stance: ${stance}`,
      '',
      '*Summary*',
      summary,
      '',
      '*Why it matters*',
      why,
    ];
    if (excerpt) {
      lines.push('', '*Excerpt*', excerpt);
    }
    telegramMessage = lines.join('\n').trim();
  } else {
    const errorCode = mdv2($json.error_code || 'unknown_error');
    const message = mdv2($json.message || 'distill failed');
    const preserved = String($json.preserved_current_artifact === true);
    telegramMessage = [
      '*Tier\\_2 distill failed*',
      `• Entry: ${mdv2(entryId)}`,
      `• Error: ${errorCode}`,
      `• Message: ${message}`,
      `• Current artifact preserved: ${mdv2(preserved)}`,
    ].join('\n').trim();
  }

  return [{
    json: {
      ...$json,
      telegram_message: telegramMessage,
    },
  }];
};

