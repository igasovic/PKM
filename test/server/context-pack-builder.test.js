'use strict';

const {
  deriveExcerptFromRecord,
  buildContextPackMarkdown,
} = require('../../src/libs/context-pack-builder.js');

describe('context-pack builder', () => {
  test('prefers distill_summary over gist/retrieval excerpt', () => {
    const excerpt = deriveExcerptFromRecord({
      distill_summary: 'Tier-2 summary should win.',
      gist: 'Tier-1 gist should not win.',
      retrieval_excerpt: 'retrieval excerpt should not win.',
    });

    expect(excerpt).toBe('Tier-2 summary should win.');
  });

  test('falls back to gist when distill_summary is absent', () => {
    const excerpt = deriveExcerptFromRecord({
      gist: 'Tier-1 gist fallback.',
      retrieval_excerpt: 'retrieval excerpt fallback.',
    });

    expect(excerpt).toBe('Tier-1 gist fallback.');
  });

  test('renders distill_summary content in context-pack markdown', () => {
    const md = buildContextPackMarkdown(
      [{
        id: '00000000-0000-4000-8000-000000000001',
        entry_id: 123,
        content_type: 'newsletter',
        author: 'Author',
        title: 'Title',
        created_at: '2026-03-09T00:00:00.000Z',
        topic_primary: 'ai',
        topic_secondary: 'agents',
        keywords: ['pkm'],
        distill_summary: 'Distilled summary text.',
        gist: 'Gist text.',
        retrieval_excerpt: 'Retrieval text.',
      }],
      { method: 'continue', query: 'pkm', days: 90, limit: 10 },
      { layout: 'ui', markdownV2: false, maxContentLen: 300 }
    );

    expect(md).toContain('content: Distilled summary text.');
    expect(md).not.toContain('content: Gist text.');
  });

  test('includes why_it_matters for top quarter of results', () => {
    const rows = Array.from({ length: 8 }, (_, idx) => ({
      id: `00000000-0000-4000-8000-00000000000${idx + 1}`,
      entry_id: idx + 1,
      content_type: 'newsletter',
      author: 'Author',
      title: `Title ${idx + 1}`,
      created_at: '2026-03-09T00:00:00.000Z',
      topic_primary: 'ai',
      topic_secondary: 'agents',
      keywords: ['pkm'],
      distill_summary: `Summary ${idx + 1}`,
      distill_why_it_matters: `Why ${idx + 1}`,
    }));

    const md = buildContextPackMarkdown(
      rows,
      { method: 'continue', query: 'pkm', days: 90, limit: 10 },
      { layout: 'ui', markdownV2: false, maxContentLen: 300 },
    );

    expect(md).toContain('why_it_matters: Why 1');
    expect(md).toContain('why_it_matters: Why 2');
    expect(md).not.toContain('why_it_matters: Why 3');
  });
});
