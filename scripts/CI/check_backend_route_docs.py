#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = ROOT / "docs/backend_route_registry.json"
EXPORT_SCRIPT_PATH = ROOT / "scripts/CI/export_backend_route_registry.js"


def load_registry_from_code() -> list[dict]:
    out = subprocess.run(
        ["node", str(EXPORT_SCRIPT_PATH)],
        cwd=str(ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout)


def main() -> int:
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    code_registry = load_registry_from_code()
    if registry != code_registry:
        print("Backend route registry drift detected:")
        print("  docs/backend_route_registry.json does not match src/server/routes/backend-route-registry.js")
        print("  run: scripts/CI/export_backend_route_registry.js --write")
        return 1

    registry_routes: set[str] = set()
    docs_by_route: dict[str, str] = {}
    tests_by_route: dict[str, list[str]] = {}

    for item in registry:
        route = f"{item['method']} {item['path']}"
        registry_routes.add(route)
        docs_by_route[route] = item["doc"]
        tests_by_route[route] = list(item.get("tests", []))

    doc_failures: list[str] = []
    test_failures: list[str] = []
    for route in sorted(registry_routes):
        route_token = route.split(" ", 1)[1]
        doc_path = ROOT / docs_by_route[route]
        if route_token not in doc_path.read_text(encoding="utf-8"):
            doc_failures.append(f"{route} missing in {docs_by_route[route]}")
        for rel_test in tests_by_route.get(route, []):
            if not (ROOT / rel_test).exists():
                test_failures.append(f"{route} missing test file {rel_test}")

    if not doc_failures and not test_failures:
        print("Route/doc parity OK")
        return 0

    if doc_failures:
        print("Route/doc parity failures:")
        for failure in doc_failures:
            print(f"  - {failure}")
    if test_failures:
        print("Route/test registry failures:")
        for failure in test_failures:
            print(f"  - {failure}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
