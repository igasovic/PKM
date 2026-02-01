/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Create Whole Text Prompt
 * Node ID: 4da5cf51-2d6b-45a3-a9c8-e13f63bad821
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Inputs expected on $json:
// title, author, content_type, topics, clean_text
// No normalization / cleanup performed here.

// HARD RULE: must have non-empty clean_text or fail (do not enrich)
const text = ($json.clean_text ?? '').toString();
if (!text.trim()) {
  throw new Error('Tier-1 prompt: clean_text is empty/null — abort enrichment');
}

const TITLE = ($json.title ?? '').toString();
const AUTHOR = ($json.author ?? '').toString();
const CONTENT_TYPE = ($json.content_type ?? 'other').toString();

let TOPIC_LIST = $json.topics ?? '["other"]';
if (typeof TOPIC_LIST !== 'string') {
  TOPIC_LIST = JSON.stringify(TOPIC_LIST);
}

// RULE: For short texts (< 4000 chars in your IF), send whole thing.
// Still keep a hard cap in case IF threshold changes or upstream surprises.
const MAX_TOTAL_CHARS_SENT = 6000;
const full = text.length > MAX_TOTAL_CHARS_SENT ? text.slice(0, MAX_TOTAL_CHARS_SENT) : text;

const prompt =
`TASK
Extract Tier-1 metadata for the item below. I will store your JSON output in a database for retrieval.

CONTROLLED TOPICS (primary topic must be exactly one of these, else "other"):
${TOPIC_LIST}

RULES
1) Choose "topic_primary" from the controlled list only. If none fits well, use "other".
2) Choose "topic_secondary" as a short freeform label (2–5 words), lowercase, no punctuation. It should be more specific than topic_primary.
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

ITEM TEXT (FULL)
${full}
`;

return [{ json: { ...$json, prompt, prompt_mode: "whole" } }];
};
