'use strict';

const { getConfig } = require('../../src/libs/config.js');
const { buildRetrievalForDb } = require('../../src/server/quality.js');

describe('quality', () => {
  test('buildRetrievalForDb returns db-ready promoted fields', () => {
    const config = getConfig();
    const out = buildRetrievalForDb({
      capture_text: 'This is a longer sentence with enough words for quality scoring.',
      content_type: 'note',
      extracted_text: '',
      url_canonical: null,
      url: null,
      config,
      excerpt_override: null,
      excerpt_source: 'This is a longer sentence with enough words for quality scoring.',
      quality_source_text: 'This is a longer sentence with enough words for quality scoring.',
    });

    expect(out).toHaveProperty('retrieval_excerpt');
    expect(out).toHaveProperty('quality_score');
    expect(out).toHaveProperty('metadata.retrieval');
    expect(typeof out.clean_word_count).toBe('number');
  });

  test('respects excerpt override', () => {
    const config = getConfig();
    const out = buildRetrievalForDb({
      capture_text: 'abc',
      content_type: 'note',
      extracted_text: '',
      url_canonical: null,
      url: null,
      config,
      excerpt_override: 'custom excerpt',
      excerpt_source: 'abc',
      quality_source_text: 'abc',
    });

    expect(out.retrieval_excerpt).toBe('custom excerpt');
    expect(out.retrieval.excerpt).toBe('custom excerpt');
  });

  test('marks low-signal short note', () => {
    const config = getConfig();
    const out = buildRetrievalForDb({
      capture_text: 'short',
      content_type: 'note',
      extracted_text: '',
      url_canonical: null,
      url: null,
      config,
      excerpt_override: null,
      excerpt_source: 'short',
      quality_source_text: 'short',
    });

    expect(out.low_signal).toBe(true);
  });
});
