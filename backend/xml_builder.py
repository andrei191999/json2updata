"""
✔  No hard-coded defaults are injected.
✔  The flat CSV order is respected.
✔  Empty tags are **skipped** (caller is responsible for warnings/errors).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

from lxml import etree as ET
from functools import lru_cache
from lxml.etree import _Element

from backend.spec_parser import load_spec
from backend.date_utils import to_iso as _to_iso
from backend.logging_config import dbg, file_log_context, thread_local
from backend.settings       import get_settings

settings = get_settings()
# ─── Module-level logger ──────────────────────────────────────────────
_log = logging.getLogger(__name__)

# CSV-derived helpers
(_TAG_SPECS, *_REST, _ORDER_IDX) = load_spec(settings.SPEC_CSV)

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
    is_real_file = bool(pdf_name) and not str(pdf_name).startswith("__preview__")
    with file_log_context(pdf_name if is_real_file else None):
        dbg("xml_builder", f"build xml start pdf={pdf_name or '-'} mapped={len(mapped)}")

        # 1) <Updata version="…">
        root = ET.Element("Updata", version="2.6.14")
        root_map: Dict[str, _Element] = {"_root": root}

        # 2) Stub out first‐level tags
        for tag in _FIRST_LEVEL:
            root_map[tag] = ET.SubElement(root, tag)

        doc_elem = root_map["Document"]
        # Default / ensure a DocumentReference exists and matches the final PDF name.
        # Mapping may have proposed a value; we override with the actual one if provided.
        if pdf_name:
            docrefs = _ensure_path(root_map, "DocumentReferences")
            # Prefer the DR that matches the mapping's @ref (if any)
            want_ref = None
            try:
                want_ref = (mapped.get("DocumentReferences", {}) or {}).get("DocumentReference", {})
                if isinstance(want_ref, dict):
                    want_ref = want_ref.get("@ref")
            except Exception:
                want_ref = mapped.get("DocumentReferences.DocumentReference.@ref")
            # find existing <DocumentReference>
            dr = None
            for cand in docrefs.findall("DocumentReference"):
                if want_ref is None or cand.get("ref") == want_ref:
                    dr = cand; break
            if dr is None:
                dr = ET.SubElement(docrefs, "DocumentReference")
                if want_ref:
                    dr.set("ref", str(want_ref))
            dr.text = pdf_name
            dbg("xml_builder", "Set DocumentReference text to final PDF name", ref=pdf_name, keep_ref=dr.get("ref"))

        # ── leaves & attributes ──────────────────────────────────────────
        for tag_path, val in mapped.items():
            # skip empties  – they remain “missing / empty” for caller
            if val in ("", None, []) or isinstance(val, (dict, list)):
                continue

            if _PATCH_RE.match(str(val)):
                dbg("xml_builder", "Patch object ignored", tag_path)
                continue

            if "date" in tag_path.lower():
                value = _to_iso(val)
                if value is None:
                    dbg("xml_builder", "Bad date – skipped", tag_path, raw=str(val))
                    continue
                val = value

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
            dbg("xml_builder", "Inserted default DocumentReference", ref=pdf_name)

        _apply_order(root)
        dbg("xml_builder", "DONE build_updata_xml", bytes=len(ET.tostring(root, encoding="utf-8")))

        # 5) Serialize (pretty print, declaration)
        return ET.tostring(
            root, encoding="utf-8", pretty_print=True, xml_declaration=True
        )

# ─────────────────── XML validation (lxml + XSD) ────────────────────
@lru_cache(maxsize=1)
def _get_schema():
    if not settings.SPEC_XSD.exists():
        return None
    return ET.XMLSchema(ET.parse(str(settings.SPEC_XSD)))

def validate_xml(xml_bytes: bytes) -> None:
    dbg("xml_builder", "START validate_xml")
    schema = _get_schema()
    if schema is None:
        dbg("xml_builder", "XSD not found – skipping validation", xsd=str(settings.SPEC_XSD))
        return
    doc = ET.fromstring(xml_bytes)
    if not schema.validate(doc):
        err = schema.error_log.last_error
        dbg("xml_builder", "XML validation FAILED", error=str(err))
        raise ValueError(err)
    dbg("xml_builder", "XML validation OK")
