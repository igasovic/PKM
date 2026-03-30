#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
INDEX_PATH = ROOT / "src/server/index.js"

ROUTE_DOCS = {
    "GET /health": ["docs/api_control.md"],
    "GET /ready": ["docs/api_control.md"],
    "GET /version": ["docs/api_control.md"],
    "GET /config": ["docs/api_control.md"],
    "POST /mcp": ["docs/api_control.md"],
    "POST /chatgpt/working_memory": ["docs/api_control.md"],
    "POST /chatgpt/wrap-commit": ["docs/api_control.md"],
    "POST /normalize/telegram": ["docs/api_ingest.md"],
    "POST /normalize/email/intent": ["docs/api_ingest.md"],
    "POST /normalize/email": ["docs/api_ingest.md"],
    "POST /normalize/webpage": ["docs/api_ingest.md"],
    "POST /normalize/notion": ["docs/api_ingest.md"],
    "POST /enrich/t1": ["docs/api_ingest.md"],
    "POST /enrich/t1/batch": ["docs/api_ingest.md"],
    "GET /status/t1/batch": ["docs/api_ingest.md"],
    "GET /status/t1/batch/:batch_id": ["docs/api_ingest.md"],
    "POST /telegram/route": ["docs/api_calendar.md"],
    "POST /calendar/normalize": ["docs/api_calendar.md"],
    "POST /calendar/finalize": ["docs/api_calendar.md"],
    "POST /calendar/observe": ["docs/api_calendar.md"],
    "POST /distill/sync": ["docs/api_distill.md"],
    "POST /distill/plan": ["docs/api_distill.md"],
    "POST /distill/run": ["docs/api_distill.md"],
    "GET /status/batch": ["docs/api_distill.md"],
    "GET /status/batch/:batch_id": ["docs/api_distill.md"],
    "POST /import/email/mbox": ["docs/api_ingest.md"],
    "POST /debug/failures": ["docs/api_control.md"],
    "GET /debug/failures": ["docs/api_control.md"],
    "GET /debug/failures/by-run/:run_id": ["docs/api_control.md"],
    "GET /debug/failures/:failure_id": ["docs/api_control.md"],
    "GET /debug/failure-bundle/:run_id": ["docs/api_control.md"],
    "GET /debug/run/last": ["docs/api_control.md"],
    "GET /debug/runs": ["docs/api_control.md"],
    "GET /debug/run/:run_id": ["docs/api_control.md"],
    "GET /db/test-mode": ["docs/api_control.md"],
    "POST /db/test-mode/toggle": ["docs/api_control.md"],
    "POST /echo": ["docs/api_control.md"],
    "POST /db/insert": ["docs/api_read_write.md"],
    "POST /db/update": ["docs/api_read_write.md"],
    "POST /db/delete": ["docs/api_read_write.md"],
    "POST /db/move": ["docs/api_read_write.md"],
    "POST /db/read/continue": ["docs/api_read_write.md"],
    "POST /db/read/find": ["docs/api_read_write.md"],
    "POST /db/read/last": ["docs/api_read_write.md"],
    "POST /db/read/pull": ["docs/api_read_write.md"],
    "POST /db/read/smoke": ["docs/api_read_write.md"],
}


def extract_routes(index_text: str) -> set[str]:
    routes: set[str] = set()

    explicit = re.findall(r"method === '([A-Z]+)'\s*&&\s*url\.pathname === '([^']+)'", index_text)
    for method, path in explicit:
        routes.add(f"{method} {path}")

    if "/chatgpt/working_memory" in index_text:
        routes.add("POST /chatgpt/working_memory")

    if "url.pathname.startsWith('/db/')" in index_text:
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
        if token in index_text:
            routes.add(route)

    return routes


def main() -> int:
    index_text = INDEX_PATH.read_text(encoding="utf-8")
    code_routes = extract_routes(index_text)
    registry_routes = set(ROUTE_DOCS.keys())

    missing_from_registry = sorted(code_routes - registry_routes)
    stale_registry = sorted(registry_routes - code_routes)

    doc_failures: list[str] = []
    for route, rel_docs in sorted(ROUTE_DOCS.items()):
        route_token = route.split(" ", 1)[1]
        for rel_doc in rel_docs:
            doc_path = ROOT / rel_doc
            if route_token not in doc_path.read_text(encoding="utf-8"):
                doc_failures.append(f"{route} missing in {rel_doc}")

    if not missing_from_registry and not stale_registry and not doc_failures:
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
    return 1


if __name__ == "__main__":
    sys.exit(main())
