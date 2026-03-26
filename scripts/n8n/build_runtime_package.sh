#!/usr/bin/env bash
set -euo pipefail

RED=$'\033[31m'
RESET=$'\033[0m'

err() {
  if [[ -t 2 ]]; then
    printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2
  else
    printf '%s\n' "$*" >&2
  fi
}

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_PACKAGE_SCRIPT="${BUILD_PACKAGE_SCRIPT:-$REPO_DIR/scripts/n8n/build_runtime_package.js}"
NODE_BIN="${NODE_BIN:-}"
NODE_DOCKER_IMAGE="${NODE_DOCKER_IMAGE:-node:22-bookworm-slim}"

resolve_node_bin() {
  if [[ -n "$NODE_BIN" ]]; then
    if command -v "$NODE_BIN" >/dev/null 2>&1; then
      printf '%s\n' "$NODE_BIN"
      return 0
    fi
    err "Missing required command: $NODE_BIN"
    exit 1
  fi

  if command -v node >/dev/null 2>&1; then
    printf '%s\n' "node"
    return 0
  fi

  if command -v nodejs >/dev/null 2>&1; then
    printf '%s\n' "nodejs"
    return 0
  fi

  return 1
}

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    err "Missing required file: $file"
    exit 1
  fi
}

require_file "$BUILD_PACKAGE_SCRIPT"

if node_bin="$(resolve_node_bin)"; then
  exec "$node_bin" "$BUILD_PACKAGE_SCRIPT"
fi

if ! command -v docker >/dev/null 2>&1; then
  err "Missing required command: node, nodejs, or docker"
  exit 1
fi

echo "[package] Host node not found; using $NODE_DOCKER_IMAGE via docker"
exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$REPO_DIR:$REPO_DIR" \
  -w "$REPO_DIR" \
  "$NODE_DOCKER_IMAGE" \
  node "$BUILD_PACKAGE_SCRIPT"
