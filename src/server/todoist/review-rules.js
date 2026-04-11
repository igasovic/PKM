'use strict';

const {
  RISKY_SHAPES,
  asText,
  parseConfidence,
} = require('./constants.js');

function defaultThresholds(config) {
  const cfg = config && config.todoist && config.todoist.review ? config.todoist.review : {};
  return {
    min_confidence: parseConfidence(cfg.min_confidence, 0.72),
    waiting_min_confidence: parseConfidence(cfg.waiting_min_confidence, 0.82),
  };
}

function computeReviewStatus(input, options = {}) {
  const row = input && typeof input === 'object' ? input : {};
  const thresholds = defaultThresholds(options.config || null);
  const reasons = [];

  const lifecycleStatus = asText(row.lifecycle_status).toLowerCase() || 'open';
  const projectKey = asText(row.project_key).toLowerCase();
  const taskShape = asText(row.task_shape).toLowerCase() || 'unknown';
  const parseConfidence = Number(row.parse_confidence);
  const confidence = Number.isFinite(parseConfidence) ? parseConfidence : 0;
  const hasSuggestedNextAction = !!asText(row.suggested_next_action);
  const parseFailed = row.parse_failed === true;
  const previousReviewStatus = asText(row.previous_review_status).toLowerCase();
  const parseTriggered = row.parse_triggered === true;

  const manualAccepted = previousReviewStatus === 'accepted';
  const manualOverridden = previousReviewStatus === 'overridden';

  // 1. Manual states win if still current.
  if (!parseTriggered && manualAccepted) {
    return { review_status: 'accepted', review_reasons: ['manual_accepted_current'] };
  }
  if (!parseTriggered && manualOverridden) {
    return { review_status: 'overridden', review_reasons: ['manual_override_current'] };
  }

  // 2. Parser fallback failure.
  if (parseFailed) reasons.push('parse_failed');

  // 3. Inbox tasks.
  if (projectKey === 'inbox') reasons.push('inbox_requires_review');

  // 4. Confidence below threshold.
  if (confidence < thresholds.min_confidence) reasons.push('confidence_below_min');

  // 5. Waiting confidence below stricter threshold.
  if (lifecycleStatus === 'waiting' && confidence < thresholds.waiting_min_confidence) {
    reasons.push('waiting_confidence_below_min');
  }

  // 6. Risky shapes.
  if (RISKY_SHAPES.has(taskShape)) reasons.push('risky_task_shape');

  // 7. Waiting + inferred next action.
  if (lifecycleStatus === 'waiting' && hasSuggestedNextAction) reasons.push('waiting_with_inferred_next_action');

  // 8. Reparse after override.
  if (parseTriggered && manualOverridden) reasons.push('override_reparse_requires_review');

  // 9. Otherwise no review needed.
  if (reasons.length === 0) {
    return { review_status: 'no_review_needed', review_reasons: [] };
  }

  return { review_status: 'needs_review', review_reasons: reasons };
}

module.exports = {
  computeReviewStatus,
};
