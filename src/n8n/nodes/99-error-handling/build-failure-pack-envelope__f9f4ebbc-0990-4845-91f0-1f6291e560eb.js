'use strict';

module.exports = async function run(ctx) {
  const { loadFailurePackConfig, redactSecrets, sha256Hex, byteLength } = require('igasovic-n8n-blocks/shared/failure-pack.js');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const posixPath = path.posix;

  const input = (ctx && ctx.$json) || {};
  const e = (input && input.error_event && typeof input.error_event === 'object') ? input.error_event : {};

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
      const sourceMain = Array.isArray(entry.source.main) ? entry.source.main : [];
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

  const workflowName = asText(input.workflow_name) || 'unknown-workflow';
  const workflowId = asText(input.workflow_id);
  const nodeName = asText(input.node_name) || 'unknown-node';
  const message = asText(input.error_message) || 'unknown error';
  const stack = asText(input.error_stack);
  const time = asText(input.failed_at) || new Date().toISOString();
  const execId = asText(input.execution_id) || 'unknown';
  const execUrl = asText(input.execution_url);
  const runId = asText(input.run_id) || `n8n-error-${Date.now()}`;
  const createdAtIso = asText(input.created_at_iso) || new Date().toISOString();

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
    status: sidecarWriteErrors.length ? 'partial' : 'captured',
  };

  return [{
    json: {
      ...input,
      sidecar_write_errors: sidecarWriteErrors,
      failure_pack_envelope: envelope,
      failure_pack_post: {
        ok: false,
        error: 'not_posted',
        failure_id: null,
        run_id: runId,
        upsert_action: null,
        status: envelope.status,
      },
    },
  }];
};
