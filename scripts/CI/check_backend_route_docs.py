#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
ROUTE_SOURCE_PATHS = [
    ROOT / "src/server/index.js",
    *sorted((ROOT / "src/server/routes").glob("*.js")),
]
REGISTRY_PATH = ROOT / "docs/backend_route_registry.json"


def extract_routes(source_text: str) -> set[str]:
    routes: set[str] = set()

    explicit = re.findall(r"method === '([A-Z]+)'\s*&&\s*url\.pathname === '([^']+)'", source_text)
    for method, path in explicit:
        routes.add(f"{method} {path}")

    if "/chatgpt/working_memory" in source_text:
        routes.add("POST /chatgpt/working_memory")

    if "url.pathname.startsWith('/db/')" in source_text:
        for path in [
            "/db/insert",
            "/db/update",
            "/db/delete",
            "/db/move",
            "/db/read/continue",
            "/db/read/find",
            "/db/read/last",
            "/db/read/pull",
            "/db/read/smoke",
            "/db/test-mode/toggle",
        ]:
            routes.add(f"POST {path}")

    dynamic_patterns = {
        "GET /status/batch/:batch_id": r"status\/batch\/([^/]+)",
        "GET /status/t1/batch/:batch_id": r"status\/t1\/batch\/([^/]+)",
        "GET /debug/failures/by-run/:run_id": r"debug\/failures\/by-run\/([^/]+)",
        "GET /debug/failures/:failure_id": r"debug\/failures\/([^/]+)",
        "GET /debug/failure-bundle/:run_id": r"debug\/failure-bundle\/([^/]+)",
        "GET /debug/run/:run_id": r"debug\/run\/([^/]+)",
    }
    for route, token in dynamic_patterns.items():
        if token in source_text:
            routes.add(route)

    return routes


def main() -> int:
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    registry_routes: set[str] = set()
    docs_by_route: dict[str, str] = {}
    tests_by_route: dict[str, list[str]] = {}

    for item in registry:
        route = f"{item['method']} {item['path']}"
        registry_routes.add(route)
        docs_by_route[route] = item["doc"]
        tests_by_route[route] = list(item.get("tests", []))

    source_text = "\n".join(path.read_text(encoding="utf-8") for path in ROUTE_SOURCE_PATHS if path.exists())
    code_routes = extract_routes(source_text)

    missing_from_registry = sorted(code_routes - registry_routes)
    stale_registry = sorted(registry_routes - code_routes)

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

    if not missing_from_registry and not stale_registry and not doc_failures and not test_failures:
        print("Route/doc parity OK")
        return 0

    if missing_from_registry:
        print("Undocumented route registry entries needed for code routes:")
        for route in missing_from_registry:
            print(f"  - {route}")
    if stale_registry:
        print("Route registry contains routes no longer found in code:")
        for route in stale_registry:
            print(f"  - {route}")
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
