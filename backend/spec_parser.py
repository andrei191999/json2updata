"""
spec_parser.py – read “Tag,Mandatory,Parent,Alias,Rule” CSV
===========================================================

Mandatory column
----------------
M   strictly required          → **errors** if empty / missing
C   conditional (Y?)           → **errors** if empty / missing
O   optional                   → never an error
(blank accepted ⇒ O)

Parent column
-------------
T   this row is only a **container** (no value itself)
F   (“” / anything else) → normal leaf tag

A *parent* tag is never reported as error / warning – only its children
are checked.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Tuple, Set
from backend.settings import get_settings
from backend.logging_config import dbg

settings = get_settings()

# ───────────────────────────────────────────────────────── helpers ──
def _norm(s: str | None) -> str:
    return (s or "").strip().upper()
# ────────────────────────────────────────────────────────────────────────────
# Data structure
# ────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class TagSpec:
    tag:        str
    mandatory:  str          # 'M' | 'C' | 'O'
    is_parent:  bool         # container (no text content)
    aliases:    Tuple[str, ...]
    rule:       str | None = None


# ────────────────────────────────────────────────────────── loader ──
def load_spec(csv_path: str | Path = settings.SPEC_CSV) -> Tuple[
        List[TagSpec],
        Set[str],                    # required leaves  (M)
        Set[str],                    # conditional leaves (C)
        Set[str],                    #parent_req:            # required *parent* tags
        Set[str],                    #parent_opt:          # optional *parent* tags
        Dict[str, Tuple[str, ...]],  # alias map (canonical → aliases)
        Dict[str, str],              # reverse alias map (alias → canonical)
        Dict[str, int]               # order map (tag → csv-row index)
]:
    specs:        list[TagSpec]             = []
    required:     set[str]                  = set()
    conditional:  set[str]                  = set()
    parent_req:      set[str]                  = set()
    parent_opt:      set[str]                  = set()
    alias_map:    dict[str, Tuple[str, ...]] = {}
    alias_rev:    dict[str, str]            = {}
    order_map:    dict[str, int]            = {}

    with open(csv_path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row_idx, row in enumerate(reader):
            tag        = row["Tag"].strip()
            mand       = _norm(row.get("Mandatory") or "O")     # default → O
            is_parent  = _norm(row.get("Parent")) == "T"

            aliases = tuple(a.strip() for a in (row.get("Alias") or "").split(";") if a.strip())
            rule    = (row.get("Rule") or "").strip() or None

            specs.append(TagSpec(tag, mand, is_parent, aliases, rule))
            order_map[tag] = row_idx
            alias_map[tag] = aliases

            # reverse alias table (lower-case for case-insensitive match)
            for a in aliases:
                alias_rev[a.lower()] = tag

            if is_parent:                         # ← parent rows
                if mand == "M":
                    parent_req.add(tag)
                else:                             # “C” or “O” or blank → optional parent
                    parent_opt.add(tag)
            else:                                 # ← leaf rows
                if mand == "M":
                    required.add(tag)
                elif mand == "C":
                    conditional.add(tag)

    dbg(
        "spec_parser", "load_spec → required(%d)=%s ; conditional(%d)=%s ; "
        "parent_req(%d)=%s ; parent_opt(%d)=%s",
        len(required), sorted(required),
        len(conditional), sorted(conditional),
        len(parent_req), sorted(parent_req),
        len(parent_opt), sorted(parent_opt),
    )

    return (specs, required, conditional, parent_req, parent_opt,
            alias_map, alias_rev, order_map)


# ──────────────────────────────────────────────── public constants ──
(_SPECS,
 _REQ,
 _COND,
 _parent_REQ,
 _parent_OPT,
 _ALIAS_MAP,
 _ALIAS_REV,
 _ORDER) = load_spec()

updata_tag_list:            list[str]                   = [s.tag for s in _SPECS]
updata_order_map:           dict[str, int]              = _ORDER
updata_required_tags:       set[str]                    = _REQ
updata_cond_required_tags:  set[str]                    = _COND
updata_parent_req_tags:     set[str]                    = _parent_REQ
updata_parent_opt_tags:     set[str]                    = _parent_OPT
alias_map:                  dict[str, Tuple[str, ...]]  = _ALIAS_MAP
alias_rev_map:              dict[str, str]              = _ALIAS_REV

# handy union of all mandatory leaves
updata_mandatory_leaf_tags: set[str] = _REQ | _COND


# ─────────────────────────────────────────────────────── self-test ──
if __name__ == "__main__":
    print("CSV rows            :", len(_SPECS))
    print("Mandatory leaves (M):", len(_REQ))
    print("Conditional leaves (C):", len(_COND))
    print("Parent req rows         :", len(_parent_REQ))
    print("Parent opt rows         :", len(_parent_OPT))
