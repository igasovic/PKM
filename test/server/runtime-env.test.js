'use strict';

const ENV_KEYS = [
  'NODE_ENV', 'PORT', 'PKM_ADMIN_SECRET', 'PKM_DB_SCHEMA',
  'DB_DELETE_MOVE_MAX_BATCH', 'PKM_DB_ADMIN_ROLE',
  'PKM_INGEST_USER', 'PKM_INGEST_PASSWORD', 'PKM_DB_HOST',
  'PKM_DB_PORT', 'PKM_DB_NAME', 'PKM_DB_SSL', 'PKM_DB_SSL_REJECT_UNAUTHORIZED',
  'PKM_PIPELINE_EVENTS_RETENTION_DAYS', 'T2_STALE_MARK_ENABLED',
  'T2_STALE_MARK_INTERVAL_MS', 'BRAINTRUST_API_KEY', 'BRAINTRUST_PROJECT',
  'BRAINTRUST_PROJECT_NAME', 'PKM_LOG_LEVEL', 'PKM_DEBUG_CAPTURE',
  'PKM_DEBUG_CAPTURE_DIR', 'PKM_LOG_SUMMARY_MAX_BYTES',
  'PKM_LOG_STRING_HASH_THRESHOLD', 'LITELLM_MASTER_KEY',
  'LLM_INPUT_COST_PER_1M_USD', 'LLM_OUTPUT_COST_PER_1M_USD',
  'LLM_MODEL_COSTS_PER_1M_USD_JSON', 'OPENAI_BASE_URL',
  'T1_DEFAULT_MODEL', 'LITELLM_TIMEOUT_MS', 'T1_REASONING_EFFORT',
  'T1_BATCH_MODEL', 'T1_BATCH_DEFAULT_MODEL', 'T1_BATCH_REQUEST_MODEL',
  'T1_BATCH_PROVIDER_MODEL', 'NOTION_API_BASE', 'NOTION_API_VERSION',
  'NOTION_DATABASE_URL', 'NOTION_DATABASE_ID', 'NOTION_API_TOKEN',
  'T1_BATCH_WORKER_ENABLED', 'T1_BATCH_SYNC_LIMIT',
  'T1_BATCH_SYNC_INTERVAL_MS', 'T2_MODEL_DIRECT', 'T2_MODEL_CHUNK_NOTE',
  'T2_MODEL_SYNTHESIS', 'T2_MODEL_SYNC_DIRECT', 'T2_MODEL_BATCH_DIRECT',
  'T2_BATCH_REQUEST_MODEL', 'T2_BATCH_WORKER_ENABLED',
  'T2_BATCH_SYNC_INTERVAL_MS', 'T2_BATCH_SYNC_LIMIT',
  'T2_BATCH_COLLECT_LIMIT', 'T2_BATCH_STATUS_HISTORY_LIMIT',
  'PKM_BRAINTRUST_SINK_WARN_IN_TEST',
  'LLM_MODEL_OPENAI_GPT_5_INPUT_COST_PER_1M_USD',
  'LLM_MODEL_OPENAI_GPT_5_OUTPUT_COST_PER_1M_USD',
];

describe('runtime-env', () => {
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // Re-require to avoid cached closures
  function load() {
    return require('../../src/server/runtime-env.js');
  }

  const env = load();

  // ---- asText ----
  describe('asText', () => {
    test('returns empty string for null/undefined', () => {
      expect(env.asText(null)).toBe('');
      expect(env.asText(undefined)).toBe('');
    });

    test('trims whitespace', () => {
      expect(env.asText('  hello  ')).toBe('hello');
    });

    test('coerces numbers to string', () => {
      expect(env.asText(42)).toBe('42');
    });
  });

  // ---- parseBool ----
  describe('parseBool', () => {
    test('returns fallback for null/undefined/empty', () => {
      expect(env.parseBool(null, true)).toBe(true);
      expect(env.parseBool(undefined, false)).toBe(false);
      expect(env.parseBool('', true)).toBe(true);
    });

    test('recognizes truthy strings', () => {
      for (const v of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON']) {
        expect(env.parseBool(v, false)).toBe(true);
      }
    });

    test('recognizes falsy strings', () => {
      for (const v of ['0', 'false', 'no', 'off', 'FALSE', 'No', 'OFF']) {
        expect(env.parseBool(v, true)).toBe(false);
      }
    });

    test('returns fallback for unrecognized value', () => {
      expect(env.parseBool('maybe', true)).toBe(true);
      expect(env.parseBool('maybe', false)).toBe(false);
    });
  });

  // ---- getServicePort ----
  describe('getServicePort', () => {
    test('defaults to 8080', () => {
      expect(env.getServicePort()).toBe(8080);
    });

    test('reads PORT env', () => {
      process.env.PORT = '3000';
      expect(env.getServicePort()).toBe(3000);
    });

    test('falls back to default for out-of-range port', () => {
      process.env.PORT = '99999';
      expect(env.getServicePort()).toBe(8080);
    });

    test('falls back to default for non-numeric PORT', () => {
      process.env.PORT = 'abc';
      expect(env.getServicePort()).toBe(8080);
    });
  });

  // ---- getNodeEnv ----
  describe('getNodeEnv', () => {
    test('returns empty string when unset', () => {
      expect(env.getNodeEnv()).toBe('');
    });

    test('lowercases the value', () => {
      process.env.NODE_ENV = 'Production';
      expect(env.getNodeEnv()).toBe('production');
    });
  });

  // ---- getRuntimeDbSchema ----
  describe('getRuntimeDbSchema', () => {
    test('defaults to pkm', () => {
      expect(env.getRuntimeDbSchema()).toBe('pkm');
    });

    test('reads PKM_DB_SCHEMA', () => {
      process.env.PKM_DB_SCHEMA = 'custom_schema';
      expect(env.getRuntimeDbSchema()).toBe('custom_schema');
    });
  });

  // ---- getDeleteMoveMaxBatch ----
  describe('getDeleteMoveMaxBatch', () => {
    test('defaults to 200', () => {
      expect(env.getDeleteMoveMaxBatch()).toBe(200);
    });

    test('reads env var', () => {
      process.env.DB_DELETE_MOVE_MAX_BATCH = '50';
      expect(env.getDeleteMoveMaxBatch()).toBe(50);
    });

    test('falls back for value below min', () => {
      process.env.DB_DELETE_MOVE_MAX_BATCH = '0';
      expect(env.getDeleteMoveMaxBatch()).toBe(200);
    });
  });

  // ---- getDbPoolConfig ----
  describe('getDbPoolConfig', () => {
    test('returns defaults when no env set', () => {
      const cfg = env.getDbPoolConfig();
      expect(cfg.host).toBe('postgres');
      expect(cfg.port).toBe(5432);
      expect(cfg.database).toBe('pkm');
      expect(cfg.ssl).toBe(false);
      expect(cfg.rejectUnauthorized).toBe(true);
      expect(cfg.user).toBe('');
      expect(cfg.password).toBe('');
    });

    test('reads env overrides', () => {
      process.env.PKM_INGEST_USER = 'admin';
      process.env.PKM_INGEST_PASSWORD = 'secret';
      process.env.PKM_DB_HOST = 'myhost';
      process.env.PKM_DB_PORT = '5433';
      process.env.PKM_DB_NAME = 'mydb';
      process.env.PKM_DB_SSL = 'true';
      process.env.PKM_DB_SSL_REJECT_UNAUTHORIZED = 'false';

      const cfg = env.getDbPoolConfig();
      expect(cfg.user).toBe('admin');
      expect(cfg.password).toBe('secret');
      expect(cfg.host).toBe('myhost');
      expect(cfg.port).toBe(5433);
      expect(cfg.database).toBe('mydb');
      expect(cfg.ssl).toBe(true);
      expect(cfg.rejectUnauthorized).toBe(false);
    });
  });

  // ---- getMaintenanceConfig ----
  describe('getMaintenanceConfig', () => {
    test('returns defaults', () => {
      const cfg = env.getMaintenanceConfig();
      expect(cfg.pipelineRetentionDays).toBe(30);
      expect(cfg.distillStaleMarkEnabled).toBe(true);
      expect(cfg.distillStaleMarkIntervalMs).toBe(86400000);
    });

    test('reads env overrides', () => {
      process.env.PKM_PIPELINE_EVENTS_RETENTION_DAYS = '7';
      process.env.T2_STALE_MARK_ENABLED = 'false';
      process.env.T2_STALE_MARK_INTERVAL_MS = '120000';
      const cfg = env.getMaintenanceConfig();
      expect(cfg.pipelineRetentionDays).toBe(7);
      expect(cfg.distillStaleMarkEnabled).toBe(false);
      expect(cfg.distillStaleMarkIntervalMs).toBe(120000);
    });
  });

  // ---- getLiteLLMSettings ----
  describe('getLiteLLMSettings', () => {
    test('returns defaults', () => {
      const cfg = env.getLiteLLMSettings();
      expect(cfg.apiKey).toBe('');
      expect(cfg.baseUrl).toBe('http://litellm:4000/v1');
      expect(cfg.defaultModel).toBe('t1-default');
      expect(cfg.timeoutMs).toBe(60000);
      expect(cfg.reasoningEffort).toBe('minimal');
    });

    test('reads env overrides', () => {
      process.env.LITELLM_MASTER_KEY = 'sk-test';
      process.env.OPENAI_BASE_URL = 'http://localhost:8080/v1';
      process.env.T1_DEFAULT_MODEL = 'gpt-5';
      process.env.LITELLM_TIMEOUT_MS = '30000';
      process.env.T1_REASONING_EFFORT = 'high';
      const cfg = env.getLiteLLMSettings();
      expect(cfg.apiKey).toBe('sk-test');
      expect(cfg.baseUrl).toBe('http://localhost:8080/v1');
      expect(cfg.defaultModel).toBe('gpt-5');
      expect(cfg.timeoutMs).toBe(30000);
      expect(cfg.reasoningEffort).toBe('high');
    });
  });

  // ---- hasLiteLLMKey ----
  describe('hasLiteLLMKey', () => {
    test('returns false when unset', () => {
      expect(env.hasLiteLLMKey()).toBe(false);
    });

    test('returns true when set', () => {
      process.env.LITELLM_MASTER_KEY = 'sk-key';
      expect(env.hasLiteLLMKey()).toBe(true);
    });
  });

  // ---- getFallbackLlmCostEnv ----
  describe('getFallbackLlmCostEnv', () => {
    test('returns null when unset', () => {
      const c = env.getFallbackLlmCostEnv();
      expect(c.inputPerM).toBeNull();
      expect(c.outputPerM).toBeNull();
    });

    test('parses numeric values', () => {
      process.env.LLM_INPUT_COST_PER_1M_USD = '1.5';
      process.env.LLM_OUTPUT_COST_PER_1M_USD = '2.5';
      const c = env.getFallbackLlmCostEnv();
      expect(c.inputPerM).toBe(1.5);
      expect(c.outputPerM).toBe(2.5);
    });
  });

  // ---- getNamedModelCostEnv ----
  describe('getNamedModelCostEnv', () => {
    test('returns nulls for empty modelKey', () => {
      const c = env.getNamedModelCostEnv('');
      expect(c.inputPerM).toBeNull();
      expect(c.outputPerM).toBeNull();
    });

    test('normalizes modelKey to uppercase env name', () => {
      process.env.LLM_MODEL_OPENAI_GPT_5_INPUT_COST_PER_1M_USD = '3';
      process.env.LLM_MODEL_OPENAI_GPT_5_OUTPUT_COST_PER_1M_USD = '6';
      const c = env.getNamedModelCostEnv('openai/gpt-5');
      expect(c.inputPerM).toBe(3);
      expect(c.outputPerM).toBe(6);
    });
  });

  // ---- getLogSettings ----
  describe('getLogSettings', () => {
    test('returns defaults', () => {
      const cfg = env.getLogSettings();
      expect(cfg.level).toBe('info');
      expect(cfg.debugCaptureEnabled).toBe(false);
      expect(cfg.debugCaptureDir).toBe('/data/pipeline-debug');
    });

    test('reads PKM_DEBUG_CAPTURE=1 as enabled', () => {
      process.env.PKM_DEBUG_CAPTURE = '1';
      expect(env.getLogSettings().debugCaptureEnabled).toBe(true);
    });
  });

  // ---- getBraintrustConfig ----
  describe('getBraintrustConfig', () => {
    test('defaults projectName to pkm-backend', () => {
      expect(env.getBraintrustConfig().projectName).toBe('pkm-backend');
    });

    test('reads BRAINTRUST_PROJECT', () => {
      process.env.BRAINTRUST_PROJECT = 'my-project';
      expect(env.getBraintrustConfig().projectName).toBe('my-project');
    });
  });

  // ---- getNotionSettings ----
  describe('getNotionSettings', () => {
    test('returns defaults', () => {
      const cfg = env.getNotionSettings();
      expect(cfg.apiVersion).toBe('2022-06-28');
      expect(cfg.apiBase).toBe('https://api.notion.com/v1');
    });

    test('strips trailing slashes from apiBase', () => {
      process.env.NOTION_API_BASE = 'https://api.notion.com/v1///';
      expect(env.getNotionSettings().apiBase).toBe('https://api.notion.com/v1');
    });
  });

  // ---- getT1BatchSettings ----
  describe('getT1BatchSettings', () => {
    test('returns defaults', () => {
      const cfg = env.getT1BatchSettings();
      expect(cfg.workerEnabled).toBe(true);
      expect(cfg.syncLimit).toBe(20);
      expect(cfg.reasoningEffort).toBe('minimal');
    });
  });

  // ---- getT2BatchSettings ----
  describe('getT2BatchSettings', () => {
    test('defaults workerEnabled to false', () => {
      expect(env.getT2BatchSettings().workerEnabled).toBe(false);
    });

    test('uses provided defaultRunLimit as syncLimit fallback', () => {
      expect(env.getT2BatchSettings(10).syncLimit).toBe(10);
    });

    test('uses 25 when defaultRunLimit is not finite', () => {
      expect(env.getT2BatchSettings('garbage').syncLimit).toBe(25);
    });

    test('clamps collectLimit to max 100', () => {
      process.env.T2_BATCH_COLLECT_LIMIT = '999';
      expect(env.getT2BatchSettings().collectLimit).toBe(20); // falls back
    });
  });

  // ---- shouldWarnBraintrustSinkInTest ----
  describe('shouldWarnBraintrustSinkInTest', () => {
    test('returns true when not in test env', () => {
      process.env.NODE_ENV = 'production';
      expect(env.shouldWarnBraintrustSinkInTest()).toBe(true);
    });

    test('returns false in test env by default', () => {
      process.env.NODE_ENV = 'test';
      expect(env.shouldWarnBraintrustSinkInTest()).toBe(false);
    });

    test('returns true in test env when env flag is 1', () => {
      process.env.NODE_ENV = 'test';
      process.env.PKM_BRAINTRUST_SINK_WARN_IN_TEST = '1';
      expect(env.shouldWarnBraintrustSinkInTest()).toBe(true);
    });
  });
});
