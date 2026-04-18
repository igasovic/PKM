'use strict';

const sb = require('../../src/libs/sql-builder.js');

describe('tier1 store sql builders', () => {
  test('collect-candidate query includes completed-without-results recovery condition', () => {
    const sql = sb.buildT1BatchListCollectCandidates({
      batchesTable: '"pkm"."t1_batches"',
      itemsTable: '"pkm"."t1_batch_items"',
      resultsTable: '"pkm"."t1_batch_item_results"',
    });

    expect(sql).toContain('FROM "pkm"."t1_batches" b');
    expect(sql).toContain('LEFT JOIN (');
    expect(sql).toContain('FROM "pkm"."t1_batch_items"');
    expect(sql).toContain('FROM "pkm"."t1_batch_item_results"');
    expect(sql).toContain("lower(COALESCE(b.status, '')) = 'completed'");
    expect(sql).toContain('COALESCE(r.processed_count, 0) = 0');
    expect(sql).toContain("COALESCE(b.metadata->>'auto_retry_spawned_batch_id', '') = ''");
  });

  test('item-status query includes per-item error code and message fields', () => {
    const sql = sb.buildT1BatchItemStatusList({
      itemsTable: '"pkm"."t1_batch_items"',
      resultsTable: '"pkm"."t1_batch_item_results"',
    });

    expect(sql).toContain("COALESCE(r.status, 'pending') AS status");
    expect(sql).toContain("NULLIF(r.error->>'code', '')");
    expect(sql).toContain('AS error_code');
    expect(sql).toContain("NULLIF(r.error->>'message', '') AS message");
    expect(sql).toContain('(r.error IS NOT NULL) AS has_error');
  });
});
