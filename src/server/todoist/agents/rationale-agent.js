'use strict';

const { asText } = require('../constants.js');
const { runTodoistLlmAgent } = require('./runner.js');

const RATIONALE_AGENT_ID = 'todoist.rationale_shortlist';
const RATIONALE_AGENT_VERSION = 'v1';

function parseReasonJson(rawText) {
  const text = asText(rawText);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed && parsed.reasons) ? parsed.reasons : [];
    const out = {};
    for (const row of rows) {
      const id = asText(row && row.todoist_task_id);
      const reason = asText(row && (row.reason || row.why_now || row.why_nudge || row.why_recommended));
      if (!id || !reason) continue;
      out[id] = reason;
    }
    return out;
  } catch (_err) {
    return {};
  }
}

function fallbackReason(kind, item) {
  const title = asText(item && (item.normalized_title_en || item.raw_title)) || 'Task';
  if (kind === 'daily') {
    return `${title}: selected for focus based on due pressure, priority, and current state.`;
  }
  if (kind === 'waiting') {
    return `${title}: waiting age and follow-up impact suggest nudging now.`;
  }
  return `${title}: recommendation is based on stale/overdue signals and current task shape.`;
}

function reasonPrompt(kind, items) {
  const field = kind === 'daily' ? 'why_now' : (kind === 'waiting' ? 'why_nudge' : 'why_recommended');
  const label = kind === 'daily'
    ? 'Daily focus shortlist'
    : (kind === 'waiting' ? 'Waiting radar shortlist' : 'Weekly pruning shortlist');

  return {
    system: [
      'You generate short rationale text for already-selected Todoist planning items.',
      'Do not re-rank or add/remove items.',
      'Use concise English. One sentence each.',
      'Return JSON only.',
      'Format: {"reasons":[{"todoist_task_id":"...","reason":"..."}]}.',
    ].join('\n'),
    user: [
      `${label} (deterministic selection already done):`,
      JSON.stringify(items.map((item) => ({
        todoist_task_id: item.todoist_task_id,
        project_key: item.project_key,
        lifecycle_status: item.lifecycle_status,
        normalized_title_en: item.normalized_title_en || item.raw_title,
        task_shape: item.task_shape,
        due_date: item.todoist_due_date,
        priority: item.todoist_priority,
      })), null, 2),
      `Return JSON with reasons for each id. Use the reason key only (the caller maps to ${field}).`,
    ].join('\n'),
  };
}

function resolveReasons(kind, items, parsed) {
  const out = {};
  for (const item of items) {
    const id = asText(item && item.todoist_task_id);
    if (!id) continue;
    out[id] = asText(parsed && parsed[id]) || fallbackReason(kind, item);
  }
  return out;
}

async function runRationaleAgent(kind, items, options = {}) {
  const shortlist = Array.isArray(items) ? items : [];
  if (!shortlist.length) {
    return {
      result: {},
      trace: {
        agent_id: RATIONALE_AGENT_ID,
        agent_version: RATIONALE_AGENT_VERSION,
        llm_used: false,
        llm_reason: 'empty_shortlist',
        llm_model: asText(options.model) || 'pkm-default',
        llm_error: null,
        parse_status: 'skipped',
        shortlist_count: 0,
        rationale_kind: asText(kind) || 'unknown',
      },
    };
  }

  const run = await runTodoistLlmAgent({
    agent_id: RATIONALE_AGENT_ID,
    version: RATIONALE_AGENT_VERSION,
    stage: `rationale_${asText(kind) || 'unknown'}`,
    model: 'pkm-default',
    build_prompt: (ctx) => reasonPrompt(ctx.kind, ctx.items),
    parse_response: (responseText) => parseReasonJson(responseText),
    fallback: () => ({}),
  }, { kind, items: shortlist }, options);

  return {
    result: resolveReasons(kind, shortlist, run && run.output ? run.output : {}),
    trace: {
      ...(run && run.trace ? run.trace : {}),
      shortlist_count: shortlist.length,
      rationale_kind: asText(kind) || 'unknown',
    },
  };
}

module.exports = {
  RATIONALE_AGENT_ID,
  RATIONALE_AGENT_VERSION,
  runRationaleAgent,
};
