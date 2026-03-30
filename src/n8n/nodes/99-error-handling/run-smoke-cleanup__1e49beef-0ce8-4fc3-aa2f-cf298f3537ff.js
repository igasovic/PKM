'use strict';

module.exports = async function run(ctx) {
  const { collectEntryIds } = require('@igasovic/n8n-blocks/nodes/00-smoke-master/smoke-state.js');
  const { wf00T99Cleanup } = require('@igasovic/n8n-blocks');

  const input = (ctx && ctx.$json) || {};
  const sourceEvent = (input && input.error_event && typeof input.error_event === 'object') ? input.error_event : {};

  const asText = (value) => String(value === undefined || value === null ? '' : value).trim();

  const findFirstValueByKey = (obj, key) => {
    const target = String(key || '').trim();
    if (!target || obj == null) return null;
    const stack = [obj];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') continue;
      if (seen.has(current)) continue;
      seen.add(current);
      if (Object.prototype.hasOwnProperty.call(current, target) && current[target] != null) {
        return current[target];
      }
      if (Array.isArray(current)) {
        current.forEach((value) => stack.push(value));
      } else {
        Object.keys(current).forEach((k) => stack.push(current[k]));
      }
    }
    return null;
  };

  if (input.is_smoke_master_error !== true) {
    return [{
      json: {
        ...input,
        smoke_cleanup_summary: null,
      },
    }];
  }

  try {
    const extractedRunId = asText(findFirstValueByKey(sourceEvent, 'test_run_id'))
      || asText(input.error_message.match(/\b(smoke_\d{4}_\d{2}_\d{2}_\d{6})\b/i)?.[1]);
    const extractedPrior = findFirstValueByKey(sourceEvent, 'prior_test_mode');
    const extractedResults = findFirstValueByKey(sourceEvent, 'results');
    const extractedArtifacts = findFirstValueByKey(sourceEvent, 'artifacts');
    const extractedEntryIds = collectEntryIds(extractedResults, extractedArtifacts, sourceEvent);

    const cleanupInput = {
      test_run_id: extractedRunId || null,
      prior_test_mode: typeof extractedPrior === 'boolean' ? extractedPrior : false,
      results: Array.isArray(extractedResults) ? extractedResults : [],
      artifacts: {
        ...(extractedArtifacts && typeof extractedArtifacts === 'object' ? extractedArtifacts : {}),
        created_entry_ids: extractedEntryIds,
      },
    };

    const cleanupRows = await wf00T99Cleanup({
      ...ctx,
      $json: cleanupInput,
    });

    const cleanupJson = Array.isArray(cleanupRows) && cleanupRows[0] && cleanupRows[0].json ? cleanupRows[0].json : null;
    const cleanupResult = cleanupJson && Array.isArray(cleanupJson.results)
      ? cleanupJson.results.find((row) => row && row.test_case === 'T99-cleanup') || null
      : null;

    return [{
      json: {
        ...input,
        smoke_cleanup_summary: {
          ok: !!(cleanupResult && cleanupResult.ok === true),
          runId: extractedRunId || null,
          deletedIds: cleanupResult && cleanupResult.artifacts && Array.isArray(cleanupResult.artifacts.deleted_ids)
            ? cleanupResult.artifacts.deleted_ids
            : extractedEntryIds,
          cleanupError: cleanupResult && cleanupResult.error ? asText(cleanupResult.error.message) : '',
        },
      },
    }];
  } catch (cleanupErr) {
    return [{
      json: {
        ...input,
        smoke_cleanup_summary: {
          ok: false,
          runId: null,
          deletedIds: [],
          cleanupError: asText(cleanupErr && cleanupErr.message ? cleanupErr.message : cleanupErr),
        },
      },
    }];
  }
};
