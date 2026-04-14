import type {
  EvalCaseRecord,
  EvalSurface,
  EvalTier,
} from '../types';

type JsonModule = { default?: unknown };
type GenericRecord = Record<string, unknown>;

const ROUTER_GOLD = import.meta.glob<JsonModule>(
  '../../../../../evals/router/fixtures/gold/*.json',
  { eager: true },
);
const ROUTER_CANDIDATES = import.meta.glob<JsonModule>(
  '../../../../../evals/router/fixtures/candidates/*.json',
  { eager: true },
);
const CALENDAR_GOLD = import.meta.glob<JsonModule>(
  '../../../../../evals/calendar/fixtures/gold/*.json',
  { eager: true },
);
const CALENDAR_CANDIDATES = import.meta.glob<JsonModule>(
  '../../../../../evals/calendar/fixtures/candidates/*.json',
  { eager: true },
);
const TODOIST_GOLD = import.meta.glob<JsonModule>(
  '../../../../../evals/todoist/fixtures/gold/*.json',
  { eager: true },
);
const TODOIST_CANDIDATES = import.meta.glob<JsonModule>(
  '../../../../../evals/todoist/fixtures/candidates/*.json',
  { eager: true },
);

const MODULE_GROUPS: Array<{
  modules: Record<string, JsonModule>;
  surface: EvalSurface;
  tier: EvalTier;
}> = [
  { modules: ROUTER_GOLD, surface: 'router', tier: 'gold' },
  { modules: ROUTER_CANDIDATES, surface: 'router', tier: 'candidates' },
  { modules: CALENDAR_GOLD, surface: 'calendar', tier: 'gold' },
  { modules: CALENDAR_CANDIDATES, surface: 'calendar', tier: 'candidates' },
  { modules: TODOIST_GOLD, surface: 'todoist', tier: 'gold' },
  { modules: TODOIST_CANDIDATES, surface: 'todoist', tier: 'candidates' },
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter((item): item is string => !!item);
}

function asCaseRows(value: unknown): GenericRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => asRecord(row))
    .filter((row): row is GenericRecord => !!row);
}

function suiteFromFilePath(filePath: string): string {
  const parts = String(filePath).split('/');
  const file = parts[parts.length - 1] || 'unknown.json';
  return file.replace(/\.json$/i, '') || 'unknown';
}

function shortJson(value: unknown, maxLength = 160): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const out = value.replace(/\s+/g, ' ').trim();
    return out.length <= maxLength ? out : `${out.slice(0, maxLength - 1)}…`;
  }

  let out = '';
  try {
    out = JSON.stringify(value);
  } catch {
    out = String(value);
  }
  const normalized = out.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function expectedLabel(expect: GenericRecord | null): string {
  if (!expect) return '-';
  const keys = [
    'route',
    'status',
    'task_shape',
    'normalized_title_en',
    'reason_code',
  ];
  for (const key of keys) {
    const value = asText(expect[key]);
    if (value) return value;
  }
  return '-';
}

function rowToCase(params: {
  surface: EvalSurface;
  tier: EvalTier;
  suite: string;
  sourcePath: string;
  row: GenericRecord;
  index: number;
}): EvalCaseRecord {
  const {
    surface,
    tier,
    suite,
    sourcePath,
    row,
    index,
  } = params;

  const caseId = asText(row.case_id) || `${surface.toUpperCase()}-AUTO-${index + 1}`;
  const name = asText(row.name) || caseId;
  const bucket = asText(row.bucket) || 'unknown';
  const input = asRecord(row.input);
  const expect = asRecord(row.expect);
  const setup = asRecord(row.setup);
  const corpusGroup = asText(row.corpus_group);
  const failureTags = asStringArray(row.failure_tags);
  const mode = asText(row.mode) || (setup ? 'stateful' : 'stateless');

  return {
    id: `${surface}:${tier}:${suite}:${caseId}`,
    surface,
    tier,
    suite,
    mode,
    case_id: caseId,
    name,
    bucket,
    corpus_group: corpusGroup,
    failure_tags: failureTags,
    input,
    expect,
    setup,
    expected_label: expectedLabel(expect),
    input_preview: shortJson(input?.raw_text || input?.text || input),
    expect_preview: shortJson(expect),
    source_path: sourcePath,
  };
}

export function loadEvalCases(): EvalCaseRecord[] {
  const out: EvalCaseRecord[] = [];

  for (const group of MODULE_GROUPS) {
    const entries = Object.entries(group.modules);
    for (const [sourcePath, mod] of entries) {
      const rows = asCaseRows(mod.default);
      const suite = suiteFromFilePath(sourcePath);
      rows.forEach((row, idx) => {
        out.push(rowToCase({
          surface: group.surface,
          tier: group.tier,
          suite,
          sourcePath,
          row,
          index: idx,
        }));
      });
    }
  }

  out.sort((a, b) => {
    if (a.surface !== b.surface) return a.surface.localeCompare(b.surface);
    if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
    if (a.suite !== b.suite) return a.suite.localeCompare(b.suite);
    return a.case_id.localeCompare(b.case_id);
  });
  return out;
}
