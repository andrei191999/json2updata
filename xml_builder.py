"""
xml_builder.py  –  build, validate and package Updata 2.6.14 XML
=================================================================
Public API
----------
build_updata_xml(mapped: dict, leftover: dict) -> bytes
validate_xml(xml_bytes: bytes) -> None          # raises on failure
package_pair(xml_path: Path, pdf_path: Path, zip_pair: bool, out_dir: Path) -> None
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Dict, Any, List, Tuple
from zipfile import ZipFile, ZIP_DEFLATED
import shutil

from lxml import etree as ET
from lxml.etree import _Element

# ────────────────────────────────────────── spec-driven ordering ──
from spec_parser import load_spec

_RES = Path(__file__).parent / "resources"
_SPEC = _RES / "updata-2.6.14.csv"

# tag_path (parent) -> list[child order]   e.g. "Receiver" -> ["ReceiverID", …]
_TAG_SPECS, _REQ, _, _ALIASES, _ORDER_MAP = load_spec(_SPEC)

# canonical *root* order (spec has them in this sequence)
_ROOT_ORDER: Tuple[str, ...] = (
    "Sender",
    "Receiver",
    "DocumentReferences",
    "Document",
    "Delivery",
)

_log = logging.getLogger(__name__)


# ────────────────────────────────────────── helpers ──
def _ensure_path(root_map: Dict[str, _Element], tag_path: str) -> _Element:
    """
    Create XML nodes for a dotted tag path and return the leaf element.
    `root_map` should map first-level tag -> element (to keep roots in order).
    """
    parts = tag_path.split(".")

    # first element is guaranteed to be in root_map (created up-front)
    cur = root_map.get(parts[0])
    if cur is None:
        cur = ET.SubElement(root_map["_root"], parts[0])
        root_map[parts[0]] = cur

    # ---- walk/create remaining segments
    for part in parts[1:]:
        if part.startswith("@"):              # attribute
            return cur
        nxt = cur.find(part)
        if nxt is None:
            nxt = ET.SubElement(cur, part)
        cur = nxt
    return cur


def _reorder_children(elem: _Element, wanted: List[str]) -> None:
    """Re-order direct children of `elem` according to `wanted_order` list."""
    if not wanted or len(elem) <= 1:
        return
    idx = {t: i for i, t in enumerate(wanted)}
    elem[:] = sorted(list(elem), key=lambda e: idx.get(e.tag, 999)) # type: ignore


def _apply_global_order(root: _Element) -> None:
    """
    Walk *every* element in the tree and sort its children if we have
    an order list for that parent path in _ORDER_MAP.
    """
    path_cache = {root: ""}  # Element -> dotted path

    def walk(node: _Element, path: str) -> None:
        if path in _ORDER_MAP:
            _reorder_children(node, _ORDER_MAP[path])
        for ch in list(node): # type: ignore # copy to list to avoid modifying while iterating
            walk(ch, f"{path}.{ch.tag}" if path else ch.tag)

    walk(root, "")


# ────────────────────────────────────────── core build ──
def build_updata_xml(mapped: Dict[str, Any],
                     leftover: Dict[str, Any],
                     pdf_name: str | None = None) -> bytes:
    """
    Parameters
    ----------
    mapped    canonical_tag -> value   (already defaults-filled)
    leftover  unmapped_key  -> value   (→ <CustomMetadata> dump)

    Returns
    -------
    xml_bytes encoded UTF-8
    """
    root = ET.Element("Updata", version="2.6.14")

    # prepare root map in canonical order
    root_map: Dict[str, _Element] = {"_root": root}
    for tag in _ROOT_ORDER:
        root_map[tag] = ET.SubElement(root, tag)

    # ---- auto-detect a PDF name (from mapped values or leftovers)
    if pdf_name is None:
        pdf_name = next(
            (str(v) for v in list(mapped.values()) + list(leftover.values())
            if isinstance(v, str) and v.lower().endswith(".pdf")),
            None,
        )

    # create Document *once*; don't use setdefault with side-effects
    doc = root_map.get("Document")
    if doc is None:
        doc = ET.SubElement(root, "Document")
        root_map["Document"] = doc

    if pdf_name:
        mapped.setdefault("DocumentReferences.DocumentReference", pdf_name)
        mapped.setdefault("DocumentReferences.DocumentReference.@ref", "main_pdf")
        mapped.setdefault("Delivery.Archive.MainFiles", "main_pdf")

    # populate mapped tags
    for tag_path, val in mapped.items():
        if val in (None, "", []):
            continue

        # attribute?
        if ".@" in tag_path:
            elem_path, attr = tag_path.rsplit(".@", 1)
            elem = _ensure_path(root_map, elem_path)
            elem.set(attr, str(val))
        else:
            elem = _ensure_path(root_map, tag_path)
            elem.text = str(val)

    # dump leftovers to <CustomMetadata>
    for k, v in leftover.items():
        ET.SubElement(
            doc,
            "CustomMetadata",
            name=k,
            type="xs:string",      # schema-legal
            value=str(v),
        )

    # ── final full-tree ordering based on CSV
    _apply_global_order(root)

    return ET.tostring(
        root,
        encoding="utf-8",
        pretty_print=True,
        xml_declaration=True,
    )


# ────────────────────────────────────────── validation ──
def _xsd_path() -> Path:
    return _RES / "updata-2.6.14.xsd"


def validate_xml(xml_bytes: bytes) -> None:
    xsd_file = _xsd_path()
    if not xsd_file.exists():
        _log.warning("XSD %s missing – skipping validation", xsd_file)
        return

    schema = ET.XMLSchema(ET.parse(str(xsd_file)))
    doc = ET.fromstring(xml_bytes)
    if not schema.validate(doc):
        raise ValueError(schema.error_log.last_error)


# ────────────────────────────────────────── packaging ──
def package_pair(
    xml_path: Path,
    pdf_path: Path,
    zip_pair: bool,
    out_dir: Path,
) -> None:
    """
    Copy or ZIP XML + matching PDF into out_dir.
    """
    if not pdf_path.exists():
        _log.warning("PDF %s missing – skipping packaging", pdf_path.name)
        return

    if zip_pair:
        zip_name = out_dir / f"{pdf_path.stem}.zip"
        with ZipFile(zip_name, "w", ZIP_DEFLATED) as zf:
            zf.write(xml_path, xml_path.name)
            zf.write(pdf_path, pdf_path.name)
    else:
        shutil.copy2(pdf_path, out_dir / pdf_path.name)
