"""
packager.py
~~~~~~~~~~~
Copy or zip XML + PDF pairs into the chosen output folder.
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path


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
    if zip_pair:
        zip_path = out_dir / f"{pdf_file.stem}.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_file, arcname=xml_file.name)
            zf.write(pdf_file, arcname=pdf_file.name)
    else:
        shutil.copy2(pdf_file, out_dir / pdf_file.name)
