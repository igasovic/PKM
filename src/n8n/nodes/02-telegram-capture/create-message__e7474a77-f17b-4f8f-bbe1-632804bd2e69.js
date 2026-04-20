/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Telegram Capture (telegram-capture)
 * Node: Create Message
 * Node ID: e7474a77-f17b-4f8f-bbe1-632804bd2e69
 */
'use strict';

const { getConfig } = require('@igasovic/n8n-blocks/shared/config.js');
const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $input, $items, $json } = ctx;

  const s = (v) => (v ?? '').toString().trim();
  const inputItems = ($input && typeof $input.all === 'function')
    ? $input.all()
    : (Array.isArray($items) ? $items : ($json && typeof $json === 'object' ? [{ json: $json }] : []));
  if (!inputItems.length) return [];

  const config = getConfig();
  const isTestMode = !!(config && config.db && config.db.is_test_mode);
  const smokeDryRun = inputItems.some((item) => item.json && item.json.smoke_telegram_dry_run === true);

  const formatItemMessage = (itemJson) => {
    const entryId = s(itemJson.entry_id);

    const url = s(itemJson.url_canonical || itemJson.url);
    const title = s(itemJson.title);
    const author = s(itemJson.author);

    // IMPORTANT: quality and display length should be based only on clean_text
    const cleanText = s(itemJson.clean_text);
    const cleanLen = cleanText.length;
    const cleanWordCountRaw = Number(itemJson.clean_word_count);
    const cleanWordCount = Number.isFinite(cleanWordCountRaw) && cleanWordCountRaw >= 0
      ? Math.trunc(cleanWordCountRaw)
      : (cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0);
    const action = s(itemJson.action).toLowerCase();

    const topicPrimary = s(itemJson.topic_primary);
    const topicSecondary = s(itemJson.topic_secondary);
    const gist = s(itemJson.gist);

    const labelBase = title || url || 'link';
    const label = author ? `${labelBase} — ${author}` : labelBase;

    // Determine status purely from clean_text length
    let status = 'failed';
    if (cleanLen > 0) status = cleanLen < 500 ? 'low_quality' : 'ok';

    const idLine = entryId ? ` (#${entryId})` : '';

    const lines = [];
    if (action === 'skipped') {
      if (status === 'ok') {
        lines.push(`♻️ Duplicate entry (skipped)${idLine}: ${label} (${cleanWordCount.toLocaleString()} words)`);
      } else if (status === 'low_quality') {
        lines.push(`♻️ Duplicate entry (skipped, low quality)${idLine}: ${label} (${cleanWordCount.toLocaleString()} words)`);
      } else {
        lines.push(`♻️ Duplicate entry (skipped)${idLine}: ${labelBase}`);
      }
    } else if (status === 'ok') {
      lines.push(`✅ Saved${idLine}: ${label} (${cleanWordCount.toLocaleString()} words)`);
    } else if (status === 'low_quality') {
      lines.push(`⚠️ Saved (low quality)${idLine}: ${label} (${cleanWordCount.toLocaleString()} words)`);
    } else {
      lines.push(`❌ Saved (extraction failed)${idLine}: ${labelBase}`);
    }

    if (url) lines.push(url);
    if (topicPrimary && topicSecondary) lines.push(`🏷️ ${topicPrimary} → ${topicSecondary}`);
    else if (topicPrimary) lines.push(`🏷️ ${topicPrimary}`);
    if (gist) lines.push(gist);

    return {
      message: lines.join('\n'),
      cleanLen,
      cleanWordCount,
      topicPrimary,
      topicSecondary,
      gist,
    };
  };

  const formatted = inputItems.map((item) => formatItemMessage(item.json || {}));
  let msg = formatted.map((entry) => entry.message).join('\n\n');

  if (isTestMode) msg = `⚗️🧪 TEST MODE\n\n` + msg;
  if (smokeDryRun) msg = `[SMOKE DRY RUN]\n` + msg;

  // Escape + truncate through shared MarkdownV2 helper.
  msg = mdv2Message(msg, { maxLen: 4000 });

  const firstJson = ($json && typeof $json === 'object') ? $json : (inputItems[0].json || {});
  const first = formatted[0] || {};

  const topicPrimary = first.topicPrimary || s(firstJson.topic_primary);
  const topicSecondary = first.topicSecondary || s(firstJson.topic_secondary);
  const topic_path =
    topicPrimary && topicSecondary ? `${topicPrimary} → ${topicSecondary}`
    : topicPrimary ? topicPrimary
    : '';

  // Keep prior behavior on output fields while aggregating to a single Telegram message item.
  return [{
    json: {
      ...firstJson,
      telegram_message: msg,
      gist: first.gist || firstJson.gist,
      topic_primary: topicPrimary || firstJson.topic_primary,
      topic_secondary: topicSecondary || firstJson.topic_secondary,
      topic_path,
      text_len: first.cleanLen ?? s(firstJson.clean_text).length,
      clean_len: first.cleanLen ?? s(firstJson.clean_text).length,
      clean_word_count: first.cleanWordCount ?? (Number(firstJson.clean_word_count) || 0),
      smoke_telegram_dry_run: smokeDryRun,
    }
  }];
};
