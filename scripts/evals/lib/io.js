'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function resolveRepoPath(...parts) {
  return path.join(REPO_ROOT, ...parts);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTextFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, 'utf8');
}

function utcStamp() {
  const iso = new Date().toISOString();
  return iso.replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

function parseArgs(argv) {
  const out = { _: [] };
  const parts = Array.isArray(argv) ? argv.slice(2) : [];
  for (let i = 0; i < parts.length; i += 1) {
    const token = String(parts[i] || '');
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = parts[i + 1];
    if (next && !String(next).startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function toInt(value, fallbackValue) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallbackValue;
  return Math.trunc(n);
}

function toFixedPct(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

module.exports = {
  REPO_ROOT,
  resolveRepoPath,
  ensureDir,
  readJsonFile,
  writeJsonFile,
  writeTextFile,
  utcStamp,
  parseArgs,
  toInt,
  toFixedPct,
};
