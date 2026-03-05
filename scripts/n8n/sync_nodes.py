#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    sys.exit(code)


def slugify(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value


def run_cmd(cmd, check: bool = True):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        die(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\n"
            f"stderr:\n{proc.stderr}"
        )
    return proc


def api_request(base_url: str, api_key: str, method: str, path: str, payload=None):
    url = f"{base_url.rstrip('/')}{path}"
    body = None
    headers = {"X-N8N-API-KEY": api_key}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            if not text.strip():
                return resp.status, {}
            try:
                return resp.status, json.loads(text)
            except json.JSONDecodeError:
                return resp.status, {"raw": text}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {method} {path}: {err_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"HTTP {method} {path} failed: {exc}") from exc


def load_json(path_obj: Path):
    try:
        return json.loads(path_obj.read_text(encoding="utf-8"))
    except Exception as exc:
        die(f"Invalid JSON in {path_obj}: {exc}")


def build_live_workflow_map():
    with tempfile.TemporaryDirectory() as temp_dir:
        run_cmd(
            [
                "docker",
                "exec",
                "-u",
                "node",
                "n8n",
                "sh",
                "-lc",
                "rm -rf /tmp/workflows_live_sync && mkdir -p /tmp/workflows_live_sync",
            ]
        )
        run_cmd(
            [
                "docker",
                "exec",
                "-u",
                "node",
                "n8n",
                "n8n",
                "export:workflow",
                "--backup",
                "--output=/tmp/workflows_live_sync",
            ]
        )
        run_cmd(["docker", "cp", "n8n:/tmp/workflows_live_sync/.", temp_dir])

        workflow_map = {}
        slug_map = {}
        for path_obj in sorted(Path(temp_dir).glob("*.json")):
            data = load_json(path_obj)
            name = data.get("name")
            wid = data.get("id")
            active = bool(data.get("active", False))
            if not name or not wid:
                continue
            if name in workflow_map:
                die(f"Duplicate live workflow name detected: {name}")
            workflow_map[name] = {"id": str(wid), "active": active}
            slug = slugify(name)
            slug_map.setdefault(slug, []).append({"name": name, "id": str(wid), "active": active})
        return workflow_map, slug_map


def extract_wrapper_targets(workflow_payload):
    targets = []
    nodes = workflow_payload.get("nodes", [])
    for node in nodes:
        params = node.get("parameters") or {}
        js_code = params.get("jsCode")
        if not isinstance(js_code, str):
            continue
        match = re.search(r"/data/js/workflows/([^'\"`]+\.js)", js_code)
        if match:
            targets.append(match.group(1))
    return targets


def validate_wrapper_targets(workflow_files, js_root_dir: Path):
    missing = []
    for workflow_path in workflow_files:
        data = load_json(workflow_path)
        wf_name = data.get("name", workflow_path.name)
        for rel_path in extract_wrapper_targets(data):
            target = js_root_dir / rel_path
            if not target.exists():
                missing.append((wf_name, rel_path))
    if missing:
        print("Missing wrapper targets:", file=sys.stderr)
        for wf_name, rel_path in missing:
            print(f"- {wf_name}: {rel_path}", file=sys.stderr)
        die("Aborting sync_nodes due to missing wrapper targets.")


def workflow_patch_payload(local_workflow):
    payload = {
        "name": local_workflow["name"],
        "nodes": local_workflow.get("nodes", []),
        "connections": local_workflow.get("connections", {}),
        "settings": local_workflow.get("settings", {}),
    }
    if "staticData" in local_workflow:
        payload["staticData"] = local_workflow["staticData"]
    if "pinData" in local_workflow:
        payload["pinData"] = local_workflow["pinData"]
    return payload


def sanitize_settings_for_put(settings):
    if not isinstance(settings, dict):
        return {}
    allowed = {
        "executionOrder",
        "saveManualExecutions",
        "callerPolicy",
        "callerIds",
        "errorWorkflow",
        "timezone",
        "saveDataErrorExecution",
        "saveDataSuccessExecution",
        "saveExecutionProgress",
        "saveDataManualExecutions",
        "executionTimeout",
    }
    return {k: v for k, v in settings.items() if k in allowed}


def deactivate_workflow(base_url: str, api_key: str, workflow_id: str):
    try:
        api_request(base_url, api_key, "POST", f"/api/v1/workflows/{workflow_id}/deactivate", {})
        return
    except RuntimeError:
        pass
    api_request(
        base_url,
        api_key,
        "PATCH",
        f"/api/v1/workflows/{workflow_id}",
        {"active": False},
    )


def activate_workflow(base_url: str, api_key: str, workflow_id: str):
    try:
        api_request(base_url, api_key, "POST", f"/api/v1/workflows/{workflow_id}/activate", {})
        return
    except RuntimeError:
        pass
    api_request(
        base_url,
        api_key,
        "PATCH",
        f"/api/v1/workflows/{workflow_id}",
        {"active": True},
    )


def update_workflow_definition(base_url: str, api_key: str, workflow_id: str, payload):
    try:
        api_request(base_url, api_key, "PATCH", f"/api/v1/workflows/{workflow_id}", payload)
        return "PATCH"
    except RuntimeError as exc:
        message = str(exc).lower()
        if "http 405" not in message and "method not allowed" not in message:
            raise
    try:
        api_request(base_url, api_key, "PUT", f"/api/v1/workflows/{workflow_id}", payload)
        return "PUT"
    except RuntimeError as exc:
        message = str(exc).lower()
        if "request/body/settings must not have additional properties" not in message:
            raise
    retry_payload = dict(payload)
    retry_payload["settings"] = sanitize_settings_for_put(payload.get("settings"))
    api_request(base_url, api_key, "PUT", f"/api/v1/workflows/{workflow_id}", retry_payload)
    return "PUT(retry-settings)"


def resolve_live_workflow(local_name: str, workflow_map, slug_map):
    exact = workflow_map.get(local_name)
    if exact:
        return exact, None
    slug = slugify(local_name)
    matches = slug_map.get(slug, [])
    if len(matches) == 1:
        m = matches[0]
        return {"id": m["id"], "active": m["active"]}, f"{local_name} -> {m['name']}"
    return None, None


def parse_args(argv):
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Patch existing n8n workflows in-place from repo JSON (no delete/import)."
    )
    parser.add_argument(
        "--workflows-dir",
        default=str(repo_root / "workflows"),
        help="Directory containing local workflow JSON files.",
    )
    parser.add_argument(
        "--js-root-dir",
        default=str(repo_root / "js" / "workflows"),
        help="Directory containing externalized JS wrapper targets.",
    )
    parser.add_argument(
        "--workflow-name",
        action="append",
        default=[],
        help="Workflow name to patch (repeatable). Default: patch all local workflows.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print actions without PATCH/activate calls.",
    )
    return parser.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    base_url = os.environ.get("N8N_API_BASE_URL", "http://127.0.0.1:5678")
    api_key = os.environ.get("N8N_API_KEY", "").strip()
    if not api_key:
        die("N8N_API_KEY is required for sync_nodes.")

    workflows_dir = Path(args.workflows_dir).resolve()
    js_root_dir = Path(args.js_root_dir).resolve()
    if not workflows_dir.exists():
        die(f"Missing workflows dir: {workflows_dir}")
    if not js_root_dir.exists():
        die(f"Missing JS root dir: {js_root_dir}")

    workflow_files = sorted(workflows_dir.glob("*.json"))
    if not workflow_files:
        die(f"No workflow JSON files found in {workflows_dir}")

    if args.workflow_name:
        selected = set(args.workflow_name)
        filtered = []
        seen_names = set()
        for wf_file in workflow_files:
            wf_json = load_json(wf_file)
            wf_name = wf_json.get("name")
            if wf_name in selected:
                filtered.append(wf_file)
                seen_names.add(wf_name)
        missing_requested = sorted(selected - seen_names)
        if missing_requested:
            die("Requested workflow names not found locally: " + ", ".join(missing_requested))
        workflow_files = filtered

    validate_wrapper_targets(workflow_files, js_root_dir)

    live_map, slug_map = build_live_workflow_map()
    missing_live = []
    updated = []
    failed = []
    method_usage = {"PATCH": 0, "PUT": 0, "PUT(retry-settings)": 0}

    for wf_file in workflow_files:
        local = load_json(wf_file)
        wf_name = local.get("name")
        if not isinstance(wf_name, str) or not wf_name.strip():
            failed.append(f"{wf_file.name}: missing .name")
            continue
        live, name_fallback = resolve_live_workflow(wf_name, live_map, slug_map)
        if not live:
            missing_live.append(wf_name)
            continue
        if name_fallback:
            print(f"Name fallback match: {name_fallback}")
        workflow_id = live["id"]
        was_active = bool(live["active"])
        payload = workflow_patch_payload(local)

        print(f"Patching workflow: {wf_name} ({workflow_id})")
        if args.dry_run:
            print(f"- dry-run: would PATCH nodes/connections/settings; active={was_active}")
            updated.append(wf_name)
            continue

        try:
            if was_active:
                deactivate_workflow(base_url, api_key, workflow_id)
            method_used = update_workflow_definition(base_url, api_key, workflow_id, payload)
            method_usage[method_used] = method_usage.get(method_used, 0) + 1
            if was_active:
                activate_workflow(base_url, api_key, workflow_id)
            updated.append(wf_name)
        except RuntimeError as exc:
            failed.append(f"{wf_name}: {exc}")

    print("Workflows updated:")
    if updated:
        for item in sorted(updated):
            print(f"- {item}")
    else:
        print("- none")

    print("Workflows missing in n8n:")
    if missing_live:
        for item in sorted(missing_live):
            print(f"- {item}")
    else:
        print("- none")

    print("Workflows failed:")
    if failed:
        for item in failed:
            print(f"- {item}")
    else:
        print("- none")

    print(
        "Update method usage: "
        f"PATCH={method_usage['PATCH']} "
        f"PUT={method_usage['PUT']} "
        f"PUT(retry-settings)={method_usage['PUT(retry-settings)']}"
    )

    if missing_live or failed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
