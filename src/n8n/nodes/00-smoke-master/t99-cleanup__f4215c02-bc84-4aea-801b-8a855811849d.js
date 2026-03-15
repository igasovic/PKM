'use strict';

const base = { ...$json };
const results = Array.isArray(base.results) ? [...base.results] : [];
const artifacts = { ...(base.artifacts || {}) };
const headers = {
  'X-PKM-Run-Id': String(base.test_run_id || ''),
  'x-pkm-admin-secret': String($env.PKM_ADMIN_SECRET || ''),
};

let deleteResponse = null;
let deleteError = null;
let modeRestored = false;
let modeRestoreError = null;

const idsFromArtifacts = [
  artifacts.telegram_capture_entry_id,
  artifacts.email_capture_entry_id,
];
const idsFromResults = results
  .map((row) => row && row.artifacts && row.artifacts.entry_id)
  .filter((v) => v !== undefined && v !== null && String(v).trim() !== '');

const ids = [...idsFromArtifacts, ...idsFromResults]
  .filter((v) => Number.isFinite(Number(v)) && Number(v) > 0)
  .map((v) => Number(v))
  .filter((v, idx, arr) => arr.indexOf(v) === idx);

if (ids.length > 0) {
  try {
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
  } catch (e) {
    deleteError = { message: String(e && e.message ? e.message : e) };
  }
}

try {
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
  modeRestoreError = { message: String(e && e.message ? e.message : e) };
}

const errorParts = [];
if (deleteError) errorParts.push('pkm_delete: ' + deleteError.message);
if (modeRestoreError) errorParts.push('test_mode_restore: ' + modeRestoreError.message);
const cleanupError = errorParts.length ? { message: errorParts.join(' | ') } : null;

const assertions = [
  { name: 'pkm_cleanup_completed', ok: ids.length === 0 || deleteError == null, deleted_ids: ids },
  { name: 'test_mode_restored', ok: modeRestored === true && modeRestoreError == null },
  { name: 'calendar_cleanup_skipped', ok: true, reason: 'calendar cleanup requires dedicated Google delete workflow' },
];
const ok = assertions.every((a) => a.ok === true);

results.push({
  test_case: 'T99-cleanup',
  ok,
  run_id: base.test_run_id || null,
  artifacts: {
    deleted_ids: ids,
    delete_response: deleteResponse || null,
  },
  assertions,
  error: cleanupError,
});

return [{ json: { ...base, results } }];
