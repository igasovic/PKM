'use strict';

const crypto = require('crypto');
const posixPath = require('node:path').posix;
const { getConfig } = require('./config.js');

const DEFAULTS = {
  schema_version: 'failure-pack.v1',
  redaction_ruleset_version: 'v1',
  sidecar_root_relative: 'debug/failures',
  sidecar_write_dir: '/files/debug/failures',
  sidecar_read_dir: '/data/debug/failures',
  inline_max_bytes: 65536,
};

const FAILURE_PACK_STATUSES = new Set([
  'captured',
  'analyzed',
  'resolved',
]);

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return !!fallback;
  if (typeof value === 'boolean') return value;
  const raw = asText(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return !!fallback;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function parseDateIso(value, fallbackIso) {
  const raw = asText(value);
  if (!raw) return fallbackIso;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return fallbackIso;
  return dt.toISOString();
}

function normalizeFailureStatus(value, fallback = 'captured') {
  const raw = asText(value).toLowerCase();
  if (!raw) return fallback;
  if (FAILURE_PACK_STATUSES.has(raw)) return raw;
  // Legacy capture-quality statuses are collapsed into the v2 lifecycle.
  if (raw === 'partial' || raw === 'failed') return 'captured';
  return fallback;
}

function stableJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function sha256Hex(value) {
  const asString = typeof value === 'string' ? value : stableJson(value);
  return crypto.createHash('sha256').update(asString, 'utf8').digest('hex');
}

function byteLength(value) {
  const asString = typeof value === 'string' ? value : stableJson(value);
  return Buffer.byteLength(asString, 'utf8');
}

function loadFailurePackConfig() {
  const cfg = getConfig();
  const src = cfg && cfg.failure_pack && typeof cfg.failure_pack === 'object'
    ? cfg.failure_pack
    : {};
  return {
    schema_version: asText(src.schema_version) || DEFAULTS.schema_version,
    redaction_ruleset_version: asText(src.redaction_ruleset_version) || DEFAULTS.redaction_ruleset_version,
    sidecar_root_relative: asText(src.sidecar_root_relative) || DEFAULTS.sidecar_root_relative,
    sidecar_write_dir: asText(src.sidecar_write_dir) || DEFAULTS.sidecar_write_dir,
    sidecar_read_dir: asText(src.sidecar_read_dir) || DEFAULTS.sidecar_read_dir,
    inline_max_bytes: toPositiveInt(src.inline_max_bytes, DEFAULTS.inline_max_bytes),
  };
}

const SENSITIVE_KEY_RE = /(authorization|bearer|token|api[_-]?key|secret|password|passwd|cookie|set-cookie|session|credential|private[_-]?key)/i;
const BEARER_RE = /^bearer\s+/i;

function shouldRedactKey(key) {
  return SENSITIVE_KEY_RE.test(asText(key));
}

function redactScalar(value, keyHint) {
  const key = asText(keyHint).toLowerCase();
  if (shouldRedactKey(key)) {
    if (key === 'authorization' && typeof value === 'string' && BEARER_RE.test(value)) {
      return 'Bearer [REDACTED]';
    }
    return '[REDACTED]';
  }
  if (typeof value === 'string' && /authorization/i.test(key) && BEARER_RE.test(value)) {
    return 'Bearer [REDACTED]';
  }
  return value;
}

function redactSecrets(value, opts = {}) {
  const seen = new WeakMap();
  const extraSensitiveKeys = Array.isArray(opts.extra_sensitive_keys)
    ? opts.extra_sensitive_keys.map((k) => asText(k).toLowerCase()).filter(Boolean)
    : [];
  const extraSensitive = new Set(extraSensitiveKeys);

  function inner(input, keyHint) {
    if (input === null || input === undefined) return input;
    if (typeof input !== 'object') return redactScalar(input, keyHint);
    if (seen.has(input)) return seen.get(input);

    if (Array.isArray(input)) {
      const out = [];
      seen.set(input, out);
      for (let i = 0; i < input.length; i += 1) {
        out.push(inner(input[i], keyHint));
      }
      return out;
    }

    const out = {};
    seen.set(input, out);
    for (const key of Object.keys(input)) {
      const lowered = asText(key).toLowerCase();
      if (shouldRedactKey(lowered) || extraSensitive.has(lowered)) {
        out[key] = redactScalar(input[key], key);
      } else {
        out[key] = inner(input[key], key);
      }
    }
    return out;
  }

  return inner(value, '');
}

function validateRelativeArtifactPath(relativePath, rootPrefix) {
  const raw = asText(relativePath).replace(/\\/g, '/');
  if (!raw) throw new Error('artifact relative_path is required');
  if (raw.includes('\0')) throw new Error('artifact relative_path is invalid');
  if (raw.startsWith('/')) throw new Error('artifact relative_path must be relative');
  if (/^[a-zA-Z]:\//.test(raw)) throw new Error('artifact relative_path must not include drive prefix');

  const normalized = posixPath.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('artifact relative_path must not traverse outside root');
  }

  const expectedPrefix = asText(rootPrefix).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (expectedPrefix && !(normalized === expectedPrefix || normalized.startsWith(`${expectedPrefix}/`))) {
    throw new Error(`artifact relative_path must start with ${expectedPrefix}/`);
  }

  return normalized;
}

function normalizeArtifactList(artifacts, rootPrefix) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return [];
  return artifacts
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const relative_path = validateRelativeArtifactPath(item.relative_path, rootPrefix);
      return {
        kind: asText(item.kind) || 'payload-sidecar',
        relative_path,
        sha256: asText(item.sha256) || null,
        content_type: asText(item.content_type) || 'application/json',
      };
    });
}

function normalizeFailurePackEnvelope(input) {
  const cfg = loadFailurePackConfig();
  const nowIso = new Date().toISOString();
  const data = input && typeof input === 'object' ? input : {};
  const requestedSchemaVersion = asText(data.schema_version);
  if (requestedSchemaVersion && requestedSchemaVersion !== cfg.schema_version) {
    throw new Error(`unsupported schema_version: ${requestedSchemaVersion}`);
  }
  const run_id = asText(data.run_id || (data.correlation && data.correlation.run_id));
  if (!run_id) throw new Error('run_id is required');

  const correlationInput = (data.correlation && typeof data.correlation === 'object') ? data.correlation : {};
  const failureInput = (data.failure && typeof data.failure === 'object') ? data.failure : {};
  const payloadsInput = (data.payloads && typeof data.payloads === 'object') ? data.payloads : {};

  const workflow_name = asText(correlationInput.workflow_name || data.workflow_name || data.workflow || 'unknown-workflow');
  const reporting_workflow_name = asText(
    correlationInput.reporting_workflow_name
    || data.reporting_workflow_name
    || data.reportingWorkflowName
    || workflow_name
  ) || workflow_name;
  const node_name = asText(failureInput.node_name || failureInput.failing_node || data.node_name || 'unknown-node');
  if (!workflow_name) throw new Error('workflow_name is required');
  if (!node_name) throw new Error('node_name is required');

  const created_at = parseDateIso(data.created_at, nowIso);
  const failure_timestamp = parseDateIso(failureInput.timestamp || data.failed_at || created_at, created_at);
  const artifacts = normalizeArtifactList(data.artifacts, cfg.sidecar_root_relative);

  const execution_id = asText(correlationInput.execution_id || data.execution_id) || null;
  const root_execution_id = asText(
    correlationInput.root_execution_id
    || data.root_execution_id
    || data.rootExecutionId
    || execution_id
    || run_id
  ) || run_id;

  const envelope = {
    schema_version: cfg.schema_version,
    failure_id: asText(data.failure_id) || null,
    created_at,
    run_id,
    correlation: {
      root_execution_id,
      reporting_workflow_name,
      execution_id,
      workflow_id: asText(correlationInput.workflow_id || data.workflow_id) || null,
      workflow_name,
      execution_url: asText(correlationInput.execution_url || data.execution_url) || null,
      mode: asText(correlationInput.mode || data.mode || 'production') || 'production',
      retry_of: asText(correlationInput.retry_of) || null,
    },
    failure: {
      node_name,
      node_type: asText(failureInput.node_type || data.node_type) || null,
      error_name: asText(failureInput.error_name || data.error_name) || null,
      error_message: asText(failureInput.error_message || data.error_message) || 'unknown error',
      stack: asText(failureInput.stack || data.stack) || null,
      timestamp: failure_timestamp,
    },
    graph: (data.graph && typeof data.graph === 'object') ? data.graph : {
      failing_node: node_name,
      direct_parents: [],
    },
    payloads: payloadsInput,
    artifacts,
    redaction: {
      applied: toBoolean(data.redaction && data.redaction.applied, true),
      ruleset_version: asText(data.redaction && data.redaction.ruleset_version) || cfg.redaction_ruleset_version,
    },
    status: normalizeFailureStatus(data.status, 'captured'),
  };

  return envelope;
}

function parseFailurePackSummary(pack) {
  const envelope = normalizeFailurePackEnvelope(pack);
  const firstArtifact = envelope.artifacts[0] || null;
  const sidecar_root = firstArtifact
    ? posixPath.dirname(firstArtifact.relative_path)
    : null;
  const reportingWorkflowNames = [];
  const reporter = asText(envelope.correlation && envelope.correlation.reporting_workflow_name);
  const canonicalWorkflow = asText(envelope.correlation && envelope.correlation.workflow_name);
  if (reporter && reporter !== canonicalWorkflow) {
    reportingWorkflowNames.push(reporter);
  }

  return {
    run_id: envelope.run_id,
    root_execution_id: asText(envelope.correlation && envelope.correlation.root_execution_id) || envelope.run_id,
    reporting_workflow_names: reportingWorkflowNames,
    execution_id: envelope.correlation.execution_id,
    workflow_id: envelope.correlation.workflow_id,
    workflow_name: envelope.correlation.workflow_name,
    mode: envelope.correlation.mode,
    failed_at: envelope.failure.timestamp,
    node_name: envelope.failure.node_name,
    node_type: envelope.failure.node_type,
    error_name: envelope.failure.error_name,
    error_message: envelope.failure.error_message,
    status: normalizeFailureStatus(envelope.status, 'captured'),
    has_sidecars: envelope.artifacts.length > 0,
    sidecar_root,
    pack: envelope,
  };
}

function summarizeForLog(pack) {
  const envelope = normalizeFailurePackEnvelope(pack);
  const failingItems = envelope.payloads
    && envelope.payloads.failing_node_input
    && Number.isFinite(Number(envelope.payloads.failing_node_input.item_count))
    ? Number(envelope.payloads.failing_node_input.item_count)
    : null;
  const parentNodes = envelope.payloads
    && envelope.payloads.upstream_context
    && Array.isArray(envelope.payloads.upstream_context.nodes)
    ? envelope.payloads.upstream_context.nodes.length
    : 0;
  return {
    schema_version: envelope.schema_version,
    run_id: envelope.run_id,
    root_execution_id: asText(envelope.correlation && envelope.correlation.root_execution_id) || envelope.run_id,
    workflow_name: envelope.correlation.workflow_name,
    reporting_workflow_name: asText(envelope.correlation && envelope.correlation.reporting_workflow_name) || null,
    node_name: envelope.failure.node_name,
    has_sidecars: envelope.artifacts.length > 0,
    artifact_count: envelope.artifacts.length,
    failing_item_count: failingItems,
    parent_node_count: parentNodes,
    payload_sha256: sha256Hex(envelope.payloads || {}),
  };
}

module.exports = {
  DEFAULTS,
  loadFailurePackConfig,
  asText,
  byteLength,
  parseDateIso,
  sha256Hex,
  stableJson,
  redactSecrets,
  validateRelativeArtifactPath,
  normalizeArtifactList,
  normalizeFailureStatus,
  normalizeFailurePackEnvelope,
  parseFailurePackSummary,
  summarizeForLog,
};
