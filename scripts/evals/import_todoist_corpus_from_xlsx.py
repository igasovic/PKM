#!/usr/bin/env python3
"""Import Todoist labeling workbook (Corpus sheet) into eval fixture JSON.

This parser intentionally uses stdlib only (zip+xml) so it can run on Pi
without external Python deps such as openpyxl.
"""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "evals" / "todoist" / "fixtures" / "gold" / "normalize.json"

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}

ALLOWED_CORPUS_GROUPS = {"gold_only", "prompt_examples", "eval_core"}
ALLOWED_SHAPES = {"project", "next_action", "micro_task", "follow_up", "vague_note", "unknown"}


def as_text(value) -> str:
    return "" if value is None else str(value).strip()


def lower(value) -> str:
    return as_text(value).lower()


def col_to_num(col: str) -> int:
    out = 0
    for ch in col:
        out = out * 26 + (ord(ch) - 64)
    return out


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall(".//a:si", NS):
        pieces = []
        for t_node in si.findall(".//a:t", NS):
            pieces.append(t_node.text or "")
        out.append("".join(pieces))
    return out


def parse_cell_value(cell: ET.Element, shared: list[str]):
    c_type = cell.attrib.get("t")
    v_node = cell.find("a:v", NS)
    if v_node is None:
        is_node = cell.find("a:is/a:t", NS)
        return is_node.text if is_node is not None else None
    raw = v_node.text
    if c_type == "s":
        try:
            return shared[int(raw)]
        except Exception:
            return raw
    return raw


def load_sheet_rows(xlsx_path: Path, sheet_name: str) -> list[dict[str, str]]:
    with zipfile.ZipFile(xlsx_path, "r") as zf:
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels.findall(".//pr:Relationship", NS)
        }

        target = None
        for sheet in workbook.findall(".//a:sheets/a:sheet", NS):
            name = sheet.attrib.get("name")
            if name == sheet_name:
                rid = sheet.attrib.get(f"{{{NS['r']}}}id")
                target = rid_to_target.get(rid)
                break
        if not target:
            raise SystemExit(f"Sheet '{sheet_name}' not found in workbook")

        sheet_path = target if target.startswith("xl/") else f"xl/{target}"
        shared = read_shared_strings(zf)
        sheet_root = ET.fromstring(zf.read(sheet_path))

    parsed_rows: list[tuple[int, dict[str, str | None]]] = []
    for row in sheet_root.findall(".//a:sheetData/a:row", NS):
        row_num = int(row.attrib.get("r", "0"))
        vals: dict[str, str | None] = {}
        for cell in row.findall("a:c", NS):
            ref = cell.attrib.get("r", "")
            col = "".join(ch for ch in ref if ch.isalpha())
            vals[col] = parse_cell_value(cell, shared)
        parsed_rows.append((row_num, vals))

    if not parsed_rows:
        return []

    # Header row = first non-empty row.
    header_row_num = None
    header_map: dict[str, str] = {}
    for row_num, vals in parsed_rows:
        non_empty = [(col, v) for col, v in vals.items() if as_text(v)]
        if non_empty:
            header_row_num = row_num
            for col, value in sorted(non_empty, key=lambda item: col_to_num(item[0])):
                header_map[col] = as_text(value)
            break
    if header_row_num is None:
        return []

    rows: list[dict[str, str]] = []
    for row_num, vals in parsed_rows:
        if row_num <= header_row_num:
            continue
        out = {name: as_text(vals.get(col)) for col, name in header_map.items()}
        if any(as_text(v) for v in out.values()):
            rows.append(out)
    return rows


def make_case_name(raw_title: str) -> str:
    title = as_text(raw_title)
    if not title:
        return "untitled"
    compact = re.sub(r"\s+", " ", title)
    return compact[:96]


def make_failure_tags(shape: str) -> list[str]:
    tags = ["task_shape", "normalized_title"]
    if shape != "project":
        tags.append("project_overcall")
    return tags


def to_fixture_rows(rows: list[dict[str, str]]) -> list[dict]:
    fixtures = []
    for idx, row in enumerate(rows, start=1):
        raw_title = as_text(row.get("raw_title"))
        project_key = lower(row.get("project_key"))
        task_shape = lower(row.get("gold_task_shape"))
        normalized_title = as_text(row.get("gold_normalized_title_en"))
        corpus_group = lower(row.get("eval_set"))

        if not raw_title:
            continue
        if corpus_group not in ALLOWED_CORPUS_GROUPS:
            raise SystemExit(f"Row {idx}: invalid eval_set/corpus_group '{corpus_group}'")
        if task_shape not in ALLOWED_SHAPES:
            raise SystemExit(f"Row {idx}: invalid gold_task_shape '{task_shape}'")
        if not normalized_title:
            raise SystemExit(f"Row {idx}: missing gold_normalized_title_en")

        fixtures.append({
            "case_id": f"T-NORM-{idx:03d}",
            "name": make_case_name(raw_title),
            "bucket": task_shape,
            "corpus_group": corpus_group,
            "failure_tags": make_failure_tags(task_shape),
            "input": {
                "raw_title": raw_title,
                "raw_description": None,
                "project_key": project_key,
                "todoist_section_name": None,
                "lifecycle_status": "open",
                "has_subtasks": False,
                "explicit_project_signal": raw_title.lower().startswith("prj:"),
            },
            "expect": {
                "task_shape": task_shape,
                "normalized_title_en": normalized_title,
                "suggested_next_action": None,
            },
        })
    return fixtures


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Todoist Corpus sheet to eval fixture JSON.")
    parser.add_argument("--xlsx", required=True, help="Path to workbook (.xlsx)")
    parser.add_argument("--sheet", default="Corpus", help="Sheet name to read (default: Corpus)")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path")
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx).expanduser().resolve()
    if not xlsx_path.exists():
        raise SystemExit(f"Workbook not found: {xlsx_path}")

    rows = load_sheet_rows(xlsx_path, args.sheet)
    fixtures = to_fixture_rows(rows)
    out_path = Path(args.output).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(fixtures)} fixture rows to {out_path}")


if __name__ == "__main__":
    main()

