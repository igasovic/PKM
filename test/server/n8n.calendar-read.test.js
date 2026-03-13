'use strict';

const parseCalendarQuery = require('../../src/n8n/nodes/31-calendar-read/parse-calendar-query__2eaf2dbf-a4ee-4e95-a691-dd14b4f89f4f.js');
const formatCalendarReadMessage = require('../../src/n8n/nodes/31-calendar-read/format-calendar-read-message__0f4f9202-36bf-4337-8f15-2f6fb1122e68.js');

describe('n8n calendar read helpers', () => {
  test('parse query resolves tomorrow window and label', async () => {
    const out = await parseCalendarQuery({
      $json: {
        message: {
          text: 'cal: what do we have tomorrow?',
          chat: { id: 1509032341 },
        },
        config: {
          calendar: {
            timezone: 'America/Chicago',
            family_calendar_id: 'family@group.calendar.google.com',
          },
        },
      },
    });

    const row = out[0].json;
    expect(row.query_label).toBe('tomorrow');
    expect(row.window_start_local).toMatch(/T00:00:00$/);
    expect(row.window_end_local).toMatch(/T00:00:00$/);
    expect(row.google_calendar_id).toBe('family@group.calendar.google.com');
    expect(row.telegram_chat_id).toBe('1509032341');
  });

  test('parse query resolves weekday labels', async () => {
    const out = await parseCalendarQuery({
      $json: {
        message: {
          text: 'what is on monday?',
          chat: { id: 1509032341 },
        },
      },
    });

    const row = out[0].json;
    expect(row.query_label).toBe('monday');
    expect(row.target_date_local).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('format read message builds output and observe payload for external events', async () => {
    const out = await formatCalendarReadMessage({
      $input: {
        all: () => [
          {
            json: {
              id: 'evt-1',
              summary: '[M][MED] 3:00p Mila dentist',
              start: { dateTime: '2026-03-13T15:00:00-05:00' },
              end: { dateTime: '2026-03-13T16:00:00-05:00' },
            },
          },
          {
            json: {
              id: 'evt-2',
              summary: 'School parent meeting',
              start: { dateTime: '2026-03-13T18:00:00-05:00' },
              end: { dateTime: '2026-03-13T19:00:00-05:00' },
            },
          },
        ],
      },
      $items: (nodeName) => {
        if (nodeName === 'Parse Calendar Query') {
          return [{
            json: {
              query_label: 'tomorrow',
              telegram_chat_id: '1509032341',
              request_id: 'req-1',
              google_calendar_id: 'family@group.calendar.google.com',
            },
          }];
        }
        return [];
      },
    });

    const row = out[0].json;
    expect(row.telegram_message).toContain('Events for tomorrow');
    expect(row.telegram_message).toContain('🟣');
    expect(row.telegram_message).toContain('⚫');
    expect(row.observe_items).toHaveLength(1);
    expect(row.observe_items[0]).toEqual(expect.objectContaining({
      google_event_id: 'evt-2',
      observation_kind: 'query_seen',
      source_type: 'external_unknown',
      was_reported: true,
    }));
  });

  test('format read message handles empty result set', async () => {
    const out = await formatCalendarReadMessage({
      $input: { all: () => [] },
      $items: () => [{ json: { query_label: 'today', telegram_chat_id: '1509032341' } }],
    });

    const row = out[0].json;
    expect(row.telegram_message).toContain('No events for today');
    expect(row.observe_items).toEqual([]);
  });
});
