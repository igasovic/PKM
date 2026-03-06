#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


def normalize_newlines(text: str) -> str:
    return str(text).replace("\r\n", "\n")


def extract_paths(content: str):
    paths = []

    array_match = re.search(r"loadFirst\s*\(\s*\[(.*?)\]\s*\)", content, re.S)
    if array_match:
        raw = array_match.group(1)
        for m in re.finditer(r"""['"]([^'"]+?)['"]""", raw):
            p = m.group(1).strip()
            if p and p not in paths:
                paths.append(p)

    if not paths:
        req_match = re.search(r"""require\(\s*['"]([^'"]+?\.js)['"]\s*\)""", content)
        if req_match:
            p = req_match.group(1).strip()
            if p:
                paths.append(p)

    return paths


def is_bridge_file(content: str) -> bool:
    if "module.exports = async function bridge(ctx)" not in content:
        return False
    if "return fn(ctx);" in content:
        return True
    if "const fn = loadFirst(" in content:
        return True
    return False


def build_bridge(paths):
    js_paths = json.dumps(paths, indent=2)
    return (
        '"use strict";\n\n'
        "function loadFirst(paths) {\n"
        "  let lastErr;\n"
        "  for (const p of paths) {\n"
        "    try {\n"
        "      return require(p);\n"
        "    } catch (err) {\n"
        "      lastErr = err;\n"
        "      if (!err || err.code !== 'MODULE_NOT_FOUND') {\n"
        "        throw err;\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "  throw lastErr;\n"
        "}\n\n"
        f"const loaded = loadFirst({js_paths});\n"
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


def main(argv):
    if len(argv) != 1:
        print("Usage: repair_legacy_bridges.py <legacy_nodes_root_dir>", file=sys.stderr)
        return 2

    root = Path(argv[0]).resolve()
    if not root.exists() or not root.is_dir():
        print(f"Missing legacy nodes root dir: {root}", file=sys.stderr)
        return 1

    repaired = []
    skipped = []

    for path_obj in sorted(root.rglob("*.js")):
        content = path_obj.read_text(encoding="utf-8")
        if not is_bridge_file(content):
            continue
        paths = extract_paths(content)
        if not paths:
            skipped.append(path_obj)
            continue
        new_content = build_bridge(paths)
        if normalize_newlines(content) == normalize_newlines(new_content):
            continue
        path_obj.write_text(new_content, encoding="utf-8")
        repaired.append(path_obj)

    print("Legacy bridges repaired:")
    if repaired:
        for item in repaired:
            print(f"- {item.relative_to(root).as_posix()}")
    else:
        print("- none")

    if skipped:
        print("Legacy bridges skipped (could not extract target paths):")
        for item in skipped:
            print(f"- {item.relative_to(root).as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
