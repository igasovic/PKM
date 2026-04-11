'use strict';

const { LiteLLMClient } = require('../litellm-client.js');
const { hasLiteLLMKey } = require('../runtime-env.js');
const { asText } = require('./constants.js');

let client = null;

function getClient() {
  if (client) return client;
  client = new LiteLLMClient({});
  return client;
}

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

async function generateRationales(kind, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return {};

  if (!hasLiteLLMKey()) {
    const out = {};
    for (const item of list) {
      const id = asText(item && item.todoist_task_id);
      if (!id) continue;
      out[id] = fallbackReason(kind, item);
    }
    return out;
  }

  const prompt = reasonPrompt(kind, list);
  try {
    const response = await getClient().sendMessage(prompt.user, {
      model: 'pkm-default',
      systemPrompt: prompt.system,
      metadata: {
        pipeline: 'todoist_planning',
        stage: `rationale_${kind}`,
      },
    });
    const parsed = parseReasonJson(response && response.text);
    const out = {};
    for (const item of list) {
      const id = asText(item && item.todoist_task_id);
      if (!id) continue;
      out[id] = parsed[id] || fallbackReason(kind, item);
    }
    return out;
  } catch (_err) {
    const out = {};
    for (const item of list) {
      const id = asText(item && item.todoist_task_id);
      if (!id) continue;
      out[id] = fallbackReason(kind, item);
    }
    return out;
  }
}

module.exports = {
  generateRationales,
};
