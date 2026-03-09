/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Distill Run Message
 * Node ID: b9f00fcd-a5ed-462f-a8d0-3e49c20eca11
 */
'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const r = $json || {};
  const mode = String(r.mode || 'run').toLowerCase();
  const d = r.decision_counts || {};

  const lines = [];
  lines.push(`*Tier\\_2 run ${mode === 'dry_run' ? '\\(dry\\ run\\)' : ''}*`);
  lines.push('');
  lines.push(`*Candidates:* ${r.candidate_count ?? 0}`);
  lines.push(`*Planned:* ${r.planned_selected_count ?? 0}`);
  if (mode === 'dry_run') {
    lines.push(`*Would process:* ${r.will_process_count ?? 0}`);
  } else {
    lines.push(`*Processed:* ${r.processed_count ?? 0}`);
    lines.push(`Completed: ${r.completed_count ?? 0}`);
    lines.push(`Failed: ${r.failed_count ?? 0}`);
  }
  lines.push('');
  lines.push('*Decisions*');
  lines.push(`• Proceed: ${d.proceed ?? 0}`);
  lines.push(`• Skipped: ${d.skipped ?? 0}`);
  lines.push(`• Not\\_eligible: ${d.not_eligible ?? 0}`);

  return [{
    json: {
      ...r,
      telegram_message: lines.join('\n'),
    },
  }];
};
