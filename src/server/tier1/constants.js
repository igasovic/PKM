'use strict';

const CLEAN_TEXT_SAMPLE_LIMIT = 4000;
const TERMINAL_BATCH_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled']);

module.exports = {
  CLEAN_TEXT_SAMPLE_LIMIT,
  TERMINAL_BATCH_STATUSES,
};
