import time
import hashlib
from pathlib import Path
from xml.dom import minidom
from fastapi import APIRouter, HTTPException
from backend.settings import get_settings
from backend.logging_config import dbg

settings = get_settings()
router = APIRouter(tags=["helpers"])

def resolve_inside_project(folder: str | None, *, fallback: Path) -> Path:
    if not folder or folder.startswith("__server") or folder == "__client__":
        dbg("paths", "resolve default", fallback=str(fallback))
        fallback.mkdir(exist_ok=True)
        return fallback
    p = (settings.PROJECT_ROOT / folder).resolve()
    try:
        p.relative_to(settings.PROJECT_ROOT)
    except ValueError:
        dbg("paths", "reject path escape", folder=folder, resolved=str(p))
        raise HTTPException(400, f"Illegal folder path: {folder}")
    p.mkdir(exist_ok=True, parents=True)
    dbg("paths", "resolved", path=str(p))
    return p

def hash_fileobj(fobj):
    dbg("paths", "hashing", bytes=fobj.tell())
    h = hashlib.sha256()
    for chunk in iter(lambda: fobj.read(8192), b""):
        h.update(chunk)
    fobj.seek(0)
    return h.hexdigest()

def safe_unlink(p: Path) -> None:
    """Retry-unlink on Windows to avoid WinError 32."""
    dbg("paths", "unlink", path=str(p))
    for _ in range(3):
        try:
            p.unlink(missing_ok=True)
            return
        except PermissionError:      # file still in use → wait & retry
            time.sleep(0.1)

def pretty_xml(xml_bytes: bytes, max_len: int = 4000) -> str:
    txt = minidom.parseString(xml_bytes).toprettyxml()
    return txt[:max_len] + "…" if len(txt) > max_len else txt