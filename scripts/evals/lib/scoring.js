'use strict';

function safeRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function groupBy(list, keyFn) {
  const out = new Map();
  for (const row of list || []) {
    const key = keyFn(row);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

function buildRouteConfusion(results) {
  const labels = ['pkm_capture', 'calendar_create', 'calendar_query', 'recipe_search', 'ambiguous'];
  const matrix = {};
  for (const exp of labels) {
    matrix[exp] = {};
    for (const got of labels) matrix[exp][got] = 0;
  }
  for (const row of results || []) {
    const exp = row.expected_route;
    const got = row.actual_route;
    if (!matrix[exp]) matrix[exp] = {};
    if (!Number.isFinite(matrix[exp][got])) matrix[exp][got] = 0;
    matrix[exp][got] += 1;
  }
  return { labels, matrix };
}

function scoreRouterResults(results) {
  const rows = Array.isArray(results) ? results : [];
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;

  const tpCreate = rows.filter((r) => r.expected_route === 'calendar_create' && r.actual_route === 'calendar_create').length;
  const fpCreate = rows.filter((r) => r.expected_route !== 'calendar_create' && r.actual_route === 'calendar_create').length;
  const ambiguousExpected = rows.filter((r) => r.expected_route === 'ambiguous').length;
  const ambiguousMatched = rows.filter((r) => r.expected_route === 'ambiguous' && r.actual_route === 'ambiguous').length;

  const confusion = buildRouteConfusion(rows);

  const failureGroups = {
    false_positive_calendar_create: rows.filter((r) => r.expected_route !== 'calendar_create' && r.actual_route === 'calendar_create'),
    bad_clarification_decision: rows.filter((r) => {
      const expectedAmb = r.expected_route === 'ambiguous';
      const actualAmb = r.actual_route === 'ambiguous';
      return expectedAmb !== actualAmb;
    }),
    high_confidence_errors: rows.filter((r) => !r.pass && Number(r.confidence || 0) >= 0.9),
    missing_observability: rows.filter((r) => r.observability_ok === false),
  };

  const byBucket = groupBy(rows, (r) => r.bucket || 'unknown');
  const bucketSummary = Array.from(byBucket.entries()).map(([bucket, bucketRows]) => ({
    bucket,
    total: bucketRows.length,
    passed: bucketRows.filter((r) => r.pass).length,
    accuracy: safeRate(bucketRows.filter((r) => r.pass).length, bucketRows.length),
  }));

  return {
    total,
    passed,
    failed: total - passed,
    accuracy: safeRate(passed, total),
    precision_calendar_create: safeRate(tpCreate, tpCreate + fpCreate),
    ambiguous_recall: safeRate(ambiguousMatched, ambiguousExpected),
    confusion,
    failure_groups: failureGroups,
    bucket_summary: bucketSummary,
  };
}

function assertMissingFieldsIncludes(actual, expectedIncludes) {
  if (!Array.isArray(expectedIncludes) || !expectedIncludes.length) return true;
  if (!Array.isArray(actual)) return false;
  return expectedIncludes.every((field) => actual.includes(field));
}

function scoreNormalizeResults(results) {
  const rows = Array.isArray(results) ? results : [];
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;

  const clarifyRows = rows.filter((r) => r.bucket === 'clarification');

  const fieldAssertions = rows.reduce((acc, row) => acc + Number(row.assertions_total || 0), 0);
  const fieldAssertionsPassed = rows.reduce((acc, row) => acc + Number(row.assertions_passed || 0), 0);

  const clarificationCorrect = clarifyRows.filter((r) => {
    const expectedMissing = r.expect && Array.isArray(r.expect.missing_fields_includes)
      ? r.expect.missing_fields_includes
      : [];
    return (
      r.actual_status === 'needs_clarification'
      && assertMissingFieldsIncludes(r.actual_missing_fields, expectedMissing)
    );
  }).length;

  const rejectionRows = rows.filter((r) => r.bucket === 'rejection_edge');
  const deterministicCorrect = rejectionRows.filter((r) => r.pass).length;

  const failureGroups = {
    bad_clarification_decision: rows.filter((r) => {
      const expNeeds = r.expected_status === 'needs_clarification';
      const gotNeeds = r.actual_status === 'needs_clarification';
      return expNeeds !== gotNeeds;
    }),
    high_confidence_errors: rows.filter((r) => {
      const conf = Number(r.llm_confidence || 0);
      return !r.pass && conf >= 0.8;
    }),
    missing_observability: rows.filter((r) => r.observability_ok === false),
  };

  const byBucket = groupBy(rows, (r) => r.bucket || 'unknown');
  const bucketSummary = Array.from(byBucket.entries()).map(([bucket, bucketRows]) => ({
    bucket,
    total: bucketRows.length,
    passed: bucketRows.filter((r) => r.pass).length,
    accuracy: safeRate(bucketRows.filter((r) => r.pass).length, bucketRows.length),
  }));

  return {
    total,
    passed,
    failed: total - passed,
    accuracy: safeRate(passed, total),
    field_extraction: safeRate(fieldAssertionsPassed, fieldAssertions),
    clarification_accuracy: safeRate(clarificationCorrect, clarifyRows.length),
    deterministic_correctness: safeRate(deterministicCorrect, rejectionRows.length),
    failure_groups: failureGroups,
    bucket_summary: bucketSummary,
  };
}

module.exports = {
  scoreRouterResults,
  scoreNormalizeResults,
};
