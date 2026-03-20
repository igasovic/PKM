'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const smokeMode = $json.smoke_mode === true;
  if (!smokeMode) {
    return [{ json: { ...$json } }];
  }

  const assertions = [];
  const cmd = String($json.cmd || '').trim();
  assertions.push({ name: 'command_present', ok: !!cmd, command: cmd || null });
  const msg = String($json.telegram_message || '');
  assertions.push({ name: 'telegram_message_non_empty', ok: msg.length > 0 });
  const telegramMessageId = $json.message_id ?? ($json.result && $json.result.message_id) ?? null;
  if (telegramMessageId != null) assertions.push({ name: 'telegram_message_id_present', ok: true });

  if (cmd === 'pull') {
    assertions.push({ name: 'pull_entry_present', ok: !!($json.entry_id || ($json.rows && $json.rows.length)) });
  }
  if (cmd === 'continue') {
    const count = Number($json.count_hits || $json.rows_count || 0);
    assertions.push({ name: 'continue_rows_available', ok: count >= 0, count });
  }
  if (cmd === 'distill') {
    const status = String($json.status || '').toLowerCase();
    assertions.push({ name: 'distill_status_present', ok: status.length > 0, status });
  }
  if (cmd === 'delete') {
    const deleted = Number($json.deleted_count ?? 0);
    assertions.push({ name: 'delete_response_present', ok: Number.isFinite(deleted), deleted_count: deleted });
  }

  const ok = assertions.every((assertion) => assertion.ok === true);
  return [{
    json: {
      ...$json,
      test_case: 'read_command',
      ok,
      run_id: $json.test_run_id || null,
      artifacts: {
        command: cmd,
        telegram_message: msg || null,
        telegram_message_id: telegramMessageId,
        entry_id: $json.entry_id ?? null,
        deleted_count: $json.deleted_count ?? null,
      },
      assertions,
      error: ok ? null : { message: 'read command assertions failed' },
    },
  }];
};

