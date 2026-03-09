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
});
