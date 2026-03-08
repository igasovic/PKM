'use strict';

const {
  parseTier2FinalOutput,
  buildTier2Artifact,
  validateTier2Artifact,
} = require('../../src/server/tier2/parsing-validation.js');

describe('tier2 parsing + validation', () => {
  test('parses fenced JSON output', () => {
    const parsed = parseTier2FinalOutput(
      '```json\n{"distill_summary":"x","distill_excerpt":null,"distill_why_it_matters":"y","distill_stance":"descriptive"}\n```'
    );
    expect(parsed.distill_summary).toBe('x');
    expect(parsed.distill_stance).toBe('descriptive');
  });

  test('accepts valid artifact', () => {
    const raw = {
      distill_summary: 'AI tooling is converging around practical automation.',
      distill_excerpt: 'practical automation',
      distill_why_it_matters: 'It gives reusable patterns for future workflow design.',
      distill_stance: 'analytical',
    };
    const artifact = buildTier2Artifact(raw, {
      model: 't2-direct',
      request_type: 'direct_generation',
      chunking_strategy: 'direct',
      content_hash: 'hash_1',
      distill_version: 'distill_v1',
    });

    const out = validateTier2Artifact({
      artifact,
      clean_text: 'This newsletter discusses practical automation and deployment patterns.',
      content_hash: 'hash_1',
    });

    expect(out.accepted).toBe(true);
    expect(out.error_code).toBeNull();
  });

  test('fails when excerpt is not grounded', () => {
    const artifact = {
      distill_summary: 'Summary',
      distill_excerpt: 'nonexistent phrase from nowhere',
      distill_why_it_matters: 'Reason',
      distill_stance: 'descriptive',
      distill_version: 'distill_v1',
      distill_created_from_hash: 'hash_1',
      distill_metadata: {
        created_at: new Date().toISOString(),
        model: 't2-direct',
        chunking_strategy: 'direct',
      },
    };

    const out = validateTier2Artifact({
      artifact,
      clean_text: 'This source does not contain that phrase.',
      content_hash: 'hash_1',
    });

    expect(out.accepted).toBe(false);
    expect(out.error_code).toBe('excerpt_not_grounded');
  });
});
