"""
packager.py
~~~~~~~~~~~
Copy or zip XML + PDF pairs into the chosen output folder.
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path
from itertools import count
from backend.logging_config import dbg, thread_local
from backend.settings import get_settings
from backend.api_state import FILE_WRITER_LOCK, is_reserved, release_path, reserve_path


settings = get_settings()

def _pdf_magic_ok(p: Path) -> bool:
    try:
        with open(p, "rb") as f:
            return f.read(5).startswith(b"%PDF-")
    except Exception:
        return False


def _next_free_threadsafe(path: Path) -> Path:
    """
    Thread-safely returns `path` if it doesn't exist,
    else tries '_1', '_2', etc., until a free name is found.
    The lock ensures that two threads can't grab the same name at the same time.
    """
    with FILE_WRITER_LOCK:
        stem, suff = path.stem, path.suffix
        cand = path
        i = 0
        while cand.exists() or is_reserved(cand):
            i += 1
            cand = path.with_name(f"{stem}_{i}{suff}")
        reserve_path(cand)        # <— reserve so no other thread can take it
        return cand
    # This line should theoretically never be reached
    return path


def package_pair(
    xml_file: Path,
    pdf_file: Path,
    *,
    zip_pair: bool,
    out_dir: Path,
) -> None:
    """
    • If zip_pair=True, create <stem>.zip containing both files.
    • Else, copy PDF alongside XML (XML already written by main).
    """
    thread_local.log_context_filename = xml_file.name if xml_file else None  # tag by the xml you’re packaging
    dbg("packager", f"START package_pair – xml={xml_file.name}, pdf={pdf_file.name}, zip={zip_pair}", out_dir=str(out_dir))

    if not pdf_file.exists() or not _pdf_magic_ok(pdf_file):
        raise FileNotFoundError(f"PDF not valid or missing: {pdf_file} (gzipped or corrupted?)")

    # If the caller passed a stale XML path (e.g., name was incremented), align to sibling.
    xml_file = Path(xml_file);
    pdf_file = Path(pdf_file)
    if not xml_file.exists():
        candidate = pdf_file.with_suffix(".xml")
        if candidate.exists():
            dbg("packager", f"xml not found: {xml_file.name} — using sibling: {candidate.name}")
            xml_file = candidate
        else:
            raise FileNotFoundError(f"XML not found: {xml_file} (also tried {candidate})")

    if zip_pair:
        zip_path_base = out_dir / xml_file.with_suffix(".zip").name
        zip_path = _next_free_threadsafe(zip_path_base)

        dbg("packager", f"Creating ZIP {zip_path.name}")

        with zipfile.ZipFile(zip_path, "w",
                             compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, arcname=xml_file.name)
            zf.write(pdf_file, arcname=pdf_file.name)

        # ZIP path is now materialized; it can be re-used in future runs if deleted
        release_path(zip_path)
        dbg("packager", "DONE package_pair", result=str(zip_path if zip_pair else pdf_file.name))
    else:
        dbg("packager", "DONE package_pair, no zip required")

    thread_local.log_context_filename = None
    dbg("packager", "END package_pair")