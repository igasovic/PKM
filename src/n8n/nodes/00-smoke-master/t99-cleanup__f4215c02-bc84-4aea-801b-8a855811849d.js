'use strict';

const { collectEntryIds } = require('@igasovic/n8n-blocks/nodes/00-smoke-master/smoke-state.js');

module.exports = async function run(ctx) {
  const { $json, $env, helpers } = ctx;
  const base = { ...($json || {}) };
  const results = Array.isArray(base.results) ? [...base.results] : [];
  const artifacts = { ...(base.artifacts || {}) };
  const headers = {
    'X-PKM-Run-Id': String(base.test_run_id || ''),
    'x-pkm-admin-secret': String(($env && $env.PKM_ADMIN_SECRET) || ''),
  };

  let deleteResponse = null;
  let deleteError = null;
  let modeRestored = false;
  let modeRestoreError = null;

  const ids = collectEntryIds(
    artifacts,
    results,
    artifacts.created_entry_ids,
    artifacts.telegram_capture_entry_id,
    artifacts.email_capture_entry_id,
  );

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
  const ok = assertions.every((assertion) => assertion.ok === true);

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

  return [{ json: { ...base, results, artifacts: { ...artifacts, created_entry_ids: ids.length ? ids : (artifacts.created_entry_ids || []) } } }];
};
