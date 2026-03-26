'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function asStringList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const one = asText(value);
  return one ? [one] : [];
}

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const body = ($json && typeof $json.body === 'object' && !Array.isArray($json.body))
    ? $json.body
    : (($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : null);

  if (!body) {
    throw new Error('commit payload must be a JSON object');
  }

  const sessionId = asText(body.session_id);
  if (!sessionId) {
    throw new Error('session_id is required');
  }

  const topicPrimary = asText(body.resolved_topic_primary);
  if (!topicPrimary) {
    throw new Error('resolved_topic_primary is required');
  }

  const payload = {
    ...body,
    session_id: sessionId,
    resolved_topic_primary: topicPrimary,
    resolved_topic_secondary: asText(body.resolved_topic_secondary) || null,
    chat_title: asText(body.chat_title) || null,
    session_summary: asText(body.session_summary) || '',
    context_used: asStringList(body.context_used),
    key_insights: asStringList(body.key_insights),
    decisions: asStringList(body.decisions),
    tensions: asStringList(body.tensions),
    open_questions: asStringList(body.open_questions),
    next_steps: asStringList(body.next_steps),
    working_memory_updates: asStringList(body.working_memory_updates),
    why_it_matters: asStringList(body.why_it_matters),
    gist: asText(body.gist) || null,
    excerpt: asText(body.excerpt) || null,
    source_entry_refs: Array.isArray(body.source_entry_refs) ? body.source_entry_refs : [],
  };

  return [{
    json: {
      ...$json,
      request_payload: payload,
      action: 'chatgpt_wrap_commit',
    },
  }];
};
