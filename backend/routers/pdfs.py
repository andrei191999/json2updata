from __future__ import annotations
import gzip, os, shutil, hashlib, re
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Body, Request, Query
from backend.api_state import FILE_WRITER_LOCK
from backend.settings import get_settings
from backend.logging_config import dbg

settings = get_settings()
router = APIRouter(tags=["pdfs"])

def _is_gzip(buf: bytes) -> bool:
    return len(buf) >= 2 and buf[0] == 0x1F and buf[1] == 0x8B

def _is_pdf(buf: bytes) -> bool:
    return buf.startswith(b"%PDF-")

@router.post("/pdf/need")
async def pdf_need(hashes: list[str] = Body(...)):
    missing = [h for h in hashes if not (settings.PDF_CACHE_DIR / f"{h}.pdf").exists()]
    dbg("api.pdf", f"need hashes={len(hashes)} missing={len(missing)}")
    return {"missing": missing}

@router.post("/pdf")
async def pdf_upload(
    request: Request,
    # make everything optional so FastAPI never 422s before we can log
    file: UploadFile | None = File(None),
    hash_form: str | None = Form(None),
    dest: str | None = Form(None),
    # also accept hash via header or query (for older clients/tools)
    hash_hdr_x: str | None = Header(None, alias="x-hash"),
    hash_hdr_plain: str | None = Header(None, alias="hash"),
    hash_q: str | None = Query(None, alias="hash"),
    fname_hdr: str | None = Header(None, alias="x-filename"),
):
    # breadcrumb: keep content-type once per request
    ct = request.headers.get("content-type")
    dbg("api.pdf", f"upload ct={ct}")

    # Fallback: if bindings failed, try reading the form manually
    if file is None or hash_form is None or dest is None:
        try:
            form = await request.form()
            keys = list(form.keys())
            dbg("api.pdf", f"upload form_keys_count={len(keys)}")
            if file is None and "file" in form:
                form_file = form["file"]
                # from fastapi.datastructures import UploadFile
                if isinstance(form_file, UploadFile):
                    file = form_file
                else:
                    raise HTTPException(400, "Invalid file upload: expected an UploadFile")
            if hash_form is None and "hash" in form:
                hash_form = str(form["hash"])
            if dest is None and "dest" in form:
                dest = str(form["dest"])
            # If still no file, pick the first UploadFile present under any key.
            if file is None:
                for k, v in form.items():
                    if isinstance(v, UploadFile):
                        file = v
                        dbg("api.pdf", f"upload found file under key='{k}'")
                        break
            # If still no hash, pick the first 64-hex string value we can find.
            if hash_form is None:
                for k, v in form.items():
                    if isinstance(v, UploadFile):
                        continue
                    s = str(v)
                    if re.fullmatch(r"[0-9a-f]{64}", s):
                        hash_form = s
                        dbg("api.pdf", f"upload found hash under key='{k}'")
                        break
        except Exception as e:
            dbg("api.pdf", f"upload form parse failed: {e}")
            raise HTTPException(400, f"multipart parse failed: {e}")

    # Consolidate hash from all possible places
    hash = (
        hash_form
        or hash_hdr_x
        or hash_hdr_plain
        or hash_q
        or request.headers.get("x-hash")
        or request.headers.get("hash")
        or request.query_params.get("hash")
    )
    dbg("api.pdf", f"hash source={'form' if hash_form else 'hdr_x' if hash_hdr_x else 'hdr' if hash_hdr_plain else 'query' if hash_q else 'other'}")

    # If multipart failed to give us a file, consider raw body fallback
    raw: bytes | None = None
    filename = None
    if file is None:
        # Only safe to treat body as raw if not multipart
        if ct and "multipart/form-data" in ct.lower():
            dbg("api.pdf", "upload no file in multipart; cannot use raw body")
        else:
            raw = await request.body()
            filename = fname_hdr or "upload.pdf"
            dbg("api.pdf", f"upload raw-body bytes={len(raw)} name={filename}")
    else:
        filename = file.filename

    if (file is None and not raw) or not hash:
        dbg("api.pdf", f"upload missing parts file={file is not None} raw={bool(raw)} hash={bool(hash)} dest={dest}")
        raise HTTPException(400, "missing required parts: file and hash")

    if raw is None:
        if file is None:
            raise HTTPException(400, "missing required file for upload")
        raw = await file.read()

    orig_len = len(raw)
    enc = "gzip" if _is_gzip(raw) else "plain"
    dbg("api.pdf", f"recv hash={hash[:8]}… bytes={orig_len} enc={enc} name={filename}")
    if enc == "gzip":
        try:
            raw = gzip.decompress(raw)
        except Exception as e:
            dbg("api.pdf", f"gunzip failed len={orig_len} err={e}")
            raise HTTPException(400, f"gunzip failed: {e}")
    if not _is_pdf(raw):
        dbg("api.pdf", f"reject non-PDF upload: first 8 bytes={raw[:8]!r}")
        raise HTTPException(400, "uploaded bytes are not a PDF (%PDF- missing)")

    # integrity: compute server hash; if client hash missing, adopt it
    server_hash = hashlib.sha256(raw).hexdigest()
    if not hash:
        hash = server_hash
        dbg("api.pdf", f"hash source=server_computed value={hash}")
    elif server_hash != hash:
        dbg("api.pdf", f"hash mismatch client={hash} server={server_hash} name={filename}")
        raise HTTPException(400, "hash mismatch")

    target = settings.PDF_CACHE_DIR / f"{hash}.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as f:
        f.write(raw)
    dbg("api.pdf", f"stored {target.name} bytes={len(raw)} (from {enc}:{orig_len})")
    return {"stored": True, "bytes": len(raw)}


@router.post("/pdf/link")
async def pdf_link(hash: str = Form(...), fname: str = Form(...), dest: str = Form(...)):
    target = settings.PDF_CACHE_DIR / f"{hash}.pdf"
    if not target.exists():
        raise HTTPException(404, "cached copy missing")

    # ── Cache self-heal: if the cached file is gzipped, transparently decompress
    try:
        with open(target, "rb") as f:
            head = f.read(5)
    except Exception as e:
        dbg("api.pdf", f"failed to read cache {target.name}: {e}")
        raise HTTPException(500, f"cache read error: {e}")

    if len(head) >= 2 and head[0] == 0x1F and head[1] == 0x8B:
        # Old cache entry (gzipped). Decompress and atomically replace the cached file.
        try:
            raw = gzip.decompress(target.read_bytes())
        except Exception as e:
            dbg("api.pdf", f"cache gunzip failed for {target.name}: {e}")
            raise HTTPException(400, f"cached PDF gunzip failed: {e}")
        if not raw.startswith(b"%PDF-"):
            dbg("api.pdf", f"cache gunzip produced non-PDF for {target.name}")
            raise HTTPException(400, "cached PDF is corrupted (not %PDF- after gunzip)")
        tmp = target.with_suffix(".pdf.swap")
        with FILE_WRITER_LOCK:
            tmp.write_bytes(raw)
            os.replace(tmp, target)
        dbg("api.pdf", f"cache_migrated {target.name} (gz -> pdf, bytes={len(raw)})")

    dest_dir = settings.PDF_WORK_DIR / dest
    dest_dir.mkdir(parents=True, exist_ok=True)
    link_path = dest_dir / fname
    try:
        if not link_path.exists():
            os.link(target, link_path)
    except (AttributeError, OSError):
        if not link_path.exists():
            shutil.copy2(target, link_path)
    dbg("api.pdf", f"linked {link_path} -> cache:{target.name}")
    return {"linked": True, "path": str(link_path.relative_to(settings.PROJECT_ROOT))}
