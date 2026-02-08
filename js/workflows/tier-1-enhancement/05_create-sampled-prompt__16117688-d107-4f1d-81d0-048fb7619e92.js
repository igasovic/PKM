/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Create Sampled Prompt
 * Node ID: 16117688-d107-4f1d-81d0-048fb7619e92
 */
'use strict';

const pb = require('../../libs/prompt-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Inputs expected on $json:
// title, author, content_type, topics, clean_text
// Only allowed modification: head / mid1 / mid2 / tail sampling.

const built = pb.buildSampledPrompt($json);

return [{
  json: {
    ...$json,
    prompt: built.prompt,
    prompt_mode: built.prompt_mode,
    text_head: built.text_head,
    text_mid1: built.text_mid1,
    text_mid2: built.text_mid2,
    text_tail: built.text_tail
  }
}];
};
