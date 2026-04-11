'use strict';

function buildNormalizationSystemPrompt() {
  return [
    'You normalize Todoist tasks into a strict planning schema.',
    'Return JSON only. No markdown, no explanations.',
    'Use English output.',
    'Be conservative: unknown is better than over-confident guesses.',
    'Never invent facts not present in title/description/project/section/lifecycle.',
    'Allowed task_shape values: project, next_action, micro_task, follow_up, vague_note, unknown.',
    'suggested_next_action should be null when unclear.',
    'parse_confidence must be a number between 0 and 1.',
  ].join('\n');
}

function buildNormalizationUserPrompt(input) {
  const safe = input && typeof input === 'object' ? input : {};
  return [
    'Normalize this Todoist task:',
    `raw_title: ${JSON.stringify(safe.raw_title || '')}`,
    `raw_description: ${JSON.stringify(safe.raw_description || '')}`,
    `project_key: ${JSON.stringify(safe.project_key || '')}`,
    `todoist_section_name: ${JSON.stringify(safe.todoist_section_name || '')}`,
    `lifecycle_status: ${JSON.stringify(safe.lifecycle_status || '')}`,
    'Return exactly this JSON shape:',
    '{"normalized_title_en":string,"task_shape":"project|next_action|micro_task|follow_up|vague_note|unknown","suggested_next_action":string|null,"parse_confidence":number}',
  ].join('\n');
}

module.exports = {
  buildNormalizationSystemPrompt,
  buildNormalizationUserPrompt,
};
