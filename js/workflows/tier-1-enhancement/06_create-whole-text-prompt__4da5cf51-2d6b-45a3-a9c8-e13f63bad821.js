/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Create Whole Text Prompt
 * Node ID: 4da5cf51-2d6b-45a3-a9c8-e13f63bad821
 */
'use strict';

const pb = require('../../libs/prompt-builder.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

// Inputs expected on $json:
// title, author, content_type, topics, clean_text
// No normalization / cleanup performed here.

const built = pb.buildWholePrompt($json);

return [{ json: { ...$json, prompt: built.prompt, prompt_mode: built.prompt_mode } }];
};
