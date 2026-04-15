import type {
  EvalCaseLastRun,
  EvalSurface,
} from '../types';

type JsonModule = { default?: unknown };
type GenericRecord = Record<string, unknown>;

const ROUTER_REPORTS = import.meta.glob<JsonModule>(
  '../../../../../evals/reports/router/*.json',
  { eager: true },
);
const CALENDAR_REPORTS = import.meta.glob<JsonModule>(
  '../../../../../evals/reports/calendar/*.json',
  { eager: true },
);
const TODOIST_REPORTS = import.meta.glob<JsonModule>(
  '../../../../../evals/reports/todoist/*.json',
  { eager: true },
);

type SurfaceReportConfig = {
  modules: Record<string, JsonModule>;
  surface: EvalSurface;
};

const REPORT_GROUPS: SurfaceReportConfig[] = [
  { modules: ROUTER_REPORTS, surface: 'router' },
  { modules: CALENDAR_REPORTS, surface: 'calendar' },
  { modules: TODOIST_REPORTS, surface: 'todoist' },
];

function asRecord(value: unknown): GenericRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as GenericRecord;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function asCaseRows(value: unknown): GenericRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => asRecord(row))
    .filter((row): row is GenericRecord => !!row);
}

function stampFromReport(filePath: string, root: GenericRecord | null): string {
  const meta = asRecord(root?.metadata);
  const fromMeta = asText(meta?.timestamp);
  if (fromMeta) return fromMeta;
  const parts = String(filePath).split('/');
  const file = parts[parts.length - 1] || '';
  return file.replace(/\.json$/i, '');
}

function buildSurfaceSummary(surface: EvalSurface, row: GenericRecord): string {
  if (surface === 'router') {
    const expected = asText(row.expected_route) || '-';
    const actual = asText(row.actual_route) || '-';
    const conf = asNumber(row.confidence);
    const confText = conf === null ? '-' : conf.toFixed(2);
    return `route ${expected} -> ${actual} | confidence ${confText}`;
  }
  if (surface === 'calendar') {
    const expected = asText(row.expected_status) || '-';
    const actual = asText(row.actual_status) || '-';
    const conf = asNumber(row.llm_confidence);
    const confText = conf === null ? '-' : conf.toFixed(2);
    return `status ${expected} -> ${actual} | llm_confidence ${confText}`;
  }
  const expected = asText(row.expected_task_shape) || '-';
  const actual = asText(row.actual_task_shape) || '-';
  const conf = asNumber(row.parse_confidence);
  const confText = conf === null ? '-' : conf.toFixed(2);
  return `shape ${expected} -> ${actual} | parse_confidence ${confText}`;
}

function toLastRun(surface: EvalSurface, stamp: string, row: GenericRecord): EvalCaseLastRun {
  return {
    surface,
    report_timestamp: stamp,
    case_id: asText(row.case_id) || '',
    run_id: asText(row.run_id),
    pass: asBoolean(row.pass),
    observability_ok: asBoolean(row.observability_ok),
    expected_label:
      asText(row.expected_route)
      || asText(row.expected_status)
      || asText(row.expected_task_shape)
      || null,
    actual_label:
      asText(row.actual_route)
      || asText(row.actual_status)
      || asText(row.actual_task_shape)
      || null,
    confidence:
      asNumber(row.confidence)
      ?? asNumber(row.llm_confidence)
      ?? asNumber(row.parse_confidence),
    duration_ms: asNumber(row.duration_ms),
    report_case: row,
    summary_line: buildSurfaceSummary(surface, row),
  };
}

export function loadLatestRunsByCase(): Map<string, EvalCaseLastRun> {
  const byCase = new Map<string, EvalCaseLastRun>();

  for (const group of REPORT_GROUPS) {
    const reports = Object.entries(group.modules)
      .map(([filePath, mod]) => ({
        filePath,
        root: asRecord(mod.default),
      }))
      .filter((item) => !!item.root)
      .map((item) => ({
        ...item,
        stamp: stampFromReport(item.filePath, item.root),
      }))
      .sort((a, b) => b.stamp.localeCompare(a.stamp));

    for (const report of reports) {
      const rows = asCaseRows(report.root?.cases);
      for (const row of rows) {
        const caseId = asText(row.case_id);
        if (!caseId) continue;
        const key = `${group.surface}:${caseId}`;
        if (byCase.has(key)) continue;
        byCase.set(key, toLastRun(group.surface, report.stamp, row));
      }
    }
  }

  return byCase;
}
