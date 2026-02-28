#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> Running repo checks in: $ROOT"

# -----------------------------
# 1) Prevent new legacy n8n code in js/
# Hybrid policy: edits allowed, but NEW files under js/ are forbidden.
# -----------------------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  added_js_files="$(git diff --name-status --diff-filter=A HEAD -- 'js/**' 2>/dev/null || true)"
  if [[ -n "${added_js_files}" ]]; then
    echo "ERROR: New files detected under legacy js/ (Hybrid policy forbids new files in js/)."
    echo "Move new code to src/n8n/ instead, or explicitly override this policy."
    echo
    echo "${added_js_files}"
    exit 1
  fi
else
  echo "WARN: Not a git repo? Skipping 'new files under js/' check."
fi

# -----------------------------
# 2) Raw SQL guardrail
# Enforce: no SQL keywords outside allowed files.
# Note: heuristic check; tune patterns if it false-positives.
# -----------------------------
ALLOW_1="src/libs/sql-builder.js"
ALLOW_2="src/server/db.js"

echo "==> Checking for raw SQL outside allowed files..."
# Search only under src/ (exclude docs, workflows, tests by design)
# Exclude allowed files explicitly.
# This flags common SQL statements appearing in strings/templates.
violations="$(
  rg -n --no-heading -S -i \
    '(?<![a-z])\b(select|insert|update|delete|create|alter|drop|truncate)\b' \
    src \
    --glob "!${ALLOW_1}" \
    --glob "!${ALLOW_2}" \
    || true
)"

if [[ -n "${violations}" ]]; then
  echo "ERROR: Possible raw SQL found outside allowed files:"
  echo "  - ${ALLOW_1}"
  echo "  - ${ALLOW_2}"
  echo
  echo "${violations}"
  echo
  echo "Fix: move SQL into the allowed layer (sql-builder/db module) and expose a DB method."
  exit 1
fi

# -----------------------------
# 3) Run Jest (best-effort)
# -----------------------------
echo "==> Running Jest..."

if [[ -f package.json ]]; then
  # Prefer explicit npm script if it exists; fall back progressively.
  if node -e "const p=require('./package.json');process.exit(!(p.scripts&&p.scripts.test))" >/dev/null 2>&1; then
    npm test
  elif node -e "const p=require('./package.json');process.exit(!(p.scripts&&p.scripts.jest))" >/dev/null 2>&1; then
    npm run jest
  elif npx --no-install jest --version >/dev/null 2>&1; then
    npx jest
  else
    echo "WARN: Could not determine how to run Jest (no test/jest script, and npx jest unavailable)."
    echo "Add a package.json script (recommended):"
    echo '  "scripts": { "test": "jest" }'
  fi
else
  echo "WARN: No package.json found; skipping Jest."
fi

echo "==> All checks passed."