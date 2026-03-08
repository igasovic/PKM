'use strict';

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeWordCount(value) {
  const n = toFiniteNumber(value, 0);
  return n > 0 ? Math.trunc(n) : 0;
}

function hasUsableCleanText(row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.has_usable_clean_text === 'boolean') return row.has_usable_clean_text;
  if (typeof row.clean_text === 'string') return row.clean_text.trim().length > 0;
  return normalizeWordCount(row.clean_word_count) > 0;
}

function isAlreadyCurrent(row) {
  const currentHash = String((row && row.content_hash) || '').trim();
  const createdFromHash = String((row && row.distill_created_from_hash) || '').trim();
  return !!(currentHash && createdFromHash && currentHash === createdFromHash);
}

function evaluateTier2Eligibility(row) {
  const contentType = String((row && row.content_type) || '').trim().toLowerCase();
  const distillStatus = String((row && row.distill_status) || '').trim().toLowerCase();

  if (contentType !== 'newsletter') {
    return { decision: 'not_eligible', reason_code: 'wrong_content_type' };
  }
  if (!hasUsableCleanText(row)) {
    return { decision: 'skipped', reason_code: 'missing_clean_text' };
  }
  if (distillStatus === 'queued') {
    return { decision: 'skipped', reason_code: 'already_queued' };
  }
  if (isAlreadyCurrent(row)) {
    return { decision: 'skipped', reason_code: 'already_current' };
  }
  return { decision: 'proceed', reason_code: null };
}

function scoreLengthBand(cleanWordCount) {
  const words = normalizeWordCount(cleanWordCount);
  if (words >= 400 && words <= 2500) return 20;
  if (words >= 200 && words < 400) return 10;
  if (words > 2500 && words <= 5000) return 10;
  if (words > 5000) return 5;
  return 0;
}

function computeTier2PriorityScore(row) {
  const status = String((row && row.distill_status) || '').trim().toLowerCase();
  if (status === 'stale') return 1000;

  const intent = String((row && row.intent) || '').trim().toLowerCase();
  const topicPrimary = toFiniteNumber(row && row.topic_primary_confidence, 0);
  const topicSecondary = toFiniteNumber(row && row.topic_secondary_confidence, 0);
  const quality = toFiniteNumber(row && row.quality_score, 0);

  const intentScore = intent === 'think' ? 40 : 0;
  const topicConfidenceScore = Math.round(20 * Math.max(topicPrimary, topicSecondary, 0));
  const qualityScoreComponent = Math.round(20 * Math.max(quality, 0));
  const lengthScore = scoreLengthBand(row && row.clean_word_count);

  return intentScore + topicConfidenceScore + qualityScoreComponent + lengthScore;
}

function toMillis(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function compareBudgetOrder(a, b) {
  const scoreDiff = toFiniteNumber(b && b.priority_score, 0) - toFiniteNumber(a && a.priority_score, 0);
  if (scoreDiff !== 0) return scoreDiff;

  const aStatus = String((a && a.distill_status) || '').trim().toLowerCase();
  const bStatus = String((b && b.distill_status) || '').trim().toLowerCase();
  if (aStatus !== bStatus) {
    if (aStatus === 'stale') return -1;
    if (bStatus === 'stale') return 1;
  }

  const wordDiff = normalizeWordCount(b && b.clean_word_count) - normalizeWordCount(a && a.clean_word_count);
  if (wordDiff !== 0) return wordDiff;

  const dateDiff = toMillis(a && a.created_at) - toMillis(b && b.created_at);
  if (dateDiff !== 0) return dateDiff;

  const aId = String((a && a.id) || '');
  const bId = String((b && b.id) || '');
  return aId.localeCompare(bId);
}

function selectTier2Budget(scoredRows, maxEntriesPerRun) {
  const rows = Array.isArray(scoredRows) ? scoredRows.slice() : [];
  const max = Math.trunc(toFiniteNumber(maxEntriesPerRun, 0));
  if (max <= 0) return [];
  rows.sort(compareBudgetOrder);
  return rows.slice(0, max);
}

function resolveTier2Route(row, config) {
  const cfg = config && config.distill ? config.distill : {};
  const threshold = Math.trunc(toFiniteNumber(cfg.direct_chunk_threshold_words, 5000));
  const cleanWordCount = normalizeWordCount(row && row.clean_word_count);
  if (cleanWordCount > threshold) {
    return {
      route: 'chunked',
      chunking_strategy: 'structure_paragraph_window_v1',
    };
  }
  return {
    route: 'direct',
    chunking_strategy: 'direct',
  };
}

function buildTier2SelectionPlan(rows, config) {
  const cfg = config && config.distill ? config.distill : {};
  const maxEntriesPerRun = cfg.max_entries_per_run;
  const candidates = Array.isArray(rows) ? rows : [];

  const decisions = candidates.map((row) => {
    const eligibility = evaluateTier2Eligibility(row);
    if (eligibility.decision !== 'proceed') {
      return {
        ...row,
        ...eligibility,
        priority_score: null,
      };
    }
    return {
      ...row,
      decision: 'proceed',
      reason_code: null,
      priority_score: computeTier2PriorityScore(row),
    };
  });

  const proceed = decisions.filter((row) => row.decision === 'proceed');
  const selected = selectTier2Budget(proceed, maxEntriesPerRun).map((row) => ({
    ...row,
    ...resolveTier2Route(row, config),
  }));

  return {
    decisions,
    selected,
  };
}

module.exports = {
  evaluateTier2Eligibility,
  computeTier2PriorityScore,
  selectTier2Budget,
  resolveTier2Route,
  buildTier2SelectionPlan,
};
