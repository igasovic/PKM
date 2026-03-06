/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Parse T1
 * Node ID: 5cd4f138-20ac-4c36-867b-e0f618fd3149
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Parse Tier-1 model output into $json.t1 (strict-ish), while preserving everything else.
// Works with OpenAI Responses-style output: $json.output[0].content[].text

function getModelText(j) {
  // Your current shape (from your example)
  if (Array.isArray(j.output) && j.output.length) {
    for (const msg of j.output) {
      // msg.content is an array of parts (output_text, etc.)
      if (Array.isArray(msg.content)) {
        const part = msg.content.find(p =>
          p &&
          (p.type === 'output_text' || p.type === 'text') &&
          typeof p.text === 'string' &&
          p.text.trim().length > 0
        );
        if (part) return part.text;

        // fallback: concatenate any .text fields
        const joined = msg.content
          .map(p => (typeof p?.text === 'string' ? p.text : ''))
          .join('\n')
          .trim();
        if (joined) return joined;
      }

      // fallback: some variants put text directly on msg
      if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text;
    }
  }

  // Other common shapes (fallbacks)
  return (
    j.responseText ??
    j.text ??
    j.output_text ??
    j.response ??
    j.data ??
    j.message?.content ??
    j.choices?.[0]?.message?.content ??
    j.choices?.[0]?.text ??
    ''
  );
}

let s = String(getModelText($json) || '').trim();
if (!s) throw new Error('Tier-1 parse: model output text is empty');

// Strip ```json fences if present
s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

// If there’s extra text around JSON, slice the first {...} block
const first = s.indexOf('{');
const last = s.lastIndexOf('}');
if (first !== -1 && last !== -1 && last > first) {
  s = s.slice(first, last + 1);
}

// Parse JSON
let t1;
try {
  t1 = JSON.parse(s);
} catch (e) {
  // include a short preview to debug without dumping huge output
  const preview = s.slice(0, 250);
  throw new Error(`Tier-1 parse: invalid JSON. Preview: ${preview}`);
}

// Validate + normalize
const reqStr = (k) => typeof t1[k] === 'string' && t1[k].trim().length > 0;

if (!reqStr('topic_primary')) throw new Error('Tier-1 parse: missing topic_primary');
if (!reqStr('topic_secondary')) throw new Error('Tier-1 parse: missing topic_secondary');
if (!reqStr('gist')) throw new Error('Tier-1 parse: missing gist');
if (!Array.isArray(t1.keywords)) throw new Error('Tier-1 parse: keywords must be an array');

t1.topic_primary = t1.topic_primary.trim();
t1.topic_secondary = t1.topic_secondary.trim();
t1.gist = t1.gist.trim();

t1.keywords = t1.keywords
  .map(x => String(x ?? '').trim())
  .filter(Boolean);

t1.keywords = Array.from(new Set(t1.keywords));

// Keep bounds tight for your spec (5–12 is what you’ve been using)
if (t1.keywords.length < 5) throw new Error('Tier-1 parse: keywords must have at least 5 items');
if (t1.keywords.length > 12) t1.keywords = t1.keywords.slice(0, 12);

// Confidences: clamp 0..1 if present
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
if (typeof t1.topic_primary_confidence === 'number') t1.topic_primary_confidence = clamp01(t1.topic_primary_confidence);
if (typeof t1.topic_secondary_confidence === 'number') t1.topic_secondary_confidence = clamp01(t1.topic_secondary_confidence);

return [{
  json: {
    ...$json,
    t1,
    t1_valid: true,
    t1_raw_text: s.slice(0, 2000),
  }
}];
};
