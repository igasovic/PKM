'use strict';

const db = require('../db.js');
const { getConfig } = require('../../libs/config.js');
const { getLogger } = require('../logger/index.js');
const { buildTier2SelectionPlan } = require('./control-plane.js');

function toPositiveIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('candidate_limit must be a positive integer');
  }
  return Math.trunc(n);
}

function summarizeDecisionCounts(decisions) {
  const out = {
    proceed: 0,
    skipped: 0,
    not_eligible: 0,
  };
  const rows = Array.isArray(decisions) ? decisions : [];
  for (const row of rows) {
    const decision = String((row && row.decision) || '').trim();
    if (Object.prototype.hasOwnProperty.call(out, decision)) {
      out[decision] += 1;
    }
  }
  return out;
}

function buildEligibilityPersistenceGroups(decisions) {
  const rows = Array.isArray(decisions) ? decisions : [];
  const grouped = new Map();

  for (const row of rows) {
    const decision = String((row && row.decision) || '').trim();
    if (decision !== 'skipped' && decision !== 'not_eligible') continue;
    const id = String((row && row.id) || '').trim();
    if (!id) continue;
    const reasonCode = row && row.reason_code ? String(row.reason_code).trim() : null;
    const key = `${decision}:${reasonCode || ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        status: decision,
        reason_code: reasonCode,
        ids: [],
      });
    }
    grouped.get(key).ids.push(id);
  }

  return Array.from(grouped.values());
}

function projectSelectedRows(selected) {
  const rows = Array.isArray(selected) ? selected : [];
  return rows.map((row) => ({
    id: row.id,
    entry_id: row.entry_id,
    route: row.route,
    chunking_strategy: row.chunking_strategy,
    priority_score: row.priority_score,
    clean_word_count: row.clean_word_count,
    distill_status: row.distill_status,
    created_at: row.created_at,
  }));
}

function mergeSelectedWithDetails(selected, details) {
  const selectedRows = Array.isArray(selected) ? selected : [];
  const detailRows = Array.isArray(details) ? details : [];
  const selectedById = new Map(selectedRows.map((row) => [String(row.id), row]));

  return detailRows.map((row) => {
    const picked = selectedById.get(String(row.id)) || row;
    return {
      id: row.id,
      entry_id: row.entry_id,
      route: picked.route,
      chunking_strategy: picked.chunking_strategy,
      priority_score: picked.priority_score,
      clean_word_count: row.clean_word_count,
      distill_status: row.distill_status,
      created_at: row.created_at,
    };
  });
}

function createTier2Planner(deps) {
  const dependencies = deps && typeof deps === 'object' ? deps : {};
  const dbClient = dependencies.db || db;
  const getConfigFn = dependencies.getConfig || getConfig;
  const getLoggerFn = dependencies.getLogger || getLogger;

  async function persistEligibilityGroups(groups, logger) {
    const persistedGroups = [];
    let updated = 0;

    for (const group of groups) {
      const ids = Array.isArray(group.ids) ? group.ids : [];
      if (!ids.length) continue;
      const res = await logger.step(
        't2.plan.persist_eligibility',
        async () => dbClient.persistTier2EligibilityStatusByIds(ids, {
          status: group.status,
          reason_code: group.reason_code,
        }),
        {
          input: {
            status: group.status,
            reason_code: group.reason_code,
            ids: ids.length,
          },
          output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
        }
      );
      const rowCount = Number(res && res.rowCount ? res.rowCount : 0);
      updated += rowCount;
      persistedGroups.push({
        status: group.status,
        reason_code: group.reason_code,
        count: ids.length,
        updated: rowCount,
      });
    }

    return { updated, groups: persistedGroups };
  }

  async function runTier2ControlPlanePlan(rawOptions) {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const candidateLimit = toPositiveIntOrNull(options.candidate_limit);
    const persistEligibility = options.persist_eligibility !== false;
    const includeDetails = options.include_details === true;

    const logger = getLoggerFn().child({ pipeline: 't2.control_plane.plan' });
    const config = getConfigFn();

    const candidateResult = await logger.step(
      't2.plan.load_candidates',
      async () => dbClient.getTier2Candidates({ limit: candidateLimit || undefined }),
      {
        input: { candidate_limit: candidateLimit },
        output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
      }
    );

    const candidates = (candidateResult && Array.isArray(candidateResult.rows)) ? candidateResult.rows : [];
    const plan = buildTier2SelectionPlan(candidates, config);
    const decisions = Array.isArray(plan.decisions) ? plan.decisions : [];
    const selected = Array.isArray(plan.selected) ? plan.selected : [];

    let persisted = { updated: 0, groups: [] };
    if (persistEligibility) {
      const groups = buildEligibilityPersistenceGroups(decisions);
      persisted = await persistEligibilityGroups(groups, logger);
    }

    let selectedOutput = projectSelectedRows(selected);
    if (includeDetails && selected.length > 0) {
      const selectedIds = selected.map((row) => row.id).filter(Boolean);
      const detailResult = await logger.step(
        't2.plan.load_selected_details',
        async () => dbClient.getTier2DetailsByIds(selectedIds),
        {
          input: { ids: selectedIds.length },
          output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
        }
      );
      selectedOutput = mergeSelectedWithDetails(selected, detailResult && detailResult.rows ? detailResult.rows : []);
    }

    return {
      candidate_count: candidates.length,
      decision_counts: summarizeDecisionCounts(decisions),
      persisted_eligibility: persisted,
      selected_count: selected.length,
      selected: selectedOutput,
    };
  }

  return {
    runTier2ControlPlanePlan,
  };
}

const planner = createTier2Planner();

module.exports = {
  createTier2Planner,
  summarizeDecisionCounts,
  buildEligibilityPersistenceGroups,
  runTier2ControlPlanePlan: planner.runTier2ControlPlanePlan,
};
