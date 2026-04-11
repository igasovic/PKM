'use strict';

const fs = require('fs');
const path = require('path');
const { requireExternalizedNode } = require('./n8n-node-loader');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'src', 'n8n', 'workflows');

function findWorkflowFile(prefix) {
  const match = fs.readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
  if (match.length !== 1) {
    throw new Error(`expected one workflow file for ${prefix}, found ${match.length}`);
  }
  return match[0];
}

function loadWorkflow(prefix) {
  const fileName = findWorkflowFile(prefix);
  const filePath = path.join(WORKFLOWS_DIR, fileName);
  const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { fileName, workflow };
}

describe('n8n todoist workflows', () => {
  const buildSyncRequest = requireExternalizedNode('34-todoist-sync', 'build-sync-request');
  const buildDailyBriefRequest = requireExternalizedNode('35-todoist-daily-focus', 'build-daily-brief-request');
  const formatDailyFocusMessage = requireExternalizedNode('35-todoist-daily-focus', 'format-daily-focus-message');
  const buildWaitingBriefRequest = requireExternalizedNode('36-todoist-waiting-radar', 'build-waiting-brief-request');
  const formatWaitingRadarMessage = requireExternalizedNode('36-todoist-waiting-radar', 'format-waiting-radar-message');
  const buildWeeklyBriefRequest = requireExternalizedNode('37-todoist-weekly-pruning', 'build-weekly-brief-request');
  const formatWeeklyPruningMessage = requireExternalizedNode('37-todoist-weekly-pruning', 'format-weekly-pruning-message');

  test('workflow block 34-37 exists and follows contiguous naming', () => {
    const wf34 = loadWorkflow('34-todoist-sync__').workflow;
    const wf35 = loadWorkflow('35-todoist-daily-focus__').workflow;
    const wf36 = loadWorkflow('36-todoist-waiting-radar__').workflow;
    const wf37 = loadWorkflow('37-todoist-weekly-pruning__').workflow;

    expect(wf34.name).toBe('34 Todoist Sync');
    expect(wf35.name).toBe('35 Todoist Daily Focus');
    expect(wf36.name).toBe('36 Todoist Waiting Radar');
    expect(wf37.name).toBe('37 Todoist Weekly Pruning');
  });

  test('wf34 build-sync-request filters projects and resolves waiting lifecycle', async () => {
    const out = await buildSyncRequest({
      $json: {},
      $input: {
        all: () => [{
          json: [
            {
              id: 'task-1',
              project_id: 'proj-work',
              section_id: 'sec-wait',
              content: 'Follow up with Alex',
              description: 'about invoice',
              priority: 4,
              due: { date: '2026-04-11', string: 'today', is_recurring: false },
              added_at: '2026-04-10T00:00:00.000Z',
            },
            {
              id: 'task-2',
              project_id: 'proj-ignored',
              section_id: null,
              content: 'Ignore me',
            },
          ],
        }],
      },
      $items: (name) => {
        if (name === 'Fetch Todoist Projects') {
          return [{
            json: [
              { id: 'proj-work', name: 'work' },
              { id: 'proj-ignored', name: 'Side Project' },
            ],
          }];
        }
        if (name === 'Fetch Todoist Sections') {
          return [{
            json: [
              { id: 'sec-wait', project_id: 'proj-work', name: 'Waiting' },
            ],
          }];
        }
        return [];
      },
    });

    const row = out[0].json;
    expect(Array.isArray(row.tasks)).toBe(true);
    expect(row.tasks).toHaveLength(1);
    expect(row.tasks[0]).toEqual(expect.objectContaining({
      todoist_task_id: 'task-1',
      project_key: 'work',
      todoist_section_name: 'Waiting',
      todoist_priority: 4,
    }));
    expect(row.sync_meta).toEqual(expect.objectContaining({
      fetched_task_count: 2,
      filtered_task_count: 1,
    }));
  });

  test('wf35/36/37 request builders preserve chat fallback and formatters build telegram text', async () => {
    const ctxBase = {
      $json: {
        message: {
          chat: { id: 1509032341 },
        },
      },
      $env: {
        TELEGRAM_ADMIN_CHAT_ID: '1509032341',
      },
    };

    const dailyReq = await buildDailyBriefRequest(ctxBase);
    expect(dailyReq[0].json.telegram_chat_id).toBe('1509032341');

    const waitingReq = await buildWaitingBriefRequest(ctxBase);
    expect(waitingReq[0].json.telegram_chat_id).toBe('1509032341');

    const weeklyReq = await buildWeeklyBriefRequest(ctxBase);
    expect(weeklyReq[0].json.telegram_chat_id).toBe('1509032341');

    const dailyMsg = await formatDailyFocusMessage({
      $json: {
        top_3: [{ normalized_title_en: 'Task A' }],
        overdue_now: [],
        waiting_nudges: [],
      },
    });
    expect(dailyMsg[0].json.telegram_message).toContain('Todoist Daily Focus');

    const waitingMsg = await formatWaitingRadarMessage({
      $json: {
        nudges: [{ normalized_title_en: 'Ping Alex' }],
      },
    });
    expect(waitingMsg[0].json.telegram_message).toContain('Todoist Waiting Radar');

    const weeklyMsg = await formatWeeklyPruningMessage({
      $json: {
        suggestions: [{ recommendation_type: 'defer', normalized_title_en: 'Maybe later' }],
      },
    });
    expect(weeklyMsg[0].json.telegram_message).toContain('Todoist Weekly Pruning');
    expect(weeklyMsg[0].json.telegram_message).toContain('defer');
  });

  test('10 Read /waiting route points to 36 Todoist Waiting Radar workflow', () => {
    const wf10 = loadWorkflow('10-read__').workflow;
    const wf36FileName = findWorkflowFile('36-todoist-waiting-radar__');
    const wf36Id = wf36FileName.replace(/^36-todoist-waiting-radar__/, '').replace(/\.json$/, '');

    const switchNode = wf10.nodes.find((node) => node.name === 'Switch');
    expect(switchNode).toBeDefined();

    const rules = switchNode.parameters.rules.values;
    expect(rules.some((rule) => rule.outputKey === 'waiting')).toBe(true);

    const waitingNode = wf10.nodes.find((node) => node.name === 'Run Todoist Waiting Radar');
    expect(waitingNode).toBeDefined();
    expect(waitingNode.type).toBe('n8n-nodes-base.executeWorkflow');
    expect(waitingNode.parameters.workflowId.value).toBe(wf36Id);

    const switchEdges = (wf10.connections.Switch && wf10.connections.Switch.main) || [];
    const hasWaitingEdge = switchEdges.some((branch) => Array.isArray(branch)
      && branch.some((edge) => edge && edge.node === 'Run Todoist Waiting Radar'));
    expect(hasWaitingEdge).toBe(true);
  });

  test('37 weekly workflow schedule is Sunday 18:30 America/Chicago', () => {
    const wf37 = loadWorkflow('37-todoist-weekly-pruning__').workflow;
    expect(wf37.settings.timezone).toBe('America/Chicago');

    const scheduleNode = wf37.nodes.find((node) => node.name === 'Schedule Weekly Pruning');
    expect(scheduleNode).toBeDefined();

    const interval = scheduleNode.parameters.rule.interval[0];
    expect(interval.field).toBe('weeks');
    expect(interval.triggerAtHour).toBe(18);
    expect(interval.triggerAtMinute).toBe(30);
    expect(Array.isArray(interval.triggerAtDay)).toBe(true);
    expect(interval.triggerAtDay).toContain(0);
  });
});
