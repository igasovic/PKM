'use strict';

const { getConfig } = require('../../src/libs/config.js');
const sb = require('../../src/libs/sql-builder.js');

describe('read SQL distill field projections', () => {
  const config = getConfig();
  const entriesTable = '"pkm"."entries"';

  test('buildReadContinue includes distill summary + why_it_matters', () => {
    const sql = sb.buildReadContinue({
      config,
      entries_table: entriesTable,
      q: 'pkm',
      days: 90,
      limit: 10,
    });

    expect(sql).toContain('COALESCE(e.distill_summary,\'\') AS distill_summary');
    expect(sql).toContain('COALESCE(e.distill_why_it_matters,\'\') AS distill_why_it_matters');
    expect(sql).toContain('NULL::text AS distill_why_it_matters');
  });

  test('buildReadFind includes distill summary + why_it_matters', () => {
    const sql = sb.buildReadFind({
      config,
      entries_table: entriesTable,
      q: 'pkm',
      days: 90,
      limit: 10,
    });

    expect(sql).toContain('COALESCE(e.distill_summary,\'\') AS distill_summary');
    expect(sql).toContain('COALESCE(e.distill_why_it_matters,\'\') AS distill_why_it_matters');
    expect(sql).toContain('NULL::text AS distill_why_it_matters');
  });

  test('buildReadLast includes distill summary + why_it_matters', () => {
    const sql = sb.buildReadLast({
      config,
      entries_table: entriesTable,
      q: 'pkm',
      days: 90,
      limit: 10,
    });

    expect(sql).toContain('COALESCE(e.distill_summary,\'\') AS distill_summary');
    expect(sql).toContain('COALESCE(e.distill_why_it_matters,\'\') AS distill_why_it_matters');
    expect(sql).toContain('NULL::text AS distill_why_it_matters');
  });

  test('buildReadPull includes distill summary + why_it_matters', () => {
    const sql = sb.buildReadPull({
      entries_table: entriesTable,
      entry_id: 123,
      shortN: 320,
      longN: 1800,
    });

    expect(sql).toContain('COALESCE(e.distill_summary,\'\') AS distill_summary');
    expect(sql).toContain('COALESCE(e.distill_why_it_matters,\'\') AS distill_why_it_matters');
    expect(sql).toContain('TRUE AS found');
    expect(sql).toContain('FALSE AS found');
  });
});
