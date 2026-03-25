'use strict';

const TOOL_DEFINITIONS = [
  {
    name: 'pkm.last',
    description: 'Retrieve recent relevant PKM rows for a vague remembered idea.',
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string' },
        days: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pkm.find',
    description: 'Find a specific detail or phrase in PKM rows.',
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string' },
        days: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pkm.continue',
    description: 'Continue an active topic thread with relevant prior rows.',
    inputSchema: {
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string' },
        days: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pkm.pull',
    description: 'Pull deterministic source context for one entry id.',
    inputSchema: {
      type: 'object',
      required: ['entry_id'],
      properties: {
        entry_id: { type: 'integer', minimum: 1 },
        shortN: { type: 'integer', minimum: 50 },
        longN: { type: 'integer', minimum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pkm.pull_working_memory',
    description: 'Pull canonical working memory markdown by resolved topic.',
    inputSchema: {
      type: 'object',
      required: ['topic'],
      properties: {
        topic: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pkm.wrap_commit',
    description: 'Persist one session note and one working-memory artifact in one MCP write flow.',
    inputSchema: {
      type: 'object',
      required: ['session_id', 'resolved_topic_primary'],
      properties: {
        session_id: { type: 'string' },
        resolved_topic_primary: { type: 'string' },
        resolved_topic_secondary: { type: 'string' },
        topic_secondary_confidence: { type: 'number' },
        chat_title: { type: 'string' },
        session_summary: { type: 'string' },
        context_used: { type: 'array', items: { type: 'string' } },
        key_insights: { type: 'array', items: { type: 'string' } },
        decisions: { type: 'array', items: { type: 'string' } },
        tensions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        next_steps: { type: 'array', items: { type: 'string' } },
        working_memory_updates: { type: 'array', items: { type: 'string' } },
        why_it_matters: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        gist: { type: 'string' },
        excerpt: { type: 'string' },
        source_entry_refs: { type: 'array', items: { type: 'integer', minimum: 1 } },
      },
      additionalProperties: true,
    },
  },
];

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

function listTools() {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

module.exports = {
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  listTools,
};
