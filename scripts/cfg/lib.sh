#!/usr/bin/env bash
set -euo pipefail

CFG_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG_REPO_ROOT="${CFG_REPO_ROOT:-$(cd "$CFG_SCRIPT_DIR/../.." && pwd)}"
CFG_STACK_ROOT="${CFG_STACK_ROOT:-/home/igasovic/stack}"
CFG_COMPOSE_FILE="${CFG_COMPOSE_FILE:-$CFG_STACK_ROOT/docker-compose.yml}"

CFG_REPO_DOCKER_COMPOSE="${CFG_REPO_DOCKER_COMPOSE:-$CFG_REPO_ROOT/ops/stack/docker-compose.yml}"
CFG_REPO_DOCKER_ENV_DIR="${CFG_REPO_DOCKER_ENV_DIR:-$CFG_REPO_ROOT/ops/stack/env}"
CFG_REPO_DOCKER_RUNNERS_CONFIG="${CFG_REPO_DOCKER_RUNNERS_CONFIG:-$CFG_REPO_ROOT/ops/stack/n8n-runners/n8n-task-runners.json}"
CFG_RUNTIME_DOCKER_RUNNERS_CONFIG="${CFG_RUNTIME_DOCKER_RUNNERS_CONFIG:-$CFG_STACK_ROOT/n8n-task-runners.json}"

CFG_REPO_LITELLM_FILE="${CFG_REPO_LITELLM_FILE:-$CFG_REPO_ROOT/ops/stack/litellm/config.yaml}"
CFG_RUNTIME_LITELLM_FILE="${CFG_RUNTIME_LITELLM_FILE:-$CFG_STACK_ROOT/litellm/config.yaml}"

CFG_REPO_POSTGRES_INIT_DIR="${CFG_REPO_POSTGRES_INIT_DIR:-$CFG_REPO_ROOT/ops/stack/postgres/init}"
CFG_RUNTIME_POSTGRES_INIT_DIR="${CFG_RUNTIME_POSTGRES_INIT_DIR:-$CFG_STACK_ROOT/postgres-init}"
CFG_REPO_POSTGRES_CONF_DIR="${CFG_REPO_POSTGRES_CONF_DIR:-$CFG_REPO_ROOT/ops/stack/postgres}"
CFG_RUNTIME_POSTGRES_CONF_DIR="${CFG_RUNTIME_POSTGRES_CONF_DIR:-$CFG_STACK_ROOT/postgres}"

CFG_REPO_CLOUDFLARED_FILE="${CFG_REPO_CLOUDFLARED_FILE:-$CFG_REPO_ROOT/ops/stack/cloudflared/config.yml}"
CFG_RUNTIME_CLOUDFLARED_FILE="${CFG_RUNTIME_CLOUDFLARED_FILE:-$CFG_STACK_ROOT/cloudflared/config.yml}"
CFG_CLOUDFLARED_CREDENTIALS_FILE="${CFG_CLOUDFLARED_CREDENTIALS_FILE:-$CFG_STACK_ROOT/cloudflared/credentials.json}"

CFG_N8N_SYNC_SCRIPT="${CFG_N8N_SYNC_SCRIPT:-$CFG_REPO_ROOT/scripts/n8n/sync_workflows.sh}"
CFG_N8N_SNAPSHOT_SCRIPT="${CFG_N8N_SNAPSHOT_SCRIPT:-$CFG_REPO_ROOT/scripts/n8n/export_workflows_snapshot.sh}"
CFG_N8N_PACKAGE_BUILD_SCRIPT="${CFG_N8N_PACKAGE_BUILD_SCRIPT:-$CFG_REPO_ROOT/scripts/n8n/build_runtime_package.js}"
CFG_N8N_PACKAGE_BUILD_RUNNER="${CFG_N8N_PACKAGE_BUILD_RUNNER:-$CFG_REPO_ROOT/scripts/n8n/build_runtime_package.sh}"
CFG_N8N_RUNNERS_DOCKERFILE="${CFG_N8N_RUNNERS_DOCKERFILE:-$CFG_REPO_ROOT/ops/stack/n8n-runners/Dockerfile}"
CFG_N8N_MIN_JS_LINES="${CFG_N8N_MIN_JS_LINES:-50}"

CFG_REPO_N8N_WORKFLOWS_DIR="${CFG_REPO_N8N_WORKFLOWS_DIR:-$CFG_REPO_ROOT/src/n8n/workflows}"
CFG_REPO_N8N_NODES_DIR="${CFG_REPO_N8N_NODES_DIR:-$CFG_REPO_ROOT/src/n8n/nodes}"
CFG_REPO_N8N_PACKAGE_MANIFEST="${CFG_REPO_N8N_PACKAGE_MANIFEST:-$CFG_REPO_ROOT/src/n8n/package.manifest.json}"

CFG_BACKEND_DEPLOY_SCRIPT="${CFG_BACKEND_DEPLOY_SCRIPT:-$CFG_REPO_ROOT/scripts/cfg/backend_push.sh}"

SUPPORTED_SURFACES=(
  n8n
  docker
  litellm
  postgres
  cloudflared
  backend
)

SUPPORTED_UPDATE_MODES=(
  push
  pull
)

CFG_RED=$'\033[31m'
CFG_GREEN=$'\033[32m'
CFG_RESET=$'\033[0m'

cfg_err() {
  if [[ -t 2 ]]; then
    printf '%s%s%s\n' "$CFG_RED" "$*" "$CFG_RESET" >&2
  else
    printf '%s\n' "$*" >&2
  fi
}

cfg_color_text() {
  local color="$1"
  local text="$2"
  if [[ -t 1 ]]; then
    printf '%s%s%s' "$color" "$text" "$CFG_RESET"
  else
    printf '%s' "$text"
  fi
}

cfg_is_breaking_detail_line() {
  local line="$1"
  local lowered
  lowered="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  [[ "$lowered" == *" failed"* ]] && return 0
  [[ "$lowered" == *"error"* ]] && return 0
  [[ "$lowered" == *"blocked"* ]] && return 0
  [[ "$lowered" == *"required"* ]] && return 0
  [[ "$lowered" == *"missing"* ]] && return 0
  [[ "$lowered" == *"forbidden"* ]] && return 0
  [[ "$lowered" == *"cannot "* ]] && return 0
  [[ "$lowered" == *"manual action required"* ]] && return 0
  return 1
}

cfg_colorize_detail_line() {
  local line="$1"
  if [[ "$line" == *"n8n push sync completed"* ]]; then
    cfg_color_text "$CFG_GREEN" "$line"
    return 0
  fi
  if [[ "$line" == *"n8n push sync failed"* ]]; then
    cfg_color_text "$CFG_RED" "$line"
    return 0
  fi
  if cfg_is_breaking_detail_line "$line"; then
    cfg_color_text "$CFG_RED" "$line"
    return 0
  fi
  printf '%s' "$line"
  return 0
}

print_supported_surfaces() {
  local s
  for s in "${SUPPORTED_SURFACES[@]}"; do
    echo "- $s"
  done
}

print_supported_update_modes() {
  local m
  for m in "${SUPPORTED_UPDATE_MODES[@]}"; do
    echo "- $m"
  done
}

is_supported_surface() {
  local needle="${1:-}"
  local s
  for s in "${SUPPORTED_SURFACES[@]}"; do
    if [[ "$needle" == "$s" ]]; then
      return 0
    fi
  done
  return 1
}

require_single_surface_arg() {
  local cmd_name="$1"
  shift

  if [[ $# -ne 1 ]]; then
    cfg_err "Usage: $cmd_name <surface>"
    cfg_err "Supported surfaces:"
    print_supported_surfaces >&2
    return 2
  fi

  local surface="$1"
  if ! is_supported_surface "$surface"; then
    cfg_err "Unknown surface: $surface"
    cfg_err "Supported surfaces:"
    print_supported_surfaces >&2
    return 2
  fi

  return 0
}

is_supported_update_mode() {
  local needle="${1:-}"
  local m
  for m in "${SUPPORTED_UPDATE_MODES[@]}"; do
    if [[ "$needle" == "$m" ]]; then
      return 0
    fi
  done
  return 1
}

run_capture() {
  local __out_var="$1"
  shift
  local _captured

  if _captured="$("$@" 2>&1)"; then
    printf -v "$__out_var" '%s' "$_captured"
    return 0
  fi

  printf -v "$__out_var" '%s' "$_captured"
  return 1
}

preview_lines() {
  local text="$1"
  local max_lines="${2:-10}"
  if [[ -z "$text" ]]; then
    return 0
  fi
  printf '%s\n' "$text" | sed -n "1,${max_lines}p"
}

format_n8n_output_line() {
  local line="${1:-}"
  if [[ -z "$line" ]]; then
    printf '%s' "$line"
    return 0
  fi

  line="${line//$CFG_REPO_N8N_WORKFLOWS_DIR/workflows}"
  line="${line//$CFG_REPO_N8N_NODES_DIR/nodes}"

  # Keep n8n output focused on repo-relative signal.
  line="$(printf '%s' "$line" | sed -E \
    -e 's#([^[:space:]]*/src/n8n/workflows/)#workflows/#g' \
    -e 's#([^[:space:]]*/src/n8n/nodes/)#nodes/#g' \
    -e 's#/tmp/checkcfg-n8n\.[^/]+/workflows/#live/workflows/#g' \
    -e 's#/tmp/checkcfg-n8n\.[^/]+/nodes/#live/nodes/#g' \
    -e 's#__([A-Za-z0-9]{2})[A-Za-z0-9_-]*([A-Za-z0-9]{4})\.js#__\1****\2.js#g')"

  printf '%s' "$line"
}

add_update_detail_lines() {
  local text="$1"
  local prefix="${2:-}"
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    line="$(format_n8n_output_line "$line")"
    add_update_detail "${prefix}${line}"
  done <<<"$text"
}

add_check_detail_lines() {
  local text="$1"
  local prefix="${2:-}"
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    line="$(format_n8n_output_line "$line")"
    add_check_detail "${prefix}${line}"
  done <<<"$text"
}

lookup_repo_workflow_file_by_name() {
  local workflow_name="${1:-}"
  [[ -n "$workflow_name" ]] || return 1
  [[ -d "$CFG_REPO_N8N_WORKFLOWS_DIR" ]] || return 1

  local wf_file wf_name
  shopt -s nullglob
  for wf_file in "$CFG_REPO_N8N_WORKFLOWS_DIR"/*.json; do
    wf_name="$(jq -r '.name // empty' "$wf_file" 2>/dev/null || true)"
    if [[ "$wf_name" == "$workflow_name" ]]; then
      printf '%s\n' "$wf_file"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

resolve_python_bin() {
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    echo "python"
    return 0
  fi
  return 1
}

docker_collect_compose_services() {
  local __out_var="$1"
  local out
  if ! run_capture out docker compose -f "$CFG_COMPOSE_FILE" --project-directory "$CFG_STACK_ROOT" config --services; then
    printf -v "$__out_var" '%s' "$out"
    return 1
  fi
  out="$(printf '%s\n' "$out" | sed '/^[[:space:]]*$/d')"
  printf -v "$__out_var" '%s' "$out"
  return 0
}

is_cloudflared_token_mode() {
  if [[ ! -f "$CFG_COMPOSE_FILE" ]]; then
    return 1
  fi
  if grep -Eq -- '--token|TUNNEL_TOKEN' "$CFG_COMPOSE_FILE"; then
    return 0
  fi
  return 1
}

# -------------------------
# Progress reporting
# -------------------------

CFG_PROGRESS="${CFG_PROGRESS:-1}"
CFG_PROGRESS_WIDTH="${CFG_PROGRESS_WIDTH:-24}"

PROGRESS_ACTIVE=0
PROGRESS_LABEL=""
PROGRESS_TOTAL=0
PROGRESS_CURRENT=0
PROGRESS_START_TS=0

progress_is_enabled() {
  [[ "$CFG_PROGRESS" != "0" ]]
}

progress_start() {
  local label="$1"
  local total="$2"
  if ! progress_is_enabled; then
    return 0
  fi
  PROGRESS_ACTIVE=1
  PROGRESS_LABEL="$label"
  PROGRESS_TOTAL="$total"
  PROGRESS_CURRENT=0
  PROGRESS_START_TS="$(date +%s)"
  echo "[$PROGRESS_LABEL] starting ($PROGRESS_TOTAL steps)..." >&2
}

progress_render() {
  local status="$1"
  local message="$2"
  if ! progress_is_enabled || [[ "$PROGRESS_ACTIVE" -ne 1 ]]; then
    return 0
  fi

  local total="$PROGRESS_TOTAL"
  if [[ "$total" -le 0 ]]; then
    total=1
  fi

  local current="$PROGRESS_CURRENT"
  if [[ "$current" -lt 0 ]]; then
    current=0
  fi
  if [[ "$current" -gt "$total" ]]; then
    current="$total"
  fi

  local pct=$(( current * 100 / total ))
  local width="$CFG_PROGRESS_WIDTH"
  if [[ "$width" -le 0 ]]; then
    width=24
  fi
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  local bar_fill bar_empty
  printf -v bar_fill '%*s' "$filled" ''
  printf -v bar_empty '%*s' "$empty" ''
  bar_fill=${bar_fill// /#}
  bar_empty=${bar_empty// /-}

  local now elapsed
  now="$(date +%s)"
  elapsed=$(( now - PROGRESS_START_TS ))

  printf '[%s] %3d%% [%s%s] (%d/%d) %s +%ss\n' \
    "$PROGRESS_LABEL" "$pct" "$bar_fill" "$bar_empty" \
    "$current" "$total" "$status: $message" "$elapsed" >&2
}

progress_step() {
  local message="$1"
  if ! progress_is_enabled || [[ "$PROGRESS_ACTIVE" -ne 1 ]]; then
    return 0
  fi
  PROGRESS_CURRENT=$(( PROGRESS_CURRENT + 1 ))
  progress_render "STEP" "$message"
}

progress_done() {
  local message="${1:-completed}"
  if ! progress_is_enabled || [[ "$PROGRESS_ACTIVE" -ne 1 ]]; then
    return 0
  fi
  PROGRESS_CURRENT="$PROGRESS_TOTAL"
  progress_render "DONE" "$message"
  PROGRESS_ACTIVE=0
}

progress_fail() {
  local message="${1:-failed}"
  if ! progress_is_enabled || [[ "$PROGRESS_ACTIVE" -ne 1 ]]; then
    return 0
  fi
  progress_render "FAIL" "$message"
  PROGRESS_ACTIVE=0
}

# -------------------------
# Check report state
# -------------------------

CHECK_STATE="clean"
CHECK_SURFACE=""
declare -a CHECK_REPO_SOURCES=()
declare -a CHECK_RUNTIME_TARGETS=()
declare -a CHECK_DETAILS=()
CHECK_NEXT_COMMAND=""

reset_check_state() {
  CHECK_STATE="clean"
  CHECK_SURFACE=""
  CHECK_REPO_SOURCES=()
  CHECK_RUNTIME_TARGETS=()
  CHECK_DETAILS=()
  CHECK_NEXT_COMMAND=""
}

add_check_repo_source() {
  CHECK_REPO_SOURCES+=("$1")
}

add_check_runtime_target() {
  CHECK_RUNTIME_TARGETS+=("$1")
}

add_check_detail() {
  local line="$1"
  if [[ "$CHECK_SURFACE" == "n8n" ]]; then
    line="$(format_n8n_output_line "$line")"
  fi
  CHECK_DETAILS+=("$line")
}

mark_check_drift() {
  if [[ "$CHECK_STATE" != "blocked" ]]; then
    CHECK_STATE="drifted"
  fi
  add_check_detail "$1"
}

mark_check_blocked() {
  CHECK_STATE="blocked"
  add_check_detail "$1"
}

check_exit_code() {
  case "$CHECK_STATE" in
    clean)
      return 0
      ;;
    drifted)
      return 3
      ;;
    blocked)
      return 4
      ;;
    *)
      return 1
      ;;
  esac
}

print_check_report() {
  local s
  echo "Surface: $CHECK_SURFACE"
  case "$CHECK_STATE" in
    clean)
      echo "Status: $(cfg_color_text "$CFG_GREEN" "$CHECK_STATE")"
      ;;
    blocked)
      echo "Status: $(cfg_color_text "$CFG_RED" "$CHECK_STATE")"
      ;;
    *)
      echo "Status: $CHECK_STATE"
      ;;
  esac
  echo "Repo sources:"
  for s in "${CHECK_REPO_SOURCES[@]}"; do
    if [[ "$CHECK_SURFACE" == "n8n" ]]; then
      s="$(format_n8n_output_line "$s")"
    fi
    echo "- $s"
  done
  echo "Runtime targets:"
  for s in "${CHECK_RUNTIME_TARGETS[@]}"; do
    if [[ "$CHECK_SURFACE" == "n8n" ]]; then
      s="$(format_n8n_output_line "$s")"
    fi
    echo "- $s"
  done
  echo "Details:"
  for s in "${CHECK_DETAILS[@]}"; do
    local colored_line
    colored_line="$(cfg_colorize_detail_line "$s")"
    echo "- $colored_line"
  done

  if [[ -n "$CHECK_NEXT_COMMAND" ]]; then
    echo "Next command: $CHECK_NEXT_COMMAND"
  fi
}

compare_file_for_check() {
  local repo_file="$1"
  local runtime_file="$2"
  local label="$3"

  add_check_repo_source "$repo_file"
  add_check_runtime_target "$runtime_file"

  if [[ ! -f "$repo_file" ]]; then
    mark_check_drift "$label: repo source missing ($repo_file)."
    return 0
  fi

  if [[ ! -f "$runtime_file" ]]; then
    mark_check_drift "$label: runtime target missing ($runtime_file)."
    return 0
  fi

  if cmp -s "$repo_file" "$runtime_file"; then
    add_check_detail "$label: clean"
    return 0
  fi

  mark_check_drift "$label: drifted"
  local diff_preview
  diff_preview="$(diff -u "$runtime_file" "$repo_file" 2>/dev/null || true)"
  diff_preview="$(preview_lines "$diff_preview" 12)"
  if [[ -n "$diff_preview" ]]; then
    add_check_detail "$label diff preview (runtime->repo):"
    while IFS= read -r line; do
      add_check_detail "  $line"
    done <<<"$diff_preview"
  fi
}

compare_dir_for_check() {
  local repo_dir="$1"
  local runtime_dir="$2"
  local label="$3"

  add_check_repo_source "$repo_dir"
  add_check_runtime_target "$runtime_dir"

  if [[ ! -d "$repo_dir" ]]; then
    mark_check_drift "$label: repo source dir missing ($repo_dir)."
    return 0
  fi

  if [[ ! -d "$runtime_dir" ]]; then
    mark_check_drift "$label: runtime target dir missing ($runtime_dir)."
    return 0
  fi

  local diff_output
  diff_output="$(diff -qr "$repo_dir" "$runtime_dir" || true)"

  if [[ -z "$diff_output" ]]; then
    add_check_detail "$label: clean"
    return 0
  fi

  mark_check_drift "$label: drifted"
  diff_output="$(preview_lines "$diff_output" 20)"
  while IFS= read -r line; do
    add_check_detail "  $line"
  done <<<"$diff_output"
}

# -------------------------
# Update report state
# -------------------------

UPDATE_STATE="ok"
UPDATE_SURFACE=""
UPDATE_MODE="push"
declare -a UPDATE_CHANGED=()
declare -a UPDATE_SERVICES=()
declare -a UPDATE_DETAILS=()
UPDATE_NEXT_COMMAND=""

reset_update_state() {
  UPDATE_STATE="ok"
  UPDATE_SURFACE=""
  UPDATE_MODE="push"
  UPDATE_CHANGED=()
  UPDATE_SERVICES=()
  UPDATE_DETAILS=()
  UPDATE_NEXT_COMMAND=""
}

add_update_detail() {
  local line="$1"
  if [[ "$UPDATE_SURFACE" == "n8n" ]]; then
    line="$(format_n8n_output_line "$line")"
  fi
  UPDATE_DETAILS+=("$line")
}

mark_update_blocked() {
  UPDATE_STATE="blocked"
  add_update_detail "$1"
}

record_changed_path() {
  UPDATE_CHANGED+=("$1")
}

record_restarted_service() {
  UPDATE_SERVICES+=("$1")
}

update_exit_code() {
  case "$UPDATE_STATE" in
    ok)
      return 0
      ;;
    blocked)
      return 4
      ;;
    *)
      return 1
      ;;
  esac
}

print_update_report() {
  local s
  echo "Surface: $UPDATE_SURFACE"
  echo "Mode: $UPDATE_MODE"
  case "$UPDATE_STATE" in
    ok)
      echo "Status: $(cfg_color_text "$CFG_GREEN" "$UPDATE_STATE")"
      ;;
    blocked)
      echo "Status: $(cfg_color_text "$CFG_RED" "$UPDATE_STATE")"
      ;;
    *)
      echo "Status: $UPDATE_STATE"
      ;;
  esac
  echo "Changed paths:"
  if [[ ${#UPDATE_CHANGED[@]} -eq 0 ]]; then
    echo "- none"
  else
    for s in "${UPDATE_CHANGED[@]}"; do
      if [[ "$UPDATE_SURFACE" == "n8n" ]]; then
        s="$(format_n8n_output_line "$s")"
      fi
      echo "- $s"
    done
  fi

  echo "Services restarted or synced:"
  if [[ ${#UPDATE_SERVICES[@]} -eq 0 ]]; then
    echo "- none"
  else
    for s in "${UPDATE_SERVICES[@]}"; do
      echo "- $s"
    done
  fi

  echo "Details:"
  for s in "${UPDATE_DETAILS[@]}"; do
    local colored_line
    colored_line="$(cfg_colorize_detail_line "$s")"
    echo "- $colored_line"
  done

  if [[ -n "$UPDATE_NEXT_COMMAND" ]]; then
    echo "Next command: $UPDATE_NEXT_COMMAND"
  fi
}

copy_file_if_changed() {
  local src="$1"
  local dst="$2"
  local label="$3"

  if [[ ! -f "$src" ]]; then
    mark_update_blocked "$label: repo source missing ($src)."
    return 0
  fi

  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    add_update_detail "$label: already up to date"
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  record_changed_path "$dst"
  add_update_detail "$label: updated"
}

copy_file_runtime_to_repo_if_changed() {
  local runtime_src="$1"
  local repo_dst="$2"
  local label="$3"

  if [[ ! -f "$runtime_src" ]]; then
    mark_update_blocked "$label: runtime source missing ($runtime_src)."
    return 0
  fi

  if [[ -f "$repo_dst" ]] && cmp -s "$runtime_src" "$repo_dst"; then
    add_update_detail "$label: already up to date"
    return 0
  fi

  mkdir -p "$(dirname "$repo_dst")"
  cp "$runtime_src" "$repo_dst"
  record_changed_path "$repo_dst"
  add_update_detail "$label: pulled from runtime"
}

sync_dir_if_changed() {
  local src_dir="$1"
  local dst_dir="$2"
  local label="$3"

  if [[ ! -d "$src_dir" ]]; then
    mark_update_blocked "$label: repo source dir missing ($src_dir)."
    return 0
  fi

  mkdir -p "$dst_dir"

  if command -v rsync >/dev/null 2>&1; then
    local dry_out
    dry_out="$(rsync -a --delete --itemize-changes "$src_dir/" "$dst_dir/" || true)"
    if [[ -z "$dry_out" ]]; then
      add_update_detail "$label: already up to date"
      return 0
    fi

    rsync -a --delete "$src_dir/" "$dst_dir/"
    record_changed_path "$dst_dir"
    add_update_detail "$label: synced with rsync --delete"
    dry_out="$(preview_lines "$dry_out" 20)"
    while IFS= read -r line; do
      add_update_detail "  $line"
    done <<<"$dry_out"
    return 0
  fi

  cp -R "$src_dir/." "$dst_dir/"
  record_changed_path "$dst_dir"
  add_update_detail "$label: copied (rsync unavailable; stale runtime files may remain)"
}

sync_dir_runtime_to_repo_if_changed() {
  local runtime_src_dir="$1"
  local repo_dst_dir="$2"
  local label="$3"

  if [[ ! -d "$runtime_src_dir" ]]; then
    mark_update_blocked "$label: runtime source dir missing ($runtime_src_dir)."
    return 0
  fi

  mkdir -p "$repo_dst_dir"

  if command -v rsync >/dev/null 2>&1; then
    local dry_out
    dry_out="$(rsync -a --delete --itemize-changes "$runtime_src_dir/" "$repo_dst_dir/" || true)"
    if [[ -z "$dry_out" ]]; then
      add_update_detail "$label: already up to date"
      return 0
    fi

    rsync -a --delete "$runtime_src_dir/" "$repo_dst_dir/"
    record_changed_path "$repo_dst_dir"
    add_update_detail "$label: pulled from runtime with rsync --delete"
    dry_out="$(preview_lines "$dry_out" 20)"
    while IFS= read -r line; do
      add_update_detail "  $line"
    done <<<"$dry_out"
    return 0
  fi

  cp -R "$runtime_src_dir/." "$repo_dst_dir/"
  record_changed_path "$repo_dst_dir"
  add_update_detail "$label: pulled from runtime (rsync unavailable; stale repo files may remain)"
}

# -------------------------
# Surface checks
# -------------------------

check_surface_n8n() {
  add_check_repo_source "$CFG_REPO_N8N_WORKFLOWS_DIR"
  add_check_repo_source "$CFG_REPO_N8N_NODES_DIR"
  add_check_repo_source "$CFG_REPO_N8N_PACKAGE_MANIFEST"
  add_check_repo_source "$CFG_N8N_RUNNERS_DOCKERFILE"
  add_check_runtime_target "live n8n workflow state"
  progress_start "checkcfg:n8n" 6
  progress_step "validate prerequisites"

  local required=(
    "$CFG_N8N_SNAPSHOT_SCRIPT"
    "$CFG_REPO_ROOT/scripts/n8n/normalize_workflows.sh"
    "$CFG_REPO_ROOT/scripts/n8n/sync_code_nodes.py"
    "$CFG_N8N_PACKAGE_BUILD_SCRIPT"
    "$CFG_N8N_PACKAGE_BUILD_RUNNER"
    "$CFG_REPO_N8N_PACKAGE_MANIFEST"
    "$CFG_N8N_RUNNERS_DOCKERFILE"
  )
  local f
  for f in "${required[@]}"; do
    if [[ ! -f "$f" ]]; then
      mark_check_blocked "n8n check prerequisite missing: $f"
      progress_fail "missing prerequisite"
      return 0
    fi
  done

  if ! command -v docker >/dev/null 2>&1; then
    mark_check_blocked "n8n check requires docker in PATH."
    progress_fail "docker missing"
    return 0
  fi

  local py_bin
  if ! py_bin="$(resolve_python_bin)"; then
    mark_check_blocked "n8n check requires python3 or python in PATH."
    progress_fail "python missing"
    return 0
  fi

  if [[ -z "${N8N_API_KEY:-}" ]]; then
    cfg_err "N8N_API_KEY is required for sync_nodes."
    cfg_err "^ export N8N_API_KEY='<your n8n api key>'"
    mark_check_blocked "N8N_API_KEY is required for sync_nodes."
    progress_fail "missing N8N_API_KEY"
    return 0
  fi

  local tmp_root
  tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/checkcfg-n8n.XXXXXX")"
  local tmp_workflows="$tmp_root/workflows"
  local tmp_raw="$tmp_root/raw"
  local tmp_patched="$tmp_root/patched"
  local tmp_nodes="$tmp_root/nodes"
  mkdir -p "$tmp_workflows" "$tmp_raw" "$tmp_patched" "$tmp_nodes"

  local out
  progress_step "build generated n8n runtime package"
  if ! run_capture out "$CFG_N8N_PACKAGE_BUILD_RUNNER"; then
    mark_check_blocked "n8n runtime package build failed."
    add_check_detail_lines "$(preview_lines "$out" 80)" "  "
    rm -rf "$tmp_root"
    progress_fail "runtime package build failed"
    return 0
  fi
  add_check_detail_lines "$(preview_lines "$out" 20)" "  "

  progress_step "export one-shot n8n snapshot (normalized + raw)"
  if ! run_capture out "$CFG_N8N_SNAPSHOT_SCRIPT" "$tmp_workflows" "$tmp_raw"; then
    mark_check_blocked "n8n snapshot export failed."
    add_check_detail_lines "$(preview_lines "$out" 80)" "  "
    rm -rf "$tmp_root"
    progress_fail "snapshot export failed"
    return 0
  fi

  local validate_live_args=(
    "$py_bin"
    "$CFG_REPO_ROOT/scripts/n8n/sync_nodes.py"
    "--workflows-dir" "$tmp_workflows"
    "--nodes-root-dir" "$CFG_REPO_N8N_NODES_DIR"
    "--dry-run"
  )

  progress_step "validate live wrapper targets against repo nodes"
  if ! run_capture out "${validate_live_args[@]}"; then
    mark_check_blocked "n8n live wrapper validation failed."
    add_check_detail_lines "$(preview_lines "$out" 120)" "  "
    rm -rf "$tmp_root"
    progress_fail "live wrapper validation failed"
    return 0
  fi

  progress_step "normalize generated workflows"
  if ! run_capture out "$CFG_REPO_ROOT/scripts/n8n/normalize_workflows.sh" "$tmp_workflows"; then
    mark_check_blocked "n8n normalization failed."
    add_check_detail_lines "$(preview_lines "$out" 80)" "  "
    rm -rf "$tmp_root"
    progress_fail "normalize failed"
    return 0
  fi

  progress_step "compare repo workflows with live snapshot"
  compare_dir_for_check "$CFG_REPO_N8N_WORKFLOWS_DIR" "$tmp_workflows" "n8n workflow JSON"

  rm -rf "$tmp_root"
  progress_done "comparison complete"
}

check_surface_docker() {
  local compose_drift=0
  local -a drifted_env_files=()
  local runners_config_drift=0

  if [[ ! -f "$CFG_REPO_DOCKER_COMPOSE" || ! -f "$CFG_COMPOSE_FILE" ]] || \
    ! cmp -s "$CFG_REPO_DOCKER_COMPOSE" "$CFG_COMPOSE_FILE"; then
    compose_drift=1
  fi

  if [[ ! -d "$CFG_REPO_DOCKER_ENV_DIR" ]]; then
    progress_start "checkcfg:docker" 1
    progress_step "compare docker compose file"
    compare_file_for_check "$CFG_REPO_DOCKER_COMPOSE" "$CFG_COMPOSE_FILE" "docker compose"
    mark_check_drift "docker env source dir missing ($CFG_REPO_DOCKER_ENV_DIR)."

    local compose_services_out
    local -a affected_services=()
    if docker_collect_compose_services compose_services_out; then
      local service
      while IFS= read -r service; do
        if [[ -n "$service" ]]; then
          affected_services+=("$service")
        fi
      done <<<"$compose_services_out"
    fi
    if [[ ${#affected_services[@]} -gt 0 ]]; then
      add_check_detail "docker affected services: ${affected_services[*]} (all services; env source missing)"
    else
      add_check_detail "docker affected services: all (env source missing; unable to resolve compose services)"
    fi

    progress_done "comparison complete"
    return 0
  fi

  shopt -s nullglob
  local env_files=("$CFG_REPO_DOCKER_ENV_DIR"/*.env)
  shopt -u nullglob

  local total=$(( 1 + ${#env_files[@]} ))
  if [[ -f "$CFG_REPO_DOCKER_RUNNERS_CONFIG" || -f "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" ]]; then
    total=$(( total + 1 ))
  fi
  progress_start "checkcfg:docker" "$total"
  progress_step "compare docker compose file"
  compare_file_for_check "$CFG_REPO_DOCKER_COMPOSE" "$CFG_COMPOSE_FILE" "docker compose"

  if [[ ${#env_files[@]} -eq 0 ]]; then
    add_check_repo_source "$CFG_REPO_DOCKER_ENV_DIR"
    add_check_runtime_target "$CFG_STACK_ROOT"
    add_check_detail "docker env: no managed *.env files found in repo source dir"
    progress_done "comparison complete"
    return 0
  fi

  local f
  for f in "${env_files[@]}"; do
    local runtime_env="$CFG_STACK_ROOT/$(basename "$f")"
    if [[ ! -f "$f" || ! -f "$runtime_env" ]] || ! cmp -s "$f" "$runtime_env"; then
      drifted_env_files+=("$(basename "$f")")
    fi
    progress_step "compare $(basename "$f")"
    compare_file_for_check "$f" "$runtime_env" "docker env $(basename "$f")"
  done

  if [[ -f "$CFG_REPO_DOCKER_RUNNERS_CONFIG" || -f "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" ]]; then
    if [[ ! -f "$CFG_REPO_DOCKER_RUNNERS_CONFIG" || ! -f "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" ]] || \
      ! cmp -s "$CFG_REPO_DOCKER_RUNNERS_CONFIG" "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG"; then
      runners_config_drift=1
    fi
    progress_step "compare n8n-task-runners.json"
    compare_file_for_check \
      "$CFG_REPO_DOCKER_RUNNERS_CONFIG" \
      "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" \
      "docker config n8n-task-runners.json"
  fi

  if [[ "$CHECK_STATE" == "clean" ]]; then
    add_check_detail "docker affected services: none (surface clean)"
    progress_done "comparison complete"
    return 0
  fi

  local compose_services_out
  local -a compose_services=()
  if docker_collect_compose_services compose_services_out; then
    local service
    while IFS= read -r service; do
      if [[ -n "$service" ]]; then
        compose_services+=("$service")
      fi
    done <<<"$compose_services_out"
  fi

  if [[ "$compose_drift" -eq 1 ]]; then
    if [[ ${#compose_services[@]} -gt 0 ]]; then
      add_check_detail "docker affected services: ${compose_services[*]} (all services; compose file drift)"
    else
      add_check_detail "docker affected services: all (compose file drift; unable to resolve compose services)"
    fi
    progress_done "comparison complete"
    return 0
  fi

  if [[ "$runners_config_drift" -eq 1 ]]; then
    add_check_detail "docker affected services: task-runners (n8n-task-runners.json drift)"
    progress_done "comparison complete"
    return 0
  fi

  local needs_all=0
  local all_reason=""
  local -a affected_services=()
  local env_file
  for env_file in "${drifted_env_files[@]}"; do
    if [[ "$env_file" == ".env" ]]; then
      needs_all=1
      all_reason="global .env drift"
      break
    fi
    if [[ "$env_file" != *.env ]]; then
      needs_all=1
      all_reason="non-env drift ($env_file)"
      break
    fi

    local candidate_service="${env_file%.env}"
    if array_contains "$candidate_service" "${compose_services[@]-}"; then
      if ! array_contains "$candidate_service" "${affected_services[@]-}"; then
        affected_services+=("$candidate_service")
      fi
    else
      needs_all=1
      all_reason="env file does not map to a compose service ($env_file)"
      break
    fi
  done

  if [[ "$needs_all" -eq 1 ]]; then
    if [[ ${#compose_services[@]} -gt 0 ]]; then
      add_check_detail "docker affected services: ${compose_services[*]} (all services; $all_reason)"
    else
      add_check_detail "docker affected services: all ($all_reason; unable to resolve compose services)"
    fi
  elif [[ ${#affected_services[@]} -gt 0 ]]; then
    add_check_detail "docker affected services: ${affected_services[*]}"
  else
    if [[ ${#compose_services[@]} -gt 0 ]]; then
      add_check_detail "docker affected services: ${compose_services[*]} (drifted; no service-mapped env files)"
    else
      add_check_detail "docker affected services: all (drifted; unable to resolve compose services)"
    fi
  fi
  progress_done "comparison complete"
}

check_surface_litellm() {
  progress_start "checkcfg:litellm" 1
  progress_step "compare litellm config"
  compare_file_for_check "$CFG_REPO_LITELLM_FILE" "$CFG_RUNTIME_LITELLM_FILE" "litellm config"
  progress_done "comparison complete"
}

check_surface_postgres() {
  local total=1
  local conf
  for conf in postgresql.conf pg_hba.conf; do
    if [[ -f "$CFG_REPO_POSTGRES_CONF_DIR/$conf" || -f "$CFG_RUNTIME_POSTGRES_CONF_DIR/$conf" ]]; then
      total=$(( total + 1 ))
    fi
  done
  progress_start "checkcfg:postgres" "$total"
  progress_step "compare postgres init directory"
  compare_dir_for_check "$CFG_REPO_POSTGRES_INIT_DIR" "$CFG_RUNTIME_POSTGRES_INIT_DIR" "postgres init dir"

  for conf in postgresql.conf pg_hba.conf; do
    local src="$CFG_REPO_POSTGRES_CONF_DIR/$conf"
    local dst="$CFG_RUNTIME_POSTGRES_CONF_DIR/$conf"
    if [[ -f "$src" || -f "$dst" ]]; then
      progress_step "compare $conf"
      compare_file_for_check "$src" "$dst" "postgres config $conf"
    fi
  done
  progress_done "comparison complete"
}

check_surface_cloudflared() {
  progress_start "checkcfg:cloudflared" 2
  progress_step "compare cloudflared config"
  compare_file_for_check "$CFG_REPO_CLOUDFLARED_FILE" "$CFG_RUNTIME_CLOUDFLARED_FILE" "cloudflared config"

  progress_step "verify cloudflared credentials"
  add_check_runtime_target "$CFG_CLOUDFLARED_CREDENTIALS_FILE"
  if [[ -f "$CFG_CLOUDFLARED_CREDENTIALS_FILE" ]]; then
    add_check_detail "cloudflared credentials: present"
  else
    mark_check_drift "cloudflared credentials missing ($CFG_CLOUDFLARED_CREDENTIALS_FILE)."
  fi
  progress_done "comparison complete"
}

check_surface_backend() {
  progress_start "checkcfg:backend" 2
  progress_step "verify backend deploy script"
  add_check_repo_source "$CFG_REPO_ROOT/src/libs/config.js"
  add_check_repo_source "$CFG_REPO_ROOT/src/libs/config/"
  add_check_repo_source "$CFG_REPO_ROOT/src/server/"
  add_check_runtime_target "backend deployment state for pkm-server"
  add_check_runtime_target "$CFG_BACKEND_DEPLOY_SCRIPT"

  if [[ ! -f "$CFG_BACKEND_DEPLOY_SCRIPT" ]]; then
    mark_check_blocked "backend deploy script missing ($CFG_BACKEND_DEPLOY_SCRIPT)."
    progress_fail "deploy script missing"
    return 0
  fi
  if [[ ! -x "$CFG_BACKEND_DEPLOY_SCRIPT" ]]; then
    mark_check_blocked "backend deploy script is not executable ($CFG_BACKEND_DEPLOY_SCRIPT)."
    progress_fail "deploy script not executable"
    return 0
  fi

  progress_step "finalize readiness check"
  add_check_detail "backend readiness: deploy script present and executable"
  add_check_detail "backend readiness: updatecfg backend --push will run scripts/cfg/backend_push.sh"
  progress_done "readiness complete"
}

run_surface_check() {
  local surface="$1"
  CHECK_SURFACE="$surface"
  CHECK_NEXT_COMMAND="updatecfg $surface --push"

  case "$surface" in
    n8n)
      check_surface_n8n
      ;;
    docker)
      check_surface_docker
      ;;
    litellm)
      check_surface_litellm
      ;;
    postgres)
      check_surface_postgres
      ;;
    cloudflared)
      check_surface_cloudflared
      ;;
    backend)
      check_surface_backend
      ;;
    *)
      mark_check_blocked "No check adapter implemented for $surface"
      ;;
  esac

  if [[ "$CHECK_STATE" == "clean" ]]; then
    CHECK_NEXT_COMMAND="none (surface is clean)"
  elif [[ "$CHECK_STATE" == "blocked" ]]; then
    CHECK_NEXT_COMMAND="resolve prerequisites, then rerun checkcfg $surface"
  fi
}

# -------------------------
# Surface updates
# -------------------------

restart_service() {
  local service="$1"
  local out
  if run_capture out docker compose -f "$CFG_COMPOSE_FILE" --project-directory "$CFG_STACK_ROOT" restart "$service"; then
    record_restarted_service "$service"
    add_update_detail "docker compose restart $service: ok"
    return 0
  fi
  mark_update_blocked "failed to restart service '$service'"
  add_update_detail "  $(preview_lines "$out" 20)"
  return 0
}

update_surface_n8n() {
  local mode="$1"
  local total_steps=4
  if [[ "$mode" == "push" ]]; then
    total_steps=5
  fi
  progress_start "updatecfg:n8n:$mode" "$total_steps"
  progress_step "validate n8n sync script"
  if [[ ! -x "$CFG_N8N_SYNC_SCRIPT" ]]; then
    mark_update_blocked "n8n sync script missing or not executable ($CFG_N8N_SYNC_SCRIPT)."
    progress_fail "sync script missing"
    return 0
  fi

  local out=""
  local sync_status=0
  local tmp_out tmp_pipe
  tmp_out="$(mktemp "${TMPDIR:-/tmp}/updatecfg-n8n.out.XXXXXX")"
  tmp_pipe="$(mktemp -u "${TMPDIR:-/tmp}/updatecfg-n8n.pipe.XXXXXX")"
  mkfifo "$tmp_pipe"

  local step_a=0
  local step_b=0
  local step_c=0
  local step_d=0

  ("$CFG_N8N_SYNC_SCRIPT" --mode "$mode" >"$tmp_pipe" 2>&1) &
  local sync_pid=$!

  while IFS= read -r line; do
    printf '%s\n' "$line" >>"$tmp_out"
    if [[ "$mode" == "push" ]]; then
      if [[ $step_a -eq 0 && "$line" == "[push 1/4]"* ]]; then
        progress_step "build runtime package"
        step_a=1
      elif [[ $step_b -eq 0 && "$line" == "[push 2/4]"* ]]; then
        progress_step "recreate n8n + runners stack"
        step_b=1
      elif [[ $step_c -eq 0 && "$line" == "[push 3/4]"* ]]; then
        progress_step "patch repo workflows to n8n API"
        step_c=1
      elif [[ $step_d -eq 0 && "$line" == "[push 4/4]"* ]]; then
        progress_step "validate live workflows"
        step_d=1
      fi
    else
      if [[ $step_a -eq 0 && "$line" == "[pull 1/3]"* ]]; then
        progress_step "export + normalize workflows"
        step_a=1
      elif [[ $step_b -eq 0 && "$line" == "[pull 2/3]"* ]]; then
        progress_step "export raw workflows"
        step_b=1
      elif [[ $step_c -eq 0 && "$line" == "[pull 3/3]"* ]]; then
        progress_step "sync code nodes to repo"
        step_c=1
      fi
    fi
  done <"$tmp_pipe"

  wait "$sync_pid" || sync_status=$?
  rm -f "$tmp_pipe"
  out="$(cat "$tmp_out")"
  rm -f "$tmp_out"

  if [[ "$sync_status" -eq 0 ]]; then
    if [[ "$mode" == "push" ]]; then
      record_restarted_service "n8n API sync"
      add_update_detail "n8n push sync completed"
    else
      record_changed_path "$CFG_REPO_N8N_WORKFLOWS_DIR"
      record_changed_path "$CFG_REPO_N8N_NODES_DIR"
      add_update_detail "n8n pull sync completed"
    fi
    add_update_detail_lines "$(preview_lines "$out" 80)" "  "
    progress_done "sync complete"
    return 0
  fi

  mark_update_blocked "n8n $mode sync failed"
  add_update_detail_lines "$(preview_lines "$out" 200)" "  "
  if [[ "$mode" == "push" ]]; then
    local missing_names
    missing_names="$(
      printf '%s\n' "$out" | awk '
        /^Workflows missing in n8n:/ { in_block=1; next }
        /^Workflows failed:/ { in_block=0 }
        in_block && /^- / {
          item=$0
          sub(/^- /, "", item)
          if (item != "none") print item
        }
      '
    )"
    if [[ -n "$missing_names" ]]; then
      add_update_detail "manual action required: import missing workflows via n8n UI (Workflows -> Import from File)"
      local wf_name wf_file
      while IFS= read -r wf_name; do
        [[ -n "$wf_name" ]] || continue
        if wf_file="$(lookup_repo_workflow_file_by_name "$wf_name")"; then
          add_update_detail "  - import '$wf_name' from $wf_file"
        else
          add_update_detail "  - import '$wf_name' (repo file not found by name; check src/n8n/workflows)"
        fi
      done <<<"$missing_names"
    fi
  fi
  progress_fail "sync failed"
}

update_surface_docker() {
  local mode="$1"
  local -a env_files=()
  local env_count=0
  local runners_config_present=0
  if [[ -d "$CFG_REPO_DOCKER_ENV_DIR" ]]; then
    shopt -s nullglob
    env_files=("$CFG_REPO_DOCKER_ENV_DIR"/*.env)
    shopt -u nullglob
    env_count="${#env_files[@]}"
  fi
  if [[ -f "$CFG_REPO_DOCKER_RUNNERS_CONFIG" || -f "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" ]]; then
    runners_config_present=1
  fi
  local total=$(( 1 + env_count ))
  if [[ "$runners_config_present" -eq 1 ]]; then
    total=$(( total + 1 ))
  fi
  if [[ "$mode" == "push" ]]; then
    total=$(( total + 2 ))
  fi
  progress_start "updatecfg:docker:$mode" "$total"
  progress_step "sync docker compose file ($mode)"

  if [[ "$mode" == "push" ]]; then
    copy_file_if_changed "$CFG_REPO_DOCKER_COMPOSE" "$CFG_COMPOSE_FILE" "docker compose"
  else
    copy_file_runtime_to_repo_if_changed "$CFG_COMPOSE_FILE" "$CFG_REPO_DOCKER_COMPOSE" "docker compose"
  fi

  if [[ -d "$CFG_REPO_DOCKER_ENV_DIR" ]]; then
    local f
    if [[ "$env_count" -eq 0 ]]; then
      add_update_detail "docker env: no managed *.env files found in repo source dir"
    else
      for f in "${env_files[@]}"; do
        progress_step "sync $(basename "$f") ($mode)"
        if [[ "$mode" == "push" ]]; then
          copy_file_if_changed "$f" "$CFG_STACK_ROOT/$(basename "$f")" "docker env $(basename "$f")"
        else
          copy_file_runtime_to_repo_if_changed "$CFG_STACK_ROOT/$(basename "$f")" "$f" "docker env $(basename "$f")"
        fi
      done
    fi
  else
    mark_update_blocked "docker env source dir missing ($CFG_REPO_DOCKER_ENV_DIR)."
    progress_fail "env source missing"
  fi

  if [[ "$runners_config_present" -eq 1 ]]; then
    progress_step "sync n8n-task-runners.json ($mode)"
    if [[ "$mode" == "push" ]]; then
      copy_file_if_changed \
        "$CFG_REPO_DOCKER_RUNNERS_CONFIG" \
        "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" \
        "docker config n8n-task-runners.json"
    else
      copy_file_runtime_to_repo_if_changed \
        "$CFG_RUNTIME_DOCKER_RUNNERS_CONFIG" \
        "$CFG_REPO_DOCKER_RUNNERS_CONFIG" \
        "docker config n8n-task-runners.json"
    fi
  fi

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    progress_fail "update blocked"
    return 0
  fi

  if [[ "$mode" == "pull" ]]; then
    add_update_detail "docker pull mode does not restart services"
    progress_done "pull complete"
    return 0
  fi

  progress_step "resolve compose apply scope"
  if [[ ${#UPDATE_CHANGED[@]} -eq 0 ]]; then
    progress_step "skip compose apply (no managed changes)"
    add_update_detail "no managed docker file changes detected; skipped compose apply"
    progress_done "push complete"
    return 0
  fi

  local compose_changed=0
  local changed
  for changed in "${UPDATE_CHANGED[@]}"; do
    if [[ "$changed" == "$CFG_COMPOSE_FILE" ]]; then
      compose_changed=1
      break
    fi
  done

  local apply_scope="full"
  local scope_reason=""
  local -a target_services=()
  local targeted_scope_reason=""

  if [[ "$compose_changed" -eq 1 ]]; then
    scope_reason="docker compose file changed"
  else
    local compose_services_out
    if ! docker_collect_compose_services compose_services_out; then
      mark_update_blocked "failed to resolve compose services for targeted docker apply"
      add_update_detail "  $(preview_lines "$compose_services_out" 20)"
      progress_fail "compose service resolution failed"
      return 0
    fi

    local -a compose_services=()
    local service
    while IFS= read -r service; do
      if [[ -n "$service" ]]; then
        compose_services+=("$service")
      fi
    done <<<"$compose_services_out"

    local needs_full_apply=0
    for changed in "${UPDATE_CHANGED[@]}"; do
      local changed_file
      changed_file="$(basename "$changed")"
      if [[ "$changed_file" == "docker-compose.yml" ]]; then
        needs_full_apply=1
        scope_reason="docker compose file changed"
        break
      fi
      if [[ "$changed_file" == "n8n-task-runners.json" ]]; then
        if ! array_contains "task-runners" "${target_services[@]-}"; then
          target_services+=("task-runners")
        fi
        targeted_scope_reason="task-runners launcher config changed"
        continue
      fi
      if [[ "$changed_file" != *.env ]]; then
        needs_full_apply=1
        scope_reason="non-env docker-managed file changed ($changed_file)"
        break
      fi
      if [[ "$changed_file" == ".env" ]]; then
        needs_full_apply=1
        scope_reason="global .env changed"
        break
      fi

      local candidate_service="${changed_file%.env}"
      if array_contains "$candidate_service" "${compose_services[@]-}"; then
        if ! array_contains "$candidate_service" "${target_services[@]-}"; then
          target_services+=("$candidate_service")
        fi
      else
        needs_full_apply=1
        scope_reason="env file does not map to a compose service ($changed_file)"
        break
      fi
    done

    if [[ "$needs_full_apply" -eq 0 && ${#target_services[@]} -gt 0 ]]; then
      apply_scope="targeted"
      if [[ -n "$targeted_scope_reason" ]]; then
        scope_reason="$targeted_scope_reason"
      else
        scope_reason="service env files changed: ${target_services[*]}"
      fi
    else
      apply_scope="full"
      if [[ -z "$scope_reason" ]]; then
        scope_reason="unable to determine targeted service scope"
      fi
    fi
  fi

  local out
  if [[ "$apply_scope" == "targeted" ]]; then
    progress_step "apply docker changes with compose up -d (targeted)"
    if run_capture out docker compose -f "$CFG_COMPOSE_FILE" --project-directory "$CFG_STACK_ROOT" up -d "${target_services[@]}"; then
      local joined_services="${target_services[*]}"
      record_restarted_service "docker surface (compose up -d $joined_services)"
      add_update_detail "docker compose targeted apply: $joined_services"
      add_update_detail "scope reason: $scope_reason"
      add_update_detail "  $(preview_lines "$out" 20)"
      progress_done "push complete"
      return 0
    fi

    mark_update_blocked "docker compose targeted apply failed"
    add_update_detail "  $(preview_lines "$out" 20)"
    progress_fail "compose apply failed"
    return 0
  fi

  progress_step "apply docker changes with compose up -d (full)"
  if run_capture out docker compose -f "$CFG_COMPOSE_FILE" --project-directory "$CFG_STACK_ROOT" up -d; then
    record_restarted_service "docker surface (compose up -d)"
    add_update_detail "docker compose full apply completed"
    add_update_detail "scope reason: $scope_reason"
    add_update_detail "  $(preview_lines "$out" 20)"
    progress_done "push complete"
    return 0
  fi

  mark_update_blocked "docker compose up -d failed"
  add_update_detail "  $(preview_lines "$out" 20)"
  progress_fail "compose apply failed"
}

update_surface_litellm() {
  local mode="$1"
  progress_start "updatecfg:litellm:$mode" 2
  progress_step "sync litellm config ($mode)"
  if [[ "$mode" == "push" ]]; then
    copy_file_if_changed "$CFG_REPO_LITELLM_FILE" "$CFG_RUNTIME_LITELLM_FILE" "litellm config"
  else
    copy_file_runtime_to_repo_if_changed "$CFG_RUNTIME_LITELLM_FILE" "$CFG_REPO_LITELLM_FILE" "litellm config"
  fi

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    progress_fail "update blocked"
    return 0
  fi

  if [[ "$mode" == "pull" ]]; then
    progress_step "skip restart for pull mode"
    add_update_detail "litellm pull mode does not restart services"
    progress_done "pull complete"
    return 0
  fi

  progress_step "restart litellm service"
  restart_service litellm
  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    progress_fail "restart failed"
    return 0
  fi
  progress_done "push complete"
}

update_surface_postgres() {
  local mode="$1"
  local total=1
  local conf
  for conf in postgresql.conf pg_hba.conf; do
    if [[ "$mode" == "push" ]]; then
      [[ -f "$CFG_REPO_POSTGRES_CONF_DIR/$conf" ]] && total=$(( total + 1 ))
    else
      [[ -f "$CFG_RUNTIME_POSTGRES_CONF_DIR/$conf" ]] && total=$(( total + 1 ))
    fi
  done
  progress_start "updatecfg:postgres:$mode" "$total"
  progress_step "sync postgres init directory ($mode)"
  if [[ "$mode" == "push" ]]; then
    sync_dir_if_changed "$CFG_REPO_POSTGRES_INIT_DIR" "$CFG_RUNTIME_POSTGRES_INIT_DIR" "postgres init dir"
  else
    sync_dir_runtime_to_repo_if_changed "$CFG_RUNTIME_POSTGRES_INIT_DIR" "$CFG_REPO_POSTGRES_INIT_DIR" "postgres init dir"
  fi

  for conf in postgresql.conf pg_hba.conf; do
    local src="$CFG_REPO_POSTGRES_CONF_DIR/$conf"
    local dst="$CFG_RUNTIME_POSTGRES_CONF_DIR/$conf"
    if [[ "$mode" == "push" ]]; then
      if [[ -f "$src" ]]; then
        progress_step "sync $conf"
        copy_file_if_changed "$src" "$dst" "postgres config $conf"
      fi
    else
      if [[ -f "$dst" ]]; then
        progress_step "sync $conf"
        copy_file_runtime_to_repo_if_changed "$dst" "$src" "postgres config $conf"
      fi
    fi
  done

  if [[ "$mode" == "push" ]]; then
    add_update_detail "postgres push mode does not restart database automatically"
    add_update_detail "if runtime config changed, run: docker compose -f $CFG_COMPOSE_FILE --project-directory $CFG_STACK_ROOT restart postgres"
  else
    add_update_detail "postgres pull mode excludes live data and copies only init/config files to repo"
  fi
  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    progress_fail "update blocked"
    return 0
  fi
  progress_done "$mode complete"
}

update_surface_cloudflared() {
  local mode="$1"
  progress_start "updatecfg:cloudflared:$mode" 2
  progress_step "sync cloudflared config ($mode)"
  if [[ "$mode" == "push" ]]; then
    if [[ ! -f "$CFG_CLOUDFLARED_CREDENTIALS_FILE" ]]; then
      mark_update_blocked "cloudflared credentials missing ($CFG_CLOUDFLARED_CREDENTIALS_FILE)."
      progress_fail "credentials missing"
      return 0
    fi
    copy_file_if_changed "$CFG_REPO_CLOUDFLARED_FILE" "$CFG_RUNTIME_CLOUDFLARED_FILE" "cloudflared config"
  else
    if [[ -f "$CFG_RUNTIME_CLOUDFLARED_FILE" ]]; then
      copy_file_runtime_to_repo_if_changed "$CFG_RUNTIME_CLOUDFLARED_FILE" "$CFG_REPO_CLOUDFLARED_FILE" "cloudflared config"
    elif is_cloudflared_token_mode; then
      add_update_detail "cloudflared config: runtime source missing ($CFG_RUNTIME_CLOUDFLARED_FILE)"
      add_update_detail "cloudflared config: detected token-based tunnel mode in compose; nothing to import"
    else
      copy_file_runtime_to_repo_if_changed "$CFG_RUNTIME_CLOUDFLARED_FILE" "$CFG_REPO_CLOUDFLARED_FILE" "cloudflared config"
    fi
  fi

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    progress_fail "update blocked"
    return 0
  fi

  if [[ "$mode" == "pull" ]]; then
    progress_step "skip restart for pull mode"
    add_update_detail "cloudflared pull mode does not restart services"
    progress_done "pull complete"
    return 0
  fi

  progress_step "restart cloudflared service"
  restart_service cloudflared
  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    progress_fail "restart failed"
    return 0
  fi
  progress_done "push complete"
}

update_surface_backend() {
  local mode="$1"
  progress_start "updatecfg:backend:$mode" 2
  progress_step "validate backend deploy mode"
  if [[ "$mode" == "pull" ]]; then
    mark_update_blocked "backend pull mode is not supported (no runtime-to-repo import path)."
    progress_fail "pull not supported"
    return 0
  fi

  if [[ ! -x "$CFG_BACKEND_DEPLOY_SCRIPT" ]]; then
    mark_update_blocked "backend deploy script missing or not executable ($CFG_BACKEND_DEPLOY_SCRIPT)."
    progress_fail "deploy script missing"
    return 0
  fi

  local out
  progress_step "run backend deploy script"
  if run_capture out "$CFG_BACKEND_DEPLOY_SCRIPT"; then
    record_restarted_service "pkm-server (scripts/cfg/backend_push.sh)"
    add_update_detail "backend push deploy completed via scripts/cfg/backend_push.sh"
    add_update_detail "  $(preview_lines "$out" 20)"
    progress_done "push complete"
    return 0
  fi

  mark_update_blocked "backend push deploy failed"
  add_update_detail "  $(preview_lines "$out" 20)"
  progress_fail "deploy failed"
}

run_surface_update() {
  local surface="$1"
  local mode="$2"
  UPDATE_SURFACE="$surface"
  UPDATE_MODE="$mode"
  UPDATE_NEXT_COMMAND="checkcfg $surface"

  case "$surface" in
    n8n)
      update_surface_n8n "$mode"
      ;;
    docker)
      update_surface_docker "$mode"
      ;;
    litellm)
      update_surface_litellm "$mode"
      ;;
    postgres)
      update_surface_postgres "$mode"
      ;;
    cloudflared)
      update_surface_cloudflared "$mode"
      ;;
    backend)
      update_surface_backend "$mode"
      ;;
    *)
      mark_update_blocked "No update adapter implemented for $surface"
      ;;
  esac

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    if [[ "$mode" == "pull" ]]; then
      UPDATE_NEXT_COMMAND="resolve prerequisites, then rerun updatecfg $surface --pull"
    else
      UPDATE_NEXT_COMMAND="resolve prerequisites, then rerun updatecfg $surface --push"
    fi
  fi
}
