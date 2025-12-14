# backend/utils/workers.py
from __future__ import annotations
import json, time
import os, re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
import threading

# Make sure check_if_cancelled is imported
from backend.api_state import reserve_path, release_path, check_if_cancelled
from backend.logging_config import dbg, file_log_context
from backend.mapper import Mapper
from backend.packager import package_pair, _next_free_threadsafe
from backend.settings import get_settings
from backend.utils.helpers import safe_unlink
from backend.xml_builder import build_updata_xml, validate_xml

settings = get_settings()
_thread = threading.local()

_INVALID = {"", "null", "none", "nan"}  # lowercased

# add near the top (next to _get_flat_or_nested or replace it)
def _val(d: dict, dotted: str):
    """
    Return value for either flat dotted key ('A.B') or nested dict d['A']['B'].
    """
    if dotted in d:
        return d[dotted]
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
        if cur is None:
            return None
    return cur

import time

def _link_or_copy(src: Path, dst: Path, retries: int = 5, backoff: float = 0.2):
    # try hard-link first
    try:
        os.link(src, dst)
        dbg("worker.build", f"hardlinked pdf -> {dst}")
        return
    except (AttributeError, OSError):
        pass

    # fallback: retry copy (handles transient 'Access is denied')
    for i in range(retries):
        try:
            shutil.copy2(src, dst)
            dbg("worker.build", f"copied pdf -> {dst}")
            return
        except PermissionError:
            time.sleep(backoff * (i + 1))
        except OSError:
            time.sleep(backoff * (i + 1))
    raise  # bubble up if we truly can't write

def _safe_stem_from_mapping(mapped: dict, default_stem: str) -> str:
    def pick_first(*vals) -> str:
        for v in vals:
            s = (v.decode() if isinstance(v, bytes) else str(v or "")).strip()
            if not s or s.lower() in _INVALID:
                continue
            stem = Path(s).stem
            stem = re.sub(r'[\\/:*?"<>|]+', "_", stem).strip(" .")
            if stem:
                return stem
        return default_stem

    # 👇 NEW: consider both nested and flat forms
    return pick_first(
        mapped.get("_pdf_name"),
        _val(mapped, "Document.FileName"),
        mapped.get("FileName"),
        mapped.get("Name"),
        _val(mapped, "DocumentReferences.DocumentReference"),
    )

def _get_mapper():
    m = getattr(_thread, "mapper", None)
    if m is None:
        m = Mapper(
            spec_path=settings.SPEC_CSV,
            defaults_path=settings.DEFAULTS_YAML,
            fuzzy_threshold=settings.FUZZY_THRESHOLD,
        )
        _thread.mapper = m
    return m

def build_one(
    fname: str,
    *,
    pid: str,
    in_dir: Path,
    pdf_link_dir: Path | None = None,
    sub_dir_valid: Path,
    sub_dir_invalid: Path,
    template_ov: Dict[str, Any],
    overrides_all: Dict[str, Any],
    browser_map: Dict[str, Any],
    package_files: bool,
    zip_pair: bool,
) -> Dict[str, Any]:
    """Pure blocking code for one JSON/PDF pair with clean cancellation checks."""
    t0 = datetime.now()
    try:
        with file_log_context(fname):
            # ✅ Cleaned-up check
            if check_if_cancelled(pid):
                return {"file": fname, "success": False, "error": "Cancelled", "warnings": []}

            dbg("worker.build", f"START {fname}")
            mapper = _get_mapper()
            if fname in browser_map:
                mapped = browser_map[fname]
                errors, warnings = mapper._classify(mapped)
            else:
                with (in_dir / fname).open(encoding="utf-8") as fh:
                    src_json = json.load(fh)
                mapped, _, (errors, warnings) = mapper.map_json(src_json)

            # ✅ Cleaned-up check
            if check_if_cancelled(pid):
                return {"file": fname, "success": False, "error": "Cancelled", "warnings": []}

            for tag, ov in template_ov.items():
                if ov.get("include"): mapped[tag] = ov.get("value", "")
            for tag, ov in overrides_all.get(fname, {}).items():
                if ov.get("include"): mapped[tag] = ov.get("value", "")
                else: mapped.pop(tag, None)

            # Determine where PDFs live (prefer the per-run link dir if provided)
            pdf_base = pdf_link_dir or in_dir
            pdf_in   = (pdf_base / fname).with_suffix(".pdf")
            dbg("worker.build", f"pdf lookup: pdf_link_dir={pdf_link_dir} in_dir(json)={in_dir}")
            missing_pdf = not pdf_in.exists()

            # Default stem:
            default_stem = (pdf_in.stem if not missing_pdf else Path(fname).stem)
            # Let mapping propose a nicer name; fall back if it's bad/blank/"null"
            stem = _safe_stem_from_mapping(mapped, default_stem)
            dbg("worker.build", f"name-pick default='{default_stem}' chosen='{stem}' "
                    f"cand=_pdf_name={mapped.get('_pdf_name')!r} "
                    f"doc.FileName={_val(mapped,'Document.FileName')!r} "
                    f"FileName={mapped.get('FileName')!r} "
                    f"Name={mapped.get('Name')!r} "
                    f"docref={_val(mapped,'DocumentReferences.DocumentReference')!r}")

            pdf_name_base = stem + ".pdf" if not stem.lower().endswith(".pdf") else stem
            # 🚫 do NOT let private/meta keys leak into XML
            mapped_for_xml = {k: v for k, v in mapped.items() if not str(k).startswith("_")}
            xml_bytes = build_updata_xml(mapped_for_xml, pdf_name_base)

            try:
                validate_xml(xml_bytes)
                xml_ok, msg = True, "ok"
            except Exception as exc:
                xml_ok, msg = False, str(exc)

            # If the PDF is missing, force the result into INVALID even if XML validates
            # status + where we write
            msg = ("ok" if (xml_ok and not missing_pdf) else (f"missing pdf: {pdf_in}" if missing_pdf else msg))
            valid = (xml_ok and not missing_pdf)
            sub_out = sub_dir_valid if valid else sub_dir_invalid

            # Initialize final_pdf_name to ensure it is always defined
            final_pdf_name = ""
            xml_out: Path | None = None

            # Cleaned-up check
            if check_if_cancelled(pid):
                return {"file": fname, "success": False, "error": "Cancelled", "warnings": []}

            if valid:
                if package_files:
                    # Reserve a unique PDF path in valid/
                    pdf_dest = _next_free_threadsafe(sub_dir_valid / pdf_name_base)
                    final_pdf_name = pdf_dest.name

                    # If unique name changed, rebuild & re-validate XML
                    if final_pdf_name != pdf_name_base:
                        dbg("worker.build", f"filename collision: {pdf_name_base} -> {final_pdf_name}")
                        # 🚫 do NOT let private/meta keys leak into XML
                        xml_bytes = build_updata_xml(mapped_for_xml, final_pdf_name)
                        try:
                            validate_xml(xml_bytes)
                        except Exception as exc:
                            # downgrade to INVALID on bad rebuilt XML
                            msg = str(exc)
                            sub_out = sub_dir_invalid
                            xml_out = _next_free_threadsafe(sub_out / Path(final_pdf_name).with_suffix(".xml"))
                            try:
                                xml_out.write_bytes(xml_bytes)
                                dbg("worker.build", f"wrote INVALID xml (post-collision): {xml_out}")
                            finally:
                                release_path(pdf_dest)
                            dt = (datetime.now() - t0).total_seconds()
                            dbg("worker.build", f"DONE {fname} valid=False dt={dt:.3f}s")
                            return {
                                "file": fname,
                                "success": False,
                                "xml": xml_bytes.decode(),
                                "warnings": sorted(warnings),
                                "errors": sorted(list(errors) + ([msg] if msg else [])),
                                "validation": {"valid": False, "message": msg},
                                "out_name": xml_out.name,
                            }

                    # --- Materialize PDF, then write XML next to it ---
                    try:
                        _link_or_copy(pdf_in, pdf_dest)  # retries on PermissionError
                    except Exception as e:
                        msg = f"unable to write PDF: {e}"
                        sub_out = sub_dir_invalid
                        xml_out = _next_free_threadsafe(sub_out / Path(final_pdf_name).with_suffix(".xml"))
                        try:
                            xml_out.write_bytes(xml_bytes)
                            dbg("worker.build", f"wrote INVALID xml (pdf copy failed): {xml_out}")
                        finally:
                            release_path(pdf_dest)
                        dt = (datetime.now() - t0).total_seconds()
                        dbg("worker.build", f"DONE {fname} valid=False dt={dt:.3f}s")
                        return {
                            "file": fname,
                            "success": False,
                            "xml": xml_bytes.decode(),
                            "warnings": sorted(warnings),
                            "errors": sorted(list(errors) + [msg]),
                            "validation": {"valid": False, "message": msg},
                            "out_name": xml_out.name,
                        }

                    xml_out = pdf_dest.with_suffix(".xml")
                    xml_out.write_bytes(xml_bytes)
                    dbg("worker.build", f"wrote xml: {xml_out}")

                    if zip_pair:
                        package_pair(xml_out, pdf_dest, zip_pair=True, out_dir=sub_dir_valid)
                        safe_unlink(xml_out); safe_unlink(pdf_dest)
                        dbg("worker.build", f"zipped pair and cleaned singles in {sub_dir_valid}")
                    else:
                        dbg("worker.build", f"packaging singles (no zip): kept {xml_out.name} + {pdf_dest.name}")

                    # release reservation after files exist (or after zipping)
                    release_path(pdf_dest)

                else:
                    # package_files = False → XML-only output in valid/
                    xml_out = _next_free_threadsafe(sub_dir_valid / Path(pdf_name_base).with_suffix(".xml"))
                    xml_out.write_bytes(xml_bytes)
                    dbg("worker.build", f"wrote xml (no packaging/copy): {xml_out}")

            dt = (datetime.now() - t0).total_seconds()
            dbg("worker.build", f"DONE {fname} valid={valid} dt={dt:.3f}s")

            return {
                "file": fname,
                "success": valid,
                "xml": xml_bytes.decode(),
                "warnings": sorted(warnings),
                "errors": (sorted(errors) if valid else sorted(list(errors) + ([msg] if msg and msg != "ok" else []))),
                "validation": {"valid": valid, "message": msg},
                "out_name": (xml_out.name if xml_out else (final_pdf_name + ".xml" if final_pdf_name else Path(pdf_name_base).with_suffix(".xml").name)),
            }

    except Exception as e:
        # NEW: guarantee we never crash the server
        dbg("worker.build", f"UNCAUGHT in {fname}: {e}")
        return {
            "file": fname,
            "success": False,
            "error": str(e),
            "warnings": [],
            "errors": [str(e)],
            "validation": {"valid": False, "message": str(e)},
        }