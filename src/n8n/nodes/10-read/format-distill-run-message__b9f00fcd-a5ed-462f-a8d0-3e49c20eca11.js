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
  const mdv2 = (v) =>
    String(v ?? '')
      .replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

  const lines = [];
  const results = Array.isArray(r.results) ? r.results : [];
  const preservedCurrentCount = results.filter((row) => row && row.preserved_current_artifact === true).length;
  if (r.skipped === true && String(r.reason || '').toLowerCase() === 'worker_busy') {
    lines.push('*Tier\\_2 run skipped*');
    lines.push('');
    lines.push('• Reason: worker\\_busy');
    lines.push(`• Message: ${mdv2(r.message || 'Tier-2 batch worker is busy. Try again shortly.')}`);
    return [{
      json: {
        ...r,
        telegram_message: lines.join('\n'),
      },
    }];
  }

  if (r.error) {
    lines.push('*Tier\\_2 run failed*');
    lines.push('');
    if (r.batch_id) {
      lines.push(`• Batch\\_id: ${mdv2(r.batch_id)}`);
    }
    lines.push(`• Error: ${mdv2(r.error)}`);
    return [{
      json: {
        ...r,
        telegram_message: lines.join('\n'),
      },
    }];
  }

  lines.push(`*Tier\\_2 run ${mode === 'dry_run' ? '\\(dry\\ run\\)' : ''}*`);
  if (r.batch_id) {
    lines.push(`*Batch\\_id:* ${mdv2(r.batch_id)}`);
  }
  lines.push('');
  lines.push(`*Candidates:* ${r.candidate_count ?? 0}`);
  lines.push(`*Planned:* ${r.planned_selected_count ?? 0}`);
  if (mode === 'dry_run') {
    lines.push(`*Would process:* ${r.will_process_count ?? 0}`);
  } else {
    lines.push(`*Processed:* ${r.processed_count ?? 0}`);
    lines.push(`Completed: ${r.completed_count ?? 0}`);
    lines.push(`Failed: ${r.failed_count ?? 0}`);
    if (preservedCurrentCount > 0) {
      lines.push(`Preserved current: ${preservedCurrentCount}`);
    }
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
