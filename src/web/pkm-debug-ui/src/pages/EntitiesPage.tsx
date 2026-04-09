import { useEffect, useMemo, useState } from 'react';
import { EntryStandardCard } from '../components/EntryStandardCard';
import { RightSideDrawer } from '../components/RightSideDrawer';
import {
  deleteEntitiesByIds,
  listEntities,
  moveEntitiesByIds,
  type EntitiesFiltersInput,
} from '../lib/entitiesApi';
import { fmtTs } from '../lib/format';
import { readPull } from '../lib/readApi';
import { createUiRunId } from '../lib/runId';
import type { EntityListRow } from '../types';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const STATUS_OPTIONS = ['pending', 'queued', 'completed', 'failed', 'skipped', 'not_eligible', 'stale'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeEntryId(value: string | null): string | null {
  const out = String(value || '').trim();
  if (!/^\d+$/.test(out)) return null;
  if (out === '0') return null;
  return out;
}

export function EntitiesPage() {
  const [contentTypeFilter, setContentTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [intentFilter, setIntentFilter] = useState('');
  const [topicPrimaryFilter, setTopicPrimaryFilter] = useState('');
  const [createdFromFilter, setCreatedFromFilter] = useState('');
  const [createdToFilter, setCreatedToFilter] = useState('');
  const [hasUrlFilter, setHasUrlFilter] = useState<'any' | 'yes' | 'no'>('any');
  const [qualityFlagFilter, setQualityFlagFilter] = useState<'any' | 'low_signal' | 'boilerplate_heavy'>('any');

  const [rows, setRows] = useState<EntityListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [schema, setSchema] = useState('pkm');
  const [isTestMode, setIsTestMode] = useState(false);
  const [topicOptions, setTopicOptions] = useState<string[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkInfo, setBulkInfo] = useState<string | null>(null);
  const [moveToSchema, setMoveToSchema] = useState('pkm_test');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [pullRunId, setPullRunId] = useState('');
  const [pullTargetEntryId, setPullTargetEntryId] = useState('');
  const [pullPayload, setPullPayload] = useState<Record<string, unknown> | null>(null);

  const selectedEntryIds = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const selectedCount = selectedEntryIds.length;

  const entityFilters: EntitiesFiltersInput = useMemo(() => ({
    content_type: contentTypeFilter.trim(),
    source: sourceFilter.trim(),
    status: statusFilter.trim(),
    intent: intentFilter.trim(),
    topic_primary: topicPrimaryFilter.trim(),
    created_from: createdFromFilter.trim(),
    created_to: createdToFilter.trim(),
    has_url: hasUrlFilter === 'any' ? null : hasUrlFilter === 'yes',
    quality_flag: qualityFlagFilter === 'any' ? '' : qualityFlagFilter,
  }), [
    contentTypeFilter,
    sourceFilter,
    statusFilter,
    intentFilter,
    topicPrimaryFilter,
    createdFromFilter,
    createdToFilter,
    hasUrlFilter,
    qualityFlagFilter,
  ]);

  const loadPage = async (
    nextPage: number,
    nextPageSize = pageSize,
    filtersOverride: EntitiesFiltersInput = entityFilters,
  ) => {
    setLoading(true);
    setError(null);
    setBulkInfo(null);
    const reqRunId = createUiRunId('ui-entities');
    try {
      const out = await listEntities({
        page: nextPage,
        page_size: nextPageSize,
        filters: filtersOverride,
      }, reqRunId);
      setRows(out.rows);
      setRunId(out.run_id || reqRunId);
      setPage(out.meta.page || nextPage);
      setPageSize(out.meta.page_size || nextPageSize);
      setTotalCount(out.meta.total_count || 0);
      setTotalPages(out.meta.total_pages || 0);
      setSchema(out.meta.schema || 'pkm');
      setIsTestMode(!!out.meta.is_test_mode);
      setTopicOptions(Array.isArray(out.meta.topic_primary_options) ? out.meta.topic_primary_options : []);
      setSelectedIds(new Set());
      setBulkError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load entities');
      setRows([]);
      setRunId(reqRunId);
      setTotalCount(0);
      setTotalPages(0);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const destination = schema === 'pkm_test' ? 'pkm' : 'pkm_test';
    setMoveToSchema(destination);
  }, [schema]);

  const openEntityDrawer = async (entryIdRaw: string | null) => {
    const entryId = normalizeEntryId(entryIdRaw);
    if (!entryId) return;

    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError(null);
    setPullTargetEntryId(entryId);
    setPullPayload(null);

    const drawerRunId = createUiRunId('ui-entity-pull');
    try {
      const out = await readPull({ entry_id: entryId }, { runId: drawerRunId });
      const row0 = Array.isArray(out.rows) && out.rows.length > 0
        ? asRecord(out.rows[0])
        : {};
      const payload = Object.keys(row0).length > 0
        ? row0
        : { entry_id: entryId, found: false };
      setPullPayload(payload);
      setPullRunId(out.run_id || drawerRunId);
    } catch (err) {
      setPullPayload(null);
      setPullRunId(drawerRunId);
      setDrawerError(err instanceof Error ? err.message : 'pull failed');
    } finally {
      setDrawerLoading(false);
    }
  };

  const toggleSelection = (entryIdRaw: string | null) => {
    const entryId = normalizeEntryId(entryIdRaw);
    if (!entryId) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const selectAllCurrentPage = () => {
    const ids = rows
      .map((row) => normalizeEntryId(row.entry_id))
      .filter((id): id is string => !!id);
    setSelectedIds(new Set(ids));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const applyFilters = async () => {
    await loadPage(1, pageSize, entityFilters);
  };

  const resetFilters = async () => {
    const clearedFilters: EntitiesFiltersInput = {
      content_type: '',
      source: '',
      status: '',
      intent: '',
      topic_primary: '',
      created_from: '',
      created_to: '',
      has_url: null,
      quality_flag: '',
    };
    setContentTypeFilter('');
    setSourceFilter('');
    setStatusFilter('');
    setIntentFilter('');
    setTopicPrimaryFilter('');
    setCreatedFromFilter('');
    setCreatedToFilter('');
    setHasUrlFilter('any');
    setQualityFlagFilter('any');
    await loadPage(1, pageSize, clearedFilters);
  };

  const runDeleteSelected = async () => {
    if (!selectedEntryIds.length || bulkBusy) return;
    const confirmed = window.confirm(`Delete ${selectedEntryIds.length} selected entities from ${schema}?`);
    if (!confirmed) return;
    setBulkBusy(true);
    setBulkError(null);
    setBulkInfo(null);
    try {
      const out = await deleteEntitiesByIds(schema, selectedEntryIds);
      setBulkInfo(`Deleted ${out.deleted_count} entities from ${out.schema}.`);
      await loadPage(page, pageSize);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const runMoveSelected = async () => {
    if (!selectedEntryIds.length || bulkBusy) return;
    if (!moveToSchema || moveToSchema === schema) {
      setBulkError('choose a destination schema different from the current one');
      return;
    }
    setBulkBusy(true);
    setBulkError(null);
    setBulkInfo(null);
    try {
      const out = await moveEntitiesByIds(schema, moveToSchema, selectedEntryIds);
      setBulkInfo(`Moved ${out.moved_count} entities from ${out.from_schema} to ${out.to_schema}.`);
      await loadPage(page, pageSize);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'move failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const goPrevPage = async () => {
    if (page <= 1 || loading) return;
    await loadPage(page - 1, pageSize);
  };

  const goNextPage = async () => {
    if (loading) return;
    if (totalPages > 0 && page >= totalPages) return;
    await loadPage(page + 1, pageSize);
  };

  const onPageSizeChange = async (next: number) => {
    setPageSize(next);
    await loadPage(1, next);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <h1 className="text-lg font-semibold text-slate-100">Entities</h1>
        <p className="mt-1 text-sm text-slate-400">Browse entities with filters, inspect one entity in drawer, and run bulk cleanup actions.</p>

        <div className="mt-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
          schema: <span className="text-slate-100">{schema}</span> | test mode: <span className="text-slate-100">{isTestMode ? 'ON' : 'OFF'}</span> | run_id: <span className="text-slate-100">{runId || '-'}</span>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <input
            value={contentTypeFilter}
            onChange={(event) => setContentTypeFilter(event.target.value)}
            placeholder="content_type"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <input
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            placeholder="source"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          >
            <option value="">status (any)</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <input
            value={intentFilter}
            onChange={(event) => setIntentFilter(event.target.value)}
            placeholder="intent"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 placeholder:text-slate-500 focus:ring"
          />
          <select
            value={topicPrimaryFilter}
            onChange={(event) => setTopicPrimaryFilter(event.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          >
            <option value="">topic_primary (any)</option>
            {topicOptions.map((topic) => (
              <option key={topic} value={topic}>{topic}</option>
            ))}
          </select>
          <select
            value={hasUrlFilter}
            onChange={(event) => setHasUrlFilter(event.target.value as 'any' | 'yes' | 'no')}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          >
            <option value="any">has_url (any)</option>
            <option value="yes">has_url = yes</option>
            <option value="no">has_url = no</option>
          </select>
          <input
            type="date"
            value={createdFromFilter}
            onChange={(event) => setCreatedFromFilter(event.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          />
          <input
            type="date"
            value={createdToFilter}
            onChange={(event) => setCreatedToFilter(event.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          />
          <select
            value={qualityFlagFilter}
            onChange={(event) => setQualityFlagFilter(event.target.value as 'any' | 'low_signal' | 'boilerplate_heavy')}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          >
            <option value="any">quality flag (any)</option>
            <option value="low_signal">low_signal</option>
            <option value="boilerplate_heavy">boilerplate_heavy</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-emerald-500 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            onClick={() => { void applyFilters(); }}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            onClick={() => { void resetFilters(); }}
            disabled={loading}
          >
            Reset
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-glow">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-slate-300">
            total: <span className="text-slate-100">{totalCount}</span> | page: <span className="text-slate-100">{page}</span> / <span className="text-slate-100">{Math.max(totalPages, 1)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-300">
              page size
            </label>
            <select
              value={pageSize}
              onChange={(event) => { void onPageSizeChange(Number(event.target.value)); }}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
            >
              {PAGE_SIZE_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              onClick={() => { void goPrevPage(); }}
              disabled={loading || page <= 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              onClick={() => { void goNextPage(); }}
              disabled={loading || (totalPages > 0 && page >= totalPages)}
            >
              Next
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            onClick={selectAllCurrentPage}
          >
            Select All Page
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            onClick={clearSelection}
          >
            Clear Selection
          </button>
          <span className="text-xs text-slate-300">selected: {selectedCount}</span>
        </div>

        <div className="grid gap-2 md:grid-cols-[200px_auto_auto]">
          <select
            value={moveToSchema}
            onChange={(event) => setMoveToSchema(event.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-sky-500 focus:ring"
          >
            <option value="pkm">move to pkm</option>
            <option value="pkm_test">move to pkm_test</option>
          </select>
          <button
            type="button"
            className="rounded border border-amber-500 bg-amber-500/15 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
            onClick={() => { void runMoveSelected(); }}
            disabled={bulkBusy || !selectedCount}
          >
            {bulkBusy ? 'Working...' : `Move Selected (${selectedCount})`}
          </button>
          <button
            type="button"
            className="rounded border border-rose-500 bg-rose-500/15 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
            onClick={() => { void runDeleteSelected(); }}
            disabled={bulkBusy || !selectedCount}
          >
            {bulkBusy ? 'Working...' : `Delete Selected (${selectedCount})`}
          </button>
        </div>

        {bulkError && (
          <div className="rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {bulkError}
          </div>
        )}

        {bulkInfo && (
          <div className="rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-300">
            {bulkInfo}
          </div>
        )}

        {rows.length === 0 && !loading && (
          <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-6 text-sm text-slate-400">
            No entities match current filters.
          </div>
        )}

        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-950/70 text-xs text-slate-300">
              <tr>
                <th className="border-b border-slate-800 px-2 py-2">Select</th>
                <th className="border-b border-slate-800 px-2 py-2">entry_id</th>
                <th className="border-b border-slate-800 px-2 py-2">Created</th>
                <th className="border-b border-slate-800 px-2 py-2">Source</th>
                <th className="border-b border-slate-800 px-2 py-2">Type</th>
                <th className="border-b border-slate-800 px-2 py-2">Intent</th>
                <th className="border-b border-slate-800 px-2 py-2">Topic</th>
                <th className="border-b border-slate-800 px-2 py-2">Status</th>
                <th className="border-b border-slate-800 px-2 py-2">Title / Gist</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const entryId = normalizeEntryId(row.entry_id);
                const checked = entryId ? selectedIds.has(entryId) : false;
                const qualityFlags = [
                  row.low_signal ? 'low_signal' : '',
                  row.boilerplate_heavy ? 'boilerplate_heavy' : '',
                ].filter(Boolean).join(', ');

                return (
                  <tr
                    key={`${row.id || 'row'}-${row.entry_id || `idx-${index}`}`}
                    className="cursor-pointer border-b border-slate-800 bg-slate-950/20 hover:bg-slate-900/60"
                    onClick={() => { void openEntityDrawer(row.entry_id); }}
                  >
                    <td className="px-2 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelection(row.entry_id)}
                        onClick={(event) => event.stopPropagation()}
                        disabled={!entryId}
                      />
                    </td>
                    <td className="px-2 py-2 align-top text-slate-200">{row.entry_id || '-'}</td>
                    <td className="px-2 py-2 align-top text-slate-300">{row.created_at ? fmtTs(row.created_at) : '-'}</td>
                    <td className="px-2 py-2 align-top text-slate-300">{row.source || '-'}</td>
                    <td className="px-2 py-2 align-top text-slate-300">{row.content_type || '-'}</td>
                    <td className="px-2 py-2 align-top text-slate-300">{row.intent || '-'}</td>
                    <td className="px-2 py-2 align-top text-slate-300">{row.topic_primary || '-'}</td>
                    <td className="px-2 py-2 align-top text-slate-300">
                      <div>{row.distill_status || '-'}</div>
                      {qualityFlags && <div className="mt-1 text-[11px] text-amber-300">{qualityFlags}</div>}
                    </td>
                    <td className="max-w-[520px] px-2 py-2 align-top">
                      <div className="font-medium text-slate-100">{row.title || '(no title)'}</div>
                      {row.gist && <div className="mt-1 line-clamp-2 text-xs text-slate-300">{row.gist}</div>}
                      {!row.gist && row.excerpt && <div className="mt-1 line-clamp-2 text-xs text-slate-300">{row.excerpt}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <RightSideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Entity Detail"
        subtitle={pullTargetEntryId ? `entry_id: ${pullTargetEntryId}${pullRunId ? ` | run_id: ${pullRunId}` : ''}` : null}
      >
        {drawerLoading && (
          <div className="rounded border border-slate-800 bg-slate-900/70 px-3 py-6 text-sm text-slate-300">
            Loading entity...
          </div>
        )}

        {drawerError && !drawerLoading && (
          <div className="rounded border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-sm text-rose-300">
            {drawerError}
          </div>
        )}

        {pullPayload && !drawerLoading && (
          <EntryStandardCard
            title="Standardized View (Telegram-style)"
            payload={pullPayload}
            fullPayload={pullPayload}
          />
        )}

        {!drawerLoading && !drawerError && !pullPayload && (
          <div className="rounded border border-slate-800 bg-slate-900/70 px-3 py-6 text-sm text-slate-300">
            Select one entity row to inspect details here.
          </div>
        )}
      </RightSideDrawer>
    </div>
  );
}
