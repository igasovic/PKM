/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Signatures and Markdown
 * Node ID: 46831d4c-c2ac-42a8-823f-9947d36c5201
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Correspondence Node 3: Remove signature-ish tails + format as Markdown

const blocks = Array.isArray($json.corr_blocks) ? $json.corr_blocks : [];

const stripInvisible = (s) =>
  String(s || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u034F]/g, '')
    .replace(/\u00A0/g, ' ');

function stripSignature(body) {
  let lines = stripInvisible(body).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Drop common signature/disclaimer “sections”
  const killIf = [
    /^get outlook for ios$/i,
    /^follow us\b/i,
    /zixprotect/i,
    /^caution:\s*this email originated from outside/i,
    /^\[cid:/i,
  ];

  // Remove lines that match killIf anywhere
  lines = lines.filter(l => !killIf.some(re => re.test(l.trim())));

  // Cut off “contact-card” tails (heuristic)
  // If we see multiple contact-ish lines near the end, cut there.
  const contactish = (l) =>
    /(phone|mobile|tel|fax|address|website|linkedin|ht?ecgroup|@)/i.test(l) ||
    /\+?\d[\d\s().-]{7,}\d/.test(l); // phone-like

  for (let i = Math.max(0, lines.length - 25); i < lines.length; i++) {
    if (contactish(lines[i])) {
      const tail = lines.slice(i).filter(x => x.trim() !== '');
      const tailContactCount = tail.filter(contactish).length;
      if (tailContactCount >= 2) {
        lines = lines.slice(0, i);
        break;
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fmtBlock(b, idx) {
  const header = [
    `### Message ${idx + 1}`,
    b.from ? `- From: ${b.from}` : null,
    b.to ? `- To: ${b.to}` : null,
    b.sent ? `- Sent: ${b.sent}` : null,
    b.subject ? `- Subject: ${b.subject}` : null,
  ].filter(Boolean).join('\n');

  const body = stripSignature(b.body || '');
  return `${header}\n\n${body}`.trim();
}

const parts = blocks.map(fmtBlock).filter(Boolean);

const threadMd = parts.join('\n\n---\n\n').trim();

return [{ json: { ...$json, clean_text: threadMd } }];
};
