/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Status Message
 * Node ID: 075f1d02-d3af-43dc-a694-f387f757ba3d
 */
'use strict';

const { mdv2, bold, bullet, parens, joinLines, finalizeMarkdownV2 } = require('igasovic-n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const payload = $json || {};
  const summary = payload.summary || {};
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const dryRunWouldProcess = jobs.reduce((total, job) => {
    if (String(job && job.status || '').toLowerCase() !== 'dry_run') {
      return total;
    }
    const metadata = job && typeof job.metadata === 'object' ? job.metadata : {};
    const count = Number(metadata.will_process_count || 0);
    return total + (Number.isFinite(count) ? count : 0);
  }, 0);
  const preservedCurrentCount = jobs.reduce((total, job) => {
    const metadata = job && typeof job.metadata === 'object' ? job.metadata : {};
    const count = Number(metadata.preserved_current_count || 0);
    return total + (Number.isFinite(count) ? count : 0);
  }, 0);
  const failureCounts = {};
  for (const job of jobs) {
    const metadata = job && typeof job.metadata === 'object' ? job.metadata : {};
    const group = metadata && typeof metadata.error_code_counts === 'object' ? metadata.error_code_counts : null;
    if (!group || Array.isArray(group)) continue;
    for (const [code, value] of Object.entries(group)) {
      const count = Number(value || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      const key = String(code || '').trim().toLowerCase() || 'worker_error';
      failureCounts[key] = Number(failureCounts[key] || 0) + count;
    }
  }
  const topFailures = Object.entries(failureCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 3);

  const dryRunLine = dryRunWouldProcess > 0
    ? bullet(`Would process ${parens('dry_run')}: ${dryRunWouldProcess}`, { rawValue: true })
    : null;
  const preservedLine = preservedCurrentCount > 0
    ? bullet(`Preserved current: ${preservedCurrentCount}`)
    : null;
  const failureBreakdownLine = topFailures.length > 0
    ? bullet(`Top failures: ${topFailures.map(([code, count]) => `${mdv2(code)} ${parens(count)}`).join(', ')}`, { rawValue: true })
    : null;

  const lines = [
    bold('Batch summary'),
    '',
    `${bold('Jobs:')} ${summary.jobs}`,
    `${bold('In_progress:')} ${summary.in_progress}`,
    `${bold('Terminal:')} ${summary.terminal}`,
    '',
    bold('Items'),
    bullet(`Total: ${summary.total_items}`),
    bullet(`Processed: ${summary.processed}`),
    bullet(`Pending: ${summary.pending}`),
    dryRunLine,
    '',
    bold('Results'),
    `✅ ${mdv2('OK')}: ${summary.ok}`,
    `⚠️ ${mdv2('Parse_error')}: ${summary.parse_error}`,
    `❌ ${mdv2('Error')}: ${summary.error}`,
    preservedLine,
    failureBreakdownLine,
  ];

  return [{
    json: {
      telegram_message: finalizeMarkdownV2(joinLines(lines, { trimTrailing: true })),
    },
  }];
};
