'use strict';

const { mdv2, bold, bullet, joinLines, finalizeMarkdownV2 } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $json = {} } = ctx || {};
  const status = String($json.status || '').trim().toLowerCase();
  const entryId = String($json.entry_id ?? '-').trim() || '-';

  let telegramMessage = '';

  if (status === 'completed') {
    const summary = mdv2($json.summary || 'n/a');
    const why = mdv2($json.why_it_matters || 'n/a');
    const excerpt = mdv2($json.excerpt || '');
    const stance = mdv2($json.stance || 'n/a');
    const lines = [
      bold('Tier_2 distill completed'),
      bullet(`Entry: ${entryId}`, { rawValue: true }),
      bullet(`Stance: ${stance}`, { rawValue: true }),
      '',
      bold('Summary'),
      summary,
      '',
      bold('Why it matters'),
      why,
    ];
    if (excerpt) {
      lines.push('', bold('Excerpt'), excerpt);
    }
    telegramMessage = finalizeMarkdownV2(joinLines(lines, { trimTrailing: true }));
  } else {
    const errorCode = mdv2($json.error_code || 'unknown_error');
    const message = mdv2($json.message || 'distill failed');
    const preserved = String($json.preserved_current_artifact === true);
    telegramMessage = joinLines([
      bold('Tier_2 distill failed'),
      bullet(`Entry: ${mdv2(entryId)}`, { rawValue: true }),
      bullet(`Error: ${errorCode}`, { rawValue: true }),
      bullet(`Message: ${message}`, { rawValue: true }),
      bullet(`Current artifact preserved: ${mdv2(preserved)}`, { rawValue: true }),
    ], { trimTrailing: true });
    telegramMessage = finalizeMarkdownV2(telegramMessage);
  }

  return [{
    json: {
      ...$json,
      telegram_message: telegramMessage,
    },
  }];
};
