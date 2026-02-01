/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Create Sampled Prompt
 * Node ID: 16117688-d107-4f1d-81d0-048fb7619e92
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Inputs expected on $json:
// title, author, content_type, topics, clean_text
// Only allowed modification: head / mid1 / mid2 / tail sampling.

const TITLE = ($json.title ?? '').toString();
const AUTHOR = ($json.author ?? '').toString();
const CONTENT_TYPE = ($json.content_type ?? 'other').toString();

let TOPIC_LIST = $json.topics ?? '["other"]';
if (typeof TOPIC_LIST !== 'string') {
  TOPIC_LIST = JSON.stringify(TOPIC_LIST);
}

// HARD RULE: must have non-empty clean_text or fail (do not enrich)
const text = ($json.clean_text ?? '').toString();
if (!text.trim()) {
  throw new Error('Tier-1 prompt: clean_text is empty/null — abort enrichment');
}

const n = text.length;

// Caps (Tier 1)
const MAX_TOTAL_CHARS_SENT = 6000;
const HEAD_CHARS = 3000;
const TAIL_CHARS = 1200;
const MID1_CHARS = 600;
const MID2_CHARS = 600;

// Sampling helpers
function windowAt(text, centerIndex, windowLen) {
  const half = Math.floor(windowLen / 2);
  let start = Math.max(0, centerIndex - half);
  let end = Math.min(text.length, start + windowLen);
  start = Math.max(0, end - windowLen);
  return text.slice(start, end);
}

let head = text.slice(0, Math.min(HEAD_CHARS, n));
let tail = n <= TAIL_CHARS ? text : text.slice(n - TAIL_CHARS);
let mid1 = windowAt(text, Math.floor(n * 0.33), MID1_CHARS);
let mid2 = windowAt(text, Math.floor(n * 0.66), MID2_CHARS);

// Build prompt (exact format you gave)
function buildPrompt(h, m1, m2, t) {
  return (
`TASK
Extract Tier-1 metadata for the item below. I will store your JSON output in a database for retrieval.

CONTROLLED TOPICS (primary topic must be exactly one of these, else "other"):
${TOPIC_LIST}

RULES
1) Choose "topic_primary" from the controlled list only. If none fits well, use "other".
2) Choose "topic_secondary" as a short freeform label (2–5 words), lowercase, no punctuation. It should be more specific than topic_primary.
   - Examples: "sibling conflict", "ai trust", "newsletter strategy", "decision hygiene"
3) Extract 5–12 keywords as short noun phrases, lowercase, no punctuation, no stopwords, no duplicates.
4) Write "gist" as ONE sentence (max 25 words) describing the core idea.
6) Provide confidence scores 0.0–1.0 for topic_primary and topic_secondary.

OUTPUT JSON SCHEMA (return exactly these keys)
{
  "topic_primary": "string",
  "topic_primary_confidence": number,
  "topic_secondary": "string",
  "topic_secondary_confidence": number,
  "keywords": ["string", ...],
  "gist": "string",
  "flags": {
    "boilerplate_heavy": boolean,
    "low_signal": boolean
  }
}

ITEM METADATA
title: ${TITLE}
author: ${AUTHOR}
content_type: ${CONTENT_TYPE}

ITEM TEXT (SAMPLED)
head:
${h}

mid_1:
${m1}

mid_2:
${m2}

tail:
${t}`
  );
}

// Hard-cap enforcement: trim tail, then mid2, then mid1. (No other modifications)
let prompt = buildPrompt(head, mid1, mid2, tail);

function rebuild() { prompt = buildPrompt(head, mid1, mid2, tail); }
function trimRight(s, charsToRemove) {
  if (charsToRemove <= 0) return s;
  return s.slice(0, Math.max(0, s.length - charsToRemove));
}

if (prompt.length > MAX_TOTAL_CHARS_SENT) {
  let over = prompt.length - MAX_TOTAL_CHARS_SENT;
  const cut = Math.min(over, tail.length);
  tail = trimRight(tail, cut);
  rebuild();
}
if (prompt.length > MAX_TOTAL_CHARS_SENT) {
  let over = prompt.length - MAX_TOTAL_CHARS_SENT;
  const cut = Math.min(over, mid2.length);
  mid2 = trimRight(mid2, cut);
  rebuild();
}
if (prompt.length > MAX_TOTAL_CHARS_SENT) {
  let over = prompt.length - MAX_TOTAL_CHARS_SENT;
  const cut = Math.min(over, mid1.length);
  mid1 = trimRight(mid1, cut);
  rebuild();
}
// If still over (rare due to fixed template), last resort: hard slice prompt itself.
if (prompt.length > MAX_TOTAL_CHARS_SENT) {
  prompt = prompt.slice(0, MAX_TOTAL_CHARS_SENT);
}

return [{
  json: {
    ...$json,
    prompt,
    prompt_mode: "sample",
    text_head: head,
    text_mid1: mid1,
    text_mid2: mid2,
    text_tail: tail
  }
}];
};
