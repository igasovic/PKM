#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_PACKAGE_SCRIPT="${BUILD_PACKAGE_SCRIPT:-$REPO_DIR/scripts/n8n/build_runtime_package.js}"
BUILD_PACKAGE_RUNNER="${BUILD_PACKAGE_RUNNER:-$REPO_DIR/scripts/n8n/build_runtime_package.sh}"
RUNNERS_DOCKERFILE="${RUNNERS_DOCKERFILE:-$REPO_DIR/ops/stack/n8n-runners/Dockerfile}"
RUNNERS_BASE_IMAGE="${RUNNERS_BASE_IMAGE:-n8nio/runners:2.10.3}"
RUNNERS_IMAGE_TAG="${RUNNERS_IMAGE_TAG:-pkm-n8n-runners:2.10.3}"
SKIP_PACKAGE_BUILD="${SKIP_PACKAGE_BUILD:-0}"

if [[ ! -f "$BUILD_PACKAGE_SCRIPT" ]]; then
  echo "Missing runtime package build script: $BUILD_PACKAGE_SCRIPT" >&2
  exit 1
fi

if [[ ! -f "$BUILD_PACKAGE_RUNNER" ]]; then
  echo "Missing runtime package runner: $BUILD_PACKAGE_RUNNER" >&2
  exit 1
fi

if [[ ! -f "$RUNNERS_DOCKERFILE" ]]; then
  echo "Missing runners Dockerfile: $RUNNERS_DOCKERFILE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Missing required command: docker" >&2
  exit 1
fi

if [[ "$SKIP_PACKAGE_BUILD" != "1" ]]; then
  echo "[runners 1/2] Build n8n runtime package"
  "$BUILD_PACKAGE_RUNNER"
else
  echo "[runners 1/2] Skip package build (already built)"
fi

echo "[runners 2/2] Build custom runners image $RUNNERS_IMAGE_TAG"
docker build \
  --build-arg "RUNNERS_BASE_IMAGE=$RUNNERS_BASE_IMAGE" \
  -t "$RUNNERS_IMAGE_TAG" \
  -f "$RUNNERS_DOCKERFILE" \
  "$REPO_DIR"
