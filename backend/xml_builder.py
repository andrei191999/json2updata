"""
✔  No hard-coded defaults are injected.
✔  The flat CSV order is respected.
✔  Empty tags are **skipped** (caller is responsible for warnings/errors).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict
from datetime import datetime, timezone, date

from lxml import etree as ET
from lxml.etree import _Element

from backend.spec_parser import load_spec
from backend.date_utils import to_iso as _to_iso

# ─── Module-level logger ──────────────────────────────────────────────
_log = logging.getLogger(__name__)

# ─── Constants & resources ────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
RES  = ROOT / "resources"

SPEC_CSV = RES / "updata-2.6.14.csv"
XSD_PATH = RES / "updata-2.6.14.xsd"

# CSV-derived helpers
(_TAG_SPECS, *_REST, _ORDER_IDX) = load_spec(SPEC_CSV)

_FIRST_LEVEL = (
    "Sender",
    "Receiver",
    "DocumentReferences",
    "Document",
    "Delivery",
)

# Browser “patch object” pattern  {"include": …, "jsonKey": …, …}
_PATCH_RE = re.compile(r"^\{'include': .*'mode': 'real'?\}$")

# ─── Helpers ──────────────────────────────────────────────────────────
def _ensure_path(root_map: Dict[str, _Element], dotted: str) -> _Element:
    """
    Create intermediary nodes so that ``root.<dotted>`` definitely exists
    and return the deepest element.

    Example:  dotted = "Document.InvoiceDocumentReferenceIDs"
    """
    parts = dotted.split(".")
    cur = root_map.get(parts[0])
    if cur is None:
        cur = ET.SubElement(root_map["_root"], parts[0])
        root_map[parts[0]] = cur

    for seg in parts[1:]:
        nxt = cur.find(seg)
        if nxt is None:
            nxt = ET.SubElement(cur, seg)
        cur = nxt
    return cur


def _sort_children(node: _Element, parent_path: str) -> None:
    """Sort *node*’s **direct** children by CSV order."""
    if len(node) <= 1:
        return

    # build full paths of each child and look up its index
    def _key(child: _Element):
        full = f"{parent_path}.{child.tag}" if parent_path else child.tag
        return _ORDER_IDX.get(full, 99999)

    node[:] = sorted(node, key=_key)  # type: ignore


def _apply_order(root: _Element) -> None:
    """Depth-first walk and sort every level in-place."""
    def _walk(elem: _Element, path: str = "") -> None:
        _sort_children(elem, path)
        for child in elem:
            _walk(child, f"{path}.{child.tag}" if path else child.tag)

    _walk(root)


# ─────────────────────── main builder ───────────────────────────────
def build_updata_xml(
    mapped: Dict[str, Any],
    pdf_name: str | None = None,            # still supported
) -> bytes:
    """
    Convert *mapped* into pretty-printed Updata XML bytes.
    """
    _log.debug("building XML – %d mapped tags received", len(mapped))

    # 1) <Updata version="…">
    root = ET.Element("Updata", version="2.6.14")
    root_map: Dict[str, _Element] = {"_root": root}

    # 2) Stub out first‐level tags
    for tag in _FIRST_LEVEL:
        root_map[tag] = ET.SubElement(root, tag)

    doc_elem = root_map["Document"]   # guaranteed to exist now


    # ── leaves & attributes ──────────────────────────────────────────
    for tag_path, val in mapped.items():
        # skip empties  – they remain “missing / empty” for caller
        if val in ("", None, []) or isinstance(val, (dict, list)):
            continue

        if _PATCH_RE.match(str(val)):
            _log.debug("patch object leaked into mapped – %s: %s", tag_path, val)
            continue

        if "date" in tag_path.lower():
            value = _to_iso(val)
            if value is None:
                continue

        # ① custom metadata
        if tag_path.startswith("meta:doc:"):
            name = tag_path.split("meta:doc:", 1)[1]
            ET.SubElement(
                doc_elem,
                "CustomMetadata",
                name=name,
                type="xs:string",
                value=str(val),
            )
            continue

        # 3b) Attribute row  path.@attr
        if ".@" in tag_path:
            elem_path, attr = tag_path.split(".@", 1)
            elem = _ensure_path(root_map, elem_path)
            elem.set(attr, str(val))
            continue

        # 3c) Normal leaf
        elem = _ensure_path(root_map, tag_path)
        elem.text = str(val)


    # optional helper: default DocumentReferences when pdf_name provided
    if pdf_name and "DocumentReferences.DocumentReference" not in mapped:
        dr = _ensure_path(root_map, "DocumentReferences.DocumentReference")
        dr.set("ref", "pdf")
        dr.text = pdf_name

    _apply_order(root)

    # 5) Serialize (pretty print, declaration)
    return ET.tostring(
        root, encoding="utf-8", pretty_print=True, xml_declaration=True
    )

# ─────────────────── XML validation (lxml + XSD) ────────────────────
def validate_xml(xml_bytes: bytes) -> None:
    """
    Validate the given XML bytes against the Updata 2.6.14 XSD.
    Raises ValueError if invalid; skips if XSD not found.
    """
    if not XSD_PATH.exists():
        _log.warning("XSD %s not found – skipping validation", XSD_PATH)
        return

    schema = ET.XMLSchema(ET.parse(str(XSD_PATH)))
    doc    = ET.fromstring(xml_bytes)
    if not schema.validate(doc):
        raise ValueError(schema.error_log.last_error)
