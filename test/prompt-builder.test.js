'use strict';

const assert = require('assert');
const pb = require('../src/libs/prompt-builder.js');

(() => {
  {
    const input = {
      title: 'T',
      author: 'A',
      content_type: 'note',
      topics: ['a', 'b'],
      clean_text: 'hello world',
    };

    const built = pb.buildSampledPrompt(input);

    const expectedPrompt = `TASK
Extract Tier-1 metadata for the item below. I will store your JSON output in a database for retrieval.

CONTROLLED TOPICS (primary topic must be exactly one of these, else "other"):
["a","b"]

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
title: T
author: A
content_type: note

ITEM TEXT (SAMPLED)
head:
hello world

mid_1:
hello world

mid_2:
hello world

tail:
hello world`;

    assert.strictEqual(built.prompt, expectedPrompt);
    assert.strictEqual(built.prompt_mode, 'sample');
    assert.strictEqual(built.text_head, 'hello world');
    assert.strictEqual(built.text_mid1, 'hello world');
    assert.strictEqual(built.text_mid2, 'hello world');
    assert.strictEqual(built.text_tail, 'hello world');
  }

  {
    const input = {
      title: 'T',
      author: 'A',
      content_type: 'note',
      topics: ['a', 'b'],
      clean_text: 'hello world',
    };

    const built = pb.buildWholePrompt(input);

    const expectedPrompt = `TASK
Extract Tier-1 metadata for the item below. I will store your JSON output in a database for retrieval.

CONTROLLED TOPICS (primary topic must be exactly one of these, else "other"):
["a","b"]

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
title: T
author: A
content_type: note

ITEM TEXT (FULL)
hello world
`;

    assert.strictEqual(built.prompt, expectedPrompt);
    assert.strictEqual(built.prompt_mode, 'whole');
  }

  {
    assert.throws(
      () => pb.buildWholePrompt({ clean_text: '   ' }),
      /Tier-1 prompt: clean_text is empty\/null — abort enrichment/
    );
  }

  // eslint-disable-next-line no-console
  console.log('prompt-builder: OK');
})();
