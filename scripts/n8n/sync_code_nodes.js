#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function die(message) {
  console.error(message);
  process.exit(1);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, "\n");
}

function withTrailingNewline(text) {
  const normalized = normalizeNewlines(text);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function nonEmptyLineCount(text) {
  return normalizeNewlines(text)
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

function toPosixPath(inputPath) {
  return String(inputPath).split(path.sep).join(path.posix.sep);
}

function normalizeAbs(inputPath) {
  return path.resolve(inputPath);
}

function extractWrapperRelativePath(jsCode) {
  const normalized = normalizeNewlines(jsCode);
  const requireMatch = normalized.match(
    /require\(\s*['"]\/data\/js\/workflows\/([^'"]+?\.js)['"]\s*\)/
  );
  if (!requireMatch) {
    return null;
  }
  return requireMatch[1];
}

function buildWrapper(wrapperRelativePath) {
  return (
    `try{const fn=require('/data/js/workflows/${wrapperRelativePath}');` +
    "return await fn({$input,$json,$items,$node,$env,helpers});}" +
    `catch(e){e.message=\`[extjs:${wrapperRelativePath}] \${e.message}\`;throw e;}`
  );
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    die(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function listJsonFiles(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(dirPath, name));
}

function listFilesRecursive(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) {
    return out;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

function emptyDir(dirPath) {
  ensureDir(dirPath);
  for (const name of fs.readdirSync(dirPath)) {
    const abs = path.join(dirPath, name);
    fs.rmSync(abs, { recursive: true, force: true });
  }
}

function deleteEmptyParents(filePath, stopDir) {
  let current = path.dirname(filePath);
  const stop = normalizeAbs(stopDir);
  while (normalizeAbs(current).startsWith(stop)) {
    if (normalizeAbs(current) === stop) {
      break;
    }
    const children = fs.readdirSync(current);
    if (children.length > 0) {
      break;
    }
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function nodeIdFromFileName(fileName) {
  const match = fileName.match(/__([^.\/]+)\.js$/);
  return match ? match[1] : null;
}

function isManagedNodeJsFile(filePath) {
  return /__([^.\/]+)\.js$/.test(path.basename(filePath));
}

function buildNodeFileIndex(jsRootDir) {
  const index = new Map();
  const files = listFilesRecursive(jsRootDir).filter(
    (f) => f.endsWith(".js") && isManagedNodeJsFile(f)
  );
  for (const abs of files) {
    const id = nodeIdFromFileName(path.basename(abs));
    if (!id) {
      continue;
    }
    if (!index.has(id)) {
      index.set(id, []);
    }
    index.get(id).push(abs);
  }
  return index;
}

function firstExisting(paths) {
  for (const candidate of paths) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function sanitizeNodeId(rawId) {
  const value = String(rawId || "node");
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function workflowSlugFromObject(workflow) {
  const fromName = slugify(workflow?.name || "");
  return fromName || "workflow";
}

function nodeFileName(node) {
  const nodeName = slugify(node?.name || "code-node") || "code-node";
  const nodeId = sanitizeNodeId(node?.id || nodeName);
  return `${nodeName}__${nodeId}.js`;
}

function isCodeNode(node) {
  return node?.type === "n8n-nodes-base.code";
}

function parseArgs(argv) {
  if (argv.length !== 6) {
    die(
      "Usage: sync_code_nodes.js <raw_dir> <patched_raw_dir> <repo_workflows_dir> <js_root_dir> <min_lines>"
    );
  }

  const rawDir = path.resolve(argv[1]);
  const patchedRawDir = path.resolve(argv[2]);
  const repoWorkflowsDir = path.resolve(argv[3]);
  const jsRootDir = path.resolve(argv[4]);
  const minLines = Number(argv[5]);

  if (!Number.isFinite(minLines) || minLines < 1) {
    die(`Invalid min_lines: ${argv[5]}`);
  }
  if (!fs.existsSync(rawDir) || !fs.statSync(rawDir).isDirectory()) {
    die(`Missing raw workflows dir: ${rawDir}`);
  }
  if (!fs.existsSync(repoWorkflowsDir) || !fs.statSync(repoWorkflowsDir).isDirectory()) {
    die(`Missing repo workflows dir: ${repoWorkflowsDir}`);
  }

  ensureDir(jsRootDir);
  ensureDir(patchedRawDir);
  return { rawDir, patchedRawDir, repoWorkflowsDir, jsRootDir, minLines };
}

function resolveSourceForWrapper({
  jsCode,
  nodeId,
  jsRootDir,
  nodeFileIndex,
}) {
  const wrapperRel = extractWrapperRelativePath(jsCode);
  if (!wrapperRel) {
    return { wrapperRel: null, sourcePath: null };
  }

  const wrapperAbs = path.join(jsRootDir, wrapperRel);
  const byIdCandidates = nodeFileIndex.get(String(nodeId || "")) || [];
  const sourcePath = firstExisting([wrapperAbs, ...byIdCandidates]);
  return { wrapperRel, sourcePath };
}

function main() {
  const { rawDir, patchedRawDir, repoWorkflowsDir, jsRootDir, minLines } = parseArgs(
    process.argv.slice(1)
  );

  emptyDir(patchedRawDir);
  const rawFiles = listJsonFiles(rawDir);
  const nodeFileIndex = buildNodeFileIndex(jsRootDir);
  const expectedJsFiles = new Set();

  let patchedNodes = 0;
  let movedFiles = 0;
  let createdFiles = 0;
  let inlinedNodes = 0;
  let skippedMissingSource = 0;
  let missingJsCode = 0;
  const workflowCreated = [];
  const workflowUpdated = [];
  const nodeAdded = [];
  const nodeUpdated = [];
  const nodeMoved = [];
  const nodeDeleted = [];

  for (const rawFile of rawFiles) {
    const fileName = path.basename(rawFile);
    const workflow = readJson(rawFile);
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const workflowSlug = workflowSlugFromObject(workflow);

    for (const node of nodes) {
      if (!isCodeNode(node)) {
        continue;
      }

      const jsCode = node?.parameters?.jsCode;
      if (typeof jsCode !== "string" || jsCode.trim() === "") {
        missingJsCode += 1;
        continue;
      }

      const nodeId = String(node?.id || "");
      const { wrapperRel, sourcePath } = resolveSourceForWrapper({
        jsCode,
        nodeId,
        jsRootDir,
        nodeFileIndex,
      });

      let effectiveCode = jsCode;
      let sourceAbs = null;
      if (wrapperRel) {
        if (!sourcePath) {
          skippedMissingSource += 1;
          continue;
        }
        sourceAbs = normalizeAbs(sourcePath);
        effectiveCode = fs.readFileSync(sourceAbs, "utf8");
      }

      const lineCount = nonEmptyLineCount(effectiveCode);
      if (lineCount < minLines) {
        const previousCode = String(node?.parameters?.jsCode || "");
        node.parameters = node.parameters || {};
        node.parameters.jsCode = normalizeNewlines(effectiveCode);
        if (normalizeNewlines(previousCode) !== normalizeNewlines(node.parameters.jsCode)) {
          nodeUpdated.push(
            `${workflowSlug}/${nodeFileName(node)} (inlined: under ${minLines} lines)`
          );
        }
        inlinedNodes += 1;
        patchedNodes += 1;
        continue;
      }

      const desiredRel = toPosixPath(path.join(workflowSlug, nodeFileName(node)));
      const desiredAbs = normalizeAbs(path.join(jsRootDir, desiredRel));
      ensureDir(path.dirname(desiredAbs));

      const normalizedCode = withTrailingNewline(effectiveCode);
      if (sourceAbs && sourceAbs !== desiredAbs && fs.existsSync(sourceAbs)) {
        if (fs.existsSync(desiredAbs)) {
          fs.writeFileSync(desiredAbs, normalizedCode, "utf8");
          fs.rmSync(sourceAbs, { force: true });
          nodeUpdated.push(toPosixPath(path.relative(jsRootDir, desiredAbs)));
        } else {
          fs.renameSync(sourceAbs, desiredAbs);
          nodeMoved.push(
            `${toPosixPath(path.relative(jsRootDir, sourceAbs))} -> ${toPosixPath(
              path.relative(jsRootDir, desiredAbs)
            )}`
          );
        }
        movedFiles += 1;
      } else if (!fs.existsSync(desiredAbs)) {
        fs.writeFileSync(desiredAbs, normalizedCode, "utf8");
        nodeAdded.push(toPosixPath(path.relative(jsRootDir, desiredAbs)));
        createdFiles += 1;
      } else {
        const existing = fs.readFileSync(desiredAbs, "utf8");
        if (normalizeNewlines(existing) !== normalizeNewlines(normalizedCode)) {
          fs.writeFileSync(desiredAbs, normalizedCode, "utf8");
          nodeUpdated.push(toPosixPath(path.relative(jsRootDir, desiredAbs)));
        }
      }

      const prevJsCode = String(node?.parameters?.jsCode || "");
      node.parameters = node.parameters || {};
      node.parameters.jsCode = buildWrapper(desiredRel);
      if (normalizeNewlines(prevJsCode) !== normalizeNewlines(node.parameters.jsCode)) {
        nodeUpdated.push(`${desiredRel} (wrapper)`);
      }
      expectedJsFiles.add(desiredAbs);
      patchedNodes += 1;
    }

    const patchedRawPath = path.join(patchedRawDir, fileName);
    writeJson(patchedRawPath, workflow);
    const repoWorkflowPath = path.join(repoWorkflowsDir, fileName);
    const nextRepoJson = `${JSON.stringify(workflow, null, 2)}\n`;
    if (!fs.existsSync(repoWorkflowPath)) {
      workflowCreated.push(fileName);
    } else {
      const prevRepoJson = fs.readFileSync(repoWorkflowPath, "utf8");
      if (normalizeNewlines(prevRepoJson) !== normalizeNewlines(nextRepoJson)) {
        workflowUpdated.push(fileName);
      }
    }
    fs.writeFileSync(repoWorkflowPath, nextRepoJson, "utf8");
  }

  const allJsFiles = listFilesRecursive(jsRootDir).filter(
    (f) => f.endsWith(".js") && isManagedNodeJsFile(f)
  );
  let removedOrphans = 0;
  for (const jsFile of allJsFiles) {
    const abs = normalizeAbs(jsFile);
    if (expectedJsFiles.has(abs)) {
      continue;
    }
    fs.rmSync(abs, { force: true });
    nodeDeleted.push(toPosixPath(path.relative(jsRootDir, abs)));
    deleteEmptyParents(abs, jsRootDir);
    removedOrphans += 1;
  }

  console.log("Workflows created:");
  if (workflowCreated.length === 0) {
    console.log("- none");
  } else {
    for (const item of workflowCreated.sort()) {
      console.log(`- ${item}`);
    }
  }

  console.log("Workflows updated:");
  if (workflowUpdated.length === 0) {
    console.log("- none");
  } else {
    for (const item of workflowUpdated.sort()) {
      console.log(`- ${item}`);
    }
  }

  console.log("Nodes added:");
  if (nodeAdded.length === 0) {
    console.log("- none");
  } else {
    for (const item of nodeAdded.sort()) {
      console.log(`- ${item}`);
    }
  }

  console.log("Nodes updated:");
  if (nodeUpdated.length === 0) {
    console.log("- none");
  } else {
    for (const item of nodeUpdated.sort()) {
      console.log(`- ${item}`);
    }
  }

  console.log("Nodes moved:");
  if (nodeMoved.length === 0) {
    console.log("- none");
  } else {
    for (const item of nodeMoved.sort()) {
      console.log(`- ${item}`);
    }
  }

  console.log("Nodes deleted:");
  if (nodeDeleted.length === 0) {
    console.log("- none");
  } else {
    for (const item of nodeDeleted.sort()) {
      console.log(`- ${item}`);
    }
  }

  console.log(
    [
      "Node sync complete:",
      `patched_nodes=${patchedNodes}`,
      `moved_files=${movedFiles}`,
      `created_files=${createdFiles}`,
      `inlined_nodes=${inlinedNodes}`,
      `removed_orphans=${removedOrphans}`,
      `missing_js_code=${missingJsCode}`,
      `skipped_missing_source=${skippedMissingSource}`,
      `min_lines=${minLines}`,
    ].join(" ")
  );
}

main();
