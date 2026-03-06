#!/usr/bin/env python3
import json
import re
import shutil
import sys
from pathlib import Path

CANONICAL_WRAPPER_PREFIX = "/data/src/n8n/nodes/"
LEGACY_WRAPPER_PREFIX = "/data/js/workflows/"


def die(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def slugify(value: str) -> str:
    value = (value or "").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"^-+|-+$", "", value)
    value = re.sub(r"-+", "-", value)
    return value


def normalize_newlines(text: str) -> str:
    return str(text).replace("\r\n", "\n")


def with_trailing_newline(text: str) -> str:
    normalized = normalize_newlines(text)
    return normalized if normalized.endswith("\n") else normalized + "\n"


def non_empty_line_count(text: str) -> int:
    return sum(1 for line in normalize_newlines(text).split("\n") if line.strip())


def is_module_style_js(text: str) -> bool:
    normalized = normalize_newlines(text)
    markers = (
        "module.exports",
        "exports.default",
    )
    return any(marker in normalized for marker in markers)


def module_to_inline_code(text: str):
    normalized = normalize_newlines(text).strip()
    header = re.search(
        r"module\.exports\s*=\s*async\s*function(?:\s+\w+)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{",
        normalized,
    )
    if not header:
        header = re.search(
            r"exports\.default\s*=\s*async\s*function(?:\s+\w+)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{",
            normalized,
        )
    if not header:
        return None

    param = header.group(1)
    start = header.start()
    body_start = header.end()

    depth = 1
    i = body_start
    while i < len(normalized):
        ch = normalized[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                body_end = i
                break
        i += 1
    else:
        return None

    body = normalized[body_start:body_end].strip("\n")
    # In Code node context these variables already exist, so drop explicit ctx destructure.
    body = re.sub(
        r"""^\s*const\s*\{\s*\$input\s*,\s*\$json\s*,\s*\$items\s*,\s*\$node\s*,\s*\$env\s*,\s*helpers\s*\}\s*=\s*"""
        + re.escape(param)
        + r"""\s*;\s*\n?""",
        "",
        body,
        count=1,
        flags=re.M,
    )
    prefix = normalized[:start].rstrip()
    if prefix:
        return prefix + "\n\n" + body + "\n"
    return body + "\n"


def rewrite_repo_imports(text: str) -> str:
    normalized = normalize_newlines(text)
    # Normalize legacy relative requires used before path migration.
    # Code-node files run from /data/src/n8n/nodes/<workflow>/..., so using absolute
    # /data/src/libs/... avoids fragile relative traversal.
    normalized = re.sub(
        r"""require\(\s*['"](?:\.\./){3}src/libs/([^'"]+)['"]\s*\)""",
        r"require('/data/src/libs/\1')",
        normalized,
    )
    return normalized


def to_posix_path(path_obj: Path) -> str:
    return path_obj.as_posix()


def path_is_under(path_obj: Path, root: Path) -> bool:
    try:
        path_obj.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def extract_wrapper_relative_path(js_code: str):
    normalized = normalize_newlines(js_code)
    for prefix in (CANONICAL_WRAPPER_PREFIX, LEGACY_WRAPPER_PREFIX):
        match = re.search(
            rf"""require\(\s*['"]{re.escape(prefix)}([^'"]+?\.js)['"]\s*\)""",
            normalized,
        )
        if match:
            return prefix, match.group(1)
    return None, None


def build_wrapper(wrapper_rel: str) -> str:
    return (
        f"try{{const fn=require('{CANONICAL_WRAPPER_PREFIX}{wrapper_rel}');"
        "return await fn({$input,$json,$items,$node,$env,helpers});}"
        f"catch(e){{e.message=`[extjs:{wrapper_rel}] ${{e.message}}`;throw e;}}"
    )


def build_legacy_bridge(wrapper_rel: str) -> str:
    return (
        '"use strict";\n\n'
        f"const loaded = require('{CANONICAL_WRAPPER_PREFIX}{wrapper_rel}');\n"
        "const fn = (typeof loaded === 'function') ? loaded : loaded?.default;\n\n"
        "function toItems(result) {\n"
        "  if (Array.isArray(result)) return result;\n"
        "  if (result == null) return [];\n"
        "  if (Array.isArray(result.items)) return result.items;\n"
        "  if (typeof result === 'object' && (\n"
        "    Object.prototype.hasOwnProperty.call(result, 'json') ||\n"
        "    Object.prototype.hasOwnProperty.call(result, 'binary') ||\n"
        "    Object.prototype.hasOwnProperty.call(result, 'pairedItem')\n"
        "  )) {\n"
        "    return [result];\n"
        "  }\n"
        "  return [{ json: result }];\n"
        "}\n\n"
        "module.exports = async function bridge(ctx) {\n"
        "  if (typeof fn !== 'function') {\n"
        "    throw new Error('Bridge target does not export a function');\n"
        "  }\n"
        "  const out = await fn(ctx);\n"
        "  return toItems(out);\n"
        "};\n"
    )


def read_json(path_obj: Path):
    try:
        return json.loads(path_obj.read_text(encoding="utf-8"))
    except Exception as exc:
        die(f"Invalid JSON in {path_obj}: {exc}")


def write_json(path_obj: Path, payload) -> None:
    path_obj.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def list_json_files(dir_path: Path):
    return sorted([p for p in dir_path.iterdir() if p.is_file() and p.suffix == ".json"])


def list_files_recursive(root_dir: Path):
    if not root_dir.exists():
        return []
    return sorted([p for p in root_dir.rglob("*") if p.is_file()])


def empty_dir(dir_path: Path) -> None:
    ensure_dir(dir_path)
    for child in dir_path.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink(missing_ok=True)


def delete_empty_parents(file_path: Path, stop_dir: Path) -> None:
    current = file_path.parent
    stop_resolved = stop_dir.resolve()
    while True:
        current_resolved = current.resolve()
        if current_resolved == stop_resolved:
            break
        if stop_resolved not in current_resolved.parents and current_resolved != stop_resolved:
            break
        try:
            next(current.iterdir())
            break
        except StopIteration:
            current.rmdir()
            current = current.parent


def node_id_from_filename(file_name: str):
    match = re.search(r"__([^.\\/]+)\.js$", file_name)
    return match.group(1) if match else None


def is_managed_node_js_file(file_path: Path) -> bool:
    return bool(re.search(r"__([^.\\/]+)\.js$", file_path.name))


def build_node_file_index(roots):
    index = {}
    files = []
    for root in roots:
        files.extend(
            [
                p
                for p in list_files_recursive(root)
                if p.suffix == ".js" and is_managed_node_js_file(p)
            ]
        )
    for abs_path in sorted(set(files)):
        node_id = node_id_from_filename(abs_path.name)
        if not node_id:
            continue
        index.setdefault(node_id, []).append(abs_path)
    return index


def first_existing(paths):
    for candidate in paths:
        if candidate and candidate.exists() and candidate.is_file():
            return candidate
    return None


def sanitize_node_id(raw_id: str) -> str:
    value = str(raw_id or "node")
    return re.sub(r"[^a-zA-Z0-9_-]", "-", value)


def workflow_slug_from_object(workflow) -> str:
    return slugify(workflow.get("name", "")) or "workflow"


def node_file_name(node) -> str:
    node_name = slugify(node.get("name", "code-node")) or "code-node"
    node_id = sanitize_node_id(str(node.get("id", node_name)))
    return f"{node_name}__{node_id}.js"


def is_code_node(node) -> bool:
    return node.get("type") == "n8n-nodes-base.code"


def resolve_source_for_wrapper(
    js_code: str,
    node_id: str,
    nodes_root_dir: Path,
    legacy_nodes_root_dir: Path | None,
    node_file_index,
):
    wrapper_prefix, wrapper_rel = extract_wrapper_relative_path(js_code)
    if not wrapper_rel:
        return None, None

    candidates = []
    if wrapper_prefix == CANONICAL_WRAPPER_PREFIX:
        candidates.append(nodes_root_dir / Path(wrapper_rel))
    elif wrapper_prefix == LEGACY_WRAPPER_PREFIX and legacy_nodes_root_dir is not None:
        candidates.append(legacy_nodes_root_dir / Path(wrapper_rel))

    candidates.append(nodes_root_dir / Path(wrapper_rel))
    if legacy_nodes_root_dir is not None:
        candidates.append(legacy_nodes_root_dir / Path(wrapper_rel))

    by_id_candidates = node_file_index.get(str(node_id or ""), [])
    source_path = first_existing([*candidates, *by_id_candidates])
    return wrapper_rel, source_path


def ensure_legacy_bridge(
    legacy_nodes_root_dir: Path | None,
    wrapper_rel: str,
):
    if legacy_nodes_root_dir is None:
        return None
    bridge_abs = (legacy_nodes_root_dir / Path(wrapper_rel)).resolve()
    ensure_dir(bridge_abs.parent)
    next_content = build_legacy_bridge(wrapper_rel)
    if bridge_abs.exists():
        current = bridge_abs.read_text(encoding="utf-8")
        if normalize_newlines(current) == normalize_newlines(next_content):
            return None
    bridge_abs.write_text(next_content, encoding="utf-8")
    return wrapper_rel


def parse_args(argv):
    if len(argv) not in (5, 6):
        die(
            "Usage: sync_code_nodes.py "
            "<raw_dir> <patched_raw_dir> <repo_workflows_dir> <nodes_root_dir> <min_lines> "
            "[legacy_nodes_root_dir]"
        )

    raw_dir = Path(argv[0]).resolve()
    patched_raw_dir = Path(argv[1]).resolve()
    repo_workflows_dir = Path(argv[2]).resolve()
    nodes_root_dir = Path(argv[3]).resolve()
    try:
        min_lines = int(argv[4])
    except Exception:
        die(f"Invalid min_lines: {argv[4]}")
    if min_lines < 1:
        die(f"Invalid min_lines: {argv[4]}")

    legacy_nodes_root_dir = None
    if len(argv) == 6 and argv[5]:
        legacy_nodes_root_dir = Path(argv[5]).resolve()

    if not raw_dir.exists() or not raw_dir.is_dir():
        die(f"Missing raw workflows dir: {raw_dir}")
    if not repo_workflows_dir.exists() or not repo_workflows_dir.is_dir():
        die(f"Missing repo workflows dir: {repo_workflows_dir}")

    ensure_dir(nodes_root_dir)
    ensure_dir(patched_raw_dir)
    if legacy_nodes_root_dir is not None:
        ensure_dir(legacy_nodes_root_dir)

    return (
        raw_dir,
        patched_raw_dir,
        repo_workflows_dir,
        nodes_root_dir,
        legacy_nodes_root_dir,
        min_lines,
    )


def main():
    (
        raw_dir,
        patched_raw_dir,
        repo_workflows_dir,
        nodes_root_dir,
        legacy_nodes_root_dir,
        min_lines,
    ) = parse_args(sys.argv[1:])

    empty_dir(patched_raw_dir)
    raw_files = list_json_files(raw_dir)
    node_index_roots = [nodes_root_dir]
    if legacy_nodes_root_dir is not None:
        node_index_roots.append(legacy_nodes_root_dir)
    node_file_index = build_node_file_index(node_index_roots)
    expected_node_files = set()

    patched_nodes = 0
    moved_files = 0
    created_files = 0
    inlined_nodes = 0
    skipped_missing_source = 0
    missing_js_code = 0
    workflow_created = []
    workflow_updated = []
    node_added = []
    node_updated = []
    node_moved = []
    node_deleted = []
    node_bridged = []

    for raw_file in raw_files:
        file_name = raw_file.name
        workflow = read_json(raw_file)
        nodes = workflow.get("nodes", []) if isinstance(workflow, dict) else []
        workflow_slug = workflow_slug_from_object(workflow)

        for node in nodes:
            if not is_code_node(node):
                continue

            parameters = node.get("parameters") or {}
            js_code = parameters.get("jsCode")
            if not isinstance(js_code, str) or not js_code.strip():
                missing_js_code += 1
                continue

            node_id = str(node.get("id", ""))
            _wrapper_rel, source_path = resolve_source_for_wrapper(
                js_code,
                node_id,
                nodes_root_dir,
                legacy_nodes_root_dir,
                node_file_index,
            )

            effective_code = js_code
            source_abs = None
            if _wrapper_rel:
                if not source_path:
                    skipped_missing_source += 1
                    continue
                source_abs = source_path.resolve()
                effective_code = source_abs.read_text(encoding="utf-8")

            effective_code = rewrite_repo_imports(effective_code)

            line_count = non_empty_line_count(effective_code)
            if line_count < min_lines:
                inline_code = effective_code
                if is_module_style_js(effective_code):
                    converted = module_to_inline_code(effective_code)
                    if converted:
                        inline_code = converted

                previous_code = str((node.get("parameters") or {}).get("jsCode", ""))
                node.setdefault("parameters", {})
                node["parameters"]["jsCode"] = normalize_newlines(inline_code)
                if normalize_newlines(previous_code) != normalize_newlines(
                    node["parameters"]["jsCode"]
                ):
                    node_updated.append(
                        f"{workflow_slug}/{node_file_name(node)} (inlined: under {min_lines} lines)"
                    )
                inlined_nodes += 1
                patched_nodes += 1
                continue

            desired_rel = Path(workflow_slug) / node_file_name(node)
            desired_abs = (nodes_root_dir / desired_rel).resolve()
            ensure_dir(desired_abs.parent)

            normalized_code = with_trailing_newline(effective_code)
            desired_existed = desired_abs.exists()

            if source_abs and source_abs != desired_abs and source_abs.exists():
                if path_is_under(source_abs, nodes_root_dir):
                    if desired_existed:
                        desired_abs.write_text(normalized_code, encoding="utf-8")
                        source_abs.unlink(missing_ok=True)
                        node_updated.append(to_posix_path(desired_abs.relative_to(nodes_root_dir)))
                    else:
                        source_abs.rename(desired_abs)
                        node_moved.append(
                            f"{to_posix_path(source_abs.relative_to(nodes_root_dir))} -> "
                            f"{to_posix_path(desired_abs.relative_to(nodes_root_dir))}"
                        )
                    moved_files += 1
                else:
                    desired_abs.write_text(normalized_code, encoding="utf-8")
                    if desired_existed:
                        node_updated.append(
                            f"{to_posix_path(desired_abs.relative_to(nodes_root_dir))} (copied)"
                        )
                    else:
                        node_added.append(to_posix_path(desired_abs.relative_to(nodes_root_dir)))
                        created_files += 1
            elif not desired_existed:
                desired_abs.write_text(normalized_code, encoding="utf-8")
                node_added.append(to_posix_path(desired_abs.relative_to(nodes_root_dir)))
                created_files += 1
            else:
                existing = desired_abs.read_text(encoding="utf-8")
                if normalize_newlines(existing) != normalize_newlines(normalized_code):
                    desired_abs.write_text(normalized_code, encoding="utf-8")
                    node_updated.append(to_posix_path(desired_abs.relative_to(nodes_root_dir)))

            prev_js_code = str((node.get("parameters") or {}).get("jsCode", ""))
            node.setdefault("parameters", {})
            desired_rel_posix = desired_rel.as_posix()
            node["parameters"]["jsCode"] = build_wrapper(desired_rel_posix)
            if normalize_newlines(prev_js_code) != normalize_newlines(node["parameters"]["jsCode"]):
                node_updated.append(f"{desired_rel_posix} (wrapper)")
            expected_node_files.add(desired_abs)
            patched_nodes += 1

            bridge_rel = ensure_legacy_bridge(legacy_nodes_root_dir, desired_rel_posix)
            if bridge_rel is not None:
                node_bridged.append(bridge_rel)

        patched_raw_path = patched_raw_dir / file_name
        write_json(patched_raw_path, workflow)

        repo_workflow_path = repo_workflows_dir / file_name
        next_repo_json = json.dumps(workflow, indent=2) + "\n"
        if not repo_workflow_path.exists():
            workflow_created.append(file_name)
        else:
            prev_repo_json = repo_workflow_path.read_text(encoding="utf-8")
            if normalize_newlines(prev_repo_json) != normalize_newlines(next_repo_json):
                workflow_updated.append(file_name)
        repo_workflow_path.write_text(next_repo_json, encoding="utf-8")

    all_node_files = [
        p
        for p in list_files_recursive(nodes_root_dir)
        if p.suffix == ".js" and is_managed_node_js_file(p)
    ]
    removed_orphans = 0
    for node_file in all_node_files:
        abs_path = node_file.resolve()
        if abs_path in expected_node_files:
            continue
        node_file.unlink(missing_ok=True)
        node_deleted.append(to_posix_path(abs_path.relative_to(nodes_root_dir)))
        delete_empty_parents(abs_path, nodes_root_dir)
        removed_orphans += 1

    print("Workflows created:")
    if not workflow_created:
        print("- none")
    else:
        for item in sorted(workflow_created):
            print(f"- {item}")

    print("Workflows updated:")
    if not workflow_updated:
        print("- none")
    else:
        for item in sorted(workflow_updated):
            print(f"- {item}")

    print("Nodes added:")
    if not node_added:
        print("- none")
    else:
        for item in sorted(node_added):
            print(f"- {item}")

    print("Nodes updated:")
    if not node_updated:
        print("- none")
    else:
        for item in sorted(node_updated):
            print(f"- {item}")

    print("Nodes moved:")
    if not node_moved:
        print("- none")
    else:
        for item in sorted(node_moved):
            print(f"- {item}")

    print("Nodes deleted:")
    if not node_deleted:
        print("- none")
    else:
        for item in sorted(node_deleted):
            print(f"- {item}")

    print("Nodes bridged:")
    if not node_bridged:
        print("- none")
    else:
        for item in sorted(node_bridged):
            print(f"- {item}")

    print(
        "Node sync complete: "
        f"patched_nodes={patched_nodes} "
        f"moved_files={moved_files} "
        f"created_files={created_files} "
        f"inlined_nodes={inlined_nodes} "
        f"removed_orphans={removed_orphans} "
        f"bridges_created={len(node_bridged)} "
        f"missing_js_code={missing_js_code} "
        f"skipped_missing_source={skipped_missing_source} "
        f"min_lines={min_lines}"
    )


if __name__ == "__main__":
    main()
