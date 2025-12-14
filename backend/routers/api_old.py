"""
FastAPI service for json→Updata conversions.
────────────────────────────────────────────────────────────────────
• Hash/Cache/Link PDF logic
• /map, /build preview
• /batch_build  ⇢  now chunked + multi-threaded
• WebSocket progress streaming
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import gzip
import json
import os
import shutil
from datetime import datetime
from functools import partial
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Union, Set
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI, HTTPException, Query, Request, UploadFile, File, Form, Body,
    Header, WebSocket, WebSocketDisconnect, Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# --- Modular Logging Import ---
from backend.logging_config import setup_logging, set_event_loop, dbg, thread_local, LAST_LOGS
from backend.settings import get_settings
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

# --- Initial Setup ---
setup_logging() # Configure all logging handlers on import
settings = get_settings()

# --- WebSocket state is owned exclusively by api.py ---
DEBUG_SUBSCRIBERS: Set[asyncio.Queue] = set()
DEBUG_LOCK: asyncio.Lock | None = None

# ─────────────────────────── stateful progress ──────────────────────────
PROGRESS:       dict[str, int] = {}   # { pid: done }
PROGRESS_TOTAL: dict[str, int] = {}   # { pid: total }

# ─── suggestion depth enum ───────────────────────────────────────────
class SuggestLevel(str, Enum):
    fast   = "fast"
    normal = "normal"
    deep   = "deep"

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Capture the event loop, create the lock, and pass state to the logging module."""
    global DEBUG_LOCK
    loop = asyncio.get_running_loop()
    set_event_loop(loop)
    DEBUG_LOCK = asyncio.Lock()

    # Make the subscribers list available to the logger via the event loop
    setattr(loop, '_debug_subscribers', DEBUG_SUBSCRIBERS)

    dbg("boot", f"Application startup complete. Event loop captured. PID: {os.getpid()}")
    yield
    dbg("boot", "Application shutdown.")

# --- FastAPI App Instance ---
app = FastAPI(title="json2updata-API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def make_mapper() -> Mapper:
    return Mapper(spec_path=settings.SPEC_CSV, defaults_path=settings.DEFAULTS_YAML, fuzzy_threshold=settings.FUZZY_THRESHOLD)

CURRENT_MAPPER = make_mapper()
# --- WebSocket Endpoints ---
@app.websocket("/api/debug/stream")
async def stream_debug_logs(websocket: WebSocket):
    await websocket.accept()
    log_queue = asyncio.Queue(maxsize=100)

    for past in LAST_LOGS:
        await websocket.send_json(past)

    # This check satisfies the type checker and adds runtime safety.
    if DEBUG_LOCK is None:
        dbg("websocket", "ERROR: DEBUG_LOCK was not initialized by the lifespan manager.")
        await websocket.close(code=1011)
        return

    async with DEBUG_LOCK:
        DEBUG_SUBSCRIBERS.add(log_queue)
    dbg("websocket", f"Debug client connected. Total subscribers: {len(DEBUG_SUBSCRIBERS)}")

    try:
        while True:
            log_data = await log_queue.get()
            await websocket.send_json(log_data)
            log_queue.task_done()
    except WebSocketDisconnect:
        dbg("websocket", "Debug client disconnected.")
    finally:
        if DEBUG_LOCK:
            async with DEBUG_LOCK:
                DEBUG_SUBSCRIBERS.remove(log_queue)
            dbg("websocket", f"Cleaned up subscriber. Total subscribers: {len(DEBUG_SUBSCRIBERS)}")


# ───────────────────────── Web-Socket progress -‐ /api/stream/{pid} ─────
@app.websocket("/api/stream/{pid}")
async def stream_progress(ws: WebSocket, pid: str):
    dbg("progress", f"Client connected for progress updates on PID: {pid}")
    await ws.accept()
    try:
        last = -1
        while True:
            await asyncio.sleep(0.25)                        # 4 Hz
            done, total = PROGRESS.get(pid, 0), PROGRESS_TOTAL.get(pid, 1)
            if done != last:
                await ws.send_json({"done": done, "total": total})
                last = done
            if done >= total:
                await ws.close()
                break
    except WebSocketDisconnect:
        pass


@app.get("/api/files", response_model=List[str])
def list_files(dir: str = Query(default=settings.INPUT_DIR.name)):
    dbg("api.files", f"Request to list files in directory: '{dir}'")
    folder = (settings.PROJECT_ROOT / dir).resolve()
    if not folder.exists():
        dbg("api.files", f"ERROR: Directory not found: {folder}")
        raise HTTPException(404, f"Folder not found: {folder}")
    files = sorted(f.name for f in folder.glob("*.json"))
    dbg("api.files", f"Found {len(files)} JSON files in '{dir}'.")
    return files

@app.get("/api/file/{fname}")
def get_file(fname: str, dir: str = Query(default=settings.INPUT_DIR.name)):
    file_path = (settings.PROJECT_ROOT / dir / fname).resolve()
    if not file_path.exists():
        raise HTTPException(404, "file not found")
    return FileResponse(str(file_path), media_type="application/json")

@app.get("/api/spec")
def get_spec():
    dbg("api.spec", "Request for API specification received.")
    spec_data = {
        "tagList":      updata_tag_list,
        "orderMap":     updata_order_map,
        "required":     sorted(updata_required_tags),
        "conditional":  sorted(updata_cond_required_tags),
        "parentReq":      sorted(updata_parent_req_tags),
        "parentOpt":      sorted(updata_parent_opt_tags),
    }
    dbg("api.spec", f"Returning spec with {len(updata_tag_list)} total tags.")
    return spec_data

# new route - check which hashes are missing
@app.post("/api/pdf/need")
async def pdf_need(hashes: list[str] = Body(...)):
    missing = [h for h in hashes if not (settings.PDF_CACHE_DIR / f"{h}.pdf").exists()]
    return {"missing": missing}

@app.post("/api/pdf")
async def pdf_upload(
    file: UploadFile = File(...),
    hash: str = Form(...),
    dest: str = Form(...),
    content_encoding: str | None = Header(None, alias="Content-Encoding"),
):
    """Store *one* canonical copy of the PDF, decompressing if the body was gzipped."""
    target = settings.PDF_CACHE_DIR / f"{hash}.pdf"
    if not target.exists():
        # -- if the client set Content-Encoding we need to *de*compress --
        sink = (
            gzip.GzipFile(fileobj=file.file, mode="rb")
            if content_encoding == "gzip"
            else file.file
        )
        with target.open("wb") as out:
            shutil.copyfileobj(sink, out)

    # ------------------------------------------------------------------
    # always (idempotently) create / refresh the hard-link that the
    # batch builder will look for later
    # ------------------------------------------------------------------
    dest_dir = settings.PDF_WORK_DIR / dest        # “dest” is just the run-stamp
    dest_dir.mkdir(parents=True, exist_ok=True)

    if not file.filename:
        raise HTTPException(400, "Uploaded file must have a filename")
    link_path = dest_dir / file.filename
    try:
        if not link_path.exists():
            os.link(target, link_path)
    except (AttributeError, OSError):
        # Windows on FAT / network shares → fall back to cheap copy
        if not link_path.exists():
            shutil.copy2(target, link_path)

    return {"stored": True, "link": str(link_path.relative_to(settings.PROJECT_ROOT))}


@app.post("/api/pdf/link")
async def pdf_link(
    hash: str = Form(...),
    fname: str = Form(...),          # original file name, keeps extension/case
    dest: str = Form(...),           # run-stamp sub-folder
):
    target = settings.PDF_CACHE_DIR / f"{hash}.pdf"
    if not target.exists():
        raise HTTPException(404, "cached copy missing")

    dest_dir = settings.PDF_WORK_DIR / dest
    dest_dir.mkdir(parents=True, exist_ok=True)
    link_path = dest_dir / fname
    try:
        if not link_path.exists():
            os.link(target, link_path)
    except (AttributeError, OSError):
        if not link_path.exists():
            shutil.copy2(target, link_path)   # Windows / cross-device

    return {"linked": True, "path": str(link_path.relative_to(settings.PROJECT_ROOT))}

# ─────────────────────────── /api/map ───────────────────────────────
# ─────────────────────────── /api/map ───────────────────────────────
@app.post("/api/map")
def map_json(
    payload: Union[Dict[str, Any], List[Dict[str, Any]]],
    level: SuggestLevel = Query(SuggestLevel.normal, description="Suggestion depth"),
):
    """
    Maps a single JSON object or a list of JSON objects to the Updata format.
    This uses a stateless mapper instance for each request.
    """
    # This function now correctly uses a helper to ensure the response
    # structure is identical for both single and batch requests.
    mapper = make_mapper()

    def _map_one(js: Dict[str, Any]):
        """Helper to map a single JSON object and format the response."""
        mapped, leftover, (errs, warns) = mapper.map_json(js)
        suggest = mapper.suggest(js, level=level.value, top_n=5)
        return {
            "mapped":   mapped,
            "leftover": leftover,
            "suggest":  suggest,
            "errors":   sorted(errs),
            "warnings": sorted(warns),
        }

    is_batch = isinstance(payload, list)
    count = len(payload) if is_batch else 1
    dbg("api.map", f"Received mapping request for {count} document(s) with suggestion level '{level.value}'.")

    if is_batch:
        # Process each item in the list using the helper
        results = [_map_one(js) for js in payload]
        dbg("api.map", f"Completed batch mapping for {count} documents.")
        return results
    else:
        # Process the single object
        result = _map_one(payload)
        dbg("api.map", f"Completed mapping. Mapped={len(result['mapped'])}, Leftover={len(result['leftover'])}")
        return result

# @app.post("/api/map")
# def map_json(
#     payload: Union[Dict[str, Any], List[Dict[str, Any]]],
#     level: SuggestLevel = Query(SuggestLevel.normal, description="Suggestion depth"),
# ):
#     global CURRENT_MAPPER
#     CURRENT_MAPPER = make_mapper()  # stateless – rebuild each call

#     # ――― helper to map ONE json ―――
#     def _map_one(js: Dict[str, Any]):
#         mapped, leftover, (errs, warns) = CURRENT_MAPPER.map_json(js)
#         suggest = CURRENT_MAPPER.suggest(js, level=level.value, top_n=5)
#         return {
#             "mapped":   mapped,
#             "leftover": leftover,
#             "suggest":  suggest,
#             "errors":   sorted(errs),
#             "warnings": sorted(warns),
#         }

#     # list → list   dict → dict   (keep shape)
#     if isinstance(payload, list):
#         dbg("map", "batch size %d", len(payload))
#         return [_map_one(js) for js in payload]

#     mapped = _map_one(payload)
#     dbg("map", "mapped %d keys, %d leftover", len(mapped["mapped"]), len(mapped["leftover"]))
#     return mapped





@app.post("/api/build")
def build_xml_endpoint(data: Dict[str, Any]):
    mapped_data = data.get("mapped", {})
    dbg("api.build", f"Received XML build request with {len(mapped_data)} mapped tags.")
    xml_bytes = build_updata_xml(mapped_data)
    try:
        validate_xml(xml_bytes)
        valid, msg = "1", "ok"
        dbg("api.build", "XML validation successful.")
    except Exception as exc:
        valid, msg = "0", str(exc)
        dbg("api.build", f"ERROR: XML validation failed: {msg}")

    hdrs = {"X-Updata-Valid": valid, "X-Updata-Message": msg}
    return Response(xml_bytes, media_type="application/xml", headers=hdrs)


# ─────────────────── NEW: worker function for one file ──────────────────
def _build_one(
    fname: str,
    *,
    in_dir: Path,
    sub_dir_valid: Path,
    sub_dir_invalid: Path,
    template_ov: dict[str, Any],
    overrides_all: dict[str, Any],
    browser_map: dict[str, Any],
    package_files: bool,
    zip_pair: bool,
) -> dict[str, Any]:
    """Pure blocking code for exactly one JSON/PDF pair."""
    # Set the filename in the thread's context
    thread_local.log_context_filename = fname
    try:
        mapper = make_mapper()           # local instance (thread-safe)
        t0 = datetime.now()
        dbg("worker.build", f"START processing '{fname}'")

        if fname in browser_map:
            mapped = browser_map[fname]
            errors, warnings = mapper._classify(mapped)
            dbg("batchBuild", f"Using pre-mapped data from browser for '{fname}' ({len(mapped)} keys)")
        else:
            dbg("batchBuild", f"Reading and mapping '{fname}' from disk.")
            with open(in_dir / fname, encoding="utf-8") as fh:
                src_json = json.load(fh)
            mapped, _, (errors, warnings) = mapper.map_json(src_json)

        mapped = {**mapped}  # copy
        # apply overrides
        for tag, ov in template_ov.items():
            if ov.get("include"):
                mapped[tag] = ov.get("value", "")
        for tag, ov in overrides_all.get(fname, {}).items():
            if ov.get("include"):
                mapped[tag] = ov.get("value", "")
            else:
                mapped.pop(tag, None)

        stem       = Path(fname).stem
        pdf_in     = in_dir / f"{stem}.pdf"    # exact, we already linked/cached
        pdf_name   = mapped.get("DocumentReferences.DocumentReference", pdf_in.name)
        if not pdf_name.lower().endswith(".pdf"):
            pdf_name += ".pdf"

        xml_bytes  = build_updata_xml(mapped, pdf_name)
        try:
            validate_xml(xml_bytes);
            valid, msg = True, "ok"
        except Exception as exc:               # noqa: BLE001
            valid, msg = False, str(exc)

        sub_out    = sub_dir_valid if valid else sub_dir_invalid
        xml_out    = sub_out / f"{Path(pdf_name).stem}.xml"
        pdf_dest   = sub_out / pdf_name

        xml_out.write_bytes(xml_bytes)
        # PDF copy → ZIP → (optional) clean-up.
        if package_files:
            if not pdf_dest.exists():
                shutil.copy2(pdf_in, pdf_dest)
            if zip_pair:
                package_pair(xml_out, pdf_dest, zip_pair=True, out_dir=sub_out)
                _safe_unlink(xml_out)
                _safe_unlink(pdf_dest)


        dbg("worker.build", f"DONE processing '{fname}'. Valid={valid}, Tags={len(mapped)}, Time={(datetime.now() - t0).total_seconds():.3f}s")

        return {
            "file": fname,
            "success": valid,
            "xml": xml_bytes.decode(),
            "warnings": sorted(warnings),
            "errors": sorted(errors),
            "validation": {"valid": valid, "message": msg},
        }
    finally:
        # IMPORTANT: Clear the context when the worker is done
        thread_local.log_context_filename = None

# ──────────────────────────────────────────────────────────────────────────
# ①  /api/save   – write one XML blob into ./output/<same-name>.xml
@app.post("/api/save")
def save_xml(data: Dict[str, Any]):
    if not data.get("fileName"):
        raise HTTPException(400, "fileName required")
    out = settings.OUTPUT_DIR / data["fileName"].replace(".json", ".xml")
    out.write_text(data["xml"], "utf-8")
    dbg("save", "wrote %s", out.name)
    return {"ok": True, "path": str(out)}


@app.post("/api/import_init")
def import_init(dest: str = Body(..., embed=True)):
    """
    Clear / create PROJECT_ROOT/<dest> so the browser can upload files there.
    """
    dest_path = (settings.PROJECT_ROOT / dest).resolve()
    if dest_path.exists():
        try:
            shutil.rmtree(dest_path)
        except PermissionError:        # folder open in Explorer on Windows
            pass                       # just leave the old files in place
    dest_path.mkdir(parents=True, exist_ok=True)
    return {"ok": True}


@app.get("/api/file_exists")
def file_exists(dest: str = Query(...), name: str = Query(...)):
    path = (settings.PROJECT_ROOT / dest / name).resolve()
    return {"exists": path.exists()}

@app.post("/api/upload")
def upload_file(file: UploadFile = File(...), dest: str = Form(...)):
    dest_path = (settings.PROJECT_ROOT / dest).resolve()
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
async def batch_build(request: Request, pid: str | None = Query(None, alias="pid")):

    body           = await request.json()
    file_names     = body["fileNames"]
    in_dir        = _resolve_inside_project(body.get("inDir"),  fallback=settings.INPUT_DIR)
    out_dir       = _resolve_inside_project(body.get("outDir"), fallback=settings.OUTPUT_DIR)

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


    dbg("api.batch", f"Received batch build request for {len(file_names)} files. PID: {pid}")

     # ------------------------------------------------------------------
    # build in settings.CHUNK_SIZE slices, each processed in parallel
    # ------------------------------------------------------------------
    results: list[dict[str, Any]] = []
    if pid:
        PROGRESS_TOTAL[pid] = len(file_names)
        PROGRESS[pid]       = 0

    loop        = asyncio.get_running_loop()
    sub_valid   = run_out_dir / "valid"
    sub_invalid = run_out_dir / "invalid"

    for start in range(0, len(file_names), settings.CHUNK_SIZE):
        chunk = file_names[start : start + settings.CHUNK_SIZE]
        chunk_no = start // settings.CHUNK_SIZE + 1
        dbg("chunk", f"▶ chunk {chunk_no} – {len(chunk)} files")
        chunk_t0 = datetime.now()

        with concurrent.futures.ThreadPoolExecutor(max_workers=settings.MAX_PARALLEL) as pool:
            tasks = [
                loop.run_in_executor(
                    pool,
                    partial(
                        _build_one,
                        fname,
                        in_dir=in_dir,
                        sub_dir_valid=sub_valid,
                        sub_dir_invalid=sub_invalid,
                        template_ov=template_ov,
                        overrides_all=overrides_all,
                        browser_map=browser_map,
                        package_files=package_files,
                        zip_pair=zip_pair,
                    ),
                )
                for fname in chunk
            ]

            # gather as they complete → steady progress updates
            for coro in asyncio.as_completed(tasks):
                res = await coro
                results.append(res)
                if pid:
                    PROGRESS[pid] += 1        # pushes to Web-Socket

            # finished one chunk -------------------------------------------
            dbg("chunk", f"✓ chunk {chunk_no} finished "
                        f"in {datetime.now() - chunk_t0} "
                        f"(total results={len(results)})")

    dbg("batch", "DONE – %d OK / %d failed",
        sum(r["success"] for r in results),
        sum(not r["success"] for r in results))

    if pid:
        PROGRESS[pid] = PROGRESS_TOTAL.get(pid, 0)

    return {"results": results}
