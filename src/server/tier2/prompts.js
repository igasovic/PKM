'use strict';

const STANCE_LIST = [
  'descriptive',
  'analytical',
  'argumentative',
  'speculative',
  'instructional',
  'narrative',
  'other',
];

function toText(value) {
  return String(value == null ? '' : value).trim();
}

function buildSourceEnvelope(entry) {
  const title = toText(entry && entry.title) || null;
  const author = toText(entry && entry.author) || null;
  const cleanText = toText(entry && entry.clean_text);
  return {
    title,
    author,
    clean_text: cleanText,
  };
}

function buildDirectDistillPrompt(entry) {
  const source = buildSourceEnvelope(entry);
  const systemPrompt = [
    'You are a careful distillation assistant.',
    'Return JSON only, no markdown, no prose before or after JSON.',
    'Output schema:',
    '{',
    '  "distill_summary": string,',
    '  "distill_excerpt": string | null,',
    '  "distill_why_it_matters": string,',
    `  "distill_stance": one of [${STANCE_LIST.join(', ')}]`,
    '}',
    'Rules:',
    '- Do not invent facts.',
    '- Cover the full source, not only opening lines.',
    '- distill_excerpt is optional and must be a contiguous source passage when present.',
  ].join('\n');

  const userPrompt = JSON.stringify({
    task: 'Distill the source into the required schema.',
    source,
  });

  return {
    request_type: 'direct_generation',
    systemPrompt,
    userPrompt,
  };
}

function buildChunkNotePrompt(opts) {
  const options = opts || {};
  const systemPrompt = [
    'You are a chunk-level note generator for distillation.',
    'Return JSON only, no markdown, no prose before or after JSON.',
    'Output schema:',
    '{',
    '  "chunk_main_point": string,',
    '  "chunk_supporting_points": string[],',
    '  "chunk_excerpt_candidate": string | null,',
    `  "chunk_stance_hint": one of [${STANCE_LIST.join(', ')}] | null`,
    '}',
    'Rules:',
    '- Summarize only the provided chunk.',
    '- chunk_excerpt_candidate is optional but must be contiguous source text when present.',
  ].join('\n');

  const userPrompt = JSON.stringify({
    task: 'Produce a chunk note in the required schema.',
    chunk_index: options.chunk_index,
    chunk_count: options.chunk_count,
    title: options.title || null,
    author: options.author || null,
    chunk_text: options.chunk_text || '',
  });

  return {
    request_type: 'chunk_note_generation',
    systemPrompt,
    userPrompt,
  };
}

function buildFinalSynthesisPrompt(opts) {
  const options = opts || {};
  const systemPrompt = [
    'You are a synthesis assistant over chunk notes.',
    'Return JSON only, no markdown, no prose before or after JSON.',
    'Output schema:',
    '{',
    '  "distill_summary": string,',
    '  "distill_excerpt": string | null,',
    '  "distill_why_it_matters": string,',
    `  "distill_stance": one of [${STANCE_LIST.join(', ')}]`,
    '}',
    'Rules:',
    '- Synthesize across all chunk notes.',
    '- Choose distill_excerpt from chunk_excerpt_candidate when useful; otherwise null.',
  ].join('\n');

  const userPrompt = JSON.stringify({
    task: 'Synthesize chunk notes into final distillation schema.',
    title: options.title || null,
    author: options.author || null,
    chunk_notes: Array.isArray(options.chunk_notes) ? options.chunk_notes : [],
  });

  return {
    request_type: 'final_synthesis',
    systemPrompt,
    userPrompt,
  };
}

module.exports = {
  buildDirectDistillPrompt,
  buildChunkNotePrompt,
  buildFinalSynthesisPrompt,
};
