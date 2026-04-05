'use strict';

const parseCommand = require('../../src/n8n/nodes/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js');
const { readCommandParser: aliasCommandParser } = require('../../src/n8n/package/node_modules/@igasovic/n8n-blocks');

function unescapeMdv2(value) {
  return String(value || '').replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
}

async function runParser(text, extra = {}) {
  const out = await parseCommand({
    $json: {
      message: {
        text,
        chat: { id: 1509032341 },
        from: { id: 111 },
      },
      ...extra,
    },
  });
  expect(Array.isArray(out)).toBe(true);
  expect(out).toHaveLength(1);
  return out[0].json;
}

async function runAliasParser(text, extra = {}) {
  const out = await aliasCommandParser({
    $json: {
      message: {
        text,
        chat: { id: 1509032341 },
        from: { id: 111 },
      },
      ...extra,
    },
  });
  expect(Array.isArray(out)).toBe(true);
  expect(out).toHaveLength(1);
  return out[0].json;
}

describe('n8n command parser', () => {
  test('/help returns immediate command overview', async () => {
    const out = await runParser('/help');
    const text = unescapeMdv2(out.telegram_message);
    expect(out._reply_now).toBe(true);
    expect(out.telegram_chat_id).toBe(1509032341);
    expect(text).toContain('/distill-run [--batch|--sync]');
    expect(text).toContain('/recipe-link <public_id_1> <public_id_2>');
    expect(text).toContain('/recipe-note <public_id> <note>');
    expect(text).toContain('append --help');
  });

  test('unscoped compatibility alias resolves root export for /help', async () => {
    const out = await runAliasParser('/help');
    const text = unescapeMdv2(out.telegram_message);
    expect(out._reply_now).toBe(true);
    expect(text).toContain('/pull <id> [--excerpt]');
  });

  test('/distill-run defaults to execution_mode=batch', async () => {
    const out = await runParser('/distill-run --dry-run --candidate-limit 50 --max-sync-items 10');
    expect(out.cmd).toBe('distillrun');
    expect(out.execution_mode).toBe('batch');
    expect(out.dry_run).toBe(true);
    expect(out.candidate_limit).toBe(50);
    expect(out.max_sync_items).toBe(10);
  });

  test('/distill-run --sync sets execution_mode=sync', async () => {
    const out = await runParser('/distill-run --sync --max-sync-items 1');
    expect(out.cmd).toBe('distillrun');
    expect(out.execution_mode).toBe('sync');
    expect(out.max_sync_items).toBe(1);
  });

  test('/distill-run --help returns command usage', async () => {
    const out = await runParser('/distill-run --help');
    const text = unescapeMdv2(out.telegram_message);
    expect(out._reply_now).toBe(true);
    expect(text).toContain('/distill-run [--batch|--sync]');
    expect(text).toContain('/distill-run --help');
  });

  test('/find --help returns find usage without query requirement', async () => {
    const out = await runParser('/find --help');
    const text = unescapeMdv2(out.telegram_message);
    expect(out._reply_now).toBe(true);
    expect(text).toContain('/find <query>');
    expect(text).toContain('currentness_mismatch');
  });

  test('/distill-run rejects conflicting --batch and --sync', async () => {
    const out = await runParser('/distill-run --batch --sync');
    const text = unescapeMdv2(out.telegram_message);
    expect(out._reply_now).toBe(true);
    expect(text).toContain('/distill-run [--batch|--sync]');
  });

  test('enforced allowlist blocks PKM commands for non-pkm user id', async () => {
    const out = await runParser('/last test', {
      config: {
        calendar: {
          telegram_access: {
            enforce_allowlist: true,
            pkm_allowed_user_ids: ['999'],
          },
        },
      },
      message: {
        text: '/last test',
        chat: { id: 1509032341 },
        from: { id: 222 },
      },
    });
    expect(out._reply_now).toBe(true);
    expect(unescapeMdv2(out.telegram_message)).toContain('calendar-only access');
  });

  test('/recipe R17 routes to recipe_get with normalized public id', async () => {
    const out = await runParser('/recipe r17');
    expect(out.cmd).toBe('recipe_get');
    expect(out.public_id).toBe('R17');
  });

  test('/recipe <query> routes to recipe_search', async () => {
    const out = await runParser('/recipe lemon pasta');
    expect(out.cmd).toBe('recipe_search');
    expect(out.q).toBe('lemon pasta');
    expect(out.alternatives_count).toBe(2);
  });

  test('/recipes <query> routes to recipe_search', async () => {
    const out = await runParser('/recipes chicken soup');
    expect(out.cmd).toBe('recipe_search');
    expect(out.q).toBe('chicken soup');
  });

  test('/recipe-save payload forwards capture text', async () => {
    const out = await runParser('/recipe-save # Lemon Pasta\n\n## Ingredients\n- pasta\n\n## Instructions\n1. boil');
    expect(out.cmd).toBe('recipe_create');
    expect(out.capture_text).toContain('# Lemon Pasta');
    expect(out.capture_text).toContain('## Ingredients');
    expect(out.capture_text).toContain('## Instructions');
  });

  test('/recipe-link routes to recipe_link with normalized ids', async () => {
    const out = await runParser('/recipe-link r2 R123');
    expect(out.cmd).toBe('recipe_link');
    expect(out.public_id_1).toBe('R2');
    expect(out.public_id_2).toBe('R123');
  });

  test('/recipe-note routes to recipe_note with id and note payload', async () => {
    const out = await runParser('/recipe-note r123 this is a very important note.');
    expect(out.cmd).toBe('recipe_note');
    expect(out.public_id).toBe('R123');
    expect(out.note).toBe('this is a very important note.');
  });

  test('/recipe-note without note returns command usage', async () => {
    const out = await runParser('/recipe-note R9');
    const text = unescapeMdv2(out.telegram_message);
    expect(out._reply_now).toBe(true);
    expect(text).toContain('/recipe-note <R<number>> <note text>');
  });
});
