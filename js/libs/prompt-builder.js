/**
 * Prompt Builder — Stateless helpers for OpenAI prompt construction
 * ================================================================
 *
 * Use this library in js/workflows for Tier-1 enrichment prompts.
 * All functions are pure and stateless.
 */
'use strict';

const DEFAULT_TOPICS = '["other"]';

/**
 * Normalize topics input into a JSON string list.
 * @param {*} topics
 * @returns {string}
 */
function normalizeTopics(topics) {
  let list = topics ?? DEFAULT_TOPICS;
  if (typeof list !== 'string') list = JSON.stringify(list);
  return list;
}

function ensureCleanText(clean_text) {
  const text = (clean_text ?? '').toString();
  if (!text.trim()) {
    throw new Error('Tier-1 prompt: clean_text is empty/null — abort enrichment');
  }
  return text;
}

function baseHeader({ title, author, content_type, topics, include_examples }) {
  const TITLE = (title ?? '').toString();
  const AUTHOR = (author ?? '').toString();
  const CONTENT_TYPE = (content_type ?? 'other').toString();
  const TOPIC_LIST = normalizeTopics(topics);
  const exampleLine = include_examples
    ? '\n   - Examples: "sibling conflict", "ai trust", "newsletter strategy", "decision hygiene"'
    : '';

  return (
`TASK
Extract Tier-1 metadata for the item below. I will store your JSON output in a database for retrieval.

CONTROLLED TOPICS (primary topic must be exactly one of these, else "other"):
${TOPIC_LIST}

RULES
1) Choose "topic_primary" from the controlled list only. If none fits well, use "other".
2) Choose "topic_secondary" as a short freeform label (2–5 words), lowercase, no punctuation. It should be more specific than topic_primary.${exampleLine}
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
`
);
}

/**
 * Build Tier-1 prompt with sampled text windows.
 * @param {{ title?: string, author?: string, content_type?: string, topics?: any, clean_text?: string }} input
 * @param {{ max_total_chars?: number, head_chars?: number, tail_chars?: number, mid1_chars?: number, mid2_chars?: number }} [caps]
 * @returns {{ prompt: string, prompt_mode: string, text_head: string, text_mid1: string, text_mid2: string, text_tail: string }}
 */
function buildSampledPrompt(input, caps) {
  const text = ensureCleanText(input && input.clean_text);
  const n = text.length;

  const MAX_TOTAL_CHARS_SENT = Number(caps && caps.max_total_chars) || 6000;
  const HEAD_CHARS = Number(caps && caps.head_chars) || 3000;
  const TAIL_CHARS = Number(caps && caps.tail_chars) || 1200;
  const MID1_CHARS = Number(caps && caps.mid1_chars) || 600;
  const MID2_CHARS = Number(caps && caps.mid2_chars) || 600;

  function windowAt(t, centerIndex, windowLen) {
    const half = Math.floor(windowLen / 2);
    let start = Math.max(0, centerIndex - half);
    let end = Math.min(t.length, start + windowLen);
    start = Math.max(0, end - windowLen);
    return t.slice(start, end);
  }

  let head = text.slice(0, Math.min(HEAD_CHARS, n));
  let tail = n <= TAIL_CHARS ? text : text.slice(n - TAIL_CHARS);
  let mid1 = windowAt(text, Math.floor(n * 0.33), MID1_CHARS);
  let mid2 = windowAt(text, Math.floor(n * 0.66), MID2_CHARS);

  const header = baseHeader({ ...(input || {}), include_examples: true });

  function buildPrompt(h, m1, m2, t) {
    return (
`${header}

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
  if (prompt.length > MAX_TOTAL_CHARS_SENT) {
    prompt = prompt.slice(0, MAX_TOTAL_CHARS_SENT);
  }

  return {
    prompt,
    prompt_mode: 'sample',
    text_head: head,
    text_mid1: mid1,
    text_mid2: mid2,
    text_tail: tail,
  };
}

/**
 * Build Tier-1 prompt with full text.
 * @param {{ title?: string, author?: string, content_type?: string, topics?: any, clean_text?: string }} input
 * @param {{ max_total_chars?: number }} [caps]
 * @returns {{ prompt: string, prompt_mode: string }}
 */
function buildWholePrompt(input, caps) {
  const text = ensureCleanText(input && input.clean_text);
  const MAX_TOTAL_CHARS_SENT = Number(caps && caps.max_total_chars) || 6000;
  const full = text.length > MAX_TOTAL_CHARS_SENT ? text.slice(0, MAX_TOTAL_CHARS_SENT) : text;

  const header = baseHeader({ ...(input || {}), include_examples: false });

  const prompt =
`${header}

ITEM TEXT (FULL)
${full}
`;

  return { prompt, prompt_mode: 'whole' };
}

module.exports = {
  buildSampledPrompt,
  buildWholePrompt,
};
