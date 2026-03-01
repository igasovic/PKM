/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Text Clean
 * Node ID: ef9f91cc-dbd4-48b7-a22d-66f47ea07239
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const cleanText = (s) => {
  if (!s) return '';

  let t = String(s);

  // Remove zero-width + BOM
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Normalize line endings
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Convert non-breaking spaces to normal spaces
  t = t.replace(/\u00A0/g, ' ');

  // Trim lines and collapse blank lines
  const lines = t.split('\n').map(l => l.trim());
  const out = [];
  let prevBlank = false;

  for (const line of lines) {
    const blank = line.length === 0;
    if (blank) {
      if (!prevBlank) out.push('');
      prevBlank = true;
    } else {
      out.push(line);
      prevBlank = false;
    }
  }

  t = out.join('\n').trim();

  // Collapse excessive spaces inside lines
  t = t.replace(/[ \t]+/g, ' ');

  return t;
};

// Trafilatura output
const extracted = $json.text || '';
const clean_text = cleanText(extracted);

return [
  {
    ...$json,
    extracted_text: extracted,              // <-- NEW alias for downstream
    extracted_len: String(extracted).length, // <-- optional debug
    clean_text,
    clean_len: clean_text.length,
  }
];
};
