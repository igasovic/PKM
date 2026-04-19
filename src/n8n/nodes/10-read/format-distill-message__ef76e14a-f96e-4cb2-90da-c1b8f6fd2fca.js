'use strict';

function mdv2(value) {
  return String(value ?? '').replace(/[\\_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function bold(value) {
  return '*' + mdv2(value) + '*';
}

function bullet(value) {
  return '• ' + String(value ?? '');
}

function joinLines(lines, options) {
  const cfg = options || {};
  const text = (Array.isArray(lines) ? lines : []).map((line) => String(line ?? '')).join('\n');
  return cfg.trimTrailing === true ? text.replace(/\s+$/, '') : text;
}

function finalizeMarkdownV2(value) {
  const text = String(value ?? '');
  return text.length > 4000 ? text.slice(0, 3997) + '...' : text;
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
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
      bullet('Entry: ' + entryId),
      bullet('Stance: ' + stance),
      '',
      bold('Summary'),
      summary,
      '',
      bold('Why it matters'),
      why,
    ];
    if (excerpt) lines.push('', bold('Excerpt'), excerpt);
    telegramMessage = finalizeMarkdownV2(joinLines(lines, { trimTrailing: true }));
  } else {
    const errorCode = mdv2($json.error_code || 'unknown_error');
    const message = mdv2($json.message || 'distill failed');
    const preserved = String($json.preserved_current_artifact === true);
    telegramMessage = joinLines([
      bold('Tier_2 distill failed'),
      bullet('Entry: ' + mdv2(entryId)),
      bullet('Error: ' + errorCode),
      bullet('Message: ' + message),
      bullet('Current artifact preserved: ' + mdv2(preserved)),
    ], { trimTrailing: true });
    telegramMessage = finalizeMarkdownV2(telegramMessage);
  }

  return [{ json: { ...$json, telegram_message: telegramMessage } }];
};
