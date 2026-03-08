'use strict';

const DISTILL_STANCES = new Set([
  'descriptive',
  'analytical',
  'argumentative',
  'speculative',
  'instructional',
  'narrative',
  'other',
]);

const DISTILL_STATUSES = new Set([
  'pending',
  'queued',
  'completed',
  'failed',
  'skipped',
  'not_eligible',
  'stale',
]);

const DISTILL_VALIDATION_ERROR_CODES = {
  MISSING_SUMMARY: 'missing_summary',
  SUMMARY_NOT_STRING: 'summary_not_string',
  SUMMARY_EMPTY: 'summary_empty',
  EXCERPT_NOT_STRING: 'excerpt_not_string',
  EXCERPT_EMPTY: 'excerpt_empty',
  EXCERPT_PLACEHOLDER_VALUE: 'excerpt_placeholder_value',
  EXCERPT_NOT_GROUNDED: 'excerpt_not_grounded',
  MISSING_WHY_IT_MATTERS: 'missing_why_it_matters',
  WHY_IT_MATTERS_NOT_STRING: 'why_it_matters_not_string',
  WHY_IT_MATTERS_EMPTY: 'why_it_matters_empty',
  MISSING_STANCE: 'missing_stance',
  INVALID_STANCE: 'invalid_stance',
  MISSING_VERSION: 'missing_version',
  VERSION_NOT_STRING: 'version_not_string',
  VERSION_EMPTY: 'version_empty',
  MISSING_CREATED_FROM_HASH: 'missing_created_from_hash',
  CREATED_FROM_HASH_NOT_STRING: 'created_from_hash_not_string',
  CREATED_FROM_HASH_MISMATCH: 'created_from_hash_mismatch',
  MISSING_METADATA: 'missing_metadata',
  METADATA_NOT_OBJECT: 'metadata_not_object',
  METADATA_MISSING_CREATED_AT: 'metadata_missing_created_at',
  METADATA_MISSING_MODEL: 'metadata_missing_model',
  METADATA_MISSING_CHUNKING_STRATEGY: 'metadata_missing_chunking_strategy',
  SUMMARY_WHY_IT_MATTERS_DUPLICATE: 'summary_why_it_matters_duplicate',
};

const DISTILL_EXCERPT_PLACEHOLDERS = new Set([
  'none',
  'n/a',
  'not available',
]);

module.exports = {
  DISTILL_STANCES,
  DISTILL_STATUSES,
  DISTILL_VALIDATION_ERROR_CODES,
  DISTILL_EXCERPT_PLACEHOLDERS,
};
