"""
make_flat_spec.py  (v3 – hierarchy-stack)
-----------------------------------------
Flatten UnifiedPost's Updata 2.6.14 hierarchical XLSX into a simple
Tag,Required CSV while preserving levels:

    Sender.PostalAddress.Streetname,Y
    Sender.PostalAddress.Zipcode,Y
    Receiver.PartyIdentification.PartyID,Y
    ...

* Columns A-G (0-6) hold the hierarchy levels.
* Column I (index 8) holds cardinality (e.g. 1..1, 0..n, M).
* We keep **only LEAF** rows (those having a cardinality).
* Required = Y when cardinality starts with 1 or M (mandatory), else N.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple, List

import openpyxl
import pandas as pd

ROOT   = Path(__file__).resolve().parent / "resources"
SRC_XLSX = ROOT / "updata-2.6.14.xlsx"
DST_CSV  = ROOT / "updata-2.6.14-flat.csv"


def iter_leaf_rows(ws) -> Iterable[Tuple[str, str]]:
    """Yield (dotted_path, Y|N) for every LEAF element in the worksheet."""
    path_stack: List[str] = [""] * 7           # depth 0-6
    seen: set[str] = set()

    for row in ws.iter_rows(values_only=True):
        cells = [str(c).strip() if c else "" for c in row[:9]]
        if not any(cells[:7]):
            continue                            # empty row

        # depth = first non-empty col in range A-G
        try:
            depth = next(i for i, val in enumerate(cells[:7]) if val)
        except StopIteration:
            continue

        tag_text = cells[depth].strip("<>/")

        # ─── skip header / comment rows ────────────────────────────────
        junk = tag_text.lower()
        if junk.startswith(("level", "updata@", "com.")) or not tag_text:
            continue

        # keep hierarchy
        path_stack[depth] = tag_text
        for i in range(depth + 1, 7):
            path_stack[i] = ""

        cardinality = cells[8]
        if not cardinality:                     # container row
            continue

        dotted = ".".join(p for p in path_stack[:depth + 1] if p)
        if dotted in seen:
            continue
        seen.add(dotted)

        required = "Y" if str(cardinality).strip().upper().startswith(("1", "M")) else "N"
        yield dotted, required



def main() -> None:
    if not SRC_XLSX.exists():
        raise SystemExit(f"Spec not found: {SRC_XLSX}")

    wb = openpyxl.load_workbook(SRC_XLSX, data_only=True)
    ws = wb.active
    rows = list(iter_leaf_rows(ws))

    if not rows:
        raise SystemExit("No leaf rows detected – check sheet layout.")

    pd.DataFrame(rows, columns=["Tag", "Required"]).to_csv(DST_CSV, index=False)
    print(f"✅  Wrote {DST_CSV.relative_to(ROOT.parent)}  ({len(rows)} rows)")


if __name__ == "__main__":
    main()
