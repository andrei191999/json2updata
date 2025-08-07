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
from backend.settings       import get_settings

settings = get_settings()


def _next_free(path: Path) -> Path:
    """
    Return *path* if it doesn’t exist.
    Else try “_1”, “_2”, … until a free name is found.
    """
    if not path.exists():
        return path
    stem, suff = path.stem, path.suffix
    for i in count(1):
        candidate = path.with_name(f"{stem}_{i}{suff}")
        if not candidate.exists():
            return candidate
    # Fallback: should never reach here, but return path to satisfy type checker
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
    thread_local.log_context_filename = xml_file.name  # tag by the xml you’re packaging
    dbg("packager", f"START package_pair – xml={xml_file.name}, pdf={pdf_file.name}, zip={zip_pair}", out_dir=str(out_dir))

    if zip_pair:
        # ensure   <stem>.zip, <stem>_1.zip, <stem>_2.zip, …
        idx = 0
        while True:
            suffix = "" if idx == 0 else f"_{idx}"
            zip_path = out_dir / f"{pdf_file.stem}{suffix}.zip"
            if not zip_path.exists():
                break
            idx += 1

        dbg("packager", f"Creating ZIP {zip_path.name}")

        with zipfile.ZipFile(zip_path, "w",
                             compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, arcname=xml_file.name)
            zf.write(pdf_file, arcname=pdf_file.name)

        dbg("packager", "DONE package_pair", result=str(zip_path if zip_pair else pdf_file.name))
    else:
        shutil.copy2(pdf_file, out_dir / pdf_file.name)

    thread_local.log_context_filename = None
    dbg("packager", "END package_pair")