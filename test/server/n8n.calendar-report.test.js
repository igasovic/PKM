'use strict';

const buildReportWindow = require('../../src/n8n/nodes/32-calendar-report/build-report-window__1d7fa7c9-3ac6-4b7e-bf0a-6e2e7789f31a.js');
const formatCalendarReportMessage = require('../../src/n8n/nodes/32-calendar-report/format-calendar-report-message__58f6c53c-5dad-4d29-93d0-00dc8f7d5683.js');

describe('n8n calendar report helpers', () => {
  test('build report window resolves daily range and admin chat fallback', async () => {
    const out = await buildReportWindow({
      $json: {
        report_kind: 'daily',
        now_local_date: '2026-03-13',
        config: {
          calendar: {
            timezone: 'America/Chicago',
            family_calendar_id: 'family@group.calendar.google.com',
          },
        },
      },
      $env: {
        TELEGRAM_ADMIN_CHAT_ID: '1509032341',
      },
    });

    const row = out[0].json;
    expect(row.report_kind).toBe('daily');
    expect(row.window_start_local).toBe('2026-03-13T00:00:00');
    expect(row.window_end_local).toBe('2026-03-16T00:00:00');
    expect(row.report_day_list).toEqual(['2026-03-13', '2026-03-14', '2026-03-15']);
    expect(row.telegram_chat_id).toBe('1509032341');
  });

  test('build report window resolves next monday-sunday for weekly mode', async () => {
    const out = await buildReportWindow({
      $json: {
        report_kind: 'weekly',
        now_local_date: '2026-03-13',
      },
      $env: {},
    });

    const row = out[0].json;
    expect(row.report_kind).toBe('weekly');
    expect(row.report_start_date_local).toBe('2026-03-16');
    expect(row.report_end_exclusive_date_local).toBe('2026-03-23');
    expect(row.report_day_list).toHaveLength(7);
  });

  test('format daily report includes explicit no-events-today and skips empty future days', async () => {
    const out = await formatCalendarReportMessage({
      $input: {
        all: () => [
          {
            json: {
              id: 'evt-1',
              summary: '[M][MED] 3:00p Mila dentist',
              start: { dateTime: '2026-03-14T15:00:00-05:00' },
              end: { dateTime: '2026-03-14T16:00:00-05:00' },
            },
          },
        ],
      },
      $items: () => [{
        json: {
          report_kind: 'daily',
          report_day_list: ['2026-03-13', '2026-03-14', '2026-03-15'],
          report_start_date_local: '2026-03-13',
          google_calendar_id: 'family@group.calendar.google.com',
          telegram_chat_id: '1509032341',
        },
      }],
    });

    const row = out[0].json;
    expect(row.telegram_message).toContain('Today \\(Fri Mar 13\\): no events');
    expect(row.telegram_message).toContain('Sat Mar 14');
    expect(row.telegram_message).toContain('🟣 3:00p \\[M\\]\\[MED\\] 3:00p Mila dentist');
    expect(row.telegram_message).not.toMatch(/^Sun Mar 15$/m);
  });

  test('format weekly report skips empty days and logs external observe items', async () => {
    const out = await formatCalendarReportMessage({
      $input: {
        all: () => [
          {
            json: {
              id: 'evt-ext',
              summary: 'School parent meeting',
              start: { dateTime: '2026-03-17T18:00:00-05:00' },
              end: { dateTime: '2026-03-17T19:00:00-05:00' },
            },
          },
        ],
      },
      $items: () => [{
        json: {
          report_kind: 'weekly',
          report_day_list: ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22'],
          report_start_date_local: '2026-03-16',
          google_calendar_id: 'family@group.calendar.google.com',
          telegram_chat_id: '1509032341',
        },
      }],
    });

    const row = out[0].json;
    expect(row.telegram_message).toContain('Family calendar weekly report');
    expect(row.telegram_message).toContain('Tue Mar 17');
    expect(row.telegram_message).not.toContain('Mon Mar 16\n');
    expect(row.observe_items).toHaveLength(1);
    expect(row.observe_items[0]).toEqual(expect.objectContaining({
      observation_kind: 'weekly_report_seen',
      source_type: 'external_unknown',
      google_event_id: 'evt-ext',
    }));
  });
});
