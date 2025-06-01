"""
spec_parser.py  –  parse the flat Updata 2.6.14 tag spec (CSV or XLSX)

Required columns (case-insensitive):
    Tag, Required, Alias   [, Rule]

Returns
-------
tag_specs  : list[TagSpec]
required   : set[str]            # mandatory tag paths
alias_map  : dict[str, str]      # alias (lower-case) → canonical tag
"""
from __future__ import annotations

import re
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple, Dict, Set

try:
    import pandas as pd  # falls back to csv if pandas not installed
except ImportError:      # pragma: no cover
    pd = None


@dataclass(frozen=True)
class TagSpec:
    tag: str                     # e.g. "Receiver.ContactName"
    required: bool               # Y  (always mandatory)
    conditional: bool            # Y? (mand. only if parent present)
    aliases: Tuple[str, ...]     # ("doc_date", "cmis_creationDate")
    rule: str | None = None      # optional expression


def _read(path: Path) -> List[Dict[str, str]]:
    if path.suffix.lower() == ".csv" or pd is None:
        with path.open(newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))
    # XLSX – take first sheet
    return pd.read_excel(path, sheet_name=0).to_dict(orient="records")  # type: ignore


def build_order_maps(tag_specs: List[TagSpec]) -> Dict[str, List[str]]:
    """
    Return {'Receiver': [...], 'Document': [...], ...} preserving
    the *first-level* child order as they appear in the CSV.
    """
    order: Dict[str, List[str]] = {}
    for ts in tag_specs:
        parent, *_ = ts.tag.split(".", 1)
        child = ts.tag.split(".")[1] if "." in ts.tag else None
        if child:
            order.setdefault(parent, [])
            if child not in order[parent]:
                order[parent].append(child)
    return order


def load_spec(path: str | Path
              ) -> tuple[List[TagSpec],
                         Set[str],
                         Set[str],
                         Dict[str, str],
                         Dict[str, List[str]]]:
    rows = _read(Path(path))
    tag_specs: List[TagSpec] = []
    required: Set[str] = set()
    conditional_required: Set[str] = set()
    alias_map: Dict[str, str] = {}


    for row in rows:
        tag = str(row["Tag"]).strip()
        if not tag:
            continue

        flag = str(row.get("Required", "")).strip().lower()
        req_flag  = flag == "y"
        cond_flag = flag == "y?"

        aliases = tuple(a.strip() for a in
                        re.split(r"[;,]", str(row.get("Alias", "")))
                        if a.strip())
        rule = str(row.get("Rule", "")).strip() or None

        tag_specs.append(TagSpec(tag, req_flag, cond_flag, aliases, rule))

        def is_leaf(tag_str: str) -> bool:
            parent_prefix = f"{tag_str}."
            return not any(r["Tag"].startswith(parent_prefix) for r in rows)

        if req_flag and is_leaf(tag):
            required.add(tag)
        elif cond_flag:
            conditional_required.add(tag)

        for al in aliases:
            alias_map[al.lower()] = tag

    return tag_specs, required, conditional_required, alias_map, build_order_maps(tag_specs)
