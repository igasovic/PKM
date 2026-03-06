/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Thread Parser
 * Node ID: 00fb2628-a0f9-40a0-9307-ba07a9fcc25a
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Correspondence Node 2: Parse Outlook-style thread into message blocks

const text = String($json.corr_text || '');

function parseOutlookBlocks(t) {
  const blocks = [];
  // Find all occurrences of a header starting at line-begin
  const re = /^From:\s*(.+)\nSent:\s*(.+)\nTo:\s*(.+)\nSubject:\s*(.+)\s*$/gim;

  const matches = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    matches.push({ idx: m.index, from: m[1], sent: m[2], to: m[3], subject: m[4] });
  }

  if (matches.length === 0) return null;

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIdx = (i + 1 < matches.length) ? matches[i + 1].idx : t.length;
    const startBodyIdx = cur.idx + (t.slice(cur.idx).match(re)?.[0]?.length || 0);

    const body = t.slice(startBodyIdx, nextIdx).trim();

    blocks.push({
      from: cur.from.trim(),
      sent: cur.sent.trim(),
      to: cur.to.trim(),
      subject: cur.subject.trim(),
      body
    });
  }

  return blocks;
}

const blocks = parseOutlookBlocks(text);

// Fallback: single block if not parseable
const parsed = blocks || [{ from: $json.author || '', sent: '', to: '', subject: $json.title || '', body: text }];

return [{ json: { ...$json, corr_blocks: parsed } }];
};
