/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Command Parser
 * Node ID: 926eb875-5735-4746-a0a4-7801b8db586f
 *
 * Notes:
 * - Generated from workflow export for clean Git diffs.
 * - Keep return shape identical to original Code node.
 * - Sandbox: require() allowed (allowlisted); fs/process not available.
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const msg = $json.message || {};
const text = String(msg.text || '').trim();
const chat_id = msg.chat?.id ?? null;

// If reused accidentally for non-commands
if (!text.startsWith('/')) {
  return [{ json: { _ignore: true } }];
}

// Supported commands + defaults
const defaults = {
  last: { days: 180, limit: 10 },
  find: { days: 365, limit: 10 },
  continue: { days: 90, limit: 10 },
  with: { days: 90, limit: 10 },
  pull: { days: null, limit: null },   // <-- NEW
  status: { days: null, limit: null },
  help: { days: null, limit: null },
};

const mCmd = text.match(/^\/([a-zA-Z_]+)/);
const cmd = (mCmd?.[1] || '').toLowerCase();

if (!defaults[cmd]) {
  return [{
    json: {
      _reply_now: true,
      chat_id,
      telegram_message:
        `Unknown command.\n\nCommands:\n` +
        `/help\n` +
        `/pull <id> [--excerpt]\n` +
        `/last "phrase" [--days N] [--limit M]\n` +
        `/find "needle" [--days N] [--limit M]\n` +
        `/continue topic [--days N] [--limit M]\n` +
        `/with person topic [--days N] [--limit M]\n` +
        `/status`
    }
  }];
}

// Special case: /help always goes to switch (no reply_now)
if (cmd === 'help') {
  return [{ json: { cmd: 'help', chat_id } }];
}

// Special case: /pull <entry_id> [--excerpt]
if (cmd === 'pull') {
  const want_excerpt = /--excerpt\b/i.test(text);

  // allow: /pull 123, /pull 123 --excerpt
  const mId = text.match(/^\/pull\s+(\d+)\b/i);
  if (!mId?.[1]) {
    return [{
      json: {
        _reply_now: true,
        chat_id,
        telegram_message: `Usage:\n/pull <id> [--excerpt]\nExample: /pull 12345 --excerpt`
      }
    }];
  }

  const entry_id = mId[1]; // keep as string to avoid JS precision issues

  return [{
    json: {
      cmd,
      entry_id,
      want_excerpt,
      chat_id
    }
  }];
}

// Flags
let days = defaults[cmd].days;
let limit = defaults[cmd].limit;

const mDays = text.match(/--days\s+(\d+)/i);
if (mDays) days = Math.max(1, parseInt(mDays[1], 10));

const mLimit = text.match(/--limit\s+(\d+)/i);
if (mLimit) limit = Math.min(50, Math.max(1, parseInt(mLimit[1], 10)));

// Query extraction
let q = null;

// Prefer quoted query for /last and /find
if (cmd === 'last' || cmd === 'find') {
  const quoted = text.match(/^\/\w+\s+["']([\s\S]*?)["']/i);
  if (quoted?.[1]) q = quoted[1].trim();
}

// Fallback: everything after /cmd minus flags
if (!q) {
  const rest = text.replace(/^\/\w+/i, '').trim();
  q = rest
    .replace(/--days\s+\d+/ig, '')
    .replace(/--limit\s+\d+/ig, '')
    .trim();
  if (!q) q = null;
}

if (!q) {
  return [{
    json: {
      _reply_now: true,
      chat_id,
      telegram_message: `Usage:\n/${cmd} <query> [--days N] [--limit M]`
    }
  }];
}

return [{
  json: {
    cmd,
    q,
    days,
    limit,
    chat_id
  }
}];
};
