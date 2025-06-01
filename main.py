"""main.py - CLI entry-point for the “CMIS JSON → Updata XML 2.6.14” converter.

Major changes
-------------
* Always writes the raw XML first (`*.draft.xml`) **before** running schema validation &
  packaging.  If validation fails the file is renamed to `*.invalid.xml`, so you can
  still open it in an editor and diff against the XSD error.
* Uses the revised `Mapper` (alias-first, stricter fuzzy) and optional `defaults.yaml`
  to fill missing mandatory tags.
* Keeps the rest of the pipeline (sanitiser  ➜  mapping  ➜  XML build  ➜  packaging)
  identical for CLI & future GUI.

The module deliberately avoids any GUI code; that comes later once the CLI path is
stable.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
from pathlib import Path
import sys
from typing import List, Tuple

import yaml
from lxml import etree

from mapper import Mapper
from xml_builder import build_updata_xml, validate_xml, package_pair

LOG = logging.getLogger(__name__)


# ─────────────────────────────────────────── CLI & logging helpers ──
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Convert CMIS-exported JSON(+PDF) to Updata 2.6.14 XML"
    )
    p.add_argument(
        "--src",
        nargs="?",
        type=Path,
        default=Path("input"),
        help="Either a folder with *.json files or a single JSON file (defaults to ./input)",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("output"),
        help="Destination folder (created if missing)",
    )
    p.add_argument(
        "--spec",
        default="resources/updata-2.6.14.csv",
        help="Flat tag specification (CSV/XLSX)",
    )
    p.add_argument(
        "--defaults",
        default="resources/defaults.yaml",
        help="YAML file with placeholder values for mandatory tags",
    )
    p.add_argument(
        "--zip",
        action="store_true",
        help="Package each XML+PDF into <name>.zip alongside loose XML",
    )
    p.add_argument(
        "--include-cmis",
        action="store_true",
        default=False,
        help="also map cmis:* keys into <CustomMetadata>")

    p.add_argument(
        "--include-lower",
        action="store_true",
        default=False,
        help="also map lower:* keys into <CustomMetadata>")

    p.add_argument(
        "--verbose",
        action="store_true",
        help="Chatty logging",
    )

    return p.parse_args()


def _setup_logging(verbose: bool) -> None:
    lvl = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _sniff_pdf(obj) -> str | None:
    """Depth-first search for the first string ending in .pdf (case-insensitive)."""
    if isinstance(obj, dict):
        for v in obj.values():
            hit = _sniff_pdf(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = _sniff_pdf(v)
            if hit:
                return hit
    elif isinstance(obj, str) and obj.lower().endswith(".pdf"):
        return obj
    return None


# ─────────────────────────────────────────── core worker ──
def _process_one(
    json_path: Path,
    pdf_path: Path | None,
    mapper: Mapper,
    out_dir: Path,
    zip_pair: bool,
) -> Tuple[bool, str]:
    """
    Returns (success, message).  Always writes a .xml/.invalid.xml file so the
    artefact is inspectable even on failure.
    """
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return False, f"JSON load error: {exc}"

    mapped, leftover, missing = mapper.map_json(data)

    pdf_guess = _sniff_pdf(data)
    if not pdf_guess and pdf_path and pdf_path.exists():     # ← new fallback
        pdf_guess = pdf_path.name

    # If any mandatory tags are still missing, log but continue
    if missing:
        logging.warning("%s – %d mandatory tags still missing", json_path.name, len(missing))

    try:
        xml_bytes = build_updata_xml(mapped, leftover, pdf_name=pdf_guess)
    except Exception as exc:
        return False, f"XML build error: {exc}"

    # Always write artefact first (draft)
    draft_xml = out_dir / f"{json_path.stem}.draft.xml"
    draft_xml.write_bytes(xml_bytes)

    # Validate
    try:
        validate_xml(xml_bytes)
        final_xml = draft_xml.with_suffix(".xml")
        draft_xml.rename(final_xml)
        if pdf_path and pdf_path.exists():
            package_pair(final_xml, pdf_path, zip_pair, out_dir)
        return True, "OK"
    except Exception as vexc:
        bad_xml = draft_xml.with_suffix(".invalid.xml")
        if bad_xml.exists():
            bad_xml.unlink()
        draft_xml.replace(bad_xml)
        return False, f"invalid XML – kept as {bad_xml.name} ({vexc})"


# ─────────────────────────────────────────── main ──
def main() -> None:
    args = _parse_args()
    _setup_logging(args.verbose)

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    mapper = Mapper(args.spec,
                args.defaults,
                include_cmis=args.include_cmis,
                include_lower=args.include_lower)

    # Gather source files
    if args.src.is_dir():
        json_files = sorted(args.src.glob("*.json"))
    elif args.src.is_file() and args.src.suffix.lower() == ".json":
        json_files = [args.src]
    else:
        logging.error("Source must be a *.json file or directory containing JSON files")
        sys.exit(1)

    ok = bad = 0
    for jpath in json_files:
        pdf_path = jpath.with_suffix(".pdf")
        success, msg = _process_one(jpath, pdf_path, mapper, out_dir, args.zip)
        if success:
            ok += 1
            logging.info("✔ %s – %s", jpath.name, msg)
        else:
            bad += 1
            logging.error("✗ %s – %s", jpath.name, msg)

    logging.info("Finished.  OK: %d  •  Failed: %d", ok, bad)


if __name__ == "__main__":
    main()