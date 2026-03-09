/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Status Message
 * Node ID: 075f1d02-d3af-43dc-a694-f387f757ba3d
 */
'use strict';

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

  const dryRunLine = dryRunWouldProcess > 0
    ? `\n• Would process \\(dry\\_run\\): ${dryRunWouldProcess}`
    : '';
  const preservedLine = preservedCurrentCount > 0
    ? `\n• Preserved current: ${preservedCurrentCount}`
    : '';

  return [{
    json: {
      telegram_message:
`*Batch summary*

*Jobs:* ${summary.jobs}
*In\\_progress:* ${summary.in_progress}
*Terminal:* ${summary.terminal}

*Items*
• Total: ${summary.total_items}
• Processed: ${summary.processed}
• Pending: ${summary.pending}${dryRunLine}

*Results*
✅ OK: ${summary.ok}
⚠️ Parse\\_error: ${summary.parse_error}
❌ Error: ${summary.error}${preservedLine}`,
    },
  }];
};
