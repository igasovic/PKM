/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Create Message
 * Node ID: e7474a77-f17b-4f8f-bbe1-632804bd2e69
 */
'use strict';

const { getConfig } = require('/data/src/libs/config.js');
const { mdv2 } = require('/data/src/libs/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $json, $items } = ctx;

  const s = (v) => (v ?? '').toString().trim();

  const config = getConfig();
  const isTestMode = !!(config && config.db && config.db.is_test_mode);

  const entryId = s($json.entry_id);

  const url = s($json.url_canonical || $json.url);
  const title = s($json.title);
  const author = s($json.author);

  // IMPORTANT: length should be based on clean_text (fallback to capture_text)
  const cleanText = s($json.clean_text || $json.clear_text || $json.capture_text);
  const cleanLen = cleanText.length;

  const topicPrimary = s($json.topic_primary);
  const topicSecondary = s($json.topic_secondary);
  const gist = s($json.gist);

  const labelBase = title || 'link';
  const label = author ? `${labelBase} — ${author}` : labelBase;

  // Determine status purely from clean_text length
  let status = 'failed';
  if (cleanLen > 0) status = cleanLen < 500 ? 'low_quality' : 'ok';

  const idLine = entryId ? ` (#${entryId})` : '';

  // Keep the previous core message semantics (status + label + url),
  // but enrich with topics + gist when available.
  const lines = [];

  if (status === 'ok') {
    lines.push(`✅ Saved${idLine}: ${label} (${cleanLen.toLocaleString()} chars)`);
  } else if (status === 'low_quality') {
    lines.push(`⚠️ Saved (low quality)${idLine}: ${label} (${cleanLen.toLocaleString()} chars)`);
  } else {
    lines.push(`❌ Saved (extraction failed)${idLine}: ${labelBase}`);
  }

  if (url) lines.push(url);

  // Add topic path + gist (new)
  if (topicPrimary && topicSecondary) lines.push(`🏷️ ${topicPrimary} → ${topicSecondary}`);
  else if (topicPrimary) lines.push(`🏷️ ${topicPrimary}`);

  if (gist) lines.push(gist);

  let msg = lines.join('\n');

  if (isTestMode) msg = `⚗️🧪 TEST MODE\n` + msg;

  // Escape the full payload to keep Telegram MarkdownV2 parsing stable.
  msg = mdv2(msg);

  // hard cap for Telegram
  const MAX = 4000;
  if (msg.length > MAX) msg = msg.slice(0, MAX - 1) + '…';

  const topic_path =
    topicPrimary && topicSecondary ? `${topicPrimary} → ${topicSecondary}`
    : topicPrimary ? topicPrimary
    : '';

  // Keep prior behavior: return everything as before, plus new fields
  return [{
    json: {
      ...$json,
      telegram_message: msg,

      // new/normalized outputs
      gist: gist || $json.gist,
      topic_primary: topicPrimary || $json.topic_primary,
      topic_secondary: topicSecondary || $json.topic_secondary,
      topic_path,

      // updated length derived from clean_text (your requirement)
      text_len: cleanLen,
      clean_len: cleanLen,
    }
  }];
};
