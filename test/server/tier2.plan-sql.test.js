'use strict';

const sb = require('../../src/libs/sql-builder.js');

describe('tier2 planner sql', () => {
  test('candidate discovery keeps eligibility checks in control-plane', () => {
    const sql = sb.buildTier2CandidateDiscovery({
      entries_table: '"pkm"."entries"',
      limit: 100,
    });

    expect(sql).toContain('COALESCE(e.distill_status, \'pending\') <> \'queued\'');
    expect(sql).toContain('CASE WHEN e.content_type = \'newsletter\' THEN 0 ELSE 1 END');
    expect(sql).toContain('CASE WHEN COALESCE(length(btrim(e.clean_text)), 0) > 0 THEN 0 ELSE 1 END');
    expect(sql).not.toContain('WHERE\n  e.content_type = \'newsletter\'');
  });

  test('eligibility status update persists status and reason metadata', () => {
    const sql = sb.buildTier2PersistEligibilityStatus({
      entries_table: '"pkm"."entries"',
      ids: ['11111111-1111-4111-8111-111111111111'],
      status: 'not_eligible',
      reason_code: 'wrong_content_type',
    });

    expect(sql).toContain('UPDATE "pkm"."entries" e');
    expect(sql).toContain("distill_status = 'not_eligible'::text");
    expect(sql).toContain("'decision', 'not_eligible'::text");
    expect(sql).toContain("'reason_code', 'wrong_content_type'::text");
  });

  test('status update builder supports queued dispatch status', () => {
    const sql = sb.buildTier2PersistEligibilityStatus({
      entries_table: '"pkm"."entries"',
      ids: ['11111111-1111-4111-8111-111111111111'],
      status: 'queued',
      reason_code: 'batch_dispatch',
    });

    expect(sql).toContain("distill_status = 'queued'::text");
    expect(sql).toContain("'decision', 'queued'::text");
    expect(sql).toContain("'reason_code', 'batch_dispatch'::text");
  });

  test('tier2 batch item insert builder includes dispatch metadata columns', () => {
    const sql = sb.buildT2BatchItemsInsert({
      itemsTable: '"pkm"."t2_batch_items"',
      rowCount: 2,
    });

    expect(sql).toContain('INSERT INTO "pkm"."t2_batch_items"');
    expect(sql).toContain('(batch_id, custom_id, entry_id, content_hash, route, chunking_strategy, request_type, title, author, content_type, prompt_mode, prompt, retry_count, created_at)');
    expect(sql).toContain('ON CONFLICT (batch_id, custom_id) DO NOTHING');
  });

  test('tier2 batch result upsert builder supports applied flag', () => {
    const sql = sb.buildT2BatchResultsUpsert({
      resultsTable: '"pkm"."t2_batch_item_results"',
      rowCount: 1,
    });

    expect(sql).toContain('INSERT INTO "pkm"."t2_batch_item_results"');
    expect(sql).toContain('(batch_id, custom_id, status, response_text, parsed, error, raw, applied, updated_at, created_at)');
    expect(sql).toContain('applied = COALESCE(EXCLUDED.applied');
  });

  test('tier2 reconcile query reads unapplied rows only', () => {
    const sql = sb.buildT2BatchReconcileRows({
      batchesTable: '"pkm"."t2_batches"',
      itemsTable: '"pkm"."t2_batch_items"',
      resultsTable: '"pkm"."t2_batch_item_results"',
    });

    expect(sql).toContain('FROM "pkm"."t2_batch_items" i');
    expect(sql).toContain('JOIN "pkm"."t2_batch_item_results" r');
    expect(sql).toContain('COALESCE(r.applied, false) = false');
    expect(sql).toContain('i.content_hash AS expected_content_hash');
  });

  test('entry-state projection includes clean_text for reconciliation validation', () => {
    const sql = sb.buildTier2EntryStatesByEntryIds({
      entries_table: '"pkm"."entries"',
      entry_ids: [11, 22],
    });

    expect(sql).toContain('e.clean_text');
    expect(sql).toContain('e.content_hash');
    expect(sql).toContain('ORDER BY ids.entry_id ASC');
  });
});
