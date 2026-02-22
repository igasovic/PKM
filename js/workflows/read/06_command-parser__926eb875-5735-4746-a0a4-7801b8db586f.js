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
  delete: { days: null, limit: null },
  move: { days: null, limit: null },
  debug: { days: null, limit: null },
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
        `/delete <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]\n` +
        `/move <prod|test> <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]\n` +
        `/debug <run_id|last>\n` +
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

// Special case: /debug <run_id|last>
if (cmd === 'debug') {
  const rest = text.replace(/^\/\w+/i, '').trim();
  if (!rest) {
    return [{
      json: {
        _reply_now: true,
        chat_id,
        telegram_message: `Usage:\n/debug <run_id|last>\nExamples:\n/debug last\n/debug n8n-123456`
      }
    }];
  }

  const token = String(rest).split(/\s+/)[0].trim();
  if (!token) {
    return [{
      json: {
        _reply_now: true,
        chat_id,
        telegram_message: `Usage:\n/debug <run_id|last>`
      }
    }];
  }

  const isLast = token.toLowerCase() === 'last';
  return [{
    json: {
      cmd,
      run_id: isLast ? null : token,
      debug_last: isLast,
      // Precomputed backend path for HTTP Request node convenience.
      debug_path: isLast
        ? '/debug/run/last'
        : `/debug/run/${encodeURIComponent(token)}`,
      debug_method: 'GET',
      chat_id
    }
  }];
}

function parseSchemaValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'p' || v === 'prod' || v === 'production' || v === 'pkm') return 'pkm';
  if (v === 't' || v === 'test' || v === 'pkm_test') return 'pkm_test';
  return null;
}

function parseSelectorSpec(rest) {
  const tokens = String(rest || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const entry_ids = [];
  let range = null;

  for (const token of tokens) {
    const idMatch = token.match(/^\d+$/);
    if (idMatch) {
      if (idMatch[0] !== '0') entry_ids.push(idMatch[0]);
      continue;
    }
    const rangeMatch = token.match(/^(\d+)(?:\.\.|-)(\d+)$/);
    if (rangeMatch) {
      if (range) {
        return { error: 'Only one range is supported.' };
      }
      const from = rangeMatch[1];
      const to = rangeMatch[2];
      if (from === '0' || to === '0') {
        return { error: 'Range values must be > 0.' };
      }
      if (BigInt(from) > BigInt(to)) {
        return { error: 'Range must satisfy from <= to.' };
      }
      range = { from, to };
      continue;
    }
    return { error: `Invalid selector token: ${token}` };
  }

  const deduped = Array.from(new Set(entry_ids));
  if (!deduped.length && !range) {
    return { error: 'Provide at least one selector: id, id list, or range.' };
  }
  return {
    entry_ids: deduped,
    range,
  };
}

if (cmd === 'delete' || cmd === 'move') {
  const dry_run = /--dry-run\b/i.test(text);
  const force = /--force\b/i.test(text);

  if (cmd === 'delete') {
    const rest0 = text.replace(/^\/\w+/i, '').trim();
    const m = rest0.match(/^(\S+)\s+([\s\S]+)$/);
    const schema = parseSchemaValue(m && m[1]);
    if (!schema) {
      return [{
        json: {
          _reply_now: true,
          chat_id,
          telegram_message: `Usage:\n/delete <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]`
        }
      }];
    }

    const rest = String((m && m[2]) || '')
      .replace(/--dry-run\b/ig, '')
      .replace(/--force\b/ig, '')
      .trim();
    const parsed = parseSelectorSpec(rest);
    if (parsed.error) {
      return [{
        json: {
          _reply_now: true,
          chat_id,
          telegram_message: parsed.error
        }
      }];
    }

    return [{
      json: {
        cmd,
        schema,
        entry_ids: parsed.entry_ids,
        range: parsed.range || null,
        dry_run,
        force,
        chat_id
      }
    }];
  }

  const rest0 = text.replace(/^\/\w+/i, '').trim();
  const m = rest0.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
  const from_schema = parseSchemaValue(m && m[1]);
  const to_schema = parseSchemaValue(m && m[2]);
  if (!from_schema || !to_schema || from_schema === to_schema) {
    return [{
      json: {
        _reply_now: true,
        chat_id,
        telegram_message: `Usage:\n/move <prod|test> <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]`
      }
    }];
  }

  const rest = String((m && m[3]) || '')
    .replace(/--dry-run\b/ig, '')
    .replace(/--force\b/ig, '')
    .trim();
  const parsed = parseSelectorSpec(rest);
  if (parsed.error) {
    return [{
      json: {
        _reply_now: true,
        chat_id,
        telegram_message: parsed.error
      }
    }];
  }

  return [{
    json: {
      cmd,
      from_schema,
      to_schema,
      entry_ids: parsed.entry_ids,
      range: parsed.range || null,
      dry_run,
      force,
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
