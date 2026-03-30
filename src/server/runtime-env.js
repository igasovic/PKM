'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function parseIntWithFallback(value, fallback, opts = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const out = Math.trunc(n);
  if (Number.isFinite(opts.min) && out < opts.min) return fallback;
  if (Number.isFinite(opts.max) && out > opts.max) return fallback;
  return out;
}

function normalizeReasoningEffort(value) {
  const raw = asText(value).toLowerCase();
  if (['minimal', 'low', 'medium', 'high'].includes(raw)) return raw;
  return null;
}

function getNodeEnv() {
  return asText(process.env.NODE_ENV).toLowerCase() || '';
}

function getServicePort() {
  return parseIntWithFallback(process.env.PORT, 8080, { min: 1, max: 65535 });
}

function getAdminSecret() {
  return asText(process.env.PKM_ADMIN_SECRET);
}

function getRuntimeDbSchema() {
  return asText(process.env.PKM_DB_SCHEMA) || 'pkm';
}

function getDeleteMoveMaxBatch() {
  return parseIntWithFallback(process.env.DB_DELETE_MOVE_MAX_BATCH, 200, { min: 1 });
}

function getDbAdminRole() {
  return asText(process.env.PKM_DB_ADMIN_ROLE);
}

function getDbPoolConfig() {
  return {
    user: asText(process.env.PKM_INGEST_USER),
    password: asText(process.env.PKM_INGEST_PASSWORD),
    host: asText(process.env.PKM_DB_HOST) || 'postgres',
    port: parseIntWithFallback(process.env.PKM_DB_PORT, 5432, { min: 1, max: 65535 }),
    database: asText(process.env.PKM_DB_NAME) || 'pkm',
    ssl: parseBool(process.env.PKM_DB_SSL, false),
    rejectUnauthorized: parseBool(process.env.PKM_DB_SSL_REJECT_UNAUTHORIZED, true),
  };
}

function getMaintenanceConfig() {
  return {
    pipelineRetentionDays: parseIntWithFallback(process.env.PKM_PIPELINE_EVENTS_RETENTION_DAYS, 30, { min: 1 }),
    distillStaleMarkEnabled: parseBool(process.env.T2_STALE_MARK_ENABLED, true),
    distillStaleMarkIntervalMs: parseIntWithFallback(
      process.env.T2_STALE_MARK_INTERVAL_MS,
      24 * 60 * 60 * 1000,
      { min: 60_000 }
    ),
  };
}

function getBraintrustConfig() {
  return {
    apiKey: asText(process.env.BRAINTRUST_API_KEY),
    projectName: asText(process.env.BRAINTRUST_PROJECT || process.env.BRAINTRUST_PROJECT_NAME) || 'pkm-backend',
  };
}

function getLogSettings() {
  return {
    level: asText(process.env.PKM_LOG_LEVEL).toLowerCase() || 'info',
    debugCaptureEnabled: asText(process.env.PKM_DEBUG_CAPTURE) === '1',
    debugCaptureDir: asText(process.env.PKM_DEBUG_CAPTURE_DIR) || '/data/pipeline-debug',
    summaryMaxBytes: parseIntWithFallback(process.env.PKM_LOG_SUMMARY_MAX_BYTES, 12 * 1024, { min: 2048 }),
    stringHashThreshold: parseIntWithFallback(process.env.PKM_LOG_STRING_HASH_THRESHOLD, 500, { min: 50 }),
  };
}

function getLiteLLMApiKey() {
  return asText(process.env.LITELLM_MASTER_KEY);
}

function hasLiteLLMKey() {
  return getLiteLLMApiKey().length > 0;
}

function getFallbackLlmCostEnv() {
  return {
    inputPerM: toFinite(process.env.LLM_INPUT_COST_PER_1M_USD),
    outputPerM: toFinite(process.env.LLM_OUTPUT_COST_PER_1M_USD),
  };
}

function getModelCostMapRaw() {
  return asText(process.env.LLM_MODEL_COSTS_PER_1M_USD_JSON);
}

function getNamedModelCostEnv(modelKey) {
  const safeKey = asText(modelKey).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!safeKey) {
    return { inputPerM: null, outputPerM: null };
  }
  return {
    inputPerM: toFinite(process.env[`LLM_MODEL_${safeKey}_INPUT_COST_PER_1M_USD`]),
    outputPerM: toFinite(process.env[`LLM_MODEL_${safeKey}_OUTPUT_COST_PER_1M_USD`]),
  };
}

function shouldWarnBraintrustSinkInTest() {
  if (getNodeEnv() !== 'test') return true;
  return asText(process.env.PKM_BRAINTRUST_SINK_WARN_IN_TEST) === '1';
}

function getLiteLLMSettings() {
  return {
    apiKey: getLiteLLMApiKey(),
    baseUrl: asText(process.env.OPENAI_BASE_URL) || 'http://litellm:4000/v1',
    defaultModel: asText(process.env.T1_DEFAULT_MODEL) || 't1-default',
    timeoutMs: parseIntWithFallback(process.env.LITELLM_TIMEOUT_MS, 60_000, { min: 1000 }),
    reasoningEffort: normalizeReasoningEffort(process.env.T1_REASONING_EFFORT) || 'minimal',
    batchModel: asText(process.env.T1_BATCH_MODEL) || null,
    batchDefaultModel: asText(process.env.T1_BATCH_DEFAULT_MODEL) || null,
    batchRequestModel: asText(process.env.T1_BATCH_REQUEST_MODEL) || null,
    batchProviderModel: asText(process.env.T1_BATCH_PROVIDER_MODEL) || null,
    inputCostPerM: getFallbackLlmCostEnv().inputPerM,
    outputCostPerM: getFallbackLlmCostEnv().outputPerM,
  };
}

function getNotionSettings() {
  return {
    apiBase: (asText(process.env.NOTION_API_BASE) || 'https://api.notion.com/v1').replace(/\/+$/, ''),
    apiVersion: asText(process.env.NOTION_API_VERSION) || '2022-06-28',
    databaseUrl: asText(process.env.NOTION_DATABASE_URL)
      || 'https://www.notion.so/1a01372f11ad4ae7a8ebf5769af98b58?v=9b730daaf4444e6183d20a870cbe0560&source=copy_link',
    databaseId: asText(process.env.NOTION_DATABASE_ID),
    apiToken: asText(process.env.NOTION_API_TOKEN),
  };
}

function getT1BatchSettings() {
  return {
    workerEnabled: parseBool(process.env.T1_BATCH_WORKER_ENABLED, true),
    syncLimit: parseIntWithFallback(process.env.T1_BATCH_SYNC_LIMIT, 20, { min: 1 }),
    syncIntervalMs: parseIntWithFallback(process.env.T1_BATCH_SYNC_INTERVAL_MS, 10 * 60_000, { min: 5000 }),
    batchModel: asText(process.env.T1_BATCH_MODEL) || null,
    batchDefaultModel: asText(process.env.T1_BATCH_DEFAULT_MODEL) || null,
    batchRequestModel: asText(process.env.T1_BATCH_REQUEST_MODEL) || null,
    batchProviderModel: asText(process.env.T1_BATCH_PROVIDER_MODEL) || null,
    reasoningEffort: normalizeReasoningEffort(process.env.T1_REASONING_EFFORT) || 'minimal',
  };
}

function getT2ModelEnv() {
  return {
    direct: asText(process.env.T2_MODEL_DIRECT) || null,
    chunkNote: asText(process.env.T2_MODEL_CHUNK_NOTE) || null,
    synthesis: asText(process.env.T2_MODEL_SYNTHESIS) || null,
    syncDirect: asText(process.env.T2_MODEL_SYNC_DIRECT) || null,
    batchDirect: asText(process.env.T2_MODEL_BATCH_DIRECT) || null,
    batchRequestModel: asText(process.env.T2_BATCH_REQUEST_MODEL) || null,
    t1BatchRequestModel: asText(process.env.T1_BATCH_REQUEST_MODEL) || null,
    t1BatchProviderModel: asText(process.env.T1_BATCH_PROVIDER_MODEL) || null,
  };
}

function getT2BatchSettings(defaultRunLimit) {
  const fallbackLimit = Number.isFinite(Number(defaultRunLimit))
    ? Math.max(1, Math.trunc(Number(defaultRunLimit)))
    : 25;
  return {
    workerEnabled: parseBool(process.env.T2_BATCH_WORKER_ENABLED, false),
    syncIntervalMs: parseIntWithFallback(process.env.T2_BATCH_SYNC_INTERVAL_MS, 10 * 60_000, { min: 5000 }),
    syncLimit: parseIntWithFallback(process.env.T2_BATCH_SYNC_LIMIT, fallbackLimit, { min: 1 }),
    collectLimit: parseIntWithFallback(process.env.T2_BATCH_COLLECT_LIMIT, 20, { min: 1, max: 100 }),
    statusHistoryLimitRaw: process.env.T2_BATCH_STATUS_HISTORY_LIMIT,
    hasLiteLLMKey: hasLiteLLMKey(),
  };
}

module.exports = {
  asText,
  parseBool,
  getNodeEnv,
  getServicePort,
  getAdminSecret,
  getRuntimeDbSchema,
  getDeleteMoveMaxBatch,
  getDbAdminRole,
  getDbPoolConfig,
  getMaintenanceConfig,
  getBraintrustConfig,
  getLogSettings,
  getLiteLLMApiKey,
  hasLiteLLMKey,
  getFallbackLlmCostEnv,
  getModelCostMapRaw,
  getNamedModelCostEnv,
  shouldWarnBraintrustSinkInTest,
  getLiteLLMSettings,
  getNotionSettings,
  getT1BatchSettings,
  getT2ModelEnv,
  getT2BatchSettings,
};
