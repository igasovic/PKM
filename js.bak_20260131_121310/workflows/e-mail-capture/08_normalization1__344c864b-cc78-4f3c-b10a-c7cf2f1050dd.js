/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Normalization1
 * Node ID: 344c864b-cc78-4f3c-b10a-c7cf2f1050dd
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Correspondence Node 1: Prepare text

const normalizeNewlines = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const stripInvisible = (s) =>
  String(s || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u034F]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

let t = $json.core_text || $json.capture_text || '';
t = stripInvisible(normalizeNewlines(t));

// Drop common “single-line” noise seen in your Outlook sample
const dropLine = [
  /^proprietary\s*$/i, // seen in sample thread:contentReference[oaicite:21]{index=21}
  /^get outlook for ios$/i, // repeated in sample:contentReference[oaicite:22]{index=22}
  /^caution:\s*this email originated from outside/i, // seen in sample:contentReference[oaicite:23]{index=23}
  /^links contained in this email have been replaced by zixprotect/i, // seen in sample:contentReference[oaicite:24]{index=24}
];

t = t
  .split('\n')
  .filter(line => !dropLine.some(re => re.test(line.trim())))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

return [{ json: { ...$json, corr_text: t } }];
};
