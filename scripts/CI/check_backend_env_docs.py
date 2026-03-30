#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
DOC_PATH = ROOT / "docs/backend_runtime_env.md"
SEARCH_ROOTS = [ROOT / "src/server", ROOT / "src/libs"]


def collect_env_vars() -> set[str]:
    env_vars: set[str] = set()
    for search_root in SEARCH_ROOTS:
        for path in search_root.rglob("*.js"):
            if "node_modules" in path.parts:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            env_vars.update(re.findall(r"process\.env\.([A-Z0-9_]+)", text))
    return env_vars


def main() -> int:
    env_vars = sorted(collect_env_vars())
    doc_text = DOC_PATH.read_text(encoding="utf-8")
    missing = [name for name in env_vars if name not in doc_text]

    if not missing:
        print("Backend env/doc parity OK")
        return 0

    print("Backend env vars used in code but missing from docs/backend_runtime_env.md:")
    for name in missing:
        print(f"  - {name}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
