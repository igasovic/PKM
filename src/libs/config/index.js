'use strict';

const CONFIG_V1 = {
  version: 'v1',

  topics: [
    'productivity',
    'product',
    'entrepreneurship',
    'consulting',
    'marketing',
    'finance',
    'parenting',
    'engineering',
    'ai',
    'home',
    'leadership',
    'cookbook',
    'fitness',
    'communication',
    'other',
    'health',
    'travel',
  ],

  db: {
    // Toggle-able: default off (production)
    is_test_mode: false,
    schema_prod: 'pkm',
    schema_test: 'pkm_test',
  },
  t1: {
    batch: {
      verbose_logging: true,
      verbose_log_path: '/data/t1.log',
    },
  },
  distill: {
    max_entries_per_run: 25,
    candidate_scan_limit: 250,
    direct_chunk_threshold_words: 5000,
    chunk_target_words: 1800,
    chunk_max_words: 2200,
    chunk_overlap_words: 150,
    version: 'distill_v1',
    models: {
      direct: process.env.T2_MODEL_DIRECT || 't2-direct',
      chunk_note: process.env.T2_MODEL_CHUNK_NOTE || 't2-chunk-note',
      synthesis: process.env.T2_MODEL_SYNTHESIS || 't2-synthesis',
      batch_direct: process.env.T2_MODEL_BATCH_DIRECT || process.env.T2_MODEL_SYNC_DIRECT || 't2-sync-direct',
      sync_direct: process.env.T2_MODEL_SYNC_DIRECT || 't2-sync-direct',
    },
    retry: {
      enabled: String(process.env.T2_RETRY_ENABLED || 'true').toLowerCase() !== 'false',
      max_attempts: (() => {
        const n = Number(process.env.T2_RETRY_MAX_ATTEMPTS || 2);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 2;
      })(),
      retryable_error_codes: [
        'generation_error',
        'network_error',
        'timeout',
        'rate_limited',
        'provider_error',
        'malformed_output',
        'worker_error',
      ],
      non_retryable_error_codes: [
        'missing_clean_text',
        'wrong_content_type',
        'already_current',
        'already_queued',
        'invalid_config',
        'invalid_route',
        'validation_contract_mismatch',
      ],
    },
  },
  calendar: {
    timezone: 'America/Chicago',
    family_calendar_id: process.env.FAMILY_CALENDAR_ID || null,
    recipient_email: process.env.FAMILY_CALENDAR_RECIPIENT_EMAIL || 'pkm.gasovic',
    prefixes: {
      calendar: 'cal:',
      pkm: 'pkm:',
    },
    // v1 temporary actor policy is workflow-level; keep explicit config for backend hardening follow-up.
    allowed_actor_codes: ['igor', 'danijela'],
    people: {
      order: ['M', 'Iv', 'L', 'Ig', 'D'],
      family_alias: 'FAM',
      map: {
        mila: { code: 'M', color: 'purple', google_color_id: '3', telegram_marker: 'purple' },
        iva: { code: 'Iv', color: 'yellow', google_color_id: '5', telegram_marker: 'yellow' },
        louie: { code: 'L', color: 'orange', google_color_id: '6', telegram_marker: 'orange' },
        igor: { code: 'Ig', color: 'blue', google_color_id: '9', telegram_marker: 'blue' },
        danijela: { code: 'D', color: 'white', google_color_id: '1', telegram_marker: 'white' },
        fam: { code: 'FAM', color: 'green', google_color_id: '10', telegram_marker: 'green' },
      },
      unresolved_external: {
        color: 'grey',
        telegram_marker: 'grey',
      },
    },
    categories: {
      FAM: 'family',
      MED: 'medical',
      HOME: 'home',
      EVT: 'event',
      KID: 'kids',
      ADM: 'admin',
      DOG: 'dog',
      SCH: 'school',
      TRV: 'travel',
      OTH: 'other',
    },
    default_duration_minutes: {
      FAM: 120,
      MED: 60,
      HOME: 60,
      EVT: 120,
      KID: 60,
      ADM: 30,
      DOG: 60,
      SCH: 60,
      TRV: 120,
      OTH: 60,
      fallback: 60,
      birthday_override: 180,
    },
    padding: {
      enabled: true,
      before_minutes: 30,
      after_minutes: 30,
      home_literals: ['home'],
    },
    reporting: {
      daily: {
        hour_local: 5,
        minute_local: 30,
      },
      weekly: {
        weekday: 'sunday',
        hour_local: 18,
        minute_local: 30,
      },
    },
    clarification: {
      one_open_request_per_chat: true,
      continuation_strategy: 'latest_open_in_chat',
    },
    create_rules: {
      allow_all_day: false,
      allow_recurrence: false,
    },
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
  },

  metadataPaths: {
    excerpt: ['retrieval', 'excerpt'],
    quality: ['retrieval', 'quality'],
    version: ['retrieval', 'version'],
  },
};

function getConfig() {
  return JSON.parse(JSON.stringify(CONFIG_V1));
}

module.exports = {
  getConfig,
};
