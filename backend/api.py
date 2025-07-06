from __future__ import annotations

import json
import logging
from enum import Enum
from pathlib import Path
import shutil
from typing import Any, Dict, List, Tuple

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from xml.dom import minidom
from datetime import datetime

from backend.packager import package_pair
from backend.mapper import Mapper
from backend.xml_builder import build_updata_xml, validate_xml
from backend.spec_parser import (
    updata_tag_list,
    updata_order_map,
    updata_required_tags,
    updata_cond_required_tags,
    updata_parent_req_tags,
    updata_parent_opt_tags,
)

# ───────────────────────────── logging ──────────────────────────────
LOG_FILE = Path(__file__).with_name("updata_backend.log")

logging.basicConfig(
    level=logging.DEBUG,          # set INFO or WARNING in production
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8"),
        #logging.StreamHandler()   # ← remove for a fully silent console
    ]
)

def dbg(tag: str, *parts) -> None:
    """
    Flexible debug helper.

    • dbg("batch", "using map for %s (%d keys)", fname, n)
    • dbg("batch", fname, n)               ← auto-joins with spaces
    """
    log = logging.getLogger(tag)
    if not parts:
        return
    if isinstance(parts[0], str) and "%" in parts[0]:
        log.debug(parts[0], *parts[1:])
    else:
        log.debug(" ".join(map(str, parts)))


def _pretty(xml_bytes: bytes, max_len: int = 4000) -> str:
    pretty = minidom.parseString(xml_bytes).toprettyxml()
    return pretty[: max_len] + "…" if len(pretty) > max_len else pretty


# ───────────────────────────── paths ────────────────────────────────
PROJECT_ROOT   = Path(__file__).resolve().parent.parent
RESOURCES_DIR  = PROJECT_ROOT / "resources"
# default folders – but can be overridden per-request
DEFAULT_IN  = PROJECT_ROOT / "input"
DEFAULT_OUT = PROJECT_ROOT / "output"
DEFAULT_IN .mkdir(exist_ok=True)
DEFAULT_OUT.mkdir(exist_ok=True)

SPEC_CSV       = RESOURCES_DIR / "updata-2.6.14.csv"
DEFAULTS_YAML  = RESOURCES_DIR / "defaults.yaml"

# -- helper ----------------------------------------------------------
def _resolve_inside_project(folder: str | None, *, fallback: Path) -> Path:
    """
    Resolve *folder* under PROJECT_ROOT, preventing “..” escapades.
    If *folder* is None/empty, return *fallback*.
    """
    if (
        not folder
        or folder.startswith("__server")
        or folder == "__client__"
    ):
        return fallback
    p = (PROJECT_ROOT / folder).resolve()
    if PROJECT_ROOT not in p.parents:
        raise HTTPException(400, f"Illegal folder path: {folder}")
    p.mkdir(exist_ok=True)
    return p

def make_mapper() -> Mapper:
    return Mapper(
        spec_path=SPEC_CSV,
        defaults_path=DEFAULTS_YAML,
        fuzzy_threshold=70,
    )

CURRENT_MAPPER = make_mapper()

# ─── suggestion depth enum ───────────────────────────────────────────
class SuggestLevel(str, Enum):
    fast   = "fast"
    normal = "normal"
    deep   = "deep"


# ------------------------------------------------------------------ FastAPI
app = FastAPI(title="json2updata-API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------ routes
@app.get("/api/files", response_model=List[str])
def list_files(dir: str = Query(default="input")):
    folder = (PROJECT_ROOT / dir).resolve()
    if not folder.exists():
        raise HTTPException(404, f"Folder not found: {folder}")
    return sorted(f.name for f in folder.glob("*.json"))

@app.get("/api/file/{fname}")
def get_file(fname: str, dir: str = Query(default="input")):
    file_path = (PROJECT_ROOT / dir / fname).resolve()
    if not file_path.exists():
        raise HTTPException(404, "file not found")
    return FileResponse(str(file_path), media_type="application/json")

@app.get("/api/spec")
def get_spec():
    return {
        "tagList":      updata_tag_list,
        "orderMap":     updata_order_map,
        "required":     sorted(updata_required_tags),
        "conditional":  sorted(updata_cond_required_tags),
        "parentReq":      sorted(updata_parent_req_tags),
        "parentOpt":      sorted(updata_parent_opt_tags),
    }

# ─────────────────────────── /api/map ───────────────────────────────
@app.post("/api/map")
def map_json(
    payload: Dict[str, Any],
    level: SuggestLevel = Query(SuggestLevel.normal,
                                description="Suggestion depth"),
):
    global CURRENT_MAPPER
    CURRENT_MAPPER = make_mapper()          # stateless – rebuild each call

    mapped, leftover, (errors, warnings) = CURRENT_MAPPER.map_json(payload)

    suggest = CURRENT_MAPPER.suggest(payload, level=level.value, top_n=5)

    dbg("map", "mapped %d keys, %d leftover", len(mapped), len(leftover))

    return {
        "mapped":   mapped,
        "leftover": leftover,
        "suggest":  suggest,
        "errors":   sorted(errors),
        "warnings": sorted(warnings),
    }

@app.post("/api/build")
def build_xml_endpoint(data: Dict[str, Any]):
    mapped = data.get("mapped", {})
    dbg("build", "building XML for preview (%d keys)", len(mapped))

    xml_bytes = build_updata_xml(data.get("mapped", {}))

    try:
        validate_xml(xml_bytes)
        valid, msg = "1", "ok"
    except Exception as exc:               # noqa: BLE001
        valid, msg = "0", str(exc)

    hdrs = {"X-Updata-Valid": valid, "X-Updata-Message": msg}
    return Response(xml_bytes, media_type="application/xml", headers=hdrs)


# ──────────────────────────────────────────────────────────────────────────
# ①  /api/save   – write one XML blob into ./output/<same-name>.xml
@app.post("/api/save")
def save_xml(data: Dict[str, Any]):
    if not data.get("fileName"):
        raise HTTPException(400, "fileName required")
    out = DEFAULT_OUT / data["fileName"].replace(".json", ".xml")
    out.write_text(data["xml"], "utf-8")
    dbg("save", "wrote %s", out.name)
    return {"ok": True, "path": str(out)}


@app.post("/api/import_init")
def import_init(dest: str = Body(..., embed=True)):
    """
    Clear / create PROJECT_ROOT/<dest> so the browser can upload files there.
    """
    dest_path = (PROJECT_ROOT / dest).resolve()
    if dest_path.exists():
        try:
            shutil.rmtree(dest_path)
        except PermissionError:        # folder open in Explorer on Windows
            pass                       # just leave the old files in place
    dest_path.mkdir(parents=True, exist_ok=True)
    return {"ok": True}


@app.get("/api/file_exists")
def file_exists(dest: str = Query(...), name: str = Query(...)):
    path = (PROJECT_ROOT / dest / name).resolve()
    return {"exists": path.exists()}

@app.post("/api/upload")
def upload_file(file: UploadFile = File(...), dest: str = Form(...)):
    dest_path = (PROJECT_ROOT / dest).resolve()
    dest_path.mkdir(parents=True, exist_ok=True)
    if not file.filename:
        raise HTTPException(400, "Uploaded file must have a filename")
    out = dest_path / file.filename
    with out.open("wb") as fh:
        fh.write(file.file.read())
    return {"ok": True}


def _apply_overrides(base: dict[str, Any],
                     ov_map: dict[str, Any]) -> dict[str, Any]:
    """
    Return a *new* mapping after applying one override dict.

    • ov['include'] is True  →  set/overwrite the value
    • ov['include'] is False →  delete the tag if it exists
    """
    merged = base.copy()
    for tag, ov in ov_map.items():
        if ov.get("include"):
            merged[tag] = ov.get("value", "")
        else:
            merged.pop(tag, None)
    return merged

@app.post("/api/batch_build")
async def batch_build(request: Request):
    body           = await request.json()
    file_names     = body["fileNames"]
    in_dir        = _resolve_inside_project(body.get("inDir"),  fallback=DEFAULT_IN)
    out_dir       = _resolve_inside_project(body.get("outDir"), fallback=DEFAULT_OUT)

    overrides_all  = body.get("overrides", {})
    template_ov    = overrides_all.get("__template__", {})
    browser_map    = body.get("browserMapped", {})

    # ── NEW: run-folder + flags ─────────────────────────────────────
    package_files  = body.get("package", True)     # copy pdf/xml?
    zip_pair       = body.get("zipPair", False)    # additionally zip?

    ts_folder   = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_out_dir = out_dir / ts_folder
    (run_out_dir / "valid").mkdir(parents=True, exist_ok=True)
    (run_out_dir / "invalid").mkdir(parents=True, exist_ok=True)

    dbg("batchBuild", "incoming %d files)", len(file_names))

    results: List[Dict[str, Any]] = []

    for fname in file_names:
        try:
            # ── 1) get a mapping ───────────────────────────────────
            if fname in browser_map:                       # fast path
                mapped   = browser_map[fname]
                errors, warnings = CURRENT_MAPPER._classify(mapped)
                dbg("batchBuild", "[%s] browser map (%d keys)", fname, len(mapped))
            else:                                          # need the raw JSON
                try:
                    with open(in_dir / fname, "r", encoding="utf-8") as fh:
                        src_json = json.load(fh)
                except Exception as exc:
                    results.append({"file": fname, "success": False,
                                    "error": f"cannot read {fname}: {exc}"})
                    continue

                mapped, _, (errors, warnings) = CURRENT_MAPPER.map_json(src_json)
                dbg("batchBuild", "[%s] auto map (%d keys)", fname, len(mapped))

            # 3) apply global + file overrides
            mapped = _apply_overrides(mapped, template_ov)
            mapped = _apply_overrides(mapped, overrides_all.get(fname, {}))
            dbg("batchBuild", "[%s] FINAL %d keys", fname, len(mapped))

            errors, warnings = CURRENT_MAPPER._classify(mapped)

            # 3b) locate the PDF – _really_ robust this time
            stem = Path(fname).stem
            dbg("pdfSearch", "[%s] looking in %s (exists=%s)", fname, in_dir, in_dir.exists())
            dbg("pdfSearch","[%s] dir=%s  --- contains %s",fname,in_dir,[p.name for p in in_dir.iterdir()],)



            pdf_in: Path | None = None

            # ① quick exact check (fast path)
            exact = in_dir / f"{stem}.pdf"
            if exact.exists():
                pdf_in = exact
            else:
                # ② fall back: recurse **any depth**, case-insensitive
                for p in in_dir.rglob("*"):
                    if p.is_file() and p.suffix.lower() == ".pdf" and p.stem.lower() == stem.lower():
                        pdf_in = p
                        break

            if pdf_in is None:
                dbg("pdfSearch", "[%s] NO match – dir has %d PDFs",
                    fname, len(list(in_dir.glob('*.pdf'))))
                raise FileNotFoundError(f"missing PDF: {stem}.pdf")


            dbg("pdfSearch", "scanned %d files under %s", len(list(in_dir.rglob('*'))), in_dir)
            dbg("pdfSearch", "[%s] resolved to %s", fname, pdf_in.name)

            # 4) final PDF name = mapping override or fallback
            pdf_name = mapped.get(
                "DocumentReferences.DocumentReference",
                pdf_in.name,                 # fallback → invoice-123.pdf
            )
            # ensure extension
            if not pdf_name.lower().endswith(".pdf"):
                pdf_name += ".pdf"

            # 4) generate XML  →  bytes
            xml_bytes = build_updata_xml(mapped, pdf_name=pdf_name)

            # 5) validate once per file
            try:
                validate_xml(xml_bytes)
                valid, msg = True, "ok"
            except Exception as exc:
                valid, msg = False, str(exc)
                dbg("batchBuild", "XML validation failed for %s: %s", fname, exc)

            # always send *string* to the browser so TS side is simple
            xml_str = xml_bytes.decode("utf-8")

            # ── 6) decide target sub-folder (valid / invalid) ──────
            sub_dir = run_out_dir / ("valid" if valid else "invalid")

            stem      = Path(pdf_name).stem
            pdf_dest  = sub_dir / pdf_name
            xml_out   = sub_dir / f"{stem}.xml"

            # write XML to disk
            xml_out.write_text(xml_str, encoding="utf-8")

            if package_files:
                # ensure PDF on disk under the right name
                if not pdf_dest.exists():
                    shutil.copy2(pdf_in, pdf_dest)

                if zip_pair:
                    package_pair(
                        xml_file=xml_out,
                        pdf_file=pdf_dest,
                        zip_pair=True,
                        out_dir=sub_dir,
                    )
                    # tidy up loose copies
                    xml_out.unlink(missing_ok=True)
                    pdf_dest.unlink(missing_ok=True)
                dbg("batchPkg", "[%s] packaged → %s",
                    fname, sub_dir.relative_to(run_out_dir))

            results.append({
                "file": fname,
                "success": valid,
                "xml": xml_str,
                "prettyXml": _pretty(xml_bytes),
                "validation": {"valid": valid, "message": msg},
                "warnings":  sorted(warnings),
                "errors":    sorted(errors),
                "meta": {
                    "mapped":   len(mapped),
                    "required": len(updata_required_tags),
                    "size":     f"{len(xml_bytes):,} bytes",
                },
            })
        except Exception as exc:
            results.append(
                {"file": fname, "success": False, "error": str(exc)}
            )

    dbg("batch", "DONE – %d OK / %d failed",
        sum(r["success"] for r in results),
        sum(not r["success"] for r in results))

    return {"results": results}
