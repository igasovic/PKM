'use strict';

const assert = require('assert');
const path = require('path');

const emailInsert = require(path.resolve(__dirname, '../js/workflows/e-mail-capture/01_build-sql-insert__c4848348-bcd7-42b5-80d4-5b59e0152a45.js'));
const telegramInsert = require(path.resolve(__dirname, '../js/workflows/telegram-capture/01_build-sql-insert__5ea800e9-24b0-4674-8ec9-e0a92e5c574b.js'));

function makeCtx(json) {
  return {
    $json: json,
    $items: (name) => {
      if (name !== 'PKM Config') return [];
      return [{ json: { config: { db: { is_test_mode: false, schema_prod: 'pkm' } } } }];
    },
  };
}

(async () => {
  {
    const retrieval = {
      excerpt: 'ex',
      version: 'v1',
      source_domain: 'example.com',
      quality: {
        clean_word_count: 10,
        clean_char_count: 20,
        extracted_char_count: 30,
        link_count: 2,
        link_ratio: 0.2,
        boilerplate_heavy: false,
        low_signal: true,
        extraction_incomplete: false,
        quality_score: 0.73,
      },
    };

    const $json = {
      intent: 'note',
      content_type: 'text',
      title: 'Hello',
      author: 'Alice',
      capture_text: 'cap',
      clean_text: 'clean',
      url: 'https://a.example',
      url_canonical: 'https://a.example',
      external_ref: { source: 'gmail', id: '123' },
      retrieval,
    };

    const expected = [
      'INSERT INTO "pkm"."entries" (',
      '  created_at,',
      '  source,',
      '  intent,',
      '  content_type,',
      '  title,',
      '  author,',
      '  capture_text,',
      '  clean_text,',
      '  url,',
      '  url_canonical,',
      '  external_ref,',
      '  metadata,',
      '  enrichment_status,',
      '  retrieval_excerpt,',
      '  retrieval_version,',
      '  source_domain,',
      '  clean_word_count,',
      '  clean_char_count,',
      '  extracted_char_count,',
      '  link_count,',
      '  link_ratio,',
      '  boilerplate_heavy,',
      '  low_signal,',
      '  extraction_incomplete,',
      '  quality_score',
      ')',
      'VALUES (',
      '  now(),',
      "  'email'::text,",
      "  'note'::text,",
      "  'text'::text,",
      "  'Hello'::text,",
      "  'Alice'::text,",
      "  'cap'::text,",
      "  'clean'::text,",
      "  'https://a.example'::text,",
      "  'https://a.example'::text,",
      "  '{\"source\":\"gmail\",\"id\":\"123\"}'::jsonb,",
      "  '{\"retrieval\":{\"excerpt\":\"ex\",\"version\":\"v1\",\"source_domain\":\"example.com\",\"quality\":{\"clean_word_count\":10,\"clean_char_count\":20,\"extracted_char_count\":30,\"link_count\":2,\"link_ratio\":0.2,\"boilerplate_heavy\":false,\"low_signal\":true,\"extraction_incomplete\":false,\"quality_score\":0.73}}}'::jsonb,",
      "  'pending',",
      "  'ex'::text,",
      "  'v1'::text,",
      "  'example.com'::text,",
      '  10::int,',
      '  20::int,',
      '  30::int,',
      '  2::int,',
      '  0.2::real,',
      '  false::boolean,',
      '  true::boolean,',
      '  false::boolean,',
      '  0.73::real',
      ')',
      'RETURNING',
      '  entry_id,',
      '  id,',
      '  created_at,',
      '  source,',
      '  intent,',
      '  content_type,',
      '  title,',
      '  author,',
      '  clean_text,',
      '  metadata,',
      '  COALESCE(char_length(clean_text), 0) AS clean_len;',
    ].join('\n');

    const actual = (await emailInsert(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  {
    const retrieval = {
      excerpt: 'ex2',
      version: 'v2',
      source_domain: 'example.org',
      quality: {
        clean_word_count: 11,
        clean_char_count: 21,
        extracted_char_count: 31,
        link_count: 3,
        link_ratio: 0.3,
        boilerplate_heavy: true,
        low_signal: false,
        extraction_incomplete: true,
        quality_score: 0.81,
      },
    };

    const $json = {
      intent: 'archive',
      content_type: 'note',
      title: 'TG',
      author: 'Bob',
      capture_text: 'cap-tg',
      clean_text: 'clean-tg',
      url: 'https://t.example',
      url_canonical: 'https://t.example',
      topic_primary: 'topicA',
      topic_primary_confidence: 0.91,
      topic_secondary: 'topicB',
      topic_secondary_confidence: 0.42,
      gist: 'gist',
      retrieval,
    };

    const expected = [
      'INSERT INTO "pkm"."entries" (',
      '  created_at,',
      '  source,',
      '  intent,',
      '  content_type,',
      '  title,',
      '  author,',
      '  capture_text,',
      '  clean_text,',
      '  url,',
      '  url_canonical,',
      '  topic_primary,',
      '  topic_primary_confidence,',
      '  topic_secondary,',
      '  topic_secondary_confidence,',
      '  gist,',
      '  metadata,',
      '  retrieval_excerpt,',
      '  retrieval_version,',
      '  source_domain,',
      '  clean_word_count,',
      '  clean_char_count,',
      '  extracted_char_count,',
      '  link_count,',
      '  link_ratio,',
      '  boilerplate_heavy,',
      '  low_signal,',
      '  extraction_incomplete,',
      '  quality_score',
      ')',
      'VALUES (',
      '  now(),',
      "  'telegram'::text,",
      "  'archive'::text,",
      "  'note'::text,",
      "  'TG'::text,",
      "  'Bob'::text,",
      "  'cap-tg'::text,",
      "  'clean-tg'::text,",
      "  'https://t.example'::text,",
      "  'https://t.example'::text,",
      "  'topicA'::text,",
      '  0.91::real,',
      "  'topicB'::text,",
      '  0.42::real,',
      "  'gist'::text,",
      "  $pkmjson${\"retrieval\":{\"excerpt\":\"ex2\",\"version\":\"v2\",\"source_domain\":\"example.org\",\"quality\":{\"clean_word_count\":11,\"clean_char_count\":21,\"extracted_char_count\":31,\"link_count\":3,\"link_ratio\":0.3,\"boilerplate_heavy\":true,\"low_signal\":false,\"extraction_incomplete\":true,\"quality_score\":0.81}}}$pkmjson$::jsonb,",
      "  'ex2'::text,",
      "  'v2'::text,",
      "  'example.org'::text,",
      '  11::int,',
      '  21::int,',
      '  31::int,',
      '  3::int,',
      '  0.3::real,',
      '  true::boolean,',
      '  false::boolean,',
      '  true::boolean,',
      '  0.81::real',
      ')',
      'RETURNING',
      '  entry_id,',
      '  id,',
      '  created_at,',
      '  source,',
      '  intent,',
      '  content_type,',
      '  title,',
      '  author,',
      '  url,',
      '  url_canonical,',
      '  COALESCE(char_length(capture_text), 0) AS text_len;',
    ].join('\n');

    const actual = (await telegramInsert(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  // If we got here, all assertions passed.
  // eslint-disable-next-line no-console
  console.log('sql-builder insert snapshots: OK');
})();
