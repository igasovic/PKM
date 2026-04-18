'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const raw = $json.stdout ?? '{}';
  let s = {};
  try { s = JSON.parse(raw); } catch (e) { s = {}; }

  const getRecord = (key) => s[key] ?? { status: 'missing', ts: '-', rc: '-' };
  const toChicagoDate = (value) => {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt);
    const y = (parts.find((p) => p.type === 'year') || {}).value;
    const m = (parts.find((p) => p.type === 'month') || {}).value;
    const d = (parts.find((p) => p.type === 'day') || {}).value;
    if (!y || !m || !d) return '';
    return `${y}-${m}-${d}`;
  };
  const dayDiffFromTodayChicago = (value) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const todayStr = toChicagoDate(new Date().toISOString());
    const dateStr = toChicagoDate(value);
    if (!todayStr || !dateStr) return Number.POSITIVE_INFINITY;
    const today = Date.parse(`${todayStr}T00:00:00Z`);
    const ts = Date.parse(`${dateStr}T00:00:00Z`);
    if (!Number.isFinite(today) || !Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
    return Math.floor((today - ts) / 86400000);
  };
  const isRecent = (record, maxDays, mustBeToday) => {
    if (!record || String(record.status || '') !== 'ok') return false;
    const diff = dayDiffFromTodayChicago(record.ts);
    if (!Number.isFinite(diff) || diff < 0) return false;
    if (mustBeToday) return diff === 0;
    return diff <= maxDays;
  };

  const daily = getRecord('pkm_backup_daily');
  const weekly = getRecord('pkm_backup_weekly');
  const monthly = getRecord('pkm_backup_monthly');

  const cloudDaily = getRecord('pkm_backup_gdrive_daily');
  const cloudWeekly = getRecord('pkm_backup_gdrive_weekly');
  const cloudMonthly = getRecord('pkm_backup_gdrive_monthly');

  const dailyOk = isRecent(daily, 0, true);
  const weeklyOk = isRecent(weekly, 7, false);
  const monthlyOk = isRecent(monthly, 31, false);
  const cloudOk = isRecent(cloudDaily, 0, true)
    && isRecent(cloudWeekly, 7, false)
    && isRecent(cloudMonthly, 31, false);

  const allOk = dailyOk && weeklyOk && monthlyOk && cloudOk;

  const now = new Date();
  const isSaturdayChicago = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
  }).format(now) === 'Sat';

  if (allOk && !isSaturdayChicago) {
    return [];
  }

  const today = toChicagoDate(now.toISOString()) || new Date().toISOString().slice(0, 10);
  const mark = (ok) => ok ? '✅' : 'x';
  const lines = [
    `PKM Backup Summary: ${today}`,
    `Daily: ${mark(dailyOk)} | Weekly: ${mark(weeklyOk)} | Monthly: ${mark(monthlyOk)} | Cloud: ${mark(cloudOk)}`,
  ];

  return [{
    json: {
      ...$json,
      telegram_message: mdv2Message(lines.join('\n')),
      backup_summary: {
        daily_ok: dailyOk,
        weekly_ok: weeklyOk,
        monthly_ok: monthlyOk,
        cloud_ok: cloudOk,
        all_ok: allOk,
      },
    },
  }];
};
