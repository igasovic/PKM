#!/usr/bin/env bash
set -euo pipefail

CFG_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG_REPO_ROOT="${CFG_REPO_ROOT:-$(cd "$CFG_SCRIPT_DIR/../.." && pwd)}"
CFG_STACK_ROOT="${CFG_STACK_ROOT:-/home/igasovic/stack}"
CFG_COMPOSE_FILE="${CFG_COMPOSE_FILE:-$CFG_STACK_ROOT/docker-compose.yml}"

CFG_REPO_DOCKER_COMPOSE="${CFG_REPO_DOCKER_COMPOSE:-$CFG_REPO_ROOT/ops/stack/docker-compose.yml}"
CFG_REPO_DOCKER_ENV_DIR="${CFG_REPO_DOCKER_ENV_DIR:-$CFG_REPO_ROOT/ops/stack/env}"

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
CFG_N8N_MIN_JS_LINES="${CFG_N8N_MIN_JS_LINES:-50}"

CFG_REPO_N8N_WORKFLOWS_DIR="${CFG_REPO_N8N_WORKFLOWS_DIR:-$CFG_REPO_ROOT/src/n8n/workflows}"
CFG_REPO_N8N_NODES_DIR="${CFG_REPO_N8N_NODES_DIR:-$CFG_REPO_ROOT/src/n8n/nodes}"

CFG_BACKEND_DEPLOY_SCRIPT="${CFG_BACKEND_DEPLOY_SCRIPT:-$CFG_REPO_ROOT/scripts/redeploy}"

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
    echo "Usage: $cmd_name <surface>" >&2
    echo "Supported surfaces:" >&2
    print_supported_surfaces >&2
    return 2
  fi

  local surface="$1"
  if ! is_supported_surface "$surface"; then
    echo "Unknown surface: $surface" >&2
    echo "Supported surfaces:" >&2
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
  local out

  if out="$("$@" 2>&1)"; then
    printf -v "$__out_var" '%s' "$out"
    return 0
  fi

  printf -v "$__out_var" '%s' "$out"
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
  CHECK_DETAILS+=("$1")
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
  echo "Status: $CHECK_STATE"
  echo "Repo sources:"
  for s in "${CHECK_REPO_SOURCES[@]}"; do
    echo "- $s"
  done
  echo "Runtime targets:"
  for s in "${CHECK_RUNTIME_TARGETS[@]}"; do
    echo "- $s"
  done
  echo "Details:"
  for s in "${CHECK_DETAILS[@]}"; do
    echo "- $s"
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
  UPDATE_DETAILS+=("$1")
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
  echo "Status: $UPDATE_STATE"
  echo "Changed paths:"
  if [[ ${#UPDATE_CHANGED[@]} -eq 0 ]]; then
    echo "- none"
  else
    for s in "${UPDATE_CHANGED[@]}"; do
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
    echo "- $s"
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
  add_check_runtime_target "live n8n workflow state"

  local required=(
    "$CFG_REPO_ROOT/scripts/n8n/export_workflows.sh"
    "$CFG_REPO_ROOT/scripts/n8n/rename_workflows_by_name.sh"
    "$CFG_REPO_ROOT/scripts/n8n/normalize_workflows.sh"
    "$CFG_REPO_ROOT/scripts/n8n/sync_code_nodes.py"
  )
  local f
  for f in "${required[@]}"; do
    if [[ ! -f "$f" ]]; then
      mark_check_blocked "n8n check prerequisite missing: $f"
      return 0
    fi
  done

  if ! command -v docker >/dev/null 2>&1; then
    mark_check_blocked "n8n check requires docker in PATH."
    return 0
  fi

  local py_bin
  if ! py_bin="$(resolve_python_bin)"; then
    mark_check_blocked "n8n check requires python3 or python in PATH."
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
  if ! run_capture out "$CFG_REPO_ROOT/scripts/n8n/export_workflows.sh" "$tmp_workflows"; then
    mark_check_blocked "n8n export failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  if ! run_capture out docker exec -u node n8n sh -lc 'rm -rf /tmp/workflows_raw_cfg && mkdir -p /tmp/workflows_raw_cfg'; then
    mark_check_blocked "n8n raw export prep failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  if ! run_capture out docker exec -u node n8n n8n export:workflow --backup --output=/tmp/workflows_raw_cfg; then
    mark_check_blocked "n8n raw export failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  if ! run_capture out docker cp n8n:/tmp/workflows_raw_cfg/. "$tmp_raw/"; then
    mark_check_blocked "n8n raw export copy failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  if ! run_capture out "$CFG_REPO_ROOT/scripts/n8n/rename_workflows_by_name.sh" "$tmp_raw"; then
    mark_check_blocked "n8n raw rename failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  local sync_args=(
    "$py_bin"
    "$CFG_REPO_ROOT/scripts/n8n/sync_code_nodes.py"
    "$tmp_raw"
    "$tmp_patched"
    "$tmp_workflows"
    "$tmp_nodes"
    "$CFG_N8N_MIN_JS_LINES"
  )
  if [[ -d "$CFG_REPO_ROOT/js/workflows" ]]; then
    sync_args+=("$CFG_REPO_ROOT/js/workflows")
  fi

  if ! run_capture out "${sync_args[@]}"; then
    mark_check_blocked "n8n code-node sync failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  if ! run_capture out "$CFG_REPO_ROOT/scripts/n8n/normalize_workflows.sh" "$tmp_workflows"; then
    mark_check_blocked "n8n normalization failed."
    add_check_detail "  $(preview_lines "$out" 20)"
    rm -rf "$tmp_root"
    return 0
  fi

  compare_dir_for_check "$CFG_REPO_N8N_WORKFLOWS_DIR" "$tmp_workflows" "n8n workflow JSON"
  compare_dir_for_check "$CFG_REPO_N8N_NODES_DIR" "$tmp_nodes" "n8n externalized code"

  rm -rf "$tmp_root"
}

check_surface_docker() {
  compare_file_for_check "$CFG_REPO_DOCKER_COMPOSE" "$CFG_COMPOSE_FILE" "docker compose"

  if [[ ! -d "$CFG_REPO_DOCKER_ENV_DIR" ]]; then
    mark_check_drift "docker env source dir missing ($CFG_REPO_DOCKER_ENV_DIR)."
    return 0
  fi

  shopt -s nullglob
  local env_files=("$CFG_REPO_DOCKER_ENV_DIR"/*.env)
  shopt -u nullglob

  if [[ ${#env_files[@]} -eq 0 ]]; then
    add_check_repo_source "$CFG_REPO_DOCKER_ENV_DIR"
    add_check_runtime_target "$CFG_STACK_ROOT"
    add_check_detail "docker env: no managed *.env files found in repo source dir"
    return 0
  fi

  local f
  for f in "${env_files[@]}"; do
    compare_file_for_check "$f" "$CFG_STACK_ROOT/$(basename "$f")" "docker env $(basename "$f")"
  done
}

check_surface_litellm() {
  compare_file_for_check "$CFG_REPO_LITELLM_FILE" "$CFG_RUNTIME_LITELLM_FILE" "litellm config"
}

check_surface_postgres() {
  compare_dir_for_check "$CFG_REPO_POSTGRES_INIT_DIR" "$CFG_RUNTIME_POSTGRES_INIT_DIR" "postgres init dir"

  local conf
  for conf in postgresql.conf pg_hba.conf; do
    local src="$CFG_REPO_POSTGRES_CONF_DIR/$conf"
    local dst="$CFG_RUNTIME_POSTGRES_CONF_DIR/$conf"
    if [[ -f "$src" || -f "$dst" ]]; then
      compare_file_for_check "$src" "$dst" "postgres config $conf"
    fi
  done
}

check_surface_cloudflared() {
  compare_file_for_check "$CFG_REPO_CLOUDFLARED_FILE" "$CFG_RUNTIME_CLOUDFLARED_FILE" "cloudflared config"

  add_check_runtime_target "$CFG_CLOUDFLARED_CREDENTIALS_FILE"
  if [[ -f "$CFG_CLOUDFLARED_CREDENTIALS_FILE" ]]; then
    add_check_detail "cloudflared credentials: present"
  else
    mark_check_drift "cloudflared credentials missing ($CFG_CLOUDFLARED_CREDENTIALS_FILE)."
  fi
}

check_surface_backend() {
  add_check_repo_source "$CFG_REPO_ROOT/src/libs/config.js"
  add_check_repo_source "$CFG_REPO_ROOT/src/libs/config/"
  add_check_repo_source "$CFG_REPO_ROOT/src/server/"
  add_check_runtime_target "backend deployment state for pkm-server"
  add_check_runtime_target "$CFG_BACKEND_DEPLOY_SCRIPT"

  if [[ ! -f "$CFG_BACKEND_DEPLOY_SCRIPT" ]]; then
    mark_check_blocked "backend deploy script missing ($CFG_BACKEND_DEPLOY_SCRIPT)."
    return 0
  fi
  if [[ ! -x "$CFG_BACKEND_DEPLOY_SCRIPT" ]]; then
    mark_check_blocked "backend deploy script is not executable ($CFG_BACKEND_DEPLOY_SCRIPT)."
    return 0
  fi

  add_check_detail "backend readiness: deploy script present and executable"
  add_check_detail "backend readiness: updatecfg backend --mode push will run scripts/redeploy"
}

run_surface_check() {
  local surface="$1"
  CHECK_SURFACE="$surface"
  CHECK_NEXT_COMMAND="updatecfg $surface --mode push"

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
  if [[ ! -x "$CFG_N8N_SYNC_SCRIPT" ]]; then
    mark_update_blocked "n8n sync script missing or not executable ($CFG_N8N_SYNC_SCRIPT)."
    return 0
  fi

  local out
  if run_capture out "$CFG_N8N_SYNC_SCRIPT" --mode "$mode"; then
    if [[ "$mode" == "push" ]]; then
      record_restarted_service "n8n API sync"
      add_update_detail "n8n push sync completed"
    else
      record_changed_path "$CFG_REPO_N8N_WORKFLOWS_DIR"
      record_changed_path "$CFG_REPO_N8N_NODES_DIR"
      add_update_detail "n8n pull sync completed"
    fi
    add_update_detail "  $(preview_lines "$out" 20)"
    return 0
  fi

  mark_update_blocked "n8n $mode sync failed"
  add_update_detail "  $(preview_lines "$out" 20)"
}

update_surface_docker() {
  local mode="$1"

  if [[ "$mode" == "push" ]]; then
    copy_file_if_changed "$CFG_REPO_DOCKER_COMPOSE" "$CFG_COMPOSE_FILE" "docker compose"
  else
    copy_file_runtime_to_repo_if_changed "$CFG_COMPOSE_FILE" "$CFG_REPO_DOCKER_COMPOSE" "docker compose"
  fi

  if [[ -d "$CFG_REPO_DOCKER_ENV_DIR" ]]; then
    shopt -s nullglob
    local env_files=("$CFG_REPO_DOCKER_ENV_DIR"/*.env)
    shopt -u nullglob
    local f
    for f in "${env_files[@]}"; do
      if [[ "$mode" == "push" ]]; then
        copy_file_if_changed "$f" "$CFG_STACK_ROOT/$(basename "$f")" "docker env $(basename "$f")"
      else
        copy_file_runtime_to_repo_if_changed "$CFG_STACK_ROOT/$(basename "$f")" "$f" "docker env $(basename "$f")"
      fi
    done
  else
    mark_update_blocked "docker env source dir missing ($CFG_REPO_DOCKER_ENV_DIR)."
  fi

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    return 0
  fi

  if [[ "$mode" == "pull" ]]; then
    add_update_detail "docker pull mode does not restart services"
    return 0
  fi

  local out
  if run_capture out docker compose -f "$CFG_COMPOSE_FILE" --project-directory "$CFG_STACK_ROOT" up -d; then
    record_restarted_service "docker surface (compose up -d)"
    add_update_detail "docker compose up -d completed"
    add_update_detail "  $(preview_lines "$out" 20)"
    return 0
  fi

  mark_update_blocked "docker compose up -d failed"
  add_update_detail "  $(preview_lines "$out" 20)"
}

update_surface_litellm() {
  local mode="$1"
  if [[ "$mode" == "push" ]]; then
    copy_file_if_changed "$CFG_REPO_LITELLM_FILE" "$CFG_RUNTIME_LITELLM_FILE" "litellm config"
  else
    copy_file_runtime_to_repo_if_changed "$CFG_RUNTIME_LITELLM_FILE" "$CFG_REPO_LITELLM_FILE" "litellm config"
  fi

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    return 0
  fi

  if [[ "$mode" == "pull" ]]; then
    add_update_detail "litellm pull mode does not restart services"
    return 0
  fi

  restart_service litellm
}

update_surface_postgres() {
  local mode="$1"
  if [[ "$mode" == "push" ]]; then
    sync_dir_if_changed "$CFG_REPO_POSTGRES_INIT_DIR" "$CFG_RUNTIME_POSTGRES_INIT_DIR" "postgres init dir"
  else
    sync_dir_runtime_to_repo_if_changed "$CFG_RUNTIME_POSTGRES_INIT_DIR" "$CFG_REPO_POSTGRES_INIT_DIR" "postgres init dir"
  fi

  local conf
  for conf in postgresql.conf pg_hba.conf; do
    local src="$CFG_REPO_POSTGRES_CONF_DIR/$conf"
    local dst="$CFG_RUNTIME_POSTGRES_CONF_DIR/$conf"
    if [[ "$mode" == "push" ]]; then
      if [[ -f "$src" ]]; then
        copy_file_if_changed "$src" "$dst" "postgres config $conf"
      fi
    else
      if [[ -f "$dst" ]]; then
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
}

update_surface_cloudflared() {
  local mode="$1"
  if [[ "$mode" == "push" ]]; then
    if [[ ! -f "$CFG_CLOUDFLARED_CREDENTIALS_FILE" ]]; then
      mark_update_blocked "cloudflared credentials missing ($CFG_CLOUDFLARED_CREDENTIALS_FILE)."
      return 0
    fi
    copy_file_if_changed "$CFG_REPO_CLOUDFLARED_FILE" "$CFG_RUNTIME_CLOUDFLARED_FILE" "cloudflared config"
  else
    copy_file_runtime_to_repo_if_changed "$CFG_RUNTIME_CLOUDFLARED_FILE" "$CFG_REPO_CLOUDFLARED_FILE" "cloudflared config"
  fi

  if [[ "$UPDATE_STATE" == "blocked" ]]; then
    return 0
  fi

  if [[ "$mode" == "pull" ]]; then
    add_update_detail "cloudflared pull mode does not restart services"
    return 0
  fi

  restart_service cloudflared
}

update_surface_backend() {
  local mode="$1"
  if [[ "$mode" == "pull" ]]; then
    mark_update_blocked "backend pull mode is not supported (no runtime-to-repo import path)."
    return 0
  fi

  if [[ ! -x "$CFG_BACKEND_DEPLOY_SCRIPT" ]]; then
    mark_update_blocked "backend deploy script missing or not executable ($CFG_BACKEND_DEPLOY_SCRIPT)."
    return 0
  fi

  local out
  if run_capture out "$CFG_BACKEND_DEPLOY_SCRIPT"; then
    record_restarted_service "pkm-server (scripts/redeploy)"
    add_update_detail "backend push deploy completed via scripts/redeploy"
    add_update_detail "  $(preview_lines "$out" 20)"
    return 0
  fi

  mark_update_blocked "backend push deploy failed"
  add_update_detail "  $(preview_lines "$out" 20)"
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
    UPDATE_NEXT_COMMAND="resolve prerequisites, then rerun updatecfg $surface --mode $mode"
  fi
}
