#!/usr/bin/env python3
import sys
from pathlib import Path


def is_bridge_file(content: str) -> bool:
    return (
        "module.exports = async function bridge(ctx)" in content
        and "/data/src/n8n/nodes/" in content
    )


def delete_empty_parents(file_path: Path, stop_dir: Path) -> None:
    current = file_path.parent
    stop_resolved = stop_dir.resolve()
    while True:
        current_resolved = current.resolve()
        if current_resolved == stop_resolved:
            break
        if stop_resolved not in current_resolved.parents:
            break
        try:
            next(current.iterdir())
            break
        except StopIteration:
            current.rmdir()
            current = current.parent


def main(argv):
    if len(argv) != 1:
        print("Usage: remove_legacy_bridges.py <legacy_nodes_root_dir>", file=sys.stderr)
        return 2

    root = Path(argv[0]).resolve()
    if not root.exists() or not root.is_dir():
        print(f"Missing legacy nodes root dir: {root}", file=sys.stderr)
        return 1

    removed = []
    for path_obj in sorted(root.rglob("*.js")):
        content = path_obj.read_text(encoding="utf-8", errors="replace")
        if not is_bridge_file(content):
            continue
        path_obj.unlink(missing_ok=True)
        delete_empty_parents(path_obj, root)
        removed.append(path_obj)

    print("Legacy bridge files removed:")
    if removed:
        for item in removed:
            print(f"- {item.relative_to(root).as_posix()}")
    else:
        print("- none")
    print(f"Removed count: {len(removed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
