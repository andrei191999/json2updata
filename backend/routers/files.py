from __future__ import annotations
from typing import List
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from backend.settings import get_settings
from backend.logging_config import dbg

settings = get_settings()
router = APIRouter(tags=["files"])

@router.get("/files", response_model=List[str])
def list_files(dir: str = Query(default="input")):
    dbg("api.files", f"Request to list files in directory: '{dir}'")
    folder = (settings.PROJECT_ROOT / dir).resolve()
    if not folder.exists():
        dbg("api.files", f"ERROR: Directory not found: {folder}")
        raise HTTPException(404, f"Folder not found: {folder}")
    files = sorted(f.name for f in folder.glob("*.json"))
    dbg("api.files", f"Found {len(files)} JSON files in '{dir}'.")
    return files

@router.get("/files/{fname}")
def get_file(fname: str, dir: str = Query(default="input")):
    file_path = (settings.PROJECT_ROOT / dir / fname).resolve()
    if not file_path.exists():
        dbg("api.files", f"404 file missing: {file_path}")
        raise HTTPException(404, "file not found")
    dbg("api.files", f"get_file {file_path}")
    return FileResponse(str(file_path), media_type="application/json")

@router.post("/import_init")
def import_init(dest: str = Form(...)):
    dest_path = (settings.PROJECT_ROOT / dest).resolve()
    dbg("api.import", f"init dest={dest_path}")
    if dest_path.exists():
        try:
            import shutil
            shutil.rmtree(dest_path)
        except PermissionError:
            dbg("api.import", "dest busy, skipping purge", dest=str(dest_path))
    dest_path.mkdir(parents=True, exist_ok=True)
    return {"ok": True}

@router.get("/file_exists")
def file_exists(dest: str = Query(...), name: str = Query(...)):
    path = (settings.PROJECT_ROOT / dest / name).resolve()
    exists = path.exists()
    dbg("api.files", f"file_exists path={path} exists={exists}")
    return {"exists": exists}

@router.post("/upload")
def upload_file(file: UploadFile = File(...), dest: str = Form(...)):
    dest_path = (settings.PROJECT_ROOT / dest).resolve()
    dest_path.mkdir(parents=True, exist_ok=True)
    if not file.filename:
        raise HTTPException(400, "Uploaded file must have a filename")
    out = dest_path / file.filename
    out.write_bytes(file.file.read())
    dbg("api.files", f"uploaded {file.filename} -> {out}")
    return {"ok": True}
