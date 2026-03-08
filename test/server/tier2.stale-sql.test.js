'use strict';

const sb = require('../../src/libs/sql-builder.js');

describe('tier2 stale sql', () => {
  test('buildTier2MarkStale emits completed->stale update', () => {
    const sql = sb.buildTier2MarkStale({ entriesTable: '"pkm"."entries"' });
    expect(sql).toContain('UPDATE "pkm"."entries"');
    expect(sql).toContain("distill_status = 'stale'");
    expect(sql).toContain("distill_status = 'completed'");
    expect(sql).toContain('content_hash IS DISTINCT FROM distill_created_from_hash');
  });
});
