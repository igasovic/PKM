'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'src', 'n8n', 'workflows');

describe('n8n workflow timezone safety', () => {
  test('all workflows pin settings.timezone to America/Chicago', () => {
    const files = fs.readdirSync(WORKFLOWS_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort();

    const missing = [];
    const wrong = [];

    for (const fileName of files) {
      const filePath = path.join(WORKFLOWS_DIR, fileName);
      const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const tz = workflow.settings && workflow.settings.timezone;
      if (!tz) {
        missing.push(`${fileName} (${workflow.name || 'unknown'})`);
        continue;
      }
      if (tz !== 'America/Chicago') {
        wrong.push(`${fileName} (${workflow.name || 'unknown'}) => ${tz}`);
      }
    }

    expect(missing).toEqual([]);
    expect(wrong).toEqual([]);
  });
});
