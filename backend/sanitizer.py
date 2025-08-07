"""
sanitizer.py
~~~~~~~~~~~~

Utility to clean incoming CMIS JSON:

    * Replace **all** colons `:` in keys with underscores `_`
    * Remove duplicate keys created by the replacement, keeping *last-seen*
    * Return the cleaned *dict* (for in-memory use) **and**
      write a side-car `<filename>.clean.json` for debugging.

The function `sanitize_json()` is imported by main.py; unit tests live in
tests/test_sanitizer.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict
from backend.logging_config import dbg, thread_local
from backend.settings       import get_settings

settings = get_settings()



def _clean_keys(obj: Any) -> Any:
    """
    Recursively traverse *obj* (dict / list / primitive) and
    replace every ':' in keys with '_' .
    """
    if isinstance(obj, dict):
        new: Dict[str, Any] = {}
        for k, v in obj.items():
            clean_k = k.replace(":", "_")
            # later keys overwrite earlier duplicates (keep last-seen)
            new[clean_k] = _clean_keys(v)
            if clean_k in new:
                dbg("sanitizer", f"Key collision: {k}→{clean_k}, overwriting previous")
        return new
    if isinstance(obj, list):
        return [_clean_keys(i) for i in obj]
    return obj


def sanitize_json(json_path: Path) -> Dict[str, Any]:
    """
    Read the original JSON, clean it, save `<file>.clean.json` next
    to the original for transparency, and return the cleaned dict.
    """
    try:
        thread_local.log_context_filename = json_path.name
        dbg("sanitizer", "START sanitize_json", input=str(json_path))

        with json_path.open(encoding="utf-8") as f:
            data = json.load(f)

        cleaned = _clean_keys(data)

        clean_path = (json_path.parent.parent / "output" / f"{json_path.name}.clean.json")
        clean_path.parent.mkdir(parents=True, exist_ok=True)
        with clean_path.open("w", encoding="utf-8") as f:
            json.dump(cleaned, f, ensure_ascii=False, indent=2)

        dbg("sanitizer", "WROTE clean JSON", clean_file=str(clean_path.relative_to(settings.OUTPUT_DIR)))
        return cleaned
    finally:
        thread_local.log_context_filename = None

if __name__ == "__main__":          # ───── simple CLI entry point
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(
        description="Clean CMIS JSON files in bulk – replace ':' with '_' "
                    "and write <file>.clean.json into ./output."
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Folder to scan recursively for *.json files"
    )

    args = parser.parse_args()
    root: Path = args.folder.expanduser().resolve()

    if not root.is_dir():
        sys.exit(f"[sanitizer] ❌  {root} is not a directory")

    json_files = list(root.rglob("*.json"))
    if not json_files:
        sys.exit(f"[sanitizer] ⚠️  No .json files found under {root}")

    print(f"[sanitizer] 🔍  Found {len(json_files)} JSON file(s) under {root}")
    for jf in json_files:
        try:
            sanitize_json(jf)
            print(f"[sanitizer]  ✅  {jf.relative_to(root)}")
        except Exception as exc:
            print(f"[sanitizer]  ⚠️  {jf}  —  {exc}")

    print("[sanitizer] 🏁  Done.")
