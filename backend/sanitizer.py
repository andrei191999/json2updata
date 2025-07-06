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
        return new
    if isinstance(obj, list):
        return [_clean_keys(i) for i in obj]
    return obj


def sanitize_json(json_path: Path) -> Dict[str, Any]:
    """
    Read the original JSON, clean it, save `<file>.clean.json` next
    to the original for transparency, and return the cleaned dict.
    """
    with json_path.open(encoding="utf-8") as f:
        data = json.load(f)

    cleaned = _clean_keys(data)

    clean_path = (json_path.parent.parent / "output" / f"{json_path.name}.clean.json")
    clean_path.parent.mkdir(parents=True, exist_ok=True)
    with clean_path.open("w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    return cleaned
