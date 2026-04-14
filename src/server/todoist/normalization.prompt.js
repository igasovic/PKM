'use strict';

const FEW_SHOT_PLACEHOLDER_TOKEN = 'TODO_FILL_FROM_CORPUS_PROMPT_EXAMPLES';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const norm = asText(value).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(norm)) return true;
    if (['0', 'false', 'no', 'off'].includes(norm)) return false;
  }
  return fallback;
}

function buildFewShotExamplesBlock(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const examples = Array.isArray(safe.few_shot_examples) ? safe.few_shot_examples : [];
  if (!examples.length) return FEW_SHOT_PLACEHOLDER_TOKEN;

  return examples
    .map((row, idx) => `${idx + 1}. ${JSON.stringify(row)}`)
    .join('\n');
}

function buildNormalizationSystemPrompt() {
  return [
    'You normalize Todoist tasks into a strict planning schema.',
    'Return JSON only. No markdown, no explanations.',
    'Use English output.',
    'Never invent facts not present in title/description/project/section/lifecycle.',
    'If the examples block contains TODO_FILL_FROM_CORPUS_PROMPT_EXAMPLES, treat it as no examples.',
    'Classification rubric:',
    '- project: true multi-step outcome/workstream; evidence should be strong.',
    '- next_action: clear executable single action; default for short actionable tasks.',
    '- micro_task: very small and concrete action.',
    '- follow_up: action is checking/pinging/waiting on person or external reply.',
    '- vague_note: intent exists but action is not executable yet.',
    '- unknown: genuinely ambiguous even after context.',
    'Project-specific rules:',
    '- do not use project by default for short titles.',
    '- project requires stronger evidence such as subtasks, explicit project marker (for example PRJ:), or clearly multi-step wording.',
    '- for true project items, include one plausible suggested_next_action when strongly supported.',
    'Next action rules:',
    '- suggested_next_action should be null when the task is already directly executable.',
    '- for vague_note or unknown, suggested_next_action should usually be null.',
    'Confidence rubric:',
    '- >=0.85 when classification is clearly supported.',
    '- 0.65-0.84 when plausible but partially ambiguous.',
    '- <=0.60 when weak evidence or ambiguity remains.',
    'Allowed task_shape values: project, next_action, micro_task, follow_up, vague_note, unknown.',
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
    `has_subtasks: ${parseBoolean(safe.has_subtasks, false)}`,
    `explicit_project_signal: ${parseBoolean(safe.explicit_project_signal, false)}`,
    'few_shot_examples:',
    buildFewShotExamplesBlock(safe),
    'Return exactly this JSON shape:',
    '{"normalized_title_en":string,"task_shape":"project|next_action|micro_task|follow_up|vague_note|unknown","suggested_next_action":string|null,"parse_confidence":number}',
  ].join('\n');
}

module.exports = {
  buildNormalizationSystemPrompt,
  buildNormalizationUserPrompt,
  FEW_SHOT_PLACEHOLDER_TOKEN,
};
