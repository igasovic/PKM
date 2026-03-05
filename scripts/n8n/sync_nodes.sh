#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "Neither 'python3' nor 'python' is available in PATH." >&2
    exit 1
  fi
fi

if [[ -z "${N8N_API_KEY:-}" ]]; then
  echo "N8N_API_KEY is required." >&2
  echo "Set it first, for example:" >&2
  echo "  export N8N_API_KEY='<key>'" >&2
  echo "  export N8N_API_BASE_URL='http://127.0.0.1:5678'" >&2
  exit 1
fi

"$PYTHON_BIN" "$REPO_DIR/scripts/n8n/sync_nodes.py" "$@"
