'use strict';

const base = { ...$json };
const results = Array.isArray(base.results) ? [...base.results] : [];
const artifacts = { ...(base.artifacts || {}) };
const headers = {
  'X-PKM-Run-Id': String(base.test_run_id || ''),
  'x-pkm-admin-secret': String($env.PKM_ADMIN_SECRET || ''),
};

let deleteResponse = null;
let modeRestored = false;
let cleanupError = null;

try {
  const ids = [artifacts.telegram_capture_entry_id, artifacts.email_capture_entry_id]
    .filter((v) => Number.isFinite(Number(v)) && Number(v) > 0)
    .map((v) => Number(v));

  if (ids.length > 0) {
    deleteResponse = await helpers.httpRequest({
      method: 'POST',
      url: 'http://pkm-server:8080/db/delete',
      headers,
      json: true,
      body: {
        schema: 'pkm_test',
        entry_ids: ids,
        force: true,
      },
    });
  }

  const stateRows = await helpers.httpRequest({
    method: 'GET',
    url: 'http://pkm-server:8080/db/test-mode',
    headers: { 'X-PKM-Run-Id': String(base.test_run_id || '') },
    json: true,
  });
  const current = !!(Array.isArray(stateRows) && stateRows[0] && stateRows[0].is_test_mode === true);
  const prior = base.prior_test_mode === true;
  if (current !== prior) {
    await helpers.httpRequest({
      method: 'POST',
      url: 'http://pkm-server:8080/db/test-mode/toggle',
      headers: { 'X-PKM-Run-Id': String(base.test_run_id || '') },
      json: true,
      body: {},
    });
  }
  modeRestored = true;
} catch (e) {
  cleanupError = { message: String(e && e.message ? e.message : e) };
}

const assertions = [
  { name: 'pkm_cleanup_completed', ok: cleanupError == null },
  { name: 'test_mode_restored', ok: modeRestored === true },
  { name: 'calendar_cleanup_skipped', ok: true, reason: 'calendar cleanup requires dedicated Google delete workflow' },
];
const ok = assertions.every((a) => a.ok === true);

results.push({
  test_case: 'T99-cleanup',
  ok,
  run_id: base.test_run_id || null,
  artifacts: {
    delete_response: deleteResponse || null,
  },
  assertions,
  error: cleanupError,
});

return [{ json: { ...base, results } }];
