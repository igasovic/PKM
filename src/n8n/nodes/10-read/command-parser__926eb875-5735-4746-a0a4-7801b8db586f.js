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

const path = require('node:path');

function loadTelegramMarkdown() {
  const packagedPath = path.join(__dirname, '..', '..', 'shared', 'telegram-markdown.js');
  try {
    return require(packagedPath);
  } catch (_err) {
    return require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  }
}

const { mdv2Message } = loadTelegramMarkdown();

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

const msg = $json.message || {};
const text = String($json.raw_text || msg.text || '').trim();
const telegram_chat_id = $json.telegram_chat_id ?? msg.chat?.id ?? null;
const smoke_mode = $json.smoke_mode === true;
const smoke_case = String($json.smoke_case || '').trim() || null;
const sender_user_id = String(msg.from?.id ?? '').trim();
const accessCfg = ($json.config && $json.config.calendar && $json.config.calendar.telegram_access) || {};
const enforceAllowlist = accessCfg.enforce_allowlist === true;
const pkmAllowedIds = new Set(
  (Array.isArray(accessCfg.pkm_allowed_user_ids) ? accessCfg.pkm_allowed_user_ids : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
);

// If reused accidentally for non-commands
if (!text.startsWith('/')) {
  return [{ json: { _ignore: true } }];
}

if (enforceAllowlist && (!sender_user_id || !pkmAllowedIds.has(sender_user_id))) {
  return replyNow(telegram_chat_id, 'This Telegram user has calendar-only access. PKM commands are disabled.');
}

// Supported commands + defaults
const defaults = {
  last: { days: 180, limit: 10 },
  find: { days: 365, limit: 10 },
  continue: { days: 90, limit: 10 },
  with: { days: 90, limit: 10 },
  pull: { days: null, limit: null },   // <-- NEW
  recipe: { days: null, limit: null },
  recipes: { days: null, limit: null },
  recipesave: { days: null, limit: null },
  delete: { days: null, limit: null },
  move: { days: null, limit: null },
  debug: { days: null, limit: null },
  distill: { days: null, limit: null },
  distillrun: { days: null, limit: null },
  status: { days: null, limit: null },
  help: { days: null, limit: null },
};

const mCmd = text.match(/^\/([a-zA-Z][a-zA-Z0-9_-]*)/);
const cmdRaw = (mCmd?.[1] || '').toLowerCase();
const cmdAlias = {
  'distill-run': 'distillrun',
  'distill_run': 'distillrun',
  'recipe-save': 'recipesave',
  'recipe_save': 'recipesave',
};
const cmd = cmdAlias[cmdRaw] || cmdRaw;
const hasHelpFlag = /(?:^|\s)(?:--help|-h)(?:\s|$)/i.test(text);

const HELP_OVERVIEW =
  `Commands:\n` +
  `/help\n` +
  `/pull <id> [--excerpt]\n` +
  `/recipe R42\n` +
  `/recipe lemon pasta\n` +
  `/recipes lemon pasta\n` +
  `/recipe-save <structured_recipe_text>\n` +
  `/last "phrase" [--days N] [--limit M]\n` +
  `/find "needle" [--days N] [--limit M]\n` +
  `/continue topic [--days N] [--limit M]\n` +
  `/with person topic [--days N] [--limit M]\n` +
  `/delete <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]\n` +
  `/move <prod|test> <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]\n` +
  `/debug <run_id|last>\n` +
  `/distill <entry_id>\n` +
  `/distill-run [--batch|--sync] [--dry-run] [--candidate-limit N] [--max-sync-items N] [--no-persist-eligibility]\n` +
  `/status [t1|t2] [--limit M] [--active-only]\n\n` +
  `Tip: append --help to any command for command-specific help.`;

const COMMAND_HELP = {
  help: HELP_OVERVIEW,
  pull: `Usage:\n/pull <id> [--excerpt]\n/pull --help`,
  recipe: `Usage:\n/recipe <R<number>|query>\nExamples:\n/recipe R42\n/recipe lemon pasta`,
  recipes: `Usage:\n/recipes <query>\nExample:\n/recipes lemon pasta`,
  recipesave: `Usage:\n/recipe-save <structured recipe text>\nExample:\n/recipe-save # Lemon Pasta\\n\\n- Servings: 4\\n\\n## Ingredients\\n- pasta\\n\\n## Instructions\\n1. boil`,
  last: `Usage:\n/last <query> [--days N] [--limit M]\nExamples:\n/last "LangGraph"\n/last agents --days 30 --limit 5`,
  find: `Usage:\n/find <query> [--days N] [--limit M]\nExamples:\n/find "currentness_mismatch"\n/find litellm --days 90`,
  continue: `Usage:\n/continue <query> [--days N] [--limit M]\nExample:\n/continue tier2 retries --days 30`,
  with: `Usage:\n/with <query> [--days N] [--limit M]\nExample:\n/with igor t2 status`,
  delete: `Usage:\n/delete <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]\nExample:\n/delete prod 100-120 --dry-run`,
  move: `Usage:\n/move <prod|test> <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]\nExample:\n/move test prod 100,101 --dry-run`,
  debug: `Usage:\n/debug <run_id|last>\n/debug --help\nExamples:\n/debug last\n/debug n8n-123456`,
  distill: `Usage:\n/distill <entry_id>\n/distill --help\nExample:\n/distill 12345`,
  distillrun: `Usage:\n/distill-run [--batch|--sync] [--dry-run] [--candidate-limit N] [--max-sync-items N] [--no-persist-eligibility]\n/distill-run --help\nExamples:\n/distill-run --dry-run --candidate-limit 50 --max-sync-items 10\n/distill-run --sync --max-sync-items 1`,
  status: `Usage:\n/status [t1|t2] [--limit M] [--active-only]\n/status --help\nExamples:\n/status\n/status t2 --limit 20 --active-only`,
};

function usageFor(commandName) {
  const key = String(commandName || '').trim().toLowerCase();
  return COMMAND_HELP[key] || HELP_OVERVIEW;
}

function replyNow(telegram_chat_id, message) {
  return [{
    json: {
      _reply_now: true,
      telegram_chat_id,
      telegram_message: mdv2Message(message, { maxLen: 4000 }),
      smoke_mode,
      smoke_case,
    },
  }];
}

if (!defaults[cmd]) {
  return replyNow(telegram_chat_id, `Unknown command.\n\n${HELP_OVERVIEW}`);
}

if (hasHelpFlag) {
  return replyNow(telegram_chat_id, usageFor(cmd));
}

// Special case: /help returns immediate usage block.
if (cmd === 'help') {
  return replyNow(telegram_chat_id, usageFor('help'));
}

// Special case: /recipe <R<number>|query>
//               /recipes <query>
if (cmd === 'recipe' || cmd === 'recipes') {
  const rest = text.replace(/^\/[a-zA-Z][a-zA-Z0-9_-]*/i, '').trim();
  if (!rest) {
    return replyNow(telegram_chat_id, usageFor(cmd));
  }

  if (cmd === 'recipe' && /^R\d+$/i.test(rest)) {
    return [{
      json: {
        cmd: 'recipe_get',
        public_id: String(rest).toUpperCase(),
        telegram_chat_id,
        smoke_mode,
        smoke_case,
      },
    }];
  }

  return [{
    json: {
      cmd: 'recipe_search',
      q: rest,
      alternatives_count: 2,
      telegram_chat_id,
      smoke_mode,
      smoke_case,
    },
  }];
}

// Special case: /recipe-save <structured recipe text>
if (cmd === 'recipesave') {
  const capture_text = text.replace(/^\/[a-zA-Z][a-zA-Z0-9_-]*/i, '').trim();
  if (!capture_text) {
    return replyNow(telegram_chat_id, usageFor('recipesave'));
  }
  return [{
    json: {
      cmd: 'recipe_create',
      capture_text,
      source: 'telegram',
      telegram_chat_id,
      smoke_mode,
      smoke_case,
    },
  }];
}

// Special case: /pull <entry_id> [--excerpt]
if (cmd === 'pull') {
  const want_excerpt = /--excerpt\b/i.test(text);

  // allow: /pull 123, /pull 123 --excerpt
  const mId = text.match(/^\/pull\s+(\d+)\b/i);
  if (!mId?.[1]) {
    return replyNow(telegram_chat_id, usageFor('pull'));
  }

  const entry_id = mId[1]; // keep as string to avoid JS precision issues

  return [{
    json: {
      cmd,
      entry_id,
      want_excerpt,
      telegram_chat_id,
      smoke_mode,
      smoke_case,
    }
  }];
}

// Special case: /debug <run_id|last>
if (cmd === 'debug') {
  const rest = text.replace(/^\/\w+/i, '').trim();
  if (!rest) {
    return replyNow(telegram_chat_id, usageFor('debug'));
  }

  const token = String(rest).split(/\s+/)[0].trim();
  if (!token) {
    return replyNow(telegram_chat_id, usageFor('debug'));
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
      telegram_chat_id,
      smoke_mode,
      smoke_case,
    }
  }];
}

// Special case: /distill <entry_id>
if (cmd === 'distill') {
  const mId = text.match(/^\/distill\s+(\d+)\b/i);
  if (!mId?.[1]) {
    return replyNow(telegram_chat_id, usageFor('distill'));
  }

  return [{
    json: {
      cmd,
      entry_id: mId[1],
      telegram_chat_id,
      smoke_mode,
      smoke_case,
    }
  }];
}

// Special case: /distill-run [--batch|--sync] [--dry-run] [--candidate-limit N] [--max-sync-items N] [--no-persist-eligibility]
if (cmd === 'distillrun') {
  const parsePositiveIntArg = (flag) => {
    const re = new RegExp(`--${flag}\\s+(\\d+)`, 'i');
    const m = text.match(re);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  };

  const candidate_limit = parsePositiveIntArg('candidate-limit');
  const max_sync_items = parsePositiveIntArg('max-sync-items');
  const dry_run = /--dry-run\b/i.test(text);
  const persist_eligibility = !/--no-persist-eligibility\b/i.test(text);
  const forceSync = /--sync\b/i.test(text);
  const forceBatch = /--batch\b/i.test(text);
  const modeMatch = text.match(/--mode\s+(batch|sync)\b/i);
  const modeFromFlag = modeMatch ? String(modeMatch[1]).toLowerCase() : null;
  let execution_mode = 'batch';

  if (forceSync && forceBatch) {
    return replyNow(telegram_chat_id, usageFor('distillrun'));
  }
  if (forceSync) execution_mode = 'sync';
  if (forceBatch) execution_mode = 'batch';

  if (modeFromFlag) {
    if ((forceSync && modeFromFlag !== 'sync') || (forceBatch && modeFromFlag !== 'batch')) {
      return replyNow(telegram_chat_id, usageFor('distillrun'));
    }
    execution_mode = modeFromFlag;
  }

  return [{
    json: {
      cmd,
      dry_run,
      candidate_limit,
      max_sync_items,
      persist_eligibility,
      execution_mode,
      telegram_chat_id,
      smoke_mode,
      smoke_case,
    }
  }];
}

// Special case: /status [t1|t2] [--limit M] [--active-only]
if (cmd === 'status') {
  const rest = text.replace(/^\/\w+/i, '').trim();
  const tokens = rest
    .replace(/--limit\s+\d+/ig, '')
    .replace(/--active-only\b/ig, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let status_stage = 't1';
  if (tokens.length > 0) {
    const stage = String(tokens[0]).toLowerCase();
    if (stage !== 't1' && stage !== 't2') {
      return replyNow(telegram_chat_id, usageFor('status'));
    }
    status_stage = stage;
  }

  let status_limit = 50;
  const mLimit = text.match(/--limit\s+(\d+)/i);
  if (mLimit) status_limit = Math.min(200, Math.max(1, parseInt(mLimit[1], 10)));

  const status_include_terminal = /--active-only\b/i.test(text) ? false : null;

  return [{
    json: {
      cmd,
      status_stage,
      status_limit,
      status_include_terminal,
      telegram_chat_id,
      smoke_mode,
      smoke_case,
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
      return replyNow(telegram_chat_id, 'Usage:\n/delete <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]');
    }

    const rest = String((m && m[2]) || '')
      .replace(/--dry-run\b/ig, '')
      .replace(/--force\b/ig, '')
      .trim();
    const parsed = parseSelectorSpec(rest);
    if (parsed.error) {
      return replyNow(telegram_chat_id, parsed.error);
    }

    return [{
      json: {
        cmd,
        schema,
        entry_ids: parsed.entry_ids,
        range: parsed.range || null,
        dry_run,
        force,
        telegram_chat_id,
        smoke_mode,
        smoke_case,
      }
    }];
  }

  const rest0 = text.replace(/^\/\w+/i, '').trim();
  const m = rest0.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
  const from_schema = parseSchemaValue(m && m[1]);
  const to_schema = parseSchemaValue(m && m[2]);
  if (!from_schema || !to_schema || from_schema === to_schema) {
    return replyNow(telegram_chat_id, 'Usage:\n/move <prod|test> <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]');
  }

  const rest = String((m && m[3]) || '')
    .replace(/--dry-run\b/ig, '')
    .replace(/--force\b/ig, '')
    .trim();
  const parsed = parseSelectorSpec(rest);
  if (parsed.error) {
    return replyNow(telegram_chat_id, parsed.error);
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
      telegram_chat_id,
      smoke_mode,
      smoke_case,
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
  return replyNow(telegram_chat_id, usageFor(cmd));
}

return [{
  json: {
    cmd,
    q,
    days,
    limit,
    telegram_chat_id,
    smoke_mode,
    smoke_case,
  }
}];
};
