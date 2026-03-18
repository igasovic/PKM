'use strict';

const {
  collectEntryIds,
  mergeSmokeState,
  readNodeJson,
} = require('@igasovic/n8n-blocks/nodes/00-smoke-master/smoke-state.js');

module.exports = async function run(ctx, options = {}) {
  const currentJson = (ctx && ctx.$json && typeof ctx.$json === 'object') ? { ...ctx.$json } : {};
  const priorState = readNodeJson(ctx && ctx.$items, options.buildNodeName);
  const base = mergeSmokeState(priorState, currentJson);

  const currentArtifacts = (currentJson.artifacts && typeof currentJson.artifacts === 'object')
    ? { ...currentJson.artifacts }
    : {};
  const currentAssertions = Array.isArray(currentJson.assertions)
    ? currentJson.assertions
    : [{ name: options.defaultAssertionName || 'smoke_execution_ok', ok: !currentJson.error }];

  const caseName = currentJson.current_test_case || options.defaultCaseName || 'smoke-step';
  const ok = currentJson.ok === true && currentAssertions.every((assertion) => assertion && assertion.ok === true);

  const artifacts = {
    ...(priorState.artifacts && typeof priorState.artifacts === 'object' ? priorState.artifacts : {}),
    ...currentArtifacts,
  };

  const artifactAliases = options.artifactAliases && typeof options.artifactAliases === 'object'
    ? options.artifactAliases
    : {};
  Object.keys(artifactAliases).forEach((sourceKey) => {
    const targetKey = artifactAliases[sourceKey];
    const value = currentArtifacts[sourceKey];
    if (!targetKey) return;
    if (value === undefined || value === null || String(value).trim() === '') return;
    artifacts[targetKey] = value;
  });

  const createdEntryIds = collectEntryIds(
    priorState.artifacts,
    currentArtifacts,
    currentJson.entry_id,
    currentJson.entry_ids,
  );
  if (createdEntryIds.length > 0) {
    artifacts.created_entry_ids = createdEntryIds;
  }

  const results = Array.isArray(base.results) ? [...base.results] : [];
  results.push({
    test_case: caseName,
    ok,
    run_id: currentJson.test_run_id || base.test_run_id || null,
    artifacts: currentArtifacts,
    assertions: currentAssertions,
    error: currentJson.error || null,
  });

  return [{
    json: {
      ...base,
      results,
      artifacts,
    },
  }];
};
