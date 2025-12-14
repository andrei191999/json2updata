from __future__ import annotations
import asyncio, os
from enum import Enum
from concurrent.futures import ThreadPoolExecutor
import concurrent.futures, json
from datetime import datetime
from collections import Counter
from functools import partial
from pathlib import Path
from typing import Any, Dict, List, Union
from pydantic import BaseModel, Field
from backend.logging_config import set_log_level
from fastapi import APIRouter, Body, HTTPException, Query, Request, Response
from backend.settings import get_settings
from backend.logging_config import dbg, file_log_context
from backend.mapper import Mapper
from backend.xml_builder import build_updata_xml, validate_xml
from backend.spec_parser import updata_tag_list, updata_order_map, updata_required_tags, updata_cond_required_tags, updata_parent_req_tags, updata_parent_opt_tags
from backend.utils.helpers import resolve_inside_project
from backend.utils.workers import build_one
from backend.api_state import (
    ACTIVE_PID, start_run, end_run, cancel_run,
    PROGRESS, PROGRESS_TOTAL, check_if_cancelled
)

settings = get_settings()
router = APIRouter(tags=["mapping"])
CANCELLED: Dict[str, bool] = {}

def make_mapper() -> Mapper:
    return Mapper(
        spec_path=settings.SPEC_CSV,
        defaults_path=settings.DEFAULTS_YAML,
        fuzzy_threshold=settings.FUZZY_THRESHOLD,
    )

@router.get("/spec")
def get_spec():
    spec_data = {
        "tagList": updata_tag_list,
        "orderMap": updata_order_map,
        "required": sorted(updata_required_tags),
        "conditional": sorted(updata_cond_required_tags),
        "parentReq": sorted(updata_parent_req_tags),
        "parentOpt": sorted(updata_parent_opt_tags),
    }
    dbg("api.spec", f"return spec tags={len(updata_tag_list)}")
    return spec_data

class SuggestLevel(str, Enum):
    fast   = "fast"
    normal = "normal"
    deep   = "deep"

@router.post("/map")
def map_json(
    payload: Union[Dict[str, Any], List[Dict[str, Any]]],
    level: SuggestLevel = Query(default=SuggestLevel.normal, description="Suggestion depth"),
    file: str | None = Query(default=None, description="Optional filename hint for single-object requests"),
):
    mapper = make_mapper()

    def _map_one(js: Dict[str, Any], hint: str | None = None):
        with file_log_context(hint):
            mapped, leftover, (errs, warns) = mapper.map_json(js)
            suggest = mapper.suggest(js, level=level.value, top_n=5)  # NOTE: .value
            dbg("api.map",
                f"mapped={len(mapped)} leftover={len(leftover)} errs={len(errs)} warns={len(warns)} file={hint or '-'}")
            return {
                "mapped":   mapped,
                "leftover": leftover,
                "suggest":  suggest,
                "errors":   sorted(errs),
                "warnings": sorted(warns),
            }

    if isinstance(payload, list):
        dbg("api.map", f"batch n={len(payload)} level={level}")
        return [_map_one(js) for js in payload]
    else:
        return _map_one(payload, file)

@router.post("/build")
def build_xml_endpoint(data: Dict[str, Any], file: str | None = Query(default=None, description="optional filename")):
    mapped = data.get("mapped", {})
    # treat “__preview__...” and None as not-a-real-file
    is_real_file = bool(file) and not str(file).startswith("__preview__")

    ctx = file_log_context(file if is_real_file else None)
    with ctx:
        dbg("api.build", f"START build xml file={file or '__preview__'}")
        xml_bytes = build_updata_xml(mapped)
        try:
            validate_xml(xml_bytes)
            valid, msg = "1", "ok"
            dbg("api.build", "XML validation ok")
        except Exception as exc:
            valid, msg = "0", str(exc)
            dbg("api.build", f"XML validation FAIL: {msg}")

    hdrs = {"X-Updata-Valid": valid, "X-Updata-Message": msg}
    return Response(xml_bytes, media_type="application/xml", headers=hdrs)

@router.post("/save")
def save_xml(data: Dict[str, Any]):
    if not data.get("fileName"):
        raise HTTPException(400, "fileName required")
    out = settings.OUTPUT_DIR / data["fileName"].replace(".json", ".xml")
    out.write_text(data["xml"], "utf-8")
    dbg("api.save", f"wrote {out.name}")
    return {"ok": True, "path": str(out)}

@router.post("/batch_build")
async def batch_build(request: Request, pid: str | None = Query(None, alias="pid")):
    body        = await request.json()
    file_names  : List[str] = body["fileNames"]
    in_dir      = resolve_inside_project(body.get("inDir"),  fallback=settings.INPUT_DIR)
    out_dir     = resolve_inside_project(body.get("outDir"), fallback=settings.OUTPUT_DIR)
    pdf_link_dest = body.get("pdfLinkDest")
    pdf_link_dir  = (settings.PDF_WORK_DIR / pdf_link_dest) if pdf_link_dest else None
    overrides   = body.get("overrides", {})
    template_ov = overrides.get("__template__", {})
    browser_map = body.get("browserMapped", {})
    package     = body.get("package", True)
    zip_pair    = body.get("zipPair", False)
    results: list[dict] = []
    loop = asyncio.get_running_loop()
    pool = ThreadPoolExecutor(max_workers=settings.MAX_PARALLEL)

    ts_folder   = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_out_dir = out_dir / ts_folder
    (run_out_dir / "valid").mkdir(parents=True, exist_ok=True)
    (run_out_dir / "invalid").mkdir(parents=True, exist_ok=True)

    # ----- guard: block concurrent runs -----
    if ACTIVE_PID and ACTIVE_PID in PROGRESS and PROGRESS.get(ACTIVE_PID, 0) < PROGRESS_TOTAL.get(ACTIVE_PID, 0):
        raise HTTPException(status_code=409, detail=f"Another batch is running (pid={ACTIVE_PID}).")

    if not pid:
        pid = datetime.now().strftime("%Y%m%d_%H%M%S%f")

    start_run(pid, total=len(file_names))
    dbg("api.batch", f"[Process ID: {os.getpid()}] Received batch request for pid={pid}")
    dbg("api.batch", f"START n={len(file_names)} pid={pid} in={in_dir} pdfDir={pdf_link_dir or '-'} out={run_out_dir} package={package} zip={zip_pair}")

    if pid:
        PROGRESS_TOTAL[pid] = len(file_names)
        PROGRESS[pid]       = 0
        CANCELLED[pid]      = False

    sub_valid   = run_out_dir / "valid"
    sub_invalid = run_out_dir / "invalid"

    loop = asyncio.get_running_loop()

    try:
        for start in range(0, len(file_names), settings.CHUNK_SIZE):
            if check_if_cancelled(pid):
                dbg("api.batch", f"ABORT pid={pid} (requested)")
                break

            chunk = file_names[start : start + settings.CHUNK_SIZE]
            chunk_no = start // settings.CHUNK_SIZE + 1
            t0 = datetime.now()
            dbg("chunk", f"▶ chunk {chunk_no} – {len(chunk)} files")

            coros = [
                loop.run_in_executor(
                    pool,
                    partial(
                        build_one, fname,
                        pid=pid, in_dir=in_dir, pdf_link_dir=pdf_link_dir,
                        sub_dir_valid=sub_valid, sub_dir_invalid=sub_invalid,
                        template_ov=template_ov, overrides_all=overrides,
                        browser_map=browser_map, package_files=package, zip_pair=zip_pair,
                    ),
                )
                for fname in chunk
            ]
            for fut in asyncio.as_completed(coros):
                res = await fut
                results.append(res)
                PROGRESS[pid] += 1

            dbg("chunk", f"✓ chunk {chunk_no} done dt={datetime.now()-t0} total={len(results)}")

        # mark final progress
        PROGRESS[pid] = min(PROGRESS[pid], PROGRESS_TOTAL[pid])
        status = "cancelled" if check_if_cancelled(pid) else "ok"

        # ── Safety net: dedupe by 'file' and log duplicate stats ───────────────
        by_file = {}
        for r in results:
            f = r.get("file")
            if f not in by_file:
                by_file[f] = r
        deduped = list(by_file.values())

        counts = Counter(r.get("file") for r in results)
        dupes = [(f, c) for f, c in counts.items() if c > 1]
        top_dupes = sorted(dupes, key=lambda x: x[1], reverse=True)[:5]
        dbg(
            "api.batch.stats",
            f"pid={pid} raw={len(results)} unique={len(deduped)} "
            f"dupe_files={len(dupes)} top={top_dupes}"
        )

        dbg("api.batch", f"DONE pid={pid} total={len(deduped)} status={status}")
        return {"status": status, "results": deduped}
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
        end_run(pid)

# ---- cancel + status endpoints ----
@router.post("/cancel/{pid}")
def cancel(pid: str):
    dbg("api.cancel", f"Received cancel request for pid={pid}")
    if cancel_run(pid):
        dbg("api.cancel", f"Successfully set cancel event for pid={pid}")
        return {"ok": True}
    raise HTTPException(404, f"pid not found: {pid}")


@router.get("/status")
def status():
    if ACTIVE_PID:
        return {
            "activePid": ACTIVE_PID,
            "done": PROGRESS.get(ACTIVE_PID, 0),
            "total": PROGRESS_TOTAL.get(ACTIVE_PID, 0),
            # ✅ Check for cancellation using Redis
            "cancelled": check_if_cancelled(ACTIVE_PID),
        }
    return {"activePid": None}


class LogLevelRequest(BaseModel):
    level: str = Field(..., pattern="^(DEBUG|INFO|WARNING|ERROR)$")

# ✅ Add this new endpoint
@router.post("/log-level")
def post_log_level(request: LogLevelRequest):
    """Endpoint to dynamically set the backend log level."""
    success = set_log_level(request.level)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid log level provided.")
    return {"ok": True, "level": request.level}
