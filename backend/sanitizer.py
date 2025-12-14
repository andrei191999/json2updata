"""
sanitizer.py
~~~~~~~~~~~~

Utility to clean incoming CMIS JSON:

    * Replace **all** colons `:` in keys with underscores `_`
    * Remove duplicate keys created by the replacement, keeping *last-seen*
    * Return the cleaned *dict* (for in-memory use) **and**
      write a side-car `<filename>.clean.json` for debugging.

Extended CLI:
  • Recursively scan a root folder for:
      - loose `*.json` files (write sidecars, do NOT overwrite originals)
      - `*.zip` files containing JSON and PDF (rebuild the ZIP with sanitized JSON)
  • Sidecars for JSON inside zips are written as:
      `output/<zipname>__<member_path>.clean.json`

Notes:
  • Uses backend settings for OUTPUT_DIR. :contentReference[oaicite:1]{index=1}
  • Logs via backend.logging_config `dbg`, tagging `thread_local.log_context_filename`
"""

import io
import shutil
import zipfile
from pathlib import Path
import json
from tempfile import NamedTemporaryFile
from typing import Any, Dict, Iterable, Tuple
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

def _write_sidecar(data: Dict[str, Any], dest: Path) -> None:
    """Write pretty-printed JSON sidecar."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


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

        # Keep previous behaviour: sidecar in ./output
        clean_path = (settings.OUTPUT_DIR / f"{json_path.name}")
        _write_sidecar(cleaned, clean_path)

        dbg("sanitizer", "WROTE clean JSON", clean_file=str(clean_path.relative_to(settings.OUTPUT_DIR)))
        return cleaned
    finally:
        thread_local.log_context_filename = None


def _sanitize_json_bytes(name: str, raw_bytes: bytes) -> Tuple[Dict[str, Any], bytes]:
    """
    Sanitize JSON coming from a ZIP entry and return (clean_dict, encoded_bytes).
    """
    try:
        thread_local.log_context_filename = name
        dbg("sanitizer.zip", "sanitize entry", entry=name)
        data = json.loads(raw_bytes.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"{name}: not valid UTF-8 JSON ({e})")
    cleaned = _clean_keys(data)
    out = json.dumps(cleaned, ensure_ascii=False, indent=2).encode("utf-8")
    return cleaned, out


def _safe_replace(original: Path, temp_path: Path) -> None:
    """
    Replace `original` with `temp_path` atomically where possible.
    Windows: unlink first if needed, then replace.
    """
    try:
        if original.exists():
            # Best effort: this may fail if some other process holds a handle.
            try:
                original.unlink()
            except PermissionError as e:
                raise
        temp_path.replace(original)
    except PermissionError:
        # On Windows, something else is holding a lock (Explorer preview, OneDrive, AV).
        # Leave the updated file next to original so the user can manually swap it.
        fallback = original.with_suffix(original.suffix + ".updated.zip")
        # Ensure we don't overwrite an existing fallback
        if fallback.exists():
            fallback.unlink(missing_ok=True)
        temp_path.replace(fallback)
        print(f"[sanitizer]  ⚠️  Could not replace locked file:\n"
              f"           {original}\n"
              f"           Wrote updated archive to:\n"
              f"           {fallback}\n"
              f"           Close apps/OneDrive and replace manually.")
    finally:
        # If we successfully replaced or moved to fallback, temp no longer exists.
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _progress(iterable: Iterable[Path], total: int, label: str):
    """
    Tiny progress helper: try tqdm, else print terse progress lines.
    """
    try:
        from tqdm import tqdm  # type: ignore
        yield from tqdm(iterable, total=total, desc=label)
        return
    except Exception:
        pass
    # fallback
    done = 0
    for item in iterable:
        done += 1
        pct = int((done / max(total, 1)) * 100)
        print(f"[sanitizer] {label}: {done}/{total} ({pct:3d}%)  {item.name}")
        yield item


def _safe_sidecar_name(zip_path: Path, member: str) -> Path:
    """
    Build a readable sidecar filename for JSON inside a ZIP.
    """
    norm_member = member.strip("/").replace("/", "__")
    return settings.OUTPUT_DIR / f"{zip_path.stem}__{norm_member}.clean.json"


def process_zip(zip_path: Path, *, modify_zip: bool = True, write_sidecars: bool = True) -> int:
    """
    Rebuild `zip_path` (if modify_zip=True), replacing JSON members with sanitized JSON.
    Writes sidecar files if requested.
    Returns: number of JSON entries sanitized.
    """
    dbg("sanitizer.zip", "OPEN", zip=str(zip_path))
    count = 0

    # We must NOT replace the file while it's open on Windows.
    # So we build the temp first, close the reader, THEN replace.
    tmp: Path | None = None
    if modify_zip:
        with NamedTemporaryFile(delete=False, suffix=".zip", dir=str(zip_path.parent)) as tf:
            tmp = Path(tf.name)

    with zipfile.ZipFile(zip_path, "r") as zin:
        infos = zin.infolist()
        if modify_zip:
            # Build new archive from the old one
            assert tmp is not None
            with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
                for info in infos:
                    name = info.filename
                    if name.lower().endswith(".json"):
                        raw = zin.read(info)
                        cleaned_dict, cleaned_bytes = _sanitize_json_bytes(name, raw)
                        if write_sidecars:
                            _write_sidecar(cleaned_dict, _safe_sidecar_name(zip_path, name))
                        new_info = zipfile.ZipInfo(filename=name, date_time=info.date_time)
                        new_info.compress_type = zipfile.ZIP_DEFLATED
                        new_info.external_attr = info.external_attr
                        zout.writestr(new_info, cleaned_bytes)
                        count += 1
                    else:
                        zout.writestr(info, zin.read(info))
        else:
            # Just produce sidecars
            if write_sidecars:
                for info in infos:
                    if info.filename.lower().endswith(".json"):
                        raw = zin.read(info)
                        cleaned_dict, _ = _sanitize_json_bytes(info.filename, raw)
                        _write_sidecar(cleaned_dict, _safe_sidecar_name(zip_path, info.filename))
                        count += 1

    # Now that the reader is closed, we can replace the original (Windows-safe).
    if modify_zip and tmp is not None:
        _safe_replace(zip_path, tmp)
        dbg("sanitizer.zip", "UPDATED", zip=str(zip_path), json_entries=count)
    else:
        dbg("sanitizer.zip", "SKIPPED modify", zip=str(zip_path), json_entries=count)

    return count

if __name__ == "__main__":          # ───── simple CLI entry point
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(
    description=(
        "Clean CMIS JSON files and JSONs inside ZIPs.\n"
        "• Replace ':' with '_' in keys.\n"
        "• Keep last-seen on collisions.\n"
        "• Write <name>.clean.json sidecars into ./output.\n"
        "• For ZIPs, rebuild archive with sanitized JSON unless disabled."
    )
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Folder to scan recursively for *.json files"
    )
    parser.add_argument(
        "--no-modify-zip",
        action="store_true",
        help="Do not rewrite ZIPs; only write sidecars"
    )
    parser.add_argument(
        "--no-sidecars",
        action="store_true",
        help="Do not write any .clean.json sidecars"
    )

    args = parser.parse_args()
    root: Path = args.folder.expanduser().resolve()

    if not root.is_dir():
        sys.exit(f"[sanitizer] ❌  {root} is not a directory")

    loose_jsons = [p for p in root.rglob("*.json") if p.suffix.lower() == ".json"]
    zip_files   = list(root.rglob("*.zip"))

    total_items = len(loose_jsons) + len(zip_files)
    if total_items == 0:
        sys.exit(f"[sanitizer] ⚠️  No .json or .zip files found under {root}")

    print(f"[sanitizer] 🔍  Found {len(loose_jsons)} JSON and {len(zip_files)} ZIP file(s) under {root}")

    # 1) loose JSONs
    for jf in _progress(loose_jsons, len(loose_jsons), "JSON"):
        try:
            cleaned = sanitize_json(jf)
            if args.no_sidecars:
                # If sidecars disabled globally, remove the one we just wrote for parity with flag.
                sidecar = settings.OUTPUT_DIR / f"{jf.name}.clean.json"
                if sidecar.exists():
                    sidecar.unlink(missing_ok=True)
            print(f"[sanitizer]  ✅  {jf.relative_to(root)}")
        except Exception as exc:
            print(f"[sanitizer]  ⚠️  {jf}  —  {exc}")

    # 2) zips with JSONs
    for zf in _progress(zip_files, len(zip_files), "ZIP"):
        try:
            n = process_zip(zf, modify_zip=not args.no_modify_zip, write_sidecars=not args.no_sidecars)
            msg = "updated" if not args.no_modify_zip else "checked"
            print(f"[sanitizer]  ✅  {zf.relative_to(root)} — {msg}, sanitized {n} JSON entr{'y' if n==1 else 'ies'}")
        except Exception as exc:
            print(f"[sanitizer]  ⚠️  {zf}  —  {exc}")

    print("[sanitizer] 🏁  Done.")
