'use strict';

const { requireExternalizedNode } = require('./n8n-node-loader');

const emailComposeReply = requireExternalizedNode('03-e-mail-capture', 'compose-reply-text');
const telegramDuplicate = requireExternalizedNode('02-telegram-capture', 'format-duplicate-message');
const emailDuplicate = requireExternalizedNode('03-e-mail-capture', 'format-duplicate-message');
const backupParse = requireExternalizedNode('80-postgres-backup', 'parse');
const backupFormat = requireExternalizedNode('80-postgres-backup', 'format');
const calendarCreateFormat = requireExternalizedNode('30-calendar-create', 'format-create-result-message');

describe('n8n telegram display formatters', () => {
  test('email compose uses word count', async () => {
    const out = await emailComposeReply({
      $json: {
        entry_id: 819,
        author: 'Sender',
        title: 'Title',
        clean_text: 'one two three four five',
        clean_word_count: 5,
      },
    });

    const msg = out[0].json.telegram_message;
    expect(msg).toContain('📏 5 words');
    expect(msg).not.toContain('chars');
  });

  test('duplicate messages include source system', async () => {
    const tgOut = await telegramDuplicate({ $json: { entry_id: 819 } });
    const emailOut = await emailDuplicate({ $json: { entry_id: 820 } });

    expect(tgOut[0].json.telegram_message).toContain('Duplicate telegram entry 819 processing stopped');
    expect(emailOut[0].json.telegram_message).toContain('Duplicate email entry 820 processing stopped');
  });

  test('backup parse suppresses ok webhook notifications', async () => {
    const ok = await backupParse({ $json: { body: { job: 'pkm_backup_rotate', rc: 0, ts: '2026-03-21T02:35:01-05:00' } } });
    const fail = await backupParse({ $json: { body: { job: 'pkm_backup_rotate', rc: 1, ts: '2026-03-21T02:35:01-05:00' } } });

    expect(ok).toEqual([]);
    expect(fail).toHaveLength(1);
    expect(fail[0].json.telegram_message).toContain('❌ CRON fail');
  });

  test('backup summary sends on saturday when all statuses are healthy', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-21T12:00:00-05:00'));
    const stdout = JSON.stringify({
      pkm_backup_daily: { status: 'ok', ts: '2026-03-21T02:10:01-05:00', rc: 0 },
      pkm_backup_weekly: { status: 'ok', ts: '2026-03-15T02:20:01-05:00', rc: 0 },
      pkm_backup_monthly: { status: 'ok', ts: '2026-03-01T02:25:01-05:00', rc: 0 },
      pkm_backup_gdrive_daily: { status: 'ok', ts: '2026-03-21T03:00:00-05:00', rc: 0 },
      pkm_backup_gdrive_weekly: { status: 'ok', ts: '2026-03-15T03:00:00-05:00', rc: 0 },
      pkm_backup_gdrive_monthly: { status: 'ok', ts: '2026-03-01T03:00:00-05:00', rc: 0 },
    });

    const out = await backupFormat({ $json: { stdout } });
    expect(out).toHaveLength(1);
    expect(out[0].json.telegram_message).toContain('PKM Backup Summary: 2026\\-03\\-21');
    expect(out[0].json.telegram_message).toContain('Daily: ✅');
    jest.useRealTimers();
  });

  test('backup summary is suppressed on non-saturday when all statuses are healthy', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-20T12:00:00-05:00'));
    const stdout = JSON.stringify({
      pkm_backup_daily: { status: 'ok', ts: '2026-03-20T02:10:01-05:00', rc: 0 },
      pkm_backup_weekly: { status: 'ok', ts: '2026-03-15T02:20:01-05:00', rc: 0 },
      pkm_backup_monthly: { status: 'ok', ts: '2026-03-01T02:25:01-05:00', rc: 0 },
      pkm_backup_gdrive_daily: { status: 'ok', ts: '2026-03-20T03:00:00-05:00', rc: 0 },
      pkm_backup_gdrive_weekly: { status: 'ok', ts: '2026-03-15T03:00:00-05:00', rc: 0 },
      pkm_backup_gdrive_monthly: { status: 'ok', ts: '2026-03-01T03:00:00-05:00', rc: 0 },
    });

    const out = await backupFormat({ $json: { stdout } });
    expect(out).toEqual([]);
    jest.useRealTimers();
  });

  test('calendar create formatter uses compact three-line confirmation', async () => {
    const out = await calendarCreateFormat({
      $json: {
        status: 'calendar_created',
        google_start: '2026-03-22T14:30:00-05:00',
        google_end: '2026-03-22T15:30:00-05:00',
        confirmation_subject: '[Ig][OTH] 3:00p test Igor',
      },
    });

    const msg = out[0].json.telegram_message;
    expect(msg).toContain('📅 Event created');
    expect(msg).toContain('\\[Ig\\]\\[OTH\\] 3:00p test Igor');
    expect(msg).toContain('Sun Mar 22 2:30p \\-\\> 3:30p');
  });
});
