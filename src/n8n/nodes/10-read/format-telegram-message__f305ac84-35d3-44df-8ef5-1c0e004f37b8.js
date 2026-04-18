/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Telegram Message
 * Node ID: f305ac84-35d3-44df-8ef5-1c0e004f37b8
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

const { getConfig } = require('igasovic-n8n-blocks/shared/config.js');
const { mdv2, bold, joinLines, finalizeMarkdownV2 } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

function s(v) { return (v ?? '').toString().trim(); }

const entryId = s($json.entry_id) || '?';
const author = s($json.author) || 'unknown';
const contentType = s($json.content_type) || 'unknown';
const title = s($json.title);
const url = s($json.url_canonical) || s($json.url);
const topicPrimary = s($json.topic_primary);
const topicSecondary = s($json.topic_secondary);
const summary = s($json.distill_summary) || s($json.gist);
const whyItMatters = s($json.distill_why_it_matters);
const excerptLong = s($json.excerpt_long);
const excerptShort = s($json.excerpt);
const cleanText = s($json.clean_text);

const cleanWordCount = Number($json.clean_word_count);
const computedWordCount = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
const wordCount = Number.isFinite(cleanWordCount) && cleanWordCount >= 0
  ? Math.trunc(cleanWordCount)
  : computedWordCount;

let body = '';
if (summary && whyItMatters && excerptLong) {
  body = `${summary}\n\nWhy it matters: ${whyItMatters}\n\n${excerptLong}`;
} else if (summary && whyItMatters && excerptShort) {
  body = `${summary}\n\nWhy it matters: ${whyItMatters}\n\n${excerptShort}`;
} else {
  body = cleanText || excerptLong || excerptShort || summary || '(no text)';
}

const lines = [];
lines.push(`🗣️ \\[${mdv2(author)}\\] \\(\\#${mdv2(entryId)}\\) \\- ${mdv2(contentType)}`);
if (title) lines.push(`📰 ${mdv2(title)}`);
if (url) lines.push(`🔗 ${mdv2(url)}`);
lines.push(`📏 ${mdv2(String(wordCount))} words`);
if (topicPrimary && topicSecondary) {
  lines.push(`🏷️ ${mdv2(topicPrimary)} → ${mdv2(topicSecondary)}`);
} else if (topicPrimary) {
  lines.push(`🏷️ ${mdv2(topicPrimary)}`);
}
lines.push(mdv2(body));

let msg = joinLines(lines, { trimTrailing: true });

const config = getConfig();
if (config.db.is_test_mode === true) {
  msg = joinLines([bold('TEST MODE'), msg], { trimTrailing: true });
}

msg = finalizeMarkdownV2(msg, { maxLen: 4000 });

return [{ json: { ...$json, telegram_message: msg } }];
};
