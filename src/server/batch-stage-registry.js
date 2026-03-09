'use strict';

const {
  getTier1BatchStatusList,
  getTier1BatchStatus,
} = require('./tier1-enrichment.js');
const {
  getTier2BatchStatusList,
  getTier2BatchStatus,
} = require('./tier2-enrichment.js');

function normalizeStage(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (raw === 't1' || raw === 't2') return raw;
  throw new Error('stage must be t1|t2');
}

function ensureAdapterShape(stage, adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error(`batch stage adapter missing: ${stage}`);
  }
  if (typeof adapter.getStatusList !== 'function') {
    throw new Error(`batch stage adapter invalid (getStatusList): ${stage}`);
  }
  if (typeof adapter.getStatus !== 'function') {
    throw new Error(`batch stage adapter invalid (getStatus): ${stage}`);
  }
}

function createBatchStageRegistry(overrides) {
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const adapters = {
    t1: ov.t1 || {
      stage: 't1',
      getStatusList: getTier1BatchStatusList,
      getStatus: getTier1BatchStatus,
    },
    t2: ov.t2 || {
      stage: 't2',
      getStatusList: getTier2BatchStatusList,
      getStatus: getTier2BatchStatus,
    },
  };

  ensureAdapterShape('t1', adapters.t1);
  ensureAdapterShape('t2', adapters.t2);

  function getAdapter(stage) {
    const key = normalizeStage(stage);
    const adapter = adapters[key];
    ensureAdapterShape(key, adapter);
    return adapter;
  }

  return {
    getAdapter,
  };
}

const defaultRegistry = createBatchStageRegistry();

module.exports = {
  createBatchStageRegistry,
  normalizeStage,
  getBatchStageAdapter: defaultRegistry.getAdapter,
};
