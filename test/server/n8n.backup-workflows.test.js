'use strict';

const fs = require('fs');
const path = require('path');

function loadWorkflow(fileName) {
  const file = path.join(__dirname, '..', '..', 'src', 'n8n', 'workflows', fileName);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('n8n backup workflows', () => {
  test('WF81 uses expression-based lookup and deletes duplicate historical files', () => {
    const wf81 = loadWorkflow('81-postgres-backup-gdrive__4KyG6iOubMpom5h-kBK-A.json');
    const nodesByName = Object.fromEntries(wf81.nodes.map((node) => [node.name, node]));

    expect(nodesByName['Merge']).toBeUndefined();
    expect(nodesByName['If Daily Exists']).toBeUndefined();
    expect(nodesByName['Build Cleanup Delete List']).toBeDefined();

    const lookup = nodesByName['Lookup Daily Files'];
    const qParam = lookup.parameters.queryParameters.parameters.find((p) => p.name === 'q');
    expect(qParam.value).toContain('String($json.filename');
    expect(qParam.value).not.toContain("{{ $json.filename }}");

    const deleteNode = nodesByName['Delete Daily File'];
    expect(deleteNode.parameters.url).toBe('={{ $json.delete_url }}');

    const cleanupCode = nodesByName['Build Cleanup Delete List'].parameters.jsCode;
    expect(cleanupCode).toContain('files.slice(1)');
    expect(cleanupCode).toContain('delete_url');
  });

  test('WF80 records cloud success status keys after each successful upload cadence', () => {
    const wf80 = loadWorkflow('80-postgres-backup__pZH_qI9CjFoJNs6x7Fh2t.json');
    const nodesByName = Object.fromEntries(wf80.nodes.map((node) => [node.name, node]));

    expect(nodesByName['Normalize Cloud Daily Success'].parameters.jsCode).toContain('pkm_backup_gdrive_daily');
    expect(nodesByName['Normalize Cloud Weekly Success'].parameters.jsCode).toContain('pkm_backup_gdrive_weekly');
    expect(nodesByName['Normalize Cloud Monthly Success'].parameters.jsCode).toContain('pkm_backup_gdrive_monthly');

    const dailyEdge = wf80.connections['Backup GDrive Daily'].main[0][0].node;
    const weeklyEdge = wf80.connections['Backup GDrive - Weekly'].main[0][0].node;
    const monthlyEdge = wf80.connections['Backup GDrive Monthly'].main[0][0].node;
    expect(dailyEdge).toBe('Normalize Cloud Daily Success');
    expect(weeklyEdge).toBe('Normalize Cloud Weekly Success');
    expect(monthlyEdge).toBe('Normalize Cloud Monthly Success');

    const statusSink = wf80.connections['Normalize Cloud Daily Success'].main[0][0].node;
    expect(statusSink).toBe('Execute a command');
  });
});
