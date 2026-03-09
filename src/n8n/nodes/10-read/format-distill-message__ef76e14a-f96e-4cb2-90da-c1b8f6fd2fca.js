/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Distill Message
 * Node ID: ef76e14a-f96e-4cb2-90da-c1b8f6fd2fca
 */
'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const r = $json || {};
  const mdv2 = (v) =>
    String(v ?? '')
      .replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

  const status = String(r.status || '').toLowerCase();
  if (status === 'completed') {
    const whyBlock = `\n\n*Why it matters*\n${mdv2(r.why_it_matters || '-')}`;
    const excerptText = String(r.excerpt || '').trim();
    const excerptBlock = excerptText ? `\n\n*Excerpt*\n${mdv2(excerptText)}` : '';
    return [{
      json: {
        ...r,
        telegram_message:
`*Tier\\_2 distill completed*
• Entry\\_id: ${r.entry_id ?? '-'}
• Stance: ${mdv2(r.stance || '-')}

*Summary*
${mdv2(r.summary || '-')}${whyBlock}${excerptBlock}`,
      },
    }];
  }

  const errMsg = r.message ? `\n• Message: ${mdv2(r.message)}` : '';
  return [{
    json: {
      ...r,
      telegram_message:
`*Tier\\_2 distill failed*
• Entry\\_id: ${r.entry_id ?? '-'}
• Error: ${mdv2(r.error_code || 'unknown_error')}${errMsg}`,
    },
  }];
};
