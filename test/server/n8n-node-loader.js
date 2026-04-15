'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, 'src', 'n8n', 'workflows');
const NODES_DIR = path.join(REPO_ROOT, 'src', 'n8n', 'nodes');

function findSingleFile(dirPath, prefix, suffix) {
  const matches = fs.readdirSync(dirPath)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .sort();

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one match for ${prefix}*${suffix} in ${dirPath}, found ${matches.length}`);
  }

  return path.join(dirPath, matches[0]);
}

function requireExternalizedNode(workflowSlug, stableStem) {
  const workflowDir = path.join(NODES_DIR, workflowSlug);
  const filePath = findSingleFile(workflowDir, `${stableStem}__`, '.js');
  return require(filePath);
}

function loadInlineCodeNode(workflowSlug, nodeName) {
  const workflowPath = findSingleFile(WORKFLOWS_DIR, `${workflowSlug}__`, '.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const node = Array.isArray(workflow.nodes)
    ? workflow.nodes.find((candidate) => candidate && candidate.name === nodeName)
    : null;

  if (!node) {
    throw new Error(`Inline node "${nodeName}" not found in workflow ${workflowPath}`);
  }

  const jsCode = node.parameters && node.parameters.jsCode;
  if (typeof jsCode !== 'string' || !jsCode.trim()) {
    throw new Error(`Inline node "${nodeName}" in ${workflowPath} does not contain jsCode`);
  }

  const workflowRequire = createRequire(workflowPath);
  const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor;

  let runInline = null;
  let mode = 'n8n-args';
  try {
    runInline = new AsyncFunction(
      'require',
      '$json',
      '$input',
      '$items',
      '$node',
      '$env',
      'helpers',
      jsCode,
    );
  } catch (err) {
    // Some legacy inline nodes still use module-style ctx access.
    runInline = new AsyncFunction('require', 'ctx', jsCode);
    mode = 'ctx';
  }

  return async function executeInline(ctx = {}) {
    if (mode === 'ctx') {
      return runInline(workflowRequire, ctx);
    }
    return runInline(
      workflowRequire,
      ctx.$json,
      ctx.$input,
      ctx.$items,
      ctx.$node,
      ctx.$env,
      ctx.helpers,
    );
  };
}

module.exports = {
  loadInlineCodeNode,
  requireExternalizedNode,
};
