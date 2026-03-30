'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function toTextList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => asText(item))
      .filter(Boolean);
  }
  const single = asText(value);
  return single ? [single] : [];
}

function heading(title) {
  return `## ${title}`;
}

function linesWithFallback(lines, fallback) {
  if (lines.length) return lines;
  return [fallback];
}

function bulletLines(items, fallback) {
  return linesWithFallback(
    toTextList(items).map((item) => `- ${item}`),
    `- ${fallback}`,
  );
}

function numberedLines(items, fallback) {
  const list = toTextList(items);
  if (!list.length) return [`1. ${fallback}`];
  return list.map((item, idx) => `${idx + 1}. ${item}`);
}

function renderSessionNoteMarkdown(input) {
  const topicPrimary = asText(input.resolved_topic_primary) || 'unspecified';
  const topicSecondary = asText(input.resolved_topic_secondary);
  const topicSecondaryConfidence = input.topic_secondary_confidence;
  const confidenceText = Number.isFinite(Number(topicSecondaryConfidence))
    ? String(Number(topicSecondaryConfidence))
    : 'n/a';

  const whyItMattersText = toTextList(input.why_it_matters);
  const summary = asText(input.session_summary) || 'No summary provided.';
  const gist = asText(input.gist) || summary;

  const lines = [
    '# Session',
    '',
    heading('Goal'),
    asText(input.chat_title) || `Progress topic: ${topicPrimary}`,
    '',
    heading('Summary'),
    summary,
    '',
    heading('Context used'),
    ...bulletLines(input.context_used, 'No explicit context references.'),
    '',
    heading('Key insights'),
    ...bulletLines(input.key_insights, 'No key insights captured.'),
    '',
    heading('Decisions'),
    ...bulletLines(input.decisions, 'No decisions captured.'),
    '',
    heading('Tensions / uncertainties'),
    ...bulletLines(input.tensions, 'None captured.'),
    '',
    heading('Open questions'),
    ...bulletLines(input.open_questions, 'None captured.'),
    '',
    heading('Next steps'),
    ...numberedLines(input.next_steps, 'No next step captured yet.'),
    '',
    heading('Working-memory updates to consider'),
    ...bulletLines(input.working_memory_updates, 'No working-memory updates captured.'),
    '',
    heading('Meta'),
    '',
    '### Why it matters',
    ...bulletLines(whyItMattersText, 'No why-it-matters rationale captured.'),
    '',
    '### Gist (1 sentence)',
    gist,
    '',
    '### Topic Primary',
    topicPrimary,
    '',
    '### Topic Secondary',
    topicSecondary || 'n/a',
    '',
    '### Topic Secondary confidence',
    confidenceText,
  ];

  return `${lines.join('\n').trim()}\n`;
}

function renderWorkingMemoryMarkdown(input) {
  const topicPrimary = asText(input.resolved_topic_primary) || 'unspecified';
  const whyItMatters = toTextList(input.why_it_matters);

  const lines = [
    `## Topic: ${topicPrimary}`,
    '',
    '**Why this matters (1-2 lines)**',
    ...linesWithFallback(whyItMatters, 'No why-it-matters rationale captured.'),
    '',
    '**Current mental model (5-7 bullets max)**',
    ...bulletLines(input.working_memory_updates, 'No mental model updates captured yet.'),
    '',
    '**Tensions / uncertainties**',
    ...bulletLines(input.tensions, 'None captured.'),
    '',
    '**Open questions**',
    ...bulletLines(input.open_questions, 'None captured.'),
    '',
    '**Next likely step**',
    ...bulletLines(input.next_steps, 'Next step not yet captured.'),
    '',
    '**Last updated**',
    `- ${new Date().toISOString().slice(0, 10)}`,
  ];

  return `${lines.join('\n').trim()}\n`;
}

module.exports = {
  renderSessionNoteMarkdown,
  renderWorkingMemoryMarkdown,
};
