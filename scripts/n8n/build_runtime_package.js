#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'src', 'n8n', 'package.manifest.json');
const NODES_ROOT = path.join(REPO_ROOT, 'src', 'n8n', 'nodes');
const LIBS_ROOT = path.join(REPO_ROOT, 'src', 'libs');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'src', 'n8n', 'package');
const PACKAGE_NAME = '@igasovic/n8n-blocks';

function die(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    die(`Invalid JSON in ${filePath}: ${err.message}`);
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function emptyDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, '\n');
}

function withTrailingNewline(value) {
  const normalized = normalizeNewlines(value);
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function listFilesRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) out.push(fullPath);
    }
  }

  walk(rootDir);
  return out.sort();
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function stableNodeFileName(fileName) {
  return fileName.replace(/__[^./\\]+(?=\.js$)/, '');
}

function stableRuntimeNodePath(relPath) {
  const posixRel = toPosixPath(relPath);
  const parts = posixRel.split('/');
  const fileName = parts.pop() || '';
  return [...parts, stableNodeFileName(fileName)].join('/');
}

function rewriteRuntimeImports(source) {
  let next = normalizeNewlines(source);

  next = next.replace(
    /require\(\s*['"]\/data\/src\/libs\/([^'"]+)['"]\s*\)/g,
    "require('@igasovic/n8n-blocks/shared/$1')",
  );
  next = next.replace(
    /require\(\s*['"](?:\.\.\/)+libs\/([^'"]+)['"]\s*\)/g,
    "require('@igasovic/n8n-blocks/shared/$1')",
  );
  next = next.replace(
    /require\(\s*['"](?:\.\.\/)+src\/libs\/([^'"]+)['"]\s*\)/g,
    "require('@igasovic/n8n-blocks/shared/$1')",
  );
  next = next.replace(
    /require\(\s*['"]\/data\/src\/n8n\/nodes\/([^/'"]+\/[^/'"]+)__[^/'"]+\.js['"]\s*\)/g,
    "require('@igasovic/n8n-blocks/nodes/$1.js')",
  );

  return next;
}

function copyRewrittenFile(srcPath, destPath) {
  const text = fs.readFileSync(srcPath, 'utf8');
  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, withTrailingNewline(rewriteRuntimeImports(text)), 'utf8');
}

function validateSharedFile(relativePath) {
  const sourcePath = path.join(LIBS_ROOT, relativePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    die(`Shared package source missing: src/libs/${relativePath}`);
  }
}

function buildPackage() {
  const manifest = readJson(MANIFEST_PATH);
  if (manifest.name !== PACKAGE_NAME) {
    die(`Package manifest name must be ${PACKAGE_NAME}. Found: ${manifest.name}`);
  }

  emptyDir(OUTPUT_ROOT);

  const nodeFiles = listFilesRecursive(NODES_ROOT).filter((filePath) => filePath.endsWith('.js'));
  let stagedNodeCount = 0;
  for (const absPath of nodeFiles) {
    const relPath = path.relative(NODES_ROOT, absPath);
    const stableRelPath = stableRuntimeNodePath(relPath);
    const destPath = path.join(OUTPUT_ROOT, 'nodes', stableRelPath);
    copyRewrittenFile(absPath, destPath);
    stagedNodeCount += 1;
  }

  const sharedFiles = Array.isArray(manifest.shared) ? manifest.shared : [];
  for (const relPath of sharedFiles) {
    validateSharedFile(relPath);
    copyRewrittenFile(
      path.join(LIBS_ROOT, relPath),
      path.join(OUTPUT_ROOT, 'shared', relPath),
    );
  }

  const packageJson = {
    name: manifest.name,
    version: manifest.version,
    private: manifest.private !== false,
    type: 'commonjs',
    description: manifest.description || 'Internal runtime package for n8n Code nodes.',
    exports: {
      './package.json': './package.json',
      './nodes/*': './nodes/*',
      './shared/*': './shared/*',
    },
    dependencies: manifest.dependencies && typeof manifest.dependencies === 'object'
      ? manifest.dependencies
      : {},
  };
  fs.writeFileSync(
    path.join(OUTPUT_ROOT, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(OUTPUT_ROOT, 'package.manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const scopeDir = path.join(OUTPUT_ROOT, 'node_modules', '@igasovic');
  ensureDir(scopeDir);
  const selfLinkPath = path.join(scopeDir, 'n8n-blocks');
  fs.rmSync(selfLinkPath, { recursive: true, force: true });
  fs.symlinkSync(path.relative(scopeDir, OUTPUT_ROOT), selfLinkPath, 'dir');

  const legacyImportHits = [];
  for (const filePath of listFilesRecursive(OUTPUT_ROOT)) {
    if (!filePath.endsWith('.js')) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    if (text.includes('/data/src/')) {
      legacyImportHits.push(toPosixPath(path.relative(REPO_ROOT, filePath)));
    }
  }
  if (legacyImportHits.length > 0) {
    die(`Legacy /data runtime imports remain in package output:\n- ${legacyImportHits.join('\n- ')}`);
  }

  console.log(`Package output: ${toPosixPath(path.relative(REPO_ROOT, OUTPUT_ROOT))}`);
  console.log(`Staged nodes: ${stagedNodeCount}`);
  console.log(`Staged shared files: ${sharedFiles.length}`);
  console.log(`Package name: ${manifest.name}`);
  console.log(`Package version: ${manifest.version}`);
}

buildPackage();
