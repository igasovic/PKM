'use strict';

module.exports = async function run(ctx) {
  const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');
  const { loadFailurePackConfig, redactSecrets, sha256Hex, byteLength } = require('@igasovic/n8n-blocks/shared/failure-pack.js');
  const { collectEntryIds } = require('@igasovic/n8n-blocks/nodes/00-smoke-master/smoke-state.js');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const posixPath = path.posix;

  const e = (ctx && ctx.$json) || {};
  const env = (ctx && ctx.$env) || {};
  const helpers = (ctx && ctx.helpers) || {};

  const SMOKE_MASTER_WORKFLOW_ID = '2DB1S0mq7UQN4U3InXRM0';
  const SMOKE_MASTER_WORKFLOW_NAME = '00 Smoke - Master';
  const SMOKE_CLEANUP_NODE_PATH = '@igasovic/n8n-blocks/nodes/00-smoke-master/t99-cleanup.js';
  const FAILURE_POST_URL = 'http://pkm-server:8080/debug/failures';
  const FALLBACK_PACK_STATUS = 'partial';

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
        current.forEach((v) => stack.push(v));
      } else {
        Object.keys(current).forEach((k) => stack.push(current[k]));
      }
    }
    return null;
  };

  const toTitle = (slug) => {
    return asText(slug)
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const parseNodeFromSource = (source) => {
    const s = asText(source);
    if (!s) return '';

    const byQuotedNode = s.match(/Node '([^']+)'/i);
    if (byQuotedNode && asText(byQuotedNode[1])) {
      return asText(byQuotedNode[1]);
    }

    const byRepoPath = s.match(/\/src\/n8n\/nodes\/[^/]+\/([a-z0-9_-]+)__[a-f0-9-]+\.js/i);
    if (byRepoPath && asText(byRepoPath[1])) {
      return toTitle(byRepoPath[1]);
    }

    const byExtjs = s.match(/extjs:[^/]+\/([a-z0-9_-]+)__[a-f0-9-]+\.js/i);
    if (byExtjs && asText(byExtjs[1])) {
      return toTitle(byExtjs[1]);
    }

    return '';
  };

  const normalizeJsonValue = (value) => {
    if (value === undefined || value === null) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return { note: 'unserializable' };
    }
  };

  const stableEqual = (a, b) => {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  };

  const flattenMainItems = (data) => {
    if (!data || typeof data !== 'object') return [];
    const main = data.main;
    if (!Array.isArray(main)) return [];
    const out = [];
    for (let b = 0; b < main.length; b += 1) {
      const branch = main[b];
      if (!Array.isArray(branch)) continue;
      for (let i = 0; i < branch.length; i += 1) {
        const item = branch[i];
        if (!item || typeof item !== 'object') continue;
        out.push(item);
      }
    }
    return out;
  };

  const extractRunData = (obj) => {
    const candidates = [
      obj && obj.execution && obj.execution.data && obj.execution.data.resultData && obj.execution.data.resultData.runData,
      obj && obj.execution && obj.execution.runData,
      findFirstValueByKey(obj, 'runData'),
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate;
      }
    }
    return {};
  };

  const extractWorkflowNodeTypeMap = (obj) => {
    const map = new Map();
    const nodes = findFirstValueByKey(obj, 'nodes');
    if (!Array.isArray(nodes)) return map;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const name = asText(node.name);
      if (!name) continue;
      map.set(name, asText(node.type) || null);
    }
    return map;
  };

  const readNodeEntries = (runData, nodeName) => {
    if (!runData || typeof runData !== 'object') return [];
    const entries = runData[nodeName];
    return Array.isArray(entries) ? entries : [];
  };

  const extractNodeItemsFromRunData = (runData, nodeName) => {
    const entries = readNodeEntries(runData, nodeName);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry || typeof entry !== 'object') continue;
      const fromInputData = flattenMainItems(entry.inputData);
      if (fromInputData.length) return fromInputData;
      const fromData = flattenMainItems(entry.data);
      if (fromData.length) return fromData;
    }
    return [];
  };

  const extractDirectParents = (runData, nodeName, typeMap) => {
    const entries = readNodeEntries(runData, nodeName);
    const seen = new Set();
    const parents = [];

    const addParent = (parentName, branchIndex) => {
      const cleanName = asText(parentName);
      if (!cleanName) return;
      const key = `${cleanName}::${branchIndex}`;
      if (seen.has(key)) return;
      seen.add(key);
      parents.push({
        node_name: cleanName,
        node_type: typeMap.get(cleanName) || null,
        branch_index: Number.isFinite(Number(branchIndex)) ? Number(branchIndex) : 0,
      });
    };

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry || typeof entry !== 'object' || !entry.source) continue;
      const source = entry.source;
      const sourceMain = Array.isArray(source.main) ? source.main : [];
      for (let b = 0; b < sourceMain.length; b += 1) {
        const branch = sourceMain[b];
        if (!Array.isArray(branch)) continue;
        for (let j = 0; j < branch.length; j += 1) {
          const ref = branch[j];
          if (!ref || typeof ref !== 'object') continue;
          addParent(ref.previousNode || ref.node || ref.nodeName, b);
        }
      }
    }
    return parents;
  };

  const extractFallbackItems = (obj) => {
    const candidates = [
      findFirstValueByKey(obj, 'inputData'),
      findFirstValueByKey(obj, 'input'),
      findFirstValueByKey(obj, 'items'),
      findFirstValueByKey(obj, 'item'),
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') return [candidate];
    }
    return [];
  };

  const redactItems = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => redactSecrets(normalizeJsonValue(item)));
  };

  const getDateParts = (isoDate) => {
    const dt = new Date(isoDate);
    const yyyy = String(dt.getUTCFullYear());
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return { yyyy, mm, dd };
  };

  const toSafeSlug = (value) => {
    const base = asText(value).toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    return base || 'unknown';
  };

  const buildParentDelta = (parentJson, failingJson) => {
    const parentObj = parentJson && typeof parentJson === 'object' ? parentJson : {};
    const failingObj = failingJson && typeof failingJson === 'object' ? failingJson : {};
    const delta = {};
    const duplicates = [];
    const keys = Object.keys(parentObj);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(failingObj, key) && stableEqual(parentObj[key], failingObj[key])) {
        duplicates.push(key);
      } else {
        delta[key] = parentObj[key];
      }
    }
    return {
      json_delta: delta,
      duplicate_paths_omitted: duplicates,
    };
  };

  const failurePackConfig = loadFailurePackConfig();

  const workflowName = asText(e.workflow && e.workflow.name)
    || asText(e.workflowName)
    || asText(e.workflow && e.workflow.id)
    || 'unknown-workflow';
  const workflowId = asText(e.workflow && e.workflow.id)
    || asText(e.workflowId)
    || asText(findFirstValueByKey(e, 'workflowId'))
    || '';

  const message = asText(e.error && e.error.message)
    || asText(e.errorMessage)
    || asText(e.execution && e.execution.error && e.execution.error.message)
    || asText(e.trigger && e.trigger.error && e.trigger.error.message)
    || 'unknown error';

  const stack = asText(e.execution && e.execution.error && e.execution.error.stack)
    || asText(e.error && e.error.stack);

  const nodeName = asText(e.execution && e.error && e.error.node && e.error.node.name)
    || asText(e.execution && e.execution.error && e.execution.error.node && e.execution.error.node.name)
    || asText(e.error && e.node && e.node.name)
    || asText(e.node && e.node.name)
    || parseNodeFromSource(stack)
    || parseNodeFromSource(message)
    || asText(e.lastNodeExecuted)
    || asText(e.execution && e.lastNodeExecuted)
    || asText(e.trigger && e.mode)
    || 'unknown-node';

  const time = asText(e.execution && e.startedAt)
    || asText(e.execution && e.startTime)
    || asText(e.trigger && e.error && e.error.timestamp)
    || asText(e.timestamp)
    || new Date().toISOString();

  const execId = asText(e.execution && e.id)
    || asText(e.executionId)
    || 'unknown';

  const execUrl = asText(e.execution && e.execution.url)
    || (execId && execId !== 'unknown' ? `/execution/${execId}` : '');
  const runId = asText(findFirstValueByKey(e, 'run_id'))
    || asText(e.run_id)
    || (execId && execId !== 'unknown' ? `n8n-exec-${execId}` : `n8n-error-${Date.now()}`);
  const createdAtIso = new Date().toISOString();

  const messageLower = message.toLowerCase();
  const nodeLower = nodeName.toLowerCase();
  const suppressImapTriggerAutoDeactivation = (
    nodeLower.includes('email trigger (imap)')
    || messageLower.includes('email trigger (imap)')
  ) && messageLower.includes('there was a problem with the trigger node')
    && messageLower.includes('workflow had to be deactivated');

  if (suppressImapTriggerAutoDeactivation) {
    return [];
  }

  const runData = extractRunData(e);
  const typeMap = extractWorkflowNodeTypeMap(e);
  const directParents = extractDirectParents(runData, nodeName, typeMap);

  const failingRawItems = extractNodeItemsFromRunData(runData, nodeName);
  const fallbackItems = extractFallbackItems(e);
  const failingNodeInputItems = redactItems(failingRawItems.length ? failingRawItems : fallbackItems);

  const upstreamNodes = directParents.map((parent) => {
    const parentItemsRaw = extractNodeItemsFromRunData(runData, parent.node_name);
    const redactedParentItems = redactItems(parentItemsRaw);
    const normalizedItems = redactedParentItems.map((item, itemIndex) => {
      const failingRef = failingNodeInputItems[itemIndex]
        && failingNodeInputItems[itemIndex].json
        && typeof failingNodeInputItems[itemIndex].json === 'object'
        ? failingNodeInputItems[itemIndex].json
        : {};
      const parentJson = item && item.json && typeof item.json === 'object' ? item.json : item;
      const delta = buildParentDelta(parentJson, failingRef);
      return {
        parent_item: item,
        json_delta: delta.json_delta,
        duplicate_paths_omitted: delta.duplicate_paths_omitted,
        binary_refs: item && item.binary && typeof item.binary === 'object' ? Object.keys(item.binary) : [],
      };
    });

    return {
      node_name: parent.node_name,
      node_type: parent.node_type,
      branch_index: parent.branch_index,
      item_count: normalizedItems.length,
      items: normalizedItems,
    };
  });

  const artifacts = [];
  const sidecarWriteErrors = [];
  const sidecarMeta = {
    counter: 0,
    dateParts: getDateParts(createdAtIso),
    runSlug: toSafeSlug(runId),
  };

  const maybeWriteSidecar = async (kindPrefix, itemIndex, payload) => {
    const normalizedPayload = normalizeJsonValue(payload);
    const content = JSON.stringify(normalizedPayload);
    const bytes = byteLength(content);
    if (bytes <= Number(failurePackConfig.inline_max_bytes || 65536)) {
      return {
        sidecar_ref: null,
        sha256: sha256Hex(content),
        inlined: normalizedPayload,
      };
    }

    sidecarMeta.counter += 1;
    const ordinal = String(sidecarMeta.counter).padStart(3, '0');
    const relSegments = [
      sidecarMeta.dateParts.yyyy,
      sidecarMeta.dateParts.mm,
      sidecarMeta.dateParts.dd,
      sidecarMeta.runSlug,
      'pack-sidecars',
      `${kindPrefix}-item-${String(itemIndex).padStart(3, '0')}-${ordinal}.json`,
    ];
    const digest = sha256Hex(content);
    try {
      const absolutePath = path.join(failurePackConfig.sidecar_write_dir, ...relSegments);
      const relativePath = posixPath.join(failurePackConfig.sidecar_root_relative, ...relSegments);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
      artifacts.push({
        kind: 'payload-sidecar',
        relative_path: relativePath,
        sha256: digest,
        content_type: 'application/json',
      });
      return {
        sidecar_ref: relativePath,
        sha256: digest,
        inlined: null,
      };
    } catch (sidecarErr) {
      sidecarWriteErrors.push(asText(sidecarErr && sidecarErr.message ? sidecarErr.message : sidecarErr) || 'sidecar_write_failed');
      return {
        sidecar_ref: null,
        sha256: digest,
        inlined: normalizedPayload,
      };
    }
  };

  const failingNodeItems = [];
  for (let i = 0; i < failingNodeInputItems.length; i += 1) {
    const item = failingNodeInputItems[i];
    const sidecar = await maybeWriteSidecar('failing-node-input', i, item);
    failingNodeItems.push({
      json: sidecar.inlined && sidecar.inlined.json && typeof sidecar.inlined.json === 'object'
        ? sidecar.inlined.json
        : sidecar.inlined,
      binary_refs: item && item.binary && typeof item.binary === 'object' ? Object.keys(item.binary) : [],
      paired_item: item && Object.prototype.hasOwnProperty.call(item, 'pairedItem') ? item.pairedItem : null,
      sidecar_ref: sidecar.sidecar_ref,
      sha256: sidecar.sha256,
    });
  }

  const upstreamContextNodes = [];
  for (let i = 0; i < upstreamNodes.length; i += 1) {
    const node = upstreamNodes[i];
    const outputItems = [];
    for (let j = 0; j < node.items.length; j += 1) {
      const parentItem = node.items[j];
      const sidecar = await maybeWriteSidecar(`parent-input-node-${toSafeSlug(node.node_name)}`, j, parentItem.parent_item);
      outputItems.push({
        json_delta: sidecar.inlined
          ? buildParentDelta(
            sidecar.inlined && sidecar.inlined.json && typeof sidecar.inlined.json === 'object'
              ? sidecar.inlined.json
              : sidecar.inlined,
            (failingNodeItems[j] && failingNodeItems[j].json) || {}
          ).json_delta
          : null,
        duplicate_paths_omitted: parentItem.duplicate_paths_omitted,
        binary_refs: parentItem.binary_refs,
        sidecar_ref: sidecar.sidecar_ref,
        sha256: sidecar.sha256,
      });
    }
    upstreamContextNodes.push({
      node_name: node.node_name,
      node_type: node.node_type,
      item_count: outputItems.length,
      items: outputItems,
    });
  }

  const envelope = {
    schema_version: failurePackConfig.schema_version || 'failure-pack.v1',
    created_at: createdAtIso,
    run_id: runId,
    correlation: {
      execution_id: execId === 'unknown' ? null : execId,
      workflow_id: workflowId || null,
      workflow_name: workflowName,
      execution_url: execUrl || null,
      mode: asText(findFirstValueByKey(e, 'mode') || 'production') || 'production',
      retry_of: asText(findFirstValueByKey(e, 'retry_of')) || null,
    },
    failure: {
      node_name: nodeName,
      node_type: asText(findFirstValueByKey(e, 'nodeType')) || null,
      error_name: asText(findFirstValueByKey(e, 'name') || findFirstValueByKey(e, 'errorName')) || null,
      error_message: message,
      stack: stack || null,
      timestamp: time,
    },
    graph: {
      failing_node: nodeName,
      direct_parents: directParents,
    },
    payloads: {
      failing_node_input: {
        item_count: failingNodeItems.length,
        items: failingNodeItems,
      },
      upstream_context: {
        basis: 'direct-parent-input',
        nodes: upstreamContextNodes,
      },
    },
    artifacts,
    redaction: {
      applied: true,
      ruleset_version: failurePackConfig.redaction_ruleset_version || 'v1',
    },
    status: sidecarWriteErrors.length ? FALLBACK_PACK_STATUS : 'captured',
  };

  let failurePackPost = {
    ok: false,
    error: '',
    failure_id: null,
    run_id: runId,
    upsert_action: null,
    status: envelope.status,
  };

  const adminSecret = asText(env.PKM_ADMIN_SECRET);
  if (!adminSecret) {
    envelope.status = FALLBACK_PACK_STATUS;
    failurePackPost = {
      ...failurePackPost,
      error: 'PKM_ADMIN_SECRET missing',
      status: envelope.status,
    };
  } else {
    try {
      const postResult = await helpers.httpRequest({
        method: 'POST',
        url: FAILURE_POST_URL,
        headers: {
          'X-PKM-Run-Id': runId,
          'x-pkm-admin-secret': adminSecret,
        },
        json: true,
        body: envelope,
      });
      failurePackPost = {
        ok: true,
        error: '',
        failure_id: asText(postResult && postResult.failure_id) || null,
        run_id: asText(postResult && postResult.run_id) || runId,
        upsert_action: asText(postResult && postResult.upsert_action) || null,
        status: asText(postResult && postResult.status) || envelope.status,
      };
    } catch (postErr) {
      envelope.status = FALLBACK_PACK_STATUS;
      failurePackPost = {
        ...failurePackPost,
        error: asText(postErr && postErr.message ? postErr.message : postErr) || 'unknown',
        status: envelope.status,
      };
    }
  }

  let smokeCleanupSummary = null;
  const isSmokeMasterError = workflowId === SMOKE_MASTER_WORKFLOW_ID || workflowName === SMOKE_MASTER_WORKFLOW_NAME;
  if (isSmokeMasterError) {
    try {
      const cleanupFn = require(SMOKE_CLEANUP_NODE_PATH);
      const extractedRunId = asText(findFirstValueByKey(e, 'test_run_id')) || asText(message.match(/\b(smoke_\d{4}_\d{2}_\d{2}_\d{6})\b/i)?.[1]);
      const extractedPrior = findFirstValueByKey(e, 'prior_test_mode');
      const extractedResults = findFirstValueByKey(e, 'results');
      const extractedArtifacts = findFirstValueByKey(e, 'artifacts');
      const extractedEntryIds = collectEntryIds(extractedResults, extractedArtifacts, e);
      const cleanupInput = {
        test_run_id: extractedRunId || null,
        prior_test_mode: typeof extractedPrior === 'boolean' ? extractedPrior : false,
        results: Array.isArray(extractedResults) ? extractedResults : [],
        artifacts: {
          ...(extractedArtifacts && typeof extractedArtifacts === 'object' ? extractedArtifacts : {}),
          created_entry_ids: extractedEntryIds,
        },
      };
      const cleanupRows = await cleanupFn({
        ...ctx,
        $json: cleanupInput,
      });
      const cleanupJson = Array.isArray(cleanupRows) && cleanupRows[0] && cleanupRows[0].json ? cleanupRows[0].json : null;
      const cleanupResult = cleanupJson && Array.isArray(cleanupJson.results)
        ? cleanupJson.results.find((row) => row && row.test_case === 'T99-cleanup') || null
        : null;
      smokeCleanupSummary = {
        ok: !!(cleanupResult && cleanupResult.ok === true),
        runId: extractedRunId || null,
        deletedIds: cleanupResult && cleanupResult.artifacts && Array.isArray(cleanupResult.artifacts.deleted_ids)
          ? cleanupResult.artifacts.deleted_ids
          : extractedEntryIds,
        cleanupError: cleanupResult && cleanupResult.error ? asText(cleanupResult.error.message) : '',
      };
    } catch (cleanupErr) {
      smokeCleanupSummary = {
        ok: false,
        runId: null,
        deletedIds: [],
        cleanupError: asText(cleanupErr && cleanupErr.message ? cleanupErr.message : cleanupErr),
      };
    }
  }

  const lines = [
    `n8n error run ${execId}`,
    `WF: ${workflowName}`,
    workflowId ? `WFID: ${workflowId}` : '',
    `Node: ${nodeName}`,
    `When: ${time}`,
    `Msg: ${message.slice(0, 500)}`,
  ].filter(Boolean);
  if (execUrl) lines.push(`Exec: ${execUrl}`);
  lines.push(`Run ID: ${runId}`);
  lines.push(`Failure pack: ${failurePackPost.ok ? 'stored' : 'failed'}`);
  lines.push(`Pack status: ${failurePackPost.status}`);
  if (failurePackPost.failure_id) lines.push(`Failure ID: ${failurePackPost.failure_id}`);
  if (failurePackPost.upsert_action) lines.push(`Pack write: ${failurePackPost.upsert_action}`);
  if (!failurePackPost.ok && failurePackPost.error) {
    lines.push(`Pack error: ${failurePackPost.error.slice(0, 300)}`);
  }
  if (sidecarWriteErrors.length) {
    lines.push(`Sidecar warning: ${sidecarWriteErrors[0].slice(0, 200)}`);
  }
  if (smokeCleanupSummary) {
    lines.push(`Smoke cleanup: ${smokeCleanupSummary.ok ? 'ok' : 'failed'}`);
    if (smokeCleanupSummary.runId) lines.push(`Smoke run: ${smokeCleanupSummary.runId}`);
    if (Array.isArray(smokeCleanupSummary.deletedIds) && smokeCleanupSummary.deletedIds.length) {
      lines.push(`Deleted IDs: ${smokeCleanupSummary.deletedIds.join(',')}`);
    }
    if (smokeCleanupSummary.cleanupError) {
      lines.push(`Cleanup error: ${smokeCleanupSummary.cleanupError.slice(0, 300)}`);
    }
  }

  return [{
    json: {
      telegram_message: mdv2Message(lines.join('\n')),
      failure_pack: {
        run_id: failurePackPost.run_id || runId,
        failure_id: failurePackPost.failure_id,
        status: failurePackPost.status,
        ok: failurePackPost.ok,
      },
    },
  }];
};
