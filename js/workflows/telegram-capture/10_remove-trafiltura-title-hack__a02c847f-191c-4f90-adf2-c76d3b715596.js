/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: remove trafiltura title - hack
 * Node ID: a02c847f-191c-4f90-adf2-c76d3b715596
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const item = { ...$json };

// Always discard Trafilatura title
delete item.title;
delete item.author;

return [item];
};
