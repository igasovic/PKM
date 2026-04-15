import { useEffect, useMemo, useState } from 'react';
import { JsonCard } from '../components/JsonCard';
import { loadEvalCases } from '../lib/evalCases';
import { loadLatestRunsByCase } from '../lib/evalReports';
import { copyText, stableStringify } from '../lib/stable';
import type { EvalCaseRecord, EvalSurface, EvalTier } from '../types';

type AnySurface = EvalSurface | 'all';
type AnyTier = EvalTier | 'all';

function surfaceBadge(surface: EvalSurface): string {
  if (surface === 'router') return 'border-cyan-700 bg-cyan-900/30 text-cyan-200';
  if (surface === 'calendar') return 'border-emerald-700 bg-emerald-900/30 text-emerald-200';
  return 'border-indigo-700 bg-indigo-900/30 text-indigo-200';
}

function tierBadge(tier: EvalTier): string {
  return tier === 'gold'
    ? 'border-amber-700 bg-amber-900/30 text-amber-200'
    : 'border-slate-700 bg-slate-900/50 text-slate-300';
}

function fmtCount(count: number, total: number): string {
  return `${count} / ${total}`;
}

export function EvalsPage() {
  const cases = useMemo(() => loadEvalCases(), []);
  const latestRunsByCase = useMemo(() => loadLatestRunsByCase(), []);

  const [surface, setSurface] = useState<AnySurface>('all');
  const [tier, setTier] = useState<AnyTier>('gold');
  const [suite, setSuite] = useState('all');
  const [bucket, setBucket] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const suites = useMemo(() => {
    const values = new Set<string>();
    cases.forEach((row) => {
      if (surface !== 'all' && row.surface !== surface) return;
      if (tier !== 'all' && row.tier !== tier) return;
      values.add(row.suite);
    });
    return ['all', ...Array.from(values).sort()];
  }, [cases, surface, tier]);

  const buckets = useMemo(() => {
    const values = new Set<string>();
    cases.forEach((row) => {
      if (surface !== 'all' && row.surface !== surface) return;
      if (tier !== 'all' && row.tier !== tier) return;
      if (suite !== 'all' && row.suite !== suite) return;
      values.add(row.bucket);
    });
    return ['all', ...Array.from(values).sort()];
  }, [cases, surface, tier, suite]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases.filter((row) => {
      if (surface !== 'all' && row.surface !== surface) return false;
      if (tier !== 'all' && row.tier !== tier) return false;
      if (suite !== 'all' && row.suite !== suite) return false;
      if (bucket !== 'all' && row.bucket !== bucket) return false;
      if (!q) return true;

      const searchable = [
        row.case_id,
        row.name,
        row.surface,
        row.tier,
        row.suite,
        row.bucket,
        row.corpus_group || '',
        row.expected_label,
        row.input_preview,
        row.expect_preview,
        row.failure_tags.join(' '),
      ].join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }, [cases, surface, tier, suite, bucket, query]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((row) => row.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => filtered.find((row) => row.id === selectedId) || null,
    [filtered, selectedId],
  );
  const selectedLastRun = useMemo(() => {
    if (!selected) return null;
    return latestRunsByCase.get(`${selected.surface}:${selected.case_id}`) || null;
  }, [latestRunsByCase, selected]);

  const summary = useMemo(() => {
    const bySurface: Record<EvalSurface, number> = {
      router: 0,
      calendar: 0,
      todoist: 0,
    };
    filtered.forEach((row) => {
      bySurface[row.surface] += 1;
    });
    return bySurface;
  }, [filtered]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1900px] p-4">
        <header className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
          <h1 className="text-lg font-semibold">Eval Cases</h1>
          <p className="mt-1 text-sm text-slate-400">
            Repo-first explorer for actual fixture cases (`evals/*/fixtures/*`).
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-300">
              total loaded: {cases.length}
            </span>
            <span className="rounded border border-cyan-700 bg-cyan-900/30 px-2 py-1 text-cyan-200">
              router: {summary.router}
            </span>
            <span className="rounded border border-emerald-700 bg-emerald-900/30 px-2 py-1 text-emerald-200">
              calendar: {summary.calendar}
            </span>
            <span className="rounded border border-indigo-700 bg-indigo-900/30 px-2 py-1 text-indigo-200">
              todoist: {summary.todoist}
            </span>
          </div>
        </header>

        <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-glow">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-xs">
              <span className="mb-1 block text-slate-400">Surface</span>
              <select
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
                value={surface}
                onChange={(event) => setSurface(event.target.value as AnySurface)}
              >
                <option value="all">all</option>
                <option value="router">router</option>
                <option value="calendar">calendar</option>
                <option value="todoist">todoist</option>
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-slate-400">Tier</span>
              <select
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
                value={tier}
                onChange={(event) => setTier(event.target.value as AnyTier)}
              >
                <option value="all">all</option>
                <option value="gold">gold</option>
                <option value="candidates">candidates</option>
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-slate-400">Suite</span>
              <select
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
                value={suite}
                onChange={(event) => setSuite(event.target.value)}
              >
                {suites.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-slate-400">Bucket</span>
              <select
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
                value={bucket}
                onChange={(event) => setBucket(event.target.value)}
              >
                {buckets.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block text-slate-400">Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="case_id, name, tags, input..."
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100 placeholder:text-slate-500"
              />
            </label>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 shadow-glow">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
              <span>Cases</span>
              <span>{fmtCount(filtered.length, cases.length)}</span>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-900/95 text-slate-300">
                  <tr className="border-b border-slate-800">
                    <th className="px-3 py-2">case_id</th>
                    <th className="px-3 py-2">surface</th>
                    <th className="px-3 py-2">bucket</th>
                    <th className="px-3 py-2">expected</th>
                    <th className="px-3 py-2">input</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isSelected = selectedId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className={`cursor-pointer border-b border-slate-900/70 ${isSelected ? 'bg-sky-500/10' : 'hover:bg-slate-800/40'}`}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td className="px-3 py-2 align-top text-slate-100">{row.case_id}</td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            <span className={`rounded border px-1.5 py-0.5 ${surfaceBadge(row.surface)}`}>{row.surface}</span>
                            <span className={`rounded border px-1.5 py-0.5 ${tierBadge(row.tier)}`}>{row.tier}</span>
                            <span className="rounded border border-slate-700 bg-slate-900/60 px-1.5 py-0.5 text-slate-300">{row.suite}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-slate-300">{row.bucket}</td>
                        <td className="px-3 py-2 align-top text-slate-200">{row.expected_label}</td>
                        <td className="max-w-[38rem] px-3 py-2 align-top text-slate-400">{row.input_preview || '-'}</td>
                      </tr>
                    );
                  })}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                        No cases match current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-glow">
            {!selected && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
                Select a case from the table to inspect details.
              </div>
            )}
            {selected && (
              <>
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-100">{selected.name}</h2>
                      <div className="mt-1 text-xs text-slate-400">{selected.case_id}</div>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      onClick={() => {
                        void copyText(stableStringify(selected, 2));
                      }}
                    >
                      Copy Case JSON
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1 text-xs">
                    <span className={`rounded border px-2 py-1 ${surfaceBadge(selected.surface)}`}>{selected.surface}</span>
                    <span className={`rounded border px-2 py-1 ${tierBadge(selected.tier)}`}>{selected.tier}</span>
                    <span className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-300">{selected.suite}</span>
                    <span className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-300">{selected.bucket}</span>
                    {selected.corpus_group && (
                      <span className="rounded border border-violet-700 bg-violet-900/30 px-2 py-1 text-violet-200">{selected.corpus_group}</span>
                    )}
                    {!!selected.failure_tags.length && (
                      <span className="rounded border border-rose-700 bg-rose-900/30 px-2 py-1 text-rose-200">
                        tags: {selected.failure_tags.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 rounded border border-slate-800 bg-slate-950/70 p-2 text-[11px] text-slate-500">
                    {selected.source_path}
                  </div>
                </div>

                <JsonCard title="input" data={selected.input || {}} defaultOpen />
                <JsonCard title="expect" data={selected.expect || {}} defaultOpen />
                {selected.setup && <JsonCard title="setup" data={selected.setup} />}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-100">Last Run</h3>
                    {selectedLastRun && (
                      <button
                        type="button"
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                        onClick={() => {
                          void copyText(stableStringify(selectedLastRun.report_case, 2));
                        }}
                      >
                        Copy Last Run JSON
                      </button>
                    )}
                  </div>
                  {!selectedLastRun && (
                    <div className="mt-2 text-xs text-slate-400">
                      No run found for this case in repo reports.
                    </div>
                  )}
                  {selectedLastRun && (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-300">
                          report: {selectedLastRun.report_timestamp}
                        </span>
                        {selectedLastRun.pass !== null && (
                          <span className={`rounded border px-2 py-1 ${selectedLastRun.pass ? 'border-emerald-700 bg-emerald-900/30 text-emerald-200' : 'border-rose-700 bg-rose-900/30 text-rose-200'}`}>
                            {selectedLastRun.pass ? 'pass' : 'fail'}
                          </span>
                        )}
                        {selectedLastRun.observability_ok !== null && (
                          <span className={`rounded border px-2 py-1 ${selectedLastRun.observability_ok ? 'border-cyan-700 bg-cyan-900/30 text-cyan-200' : 'border-amber-700 bg-amber-900/30 text-amber-200'}`}>
                            obs: {selectedLastRun.observability_ok ? 'ok' : 'missing'}
                          </span>
                        )}
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-300">
                        {selectedLastRun.summary_line}
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-400">
                          <span className="text-slate-500">run_id:</span> {selectedLastRun.run_id || '-'}
                        </div>
                        <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-400">
                          <span className="text-slate-500">duration_ms:</span> {selectedLastRun.duration_ms ?? '-'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
