'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

function request(port, method, routePath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: routePath,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('backend route registry smoke matrix', () => {
  let server = null;
  let port = null;
  let listenDenied = false;
  let envBackup;

  beforeEach(() => {
    jest.resetModules();
    listenDenied = false;
    envBackup = { ...process.env };
    process.env.PKM_ADMIN_SECRET = 'test-admin-secret';

    jest.doMock('../../src/server/normalization.js', () => ({
      decideEmailIntent: async () => ({ content_type: 'message' }),
    }));

    jest.doMock('../../src/server/ingestion-pipeline.js', () => ({
      runTelegramIngestionPipeline: async () => ({ source: 'telegram', normalized: true }),
      runEmailIngestionPipeline: async () => ({ source: 'email', normalized: true }),
      runWebpageIngestionPipeline: async () => ({ source: 'webpage', normalized: true }),
      runNotionIngestionPipeline: async () => ({ source: 'notion', normalized: true }),
    }));

    jest.doMock('../../src/server/tier1-enrichment.js', () => ({
      enrichTier1: async () => ({ topic_primary: 'family', confidence: 0.9 }),
      enqueueTier1Batch: async () => ({ batch_id: 't1_batch_1', status: 'queued', request_count: 1, schema: 'pkm' }),
      getTier1BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier1BatchStatus: async () => null,
      startTier1BatchWorker: () => {},
      stopTier1BatchWorker: () => {},
    }));

    jest.doMock('../../src/server/email-importer.js', () => ({
      importEmailMbox: async () => ({ import_id: 'email_import_1', total_messages: 1, inserted: 1 }),
    }));

    jest.doMock('../../src/server/calendar-service.js', () => ({
      routeTelegramInput: async () => ({ route: 'calendar_create', confidence: 0.95, clarification_question: null }),
      normalizeCalendarRequest: async () => ({
        status: 'ready',
        missing_fields: [],
        clarification_question: null,
        normalized_event: { title: 'Dentist', starts_at: '2026-04-01T15:00:00Z' },
        warning_codes: [],
      }),
      normalizeCalendarRequestWithTrace: async () => ({
        result: {
          status: 'ready',
          missing_fields: [],
          clarification_question: null,
          normalized_event: { title: 'Dentist', starts_at: '2026-04-01T15:00:00Z' },
          warning_codes: [],
        },
        trace: { steps: [] },
      }),
    }));

    jest.doMock('../../src/server/repositories/calendar-repository.js', () => ({
      getCalendarRequestById: async () => null,
      getLatestOpenCalendarRequestByChat: async () => null,
      upsertCalendarRequest: async () => ({ request_id: '11111111-1111-4111-8111-111111111111', clarification_turns: [], raw_text: 'x', status: 'received' }),
      updateCalendarRequestById: async () => ({ request_id: '11111111-1111-4111-8111-111111111111', status: 'normalized' }),
      finalizeCalendarRequestById: async () => ({ request_id: '11111111-1111-4111-8111-111111111111', status: 'calendar_created' }),
      insertCalendarObservations: async () => ({ rows: [{ observation_id: 'obs-1' }], rowCount: 1 }),
    }));

    jest.doMock('../../src/server/repositories/read-write-repository.js', () => ({
      insert: async () => ({ rows: [{ entry_id: 101 }], rowCount: 1 }),
      update: async () => ({ rows: [{ entry_id: 101 }], rowCount: 1 }),
      deleteEntries: async () => ({ rows: [{ deleted_count: 1 }], rowCount: 1 }),
      moveEntries: async () => ({ rows: [{ moved_count: 1 }], rowCount: 1 }),
      readContinue: async () => ({ rows: [{ entry_id: 101 }], rowCount: 1 }),
      readFind: async () => ({ rows: [{ entry_id: 101, title: 'match' }], rowCount: 1 }),
      readLast: async () => ({ rows: [{ entry_id: 101 }], rowCount: 1 }),
      readPull: async () => ({ rows: [{ entry_id: 101, excerpt: 'detail' }], rowCount: 1 }),
      readSmoke: async () => ({ rows: [{ entry_id: 101 }], rowCount: 1 }),
    }));

    jest.doMock('../../src/server/tier2/planner.js', () => ({
      runTier2ControlPlanePlan: async () => ({
        candidate_count: 1,
        decision_counts: { proceed: 1, skipped: 0, not_eligible: 0 },
        persisted_eligibility: { updated: 1, groups: [] },
        selected_count: 1,
        selected: [{ entry_id: 101 }],
      }),
    }));

    jest.doMock('../../src/server/tier2/service.js', () => ({
      distillTier2SingleEntrySync: async () => ({ entry_id: 101, status: 'completed' }),
    }));

    jest.doMock('../../src/server/tier2-enrichment.js', () => ({
      runTier2BatchWorkerCycle: async () => ({
        mode: 'dry_run',
        batch_id: 't2_batch_1',
        target_schema: 'pkm',
        planned_selected_count: 1,
        will_process_count: 1,
        selected: [{ entry_id: 101 }],
      }),
      getTier2BatchStatusList: async () => ({ summary: {}, jobs: [] }),
      getTier2BatchStatus: async () => null,
      startTier2BatchWorker: () => {},
      stopTier2BatchWorker: () => {},
    }));
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    server = null;
    port = null;
    process.env = envBackup;
  });

  async function startServer() {
    const { createServer } = require('../../src/server/index.js');
    server = createServer();
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError);
          resolve();
        });
      });
      port = server.address().port;
    } catch (err) {
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        listenDenied = true;
        return;
      }
      throw err;
    }
  }

  test('registry-defined n8n smoke routes return expected status', async () => {
    const registryPath = path.join(__dirname, '../../docs/backend_route_registry.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const smokeEntries = registry.filter((entry) => entry && entry.smoke && entry.smoke.enabled);

    expect(smokeEntries.length).toBeGreaterThan(0);

    await startServer();
    if (listenDenied) return;

    for (const entry of smokeEntries) {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (entry.auth === 'admin_secret') {
        headers['x-pkm-admin-secret'] = 'test-admin-secret';
      }
      const body = JSON.stringify(entry.smoke.body || {});
      const res = await request(port, entry.method, entry.path, body, headers);
      expect(res.status).toBe(entry.smoke.expected_status);
      expect(() => JSON.parse(res.body)).not.toThrow();
    }
  });
});
