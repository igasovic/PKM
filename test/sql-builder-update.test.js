'use strict';

const assert = require('assert');
const path = require('path');

const telegramUpdate = require(path.resolve(__dirname, '../js/workflows/telegram-capture/02_build-sql-update__1c1e479b-b8f6-4d85-9c69-8c0f9943982f.js'));
const t1Update = require(path.resolve(__dirname, '../js/workflows/e-mail-capture/14_update-t1-info-to-db__1a6df95f-7a5c-4203-b82c-f2e0a84b70c0.js'));

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
      id: '11111111-1111-1111-1111-111111111111',
      url: 'https://t.example',
      url_canonical: 'https://t.example',
      title: 'Title',
      author: 'Author',
      clean_text: 'clean',
      extracted_text: 'extracted',
      retrieval,
    };

    const expected = [
      'UPDATE "pkm"."entries"',
      'SET',
      "  url = COALESCE('https://t.example', url),",
      "  url_canonical = COALESCE('https://t.example', url_canonical),",
      '  -- only overwrite when non-empty',
      "  clean_text = COALESCE('clean'::text, clean_text),",
      '  -- only overwrite when non-empty',
      "  extracted_text = COALESCE('extracted'::text, extracted_text),",
      "  title = COALESCE('Title'::text, title),",
      "  author = COALESCE('Author'::text, author),",
      '  metadata = CASE',
      '    WHEN true THEN',
      '      jsonb_set(',
      "        COALESCE(metadata, '{}'::jsonb),",
      "        '{retrieval}',",
      "        '{\"excerpt\":\"ex\",\"version\":\"v1\",\"source_domain\":\"example.com\",\"quality\":{\"clean_word_count\":10,\"clean_char_count\":20,\"extracted_char_count\":30,\"link_count\":2,\"link_ratio\":0.2,\"boilerplate_heavy\":false,\"low_signal\":true,\"extraction_incomplete\":false,\"quality_score\":0.73}}'::jsonb,",
      '        true',
      '      )',
      '    ELSE metadata',
      '  END,',
      '  -- WP2 promoted retrieval columns: update only when retrieval exists',
      "  retrieval_excerpt = CASE WHEN true THEN 'ex'::text ELSE retrieval_excerpt END,",
      "  retrieval_version = CASE WHEN true THEN 'v1'::text ELSE retrieval_version END,",
      "  source_domain = CASE WHEN true THEN 'example.com'::text ELSE source_domain END,",
      '  clean_word_count = CASE WHEN true THEN 10::int ELSE clean_word_count END,',
      '  clean_char_count = CASE WHEN true THEN 20::int ELSE clean_char_count END,',
      '  extracted_char_count = CASE WHEN true THEN 30::int ELSE extracted_char_count END,',
      '  link_count = CASE WHEN true THEN 2::int ELSE link_count END,',
      '  link_ratio = CASE WHEN true THEN 0.2::real ELSE link_ratio END,',
      '  boilerplate_heavy = CASE WHEN true THEN false::boolean ELSE boilerplate_heavy END,',
      '  low_signal = CASE WHEN true THEN true::boolean ELSE low_signal END,',
      '  extraction_incomplete = CASE WHEN true THEN false::boolean ELSE extraction_incomplete END,',
      '  quality_score = CASE WHEN true THEN 0.73::real ELSE quality_score END,',
      '  content_hash = NULL',
      "WHERE id = '11111111-1111-1111-1111-111111111111'::uuid",
      'RETURNING',
      '  entry_id,',
      '  id,',
      '  created_at,',
      '  source,',
      '  intent,',
      '  content_type,',
      "  COALESCE(title,'') AS title,",
      "  COALESCE(author,'') AS author,",
      "  COALESCE(clean_text,'') AS clean_text,",
      '  url_canonical,',
      '  COALESCE(char_length(clean_text), 0) AS clean_len,',
      '  COALESCE(char_length(extracted_text), 0) AS extracted_len;',
    ].join('\n');

    const actual = (await telegramUpdate(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  {
    const t1 = {
      topic_primary: 'alpha',
      topic_secondary: 'beta',
      gist: 'gamma',
      keywords: ['one', 'two', 'three', 'four', 'five'],
      topic_primary_confidence: 0.7,
      topic_secondary_confidence: 0.4,
    };

    const $json = {
      id: '22222222-2222-2222-2222-222222222222',
      t1,
      enrichment_model: 'gpt-5-nano',
      prompt_version: 'v1',
    };

    const expected = [
      'UPDATE "pkm"."entries"',
      'SET',
      "  topic_primary = 'alpha'::text,",
      '  topic_primary_confidence = 0.7,',
      "  topic_secondary = 'beta'::text,",
      '  topic_secondary_confidence = 0.4,',
      "  keywords = ARRAY['one', 'two', 'three', 'four', 'five']::text[],",
      "  gist = 'gamma'::text,",
      "  enrichment_status = 'done',",
      "  enrichment_model = 'gpt-5-nano'::text,",
      "  prompt_version = 'v1'::text,",
      '  metadata = CASE',
      '    WHEN true THEN',
      '      jsonb_set(',
      "        COALESCE(metadata, '{}'::jsonb),",
      "        '{t1_raw}',",
      "        '{\"topic_primary\":\"alpha\",\"topic_secondary\":\"beta\",\"gist\":\"gamma\",\"keywords\":[\"one\",\"two\",\"three\",\"four\",\"five\"],\"topic_primary_confidence\":0.7,\"topic_secondary_confidence\":0.4}'::jsonb,",
      '        true',
      '      )',
      '    ELSE metadata',
      '  END',
      "WHERE id = '22222222-2222-2222-2222-222222222222'::uuid",
      'RETURNING',
      '  entry_id,',
      '  id,',
      '  created_at,',
      '  source,',
      '  intent,',
      '  content_type,',
      "  COALESCE(title,'') AS title,",
      "  COALESCE(author,'') AS author,",
      "  COALESCE(url_canonical,'') AS url_canonical,",
      '  topic_primary,',
      '  topic_secondary,',
      '  gist,',
      '  clean_text,',
      '  array_length(keywords,1) AS kw_count,',
      '  enrichment_status;',
    ].join('\n');

    const actual = (await t1Update(makeCtx($json)))[0].json.sql;
    assert.strictEqual(actual, expected);
  }

  // eslint-disable-next-line no-console
  console.log('sql-builder update snapshots: OK');
})();
