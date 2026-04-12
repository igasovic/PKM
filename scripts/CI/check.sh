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
# 1) n8n path rule: legacy js/ tree is sunset and must not exist
# --------
echo "==> Checking legacy js/ sunset (js/ must be absent)..."
if [[ -d "$ROOT/js" ]]; then
  echo "ERROR: Legacy js/ directory still exists. Use src/n8n/workflows and src/n8n/nodes only."
  find "$ROOT/js" -maxdepth 2 -type f | sed "s#^$ROOT/##" | head -n 20
  exit 1
fi

# --------
# 2) DB safety: flag likely raw SQL usage outside allowed files
#    Allowed:
#      - src/libs/sql-builder.js
#      - src/server/db/**
# --------
echo "==> Checking for likely raw SQL outside allowed files..."
# Heuristic patterns; tune as you learn false positives
SQL_PATTERNS='(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b'
ALLOWED_1='src/libs/sql-builder.js'
ALLOWED_2='src/server/db/'

# Search only in src/ and only in JS/TS-ish files
MATCHES="$(rg -n --hidden --glob '!**/node_modules/**' \
  -S "$SQL_PATTERNS" "$ROOT/src" \
  --glob '**/*.js' --glob '**/*.cjs' --glob '**/*.mjs' --glob '**/*.ts' --glob '**/*.tsx' \
  2>/dev/null || true)"

if [[ -n "$MATCHES" ]]; then
  # Filter out allowed files
  VIOLATIONS="$(echo "$MATCHES" | grep -vE "^$ROOT/$ALLOWED_1:" || true)"
  VIOLATIONS="$(echo "$VIOLATIONS" | grep -vE "^$ROOT/$ALLOWED_2" || true)"
  # rg output might not be rooted; handle relative output too
  VIOLATIONS="$(echo "$VIOLATIONS" | grep -vE "^$ALLOWED_1:" || true)"
  VIOLATIONS="$(echo "$VIOLATIONS" | grep -vE "^$ALLOWED_2" || true)"

  if [[ -n "$VIOLATIONS" ]]; then
    echo "ERROR: Likely raw SQL found outside allowed files:"
    echo "$VIOLATIONS"
    echo
    echo "Rule: No raw SQL outside:"
    echo "  - $ALLOWED_1"
    echo "  - ${ALLOWED_2}**"
    exit 1
  fi
fi

# --------
# 3) n8n safety checks
# --------
echo "==> Checking n8n workflow safety rules..."
N8N_WF_DIR="$ROOT/src/n8n/workflows"
N8N_NODES_DIR="$ROOT/src/n8n/nodes"
N8N_PACKAGE_BUILD_SCRIPT="$ROOT/scripts/n8n/build_runtime_package.js"

if [[ -d "$N8N_WF_DIR" ]]; then
  if [[ ! -x "$N8N_PACKAGE_BUILD_SCRIPT" ]]; then
    echo "ERROR: n8n runtime package build script missing or not executable: $N8N_PACKAGE_BUILD_SCRIPT"
    exit 1
  fi

  echo "==> Building generated n8n runtime package..."
  node "$N8N_PACKAGE_BUILD_SCRIPT"

  LEGACY_RUNTIME_IMPORTS="$(
    rg -n -S "/data/src/(n8n|libs)/" "$N8N_WF_DIR" "$N8N_NODES_DIR" 2>/dev/null || true
  )"
  if [[ -n "$LEGACY_RUNTIME_IMPORTS" ]]; then
    echo "ERROR: Legacy /data runtime imports found in canonical n8n sources:"
    echo "$LEGACY_RUNTIME_IMPORTS"
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
        m = re.search(r"@igasovic/n8n-blocks/nodes/([^'\\\"]+\\.js)", js)
        if not m:
            continue
        rel = pathlib.Path(m.group(1))
        direct = nodes_dir / rel
        if direct.exists():
            continue
        workflow_dir = nodes_dir / rel.parent
        matches = list(workflow_dir.glob(f"{rel.stem}__*.js")) if workflow_dir.exists() else []
        if not matches:
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

  N8N_WORKFLOW_GUARDS="$(
    python3 - "$N8N_WF_DIR" <<'PY'
import json
import pathlib
import sys

wf_dir = pathlib.Path(sys.argv[1])
expected_error_workflow = "R2r3jkL5Rb39zKpyutwhW"
errors = []

all_workflows = sorted(wf_dir.glob("*.json"))
if not all_workflows:
    errors.append("no workflow files found under src/n8n/workflows")

for wf_path in all_workflows:
    try:
        wf = json.loads(wf_path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{wf_path.name}: invalid JSON ({exc})")
        continue

    settings = wf.get("settings") if isinstance(wf.get("settings"), dict) else {}
    error_wf = str(settings.get("errorWorkflow") or "").strip()
    # All workflows except WF99 must route failures to WF99.
    if not wf_path.name.startswith("99-error-handling__") and error_wf != expected_error_workflow:
        errors.append(
            f"{wf_path.name}: settings.errorWorkflow must be '{expected_error_workflow}' (found '{error_wf or '<<empty>>'}')"
        )

    # Guard against inline Code-node context regressions on Todoist workflows.
    if wf_path.name.startswith(("34-todoist-sync__", "35-todoist-daily-focus__", "36-todoist-waiting-radar__", "37-todoist-weekly-pruning__")):
        for node in wf.get("nodes", []):
            js = ((node.get("parameters") or {}).get("jsCode") or "")
            if not isinstance(js, str) or not js:
                continue
            if "ctx." in js or "ctx &&" in js or "(ctx" in js:
                node_name = str(node.get("name") or "<<unnamed>>")
                errors.append(f"{wf_path.name}: inline jsCode must not reference ctx ({node_name})")

if errors:
    print("\n".join(errors))
PY
  )"
  if [[ -n "$N8N_WORKFLOW_GUARDS" ]]; then
    echo "ERROR: n8n workflow static guards failed:"
    echo "$N8N_WORKFLOW_GUARDS"
    exit 1
  fi
else
  echo "WARN: $N8N_WF_DIR not found. Skipping n8n workflow safety checks."
fi

# --------
# 4) Docs parity: backend routes and env vars must stay reflected in docs
# --------
echo "==> Regenerating backend route registry from source-of-truth..."
node "$ROOT/scripts/CI/export_backend_route_registry.js" --write

echo "==> Checking backend route/doc parity..."
python3 "$ROOT/scripts/CI/check_backend_route_docs.py"

echo "==> Checking backend env/doc parity..."
python3 "$ROOT/scripts/CI/check_backend_env_docs.py"

echo "==> Regenerating backend test surface matrix..."
python3 "$ROOT/scripts/CI/generate_backend_test_surface_matrix.py" --write

# --------
# 5) Tests: run backend Jest from src/server
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
