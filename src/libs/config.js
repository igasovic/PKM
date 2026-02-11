'use strict';

const sb = require('../../src/libs/sql-builder.js');
const { getPool } = require('./db-pool.js');

const CONFIG_V1 = {
  version: 'v1',


  db: {
    // Toggle-able: default off (production)
    is_test_mode: false,
    schema_prod: 'pkm',
    schema_test: 'pkm_test',
  },
  scoring: {
    ordering: ['score_desc', 'created_at_desc'],

    noteQuotaByCmd: {
      continue: 0.75,
    },

    recencyByCmd: {
      continue: { half_life_days: 45 },
      last: { half_life_days: 180 },
      find: { half_life_days: 365 },
    },

    daysByCmd: {
      continue: 90,
      last: 180,
      find: 365,
    },

    maxItems: {
      continue: 15,
      last: 15,
      find: 15,
      pull_excerpt_chars: 1800,
      pull_short_chars: 320,
    },

    weightsByCmd: {
      continue: {
        topic_primary_exact: 70,
        topic_primary_fuzzy: 50,
        topic_secondary_exact: 35,
        topic_secondary_fuzzy: 25,

        keywords_overlap_each: 6,
        keywords_overlap_cap: 36,

        gist_match: 18,
        title_match: 10,
        author_match: 6,
        people_match: 10,

        fts_rank: 6,

        prefer_content_type_note: 14,
        prefer_intent_think: 10,
        prefer_enriched: 4,

        penalty_boilerplate_heavy: 22,
        penalty_low_signal: 18,
        penalty_link_ratio_high: 10,
        penalty_extraction_incomplete: 8,
        penalty_is_duplicate: 50,
      },

      last: {
        topic_primary_exact: 35,
        topic_primary_fuzzy: 25,
        topic_secondary_exact: 40,
        topic_secondary_fuzzy: 30,

        keywords_overlap_each: 7,
        keywords_overlap_cap: 42,

        gist_match: 24,
        title_match: 12,
        author_match: 8,
        people_match: 10,

        fts_rank: 18,

        prefer_content_type_note: 10,
        prefer_intent_think: 8,
        prefer_enriched: 4,

        penalty_boilerplate_heavy: 18,
        penalty_low_signal: 14,
        penalty_link_ratio_high: 8,
        penalty_extraction_incomplete: 6,
        penalty_is_duplicate: 50,
      },

      find: {
        topic_primary_exact: 10,
        topic_primary_fuzzy: 8,
        topic_secondary_exact: 10,
        topic_secondary_fuzzy: 8,

        keywords_overlap_each: 3,
        keywords_overlap_cap: 18,

        gist_match: 10,
        title_match: 10,
        author_match: 8,
        people_match: 8,

        fts_rank: 80,

        prefer_content_type_note: 0,
        prefer_intent_think: 0,
        prefer_enriched: 0,

        penalty_boilerplate_heavy: 8,
        penalty_low_signal: 6,
        penalty_link_ratio_high: 4,
        penalty_extraction_incomplete: 3,
        penalty_is_duplicate: 30,
      },
    },
  },

  qualityThresholds: {
    excerpt_max_chars: 320,

    low_signal: { min_words: 35, min_chars: 220 },

    boilerplate: { link_ratio_high: 0.18, link_count_high: 25 },

    extraction_incomplete: {
      min_extracted_chars_to_consider: 800,
      clean_vs_extracted_ratio_low: 0.25,
    },
  },

  metadataPaths: {
    excerpt: ['retrieval', 'excerpt'],
    sourceDomain: ['retrieval', 'source_domain'],
    quality: ['retrieval', 'quality'],
    version: ['retrieval', 'version'],
  },
};

const CONFIG_TABLE = sb.qualifiedTable(CONFIG_V1.db.schema_prod, 'runtime_config');
let cachedTestMode = null;
let cachedTestModeAt = 0;
const TEST_MODE_CACHE_MS = 10000;

function wrapConfigTableError(err) {
  if (!err) return err;
  if (err.code === '42P01' || err.code === '3F000') {
    const wrapped = new Error(`runtime_config table missing: create ${CONFIG_TABLE} before using test mode`);
    wrapped.cause = err;
    return wrapped;
  }
  return err;
}

async function getTestModeState() {
  const now = Date.now();
  if (cachedTestMode !== null && (now - cachedTestModeAt) < TEST_MODE_CACHE_MS) {
    return cachedTestMode;
  }
  const p = getPool();
  let res;

  res = await p.query(`SELECT value FROM ${CONFIG_TABLE} WHERE key = $1`, ['is_test_mode']);

  const value = !!(res.rows && res.rows[0] && res.rows[0].value === true);
  cachedTestMode = value;
  cachedTestModeAt = now;
  return value;
}

async function setTestModeState(nextState) {
  const p = getPool();

  await p.query(
    `INSERT INTO ${CONFIG_TABLE} (key, value, updated_at)\n     VALUES ($1, $2::jsonb, now())\n     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    ['is_test_mode', JSON.stringify(!!nextState)]
  );

  cachedTestMode = !!nextState;
  cachedTestModeAt = Date.now();
}

async function toggleTestMode() {
  const current = await getTestModeState();
  const next = !current;
  await setTestModeState(next);
  return next;
}

function getConfigStatic() {
  return JSON.parse(JSON.stringify(CONFIG_V1));
}

async function getConfig() {
  const config = JSON.parse(JSON.stringify(CONFIG_V1));
  config.db.is_test_mode = await getTestModeState();
  return config;
}

module.exports = {
  CONFIG_V1,
  getConfigStatic,
  getConfig,
  getTestModeState,
  toggleTestMode,
};
