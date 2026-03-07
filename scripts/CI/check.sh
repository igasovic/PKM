#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> CI check (local): $ROOT"

search_text() {
  local pattern="$1"
  local path="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -n --hidden --glob '!**/node_modules/**' -S "$pattern" "$path" 2>/dev/null || true
  else
    grep -R -n -E "$pattern" "$path" 2>/dev/null || true
  fi
}

# --------
# 1) Hybrid migration rule: no *new* files under legacy js/
#    (edits to existing files are allowed)
# --------
echo "==> Checking legacy js/ policy (no new files under js/)..."
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  # List newly added files (A) compared to HEAD
  NEW_FILES="$(git -C "$ROOT" diff --name-status --diff-filter=A HEAD | awk '{print $2}' || true)"
  if echo "$NEW_FILES" | grep -qE '^js/'; then
    echo "ERROR: New files were added under legacy js/. Add new n8n code under src/n8n/ instead."
    echo "New files:"
    echo "$NEW_FILES" | grep -E '^js/' || true
    exit 1
  fi
else
  echo "WARN: Not a git repo; skipping new-file checks."
fi

# --------
# 2) DB safety: flag likely raw SQL usage outside allowed files
#    Allowed:
#      - src/libs/sql-builder.js
#      - src/server/db.js
# --------
echo "==> Checking for likely raw SQL outside allowed files..."
# Heuristic patterns; tune as you learn false positives
SQL_PATTERNS='(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b'
ALLOWED_1='src/libs/sql-builder.js'
ALLOWED_2='src/server/db.js'

# Search only in src/ and only in JS/TS-ish files
MATCHES="$(rg -n --hidden --glob '!**/node_modules/**' \
  -S "$SQL_PATTERNS" "$ROOT/src" \
  --glob '**/*.js' --glob '**/*.cjs' --glob '**/*.mjs' --glob '**/*.ts' --glob '**/*.tsx' \
  2>/dev/null || true)"

if [[ -n "$MATCHES" ]]; then
  # Filter out allowed files
  VIOLATIONS="$(echo "$MATCHES" | grep -vE "^$ROOT/$ALLOWED_1:" | grep -vE "^$ROOT/$ALLOWED_2:" || true)"
  # rg output might not be rooted; handle relative output too
  VIOLATIONS="$(echo "$VIOLATIONS" | grep -vE "^$ALLOWED_1:" | grep -vE "^$ALLOWED_2:" || true)"

  if [[ -n "$VIOLATIONS" ]]; then
    echo "ERROR: Likely raw SQL found outside allowed files:"
    echo "$VIOLATIONS"
    echo
    echo "Rule: No raw SQL outside:"
    echo "  - $ALLOWED_1"
    echo "  - $ALLOWED_2"
    exit 1
  fi
fi

# --------
# 3) n8n safety checks
# --------
echo "==> Checking n8n workflow safety rules..."
N8N_WF_DIR="$ROOT/src/n8n/workflows"
N8N_NODES_DIR="$ROOT/src/n8n/nodes"

if [[ -d "$N8N_WF_DIR" ]]; then
  LEGACY_REFS="$(search_text '/data/js/workflows/' "$N8N_WF_DIR")"
  if [[ -n "$LEGACY_REFS" ]]; then
    echo "ERROR: Legacy wrapper paths found in canonical workflows:"
    echo "$LEGACY_REFS"
    exit 1
  fi

  MISSING_TARGETS="$(
    python3 - "$N8N_WF_DIR" "$N8N_NODES_DIR" <<'PY'
import json
import pathlib
import re
import sys

wf_dir = pathlib.Path(sys.argv[1])
nodes_dir = pathlib.Path(sys.argv[2])
missing = []
for wf in sorted(wf_dir.glob("*.json")):
    try:
        data = json.loads(wf.read_text(encoding="utf-8"))
    except Exception:
        continue
    for node in data.get("nodes", []):
        js = (node.get("parameters") or {}).get("jsCode", "")
        m = re.search(r"/data/src/n8n/nodes/([^'\\\"]+\\.js)", js)
        if m and not (nodes_dir / m.group(1)).exists():
            missing.append(f"{wf.name}: {node.get('name')} -> {m.group(1)}")
if missing:
    print("\n".join(missing))
PY
  )"
  if [[ -n "$MISSING_TARGETS" ]]; then
    echo "ERROR: Missing canonical wrapper targets:"
    echo "$MISSING_TARGETS"
    exit 1
  fi
else
  echo "WARN: $N8N_WF_DIR not found. Skipping n8n workflow safety checks."
fi

# --------
# 4) Tests: run backend Jest from src/server
# --------
echo "==> Running backend tests (Jest) from src/server..."
BACKEND_DIR="$ROOT/src/server"

if [[ -f "$BACKEND_DIR/package.json" ]]; then
  if command -v npm >/dev/null 2>&1; then
    # Install deps if node_modules missing
    if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
      echo "==> Installing backend deps (npm install)..."
      (cd "$BACKEND_DIR" && npm install)
    fi

    echo "==> npm test (src/server)..."
    (cd "$BACKEND_DIR" && npm test)
  else
    echo "WARN: npm not found. Skipping tests."
  fi
else
  echo "WARN: src/server/package.json not found. Skipping backend tests."
fi

echo "✅ All checks passed."
