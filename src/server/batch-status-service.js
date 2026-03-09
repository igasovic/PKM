'use strict';

const { getBatchStageAdapter, normalizeStage } = require('./batch-stage-registry.js');

function parseBool(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function createBatchStatusService(deps) {
  const dependencies = deps && typeof deps === 'object' ? deps : {};
  const getAdapter = dependencies.getAdapter || getBatchStageAdapter;

  async function getBatchStatusList(rawInput) {
    const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
    const stage = normalizeStage(input.stage || 't1');
    const adapter = getAdapter(stage);

    const includeTerminalDefault = stage === 't2';
    const options = {
      limit: input.limit,
      include_terminal: parseBool(input.include_terminal, includeTerminalDefault),
    };

    if (stage === 't1' && input.schema) {
      options.schema = String(input.schema).trim();
    }

    return adapter.getStatusList(options);
  }

  async function getBatchStatus(rawInput) {
    const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
    const stage = normalizeStage(input.stage || 't1');
    const adapter = getAdapter(stage);

    const batchId = String(input.batch_id || '').trim();
    if (!batchId) {
      throw new Error('batch_id is required');
    }

    const options = {
      include_items: parseBool(input.include_items, false),
      items_limit: input.items_limit,
    };

    if (stage === 't1' && input.schema) {
      options.schema = String(input.schema).trim();
    }

    return adapter.getStatus(batchId, options);
  }

  return {
    getBatchStatusList,
    getBatchStatus,
  };
}

const defaultService = createBatchStatusService();

module.exports = {
  createBatchStatusService,
  getBatchStatusList: defaultService.getBatchStatusList,
  getBatchStatus: defaultService.getBatchStatus,
};
