'use strict';

const path = require('path');
const {
  resolveRepoPath,
  ensureDir,
  writeJsonFile,
  writeTextFile,
  toFixedPct,
} = require('./io.js');

function takeTop(items, limit) {
  const rows = Array.isArray(items) ? items : [];
  return rows.slice(0, Math.max(0, Number(limit || 10)));
}

function markdownFailureList(rows) {
  if (!rows.length) return '- none';
  return rows.map((row) => `- ${row.case_id}: expected=${row.expected_label} actual=${row.actual_label} run_id=${row.run_id}`).join('\n');
}

function buildRouterMarkdown(report) {
  const summary = report.summary || {};
  const matrix = summary.confusion || {};
  const labels = Array.isArray(matrix.labels) ? matrix.labels : [];
  const rows = labels.map((exp) => {
    const cells = labels.map((got) => String((matrix.matrix?.[exp]?.[got]) || 0));
    return `| ${exp} | ${cells.join(' | ')} |`;
  }).join('\n');
  const header = labels.length ? `| expected \\ actual | ${labels.join(' | ')} |\n|---|${labels.map(() => '---').join('|')}|\n${rows}` : 'No confusion matrix available.';

  const highConfidence = takeTop((summary.failure_groups && summary.failure_groups.high_confidence_errors) || [], 15)
    .map((r) => ({ ...r, expected_label: r.expected_route, actual_label: r.actual_route }));
  const falseCreate = takeTop((summary.failure_groups && summary.failure_groups.false_positive_calendar_create) || [], 15)
    .map((r) => ({ ...r, expected_label: r.expected_route, actual_label: r.actual_route }));
  const badClarify = takeTop((summary.failure_groups && summary.failure_groups.bad_clarification_decision) || [], 15)
    .map((r) => ({ ...r, expected_label: r.expected_route, actual_label: r.actual_route }));

  return [
    `# Family Calendar Router Eval Report (${report.metadata.timestamp})`,
    '',
    `- backend: ${report.metadata.backend_url}`,
    `- total: ${summary.total}`,
    `- passed: ${summary.passed}`,
    `- accuracy: ${toFixedPct(summary.accuracy)}`,
    `- calendar_create precision: ${toFixedPct(summary.precision_calendar_create)}`,
    `- ambiguous recall: ${toFixedPct(summary.ambiguous_recall)}`,
    '',
    '## Confusion Matrix',
    '',
    header,
    '',
    '## Highlight: false-positive `calendar_create`',
    markdownFailureList(falseCreate),
    '',
    '## Highlight: bad clarification decisions',
    markdownFailureList(badClarify),
    '',
    '## Highlight: high-confidence errors',
    markdownFailureList(highConfidence),
    '',
  ].join('\n');
}

function buildCalendarMarkdown(report) {
  const summary = report.summary || {};
  const highConfidence = takeTop((summary.failure_groups && summary.failure_groups.high_confidence_errors) || [], 15)
    .map((r) => ({ ...r, expected_label: r.expected_status, actual_label: r.actual_status }));
  const badClarify = takeTop((summary.failure_groups && summary.failure_groups.bad_clarification_decision) || [], 15)
    .map((r) => ({ ...r, expected_label: r.expected_status, actual_label: r.actual_status }));

  return [
    `# Family Calendar Normalize Eval Report (${report.metadata.timestamp})`,
    '',
    `- backend: ${report.metadata.backend_url}`,
    `- total: ${summary.total}`,
    `- passed: ${summary.passed}`,
    `- accuracy: ${toFixedPct(summary.accuracy)}`,
    `- field extraction: ${toFixedPct(summary.field_extraction)}`,
    `- clarification accuracy: ${toFixedPct(summary.clarification_accuracy)}`,
    `- deterministic correctness: ${toFixedPct(summary.deterministic_correctness)}`,
    '',
    '## Highlight: bad clarification decisions',
    markdownFailureList(badClarify),
    '',
    '## Highlight: high-confidence errors',
    markdownFailureList(highConfidence),
    '',
  ].join('\n');
}

function writeEvalReport(surface, stamp, report, markdown) {
  const dir = resolveRepoPath('evals', 'reports', surface);
  ensureDir(dir);
  const jsonPath = path.join(dir, `${stamp}.json`);
  const mdPath = path.join(dir, `${stamp}.md`);
  writeJsonFile(jsonPath, report);
  writeTextFile(mdPath, markdown);
  return { jsonPath, mdPath };
}

module.exports = {
  buildRouterMarkdown,
  buildCalendarMarkdown,
  writeEvalReport,
};
