/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Compose Reply Text
 * Node ID: 0ae5a1f1-fc06-445c-b460-7447a1632dba
 */
'use strict';

const { getConfig } = require('igasovic-n8n-blocks/shared/config.js');
const { mdv2Message } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

function s(v) { return (v ?? '').toString().trim(); }

const entryId = s($json.entry_id);
const author = s($json.author);
const title = s($json.title);

const cleanText = s($json.clean_text);
const wordCountRaw = Number($json.clean_word_count);
const textWordCount = Number.isFinite(wordCountRaw) && wordCountRaw >= 0
  ? Math.trunc(wordCountRaw)
  : (cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0);

const topicPrimary = s($json.topic_primary);
const topicSecondary = s($json.topic_secondary);
const gist = s($json.gist);

// flags_json may be object or string
let flags = $json.flags_json;
if (typeof flags === 'string' && flags.trim()) {
  try { flags = JSON.parse(flags); } catch { flags = {}; }
}
if (!flags || typeof flags !== 'object') flags = {};

const boilerplate = flags.boilerplate_heavy === true;
const lowSignal = flags.low_signal === true;

const lines = [];

// Head emoji + author + id
lines.push(`🗣️ ${author || 'unknown'}${entryId ? ` (#${entryId})` : ''}`);

// Title
if (title) lines.push(`📰 ${title}`);

// Length
lines.push(`📏 ${textWordCount.toLocaleString()} words`);

// Topics
if (topicPrimary && topicSecondary) lines.push(`🏷️ ${topicPrimary} → ${topicSecondary}`);
else if (topicPrimary) lines.push(`🏷️ ${topicPrimary}`);

// Gist
if (gist) lines.push(`\n${gist}`);

// Flags
const flagBits = [];
if (boilerplate) flagBits.push('⚠️ boilerplate-heavy');
if (lowSignal) flagBits.push('🟡 low-signal');
if (flagBits.length) lines.push(`\n${flagBits.join(' · ')}`);

let telegram_message = lines.join('\n');

const config = getConfig();
const smokeDryRun = $json.smoke_telegram_dry_run === true;
if (config?.db?.is_test_mode === true) {
  telegram_message = `⚗️🧪 TEST MODE
${telegram_message}`;
}
if (smokeDryRun) {
  telegram_message = `[SMOKE DRY RUN]
${telegram_message}`;
}

telegram_message = mdv2Message(telegram_message, { maxLen: 4000 });

return [{ json: { ...$json, telegram_message, smoke_telegram_dry_run: smokeDryRun } }];
};
