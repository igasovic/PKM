/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: Read (read)
 * Node: Format Distill Run Message
 * Node ID: b9f00fcd-a5ed-462f-a8d0-3e49c20eca11
 */
'use strict';

const { mdv2, bold, bullet, parens, joinLines, finalizeMarkdownV2 } = (() => {
  try {
    return require('/data/src/libs/telegram-markdown.js');
  } catch (err) {
    return require('../../../libs/telegram-markdown.js');
  }
})();

module.exports = async function run(ctx) {
  const { $json } = ctx;

  const r = $json || {};
  const mode = String(r.mode || 'run').toLowerCase();
  const d = r.decision_counts || {};
  const lines = [];
  const results = Array.isArray(r.results) ? r.results : [];
  const executionMode = String(r.execution_mode || 'batch').toLowerCase() === 'sync' ? 'sync' : 'batch';
  const preservedCurrentCountFromResults = results.filter((row) => row && row.preserved_current_artifact === true).length;
  const preservedCurrentCountRaw = Number(r.preserved_current_count);
  const preservedCurrentCount = Number.isFinite(preservedCurrentCountRaw)
    ? preservedCurrentCountRaw
    : preservedCurrentCountFromResults;
  const errorCodeCounts = (() => {
    if (r && r.error_code_counts && typeof r.error_code_counts === 'object' && !Array.isArray(r.error_code_counts)) {
      return r.error_code_counts;
    }
    const out = {};
    for (const row of results) {
      if (!row || row.status === 'completed') continue;
      const code = String(row.error_code || row.status || 'worker_error').trim().toLowerCase() || 'worker_error';
      out[code] = Number(out[code] || 0) + 1;
    }
    return out;
  })();
  const topFailureCodes = Object.entries(errorCodeCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 3);
  if (r.skipped === true && String(r.reason || '').toLowerCase() === 'worker_busy') {
    lines.push(bold('Tier_2 run skipped'));
    lines.push('');
    lines.push(bullet(`Reason: ${mdv2('worker_busy')}`, { rawValue: true }));
    lines.push(bullet(`Message: ${mdv2(r.message || 'Tier-2 batch worker is busy. Try again shortly.')}`, { rawValue: true }));
    return [{
      json: {
        ...r,
        telegram_message: finalizeMarkdownV2(joinLines(lines, { trimTrailing: true })),
      },
    }];
  }

  if (r.error) {
    lines.push(bold('Tier_2 run failed'));
    lines.push('');
    if (r.batch_id) {
      lines.push(bullet(`${mdv2('Batch_id')}: ${mdv2(r.batch_id)}`, { rawValue: true }));
    }
    lines.push(bullet(`Error: ${mdv2(r.error)}`, { rawValue: true }));
    return [{
      json: {
        ...r,
        telegram_message: finalizeMarkdownV2(joinLines(lines, { trimTrailing: true })),
      },
    }];
  }

  lines.push(mode === 'dry_run'
    ? `${bold('Tier_2 run')} ${parens('dry run')}`
    : `${bold('Tier_2 run')} `);
  if (r.batch_id) {
    lines.push(`${bold('Batch_id:')} ${mdv2(r.batch_id)}`);
  }
  lines.push(`${bold('Execution:')} ${mdv2(executionMode)}`);
  lines.push('');
  lines.push(`${bold('Candidates:')} ${r.candidate_count ?? 0}`);
  lines.push(`${bold('Planned:')} ${r.planned_selected_count ?? 0}`);
  if (mode === 'dry_run') {
    lines.push(`${bold('Would process:')} ${r.will_process_count ?? 0}`);
  } else {
    lines.push(`${bold('Processed:')} ${r.processed_count ?? 0}`);
    lines.push(`Completed: ${r.completed_count ?? 0}`);
    lines.push(`Failed: ${r.failed_count ?? 0}`);
    if (preservedCurrentCount > 0) {
      lines.push(`Preserved current: ${preservedCurrentCount}`);
    }
    if (topFailureCodes.length > 0) {
      lines.push(`Top failures: ${topFailureCodes.map(([code, count]) => `${mdv2(code)} ${parens(Number(count || 0))}`).join(', ')}`);
    }
  }
  lines.push('');
  lines.push(bold('Decisions'));
  lines.push(bullet(`Proceed: ${d.proceed ?? 0}`));
  lines.push(bullet(`Skipped: ${d.skipped ?? 0}`));
  lines.push(bullet(`Not_eligible: ${d.not_eligible ?? 0}`));

  return [{
    json: {
      ...r,
      telegram_message: finalizeMarkdownV2(joinLines(lines, { trimTrailing: true })),
    },
  }];
};
