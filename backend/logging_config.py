import asyncio
import logging
import os
import sys
import threading
import logging.handlers
import json
from fnmatch import fnmatch
from pathlib import Path
from typing import Any, Dict
from collections import deque

# ----------------------------------------------------------
# Central settings
# ----------------------------------------------------------
from backend.settings import get_settings
settings = get_settings()
LAST_LOGS = deque(maxlen=200)

# ----------------------------------------------------------
# Thread-local context: attach current "fileName" to every record
# ----------------------------------------------------------
thread_local = threading.local()

class ContextFilter(logging.Filter):
    """Injects thread-local filename and user into each LogRecord."""
    def filter(self, record: logging.LogRecord) -> bool:
        record.fileNameFromContext = getattr(thread_local, "log_context_filename", None)
        record.user = getattr(thread_local, "log_context_user", None)
        return True

# ----------------------------------------------------------
# WebSocket handler for UI console
# ----------------------------------------------------------
EVENT_LOOP: asyncio.AbstractEventLoop | None = None

class WebSocketDebugHandler(logging.Handler):
    """
    A custom logging handler that forwards log records to all connected WebSocket clients.
    It runs in a separate thread from the main application, so it must use thread-safe methods.
    """
    def emit(self, record: logging.LogRecord) -> None:
        if not EVENT_LOOP:
            return

        subs = getattr(EVENT_LOOP, "_debug_subscribers", None)
        if not subs:
            return

        log_data: Dict[str, Any] = {
            "level": record.levelname,
            "tag": record.name,
            "message": record.getMessage(),
            "timestamp": record.created,
            "fileName": getattr(record, "fileNameFromContext", None),
            "user": getattr(record, "user", None),
        }
        LAST_LOGS.append(log_data)

        try:
            for q in subs:
                EVENT_LOOP.call_soon_threadsafe(q.put_nowait, log_data)
        except Exception:
            # CRITICAL: If an error happens inside a logging handler, we CANNOT use
            # the logger (e.g., `dbg()`) to report it, as that would cause an infinite loop.
            # We must write directly to the standard error stream.
            print(f"[WebSocketHandler] ERROR pushing log: {sys.exc_info()[1]}", file=sys.stderr)

def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Call this from api.py after you start the uvicorn loop."""
    global EVENT_LOOP
    EVENT_LOOP = loop

# ----------------------------------------------------------
# Formatter: JSON vs plain-text
# ----------------------------------------------------------
if settings.LOG_JSON:
    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload: Dict[str, Any] = {
                "timestamp": self.formatTime(record, self.datefmt),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "file": getattr(record, "fileNameFromContext", None),
                "user": getattr(record, "user", None),
            }
            if isinstance(record.args, dict):
                payload.update(record.args)
            return json.dumps(payload)

    formatter = JsonFormatter(datefmt="%Y-%m-%d %H:%M:%S.%f")
else:
    formatter = logging.Formatter(
        "%(asctime)s %(levelname).1s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

# ----------------------------------------------------------
# Apply global include/exclude filters on logger names
# ----------------------------------------------------------
def apply_include_exclude() -> None:
    includes = [g.strip() for g in settings.LOG_INCLUDE.split(",") if g.strip()]
    excludes = [g.strip() for g in settings.LOG_EXCLUDE.split(",") if g.strip()]

    for name, logger in logging.root.manager.loggerDict.items():
        if not isinstance(logger, logging.Logger):
            continue

        # reset to root level first
        logger.setLevel(settings.LOG_LEVEL.upper())

        # if includes set, disable those not matched
        if includes and not any(fnmatch(name, pat) for pat in includes):
            logger.disabled = True
            continue

        # disable those explicitly excluded
        if excludes and any(fnmatch(name, pat) for pat in excludes):
            logger.disabled = True

# ----------------------------------------------------------
# setup_logging(): call this once at application startup
# ----------------------------------------------------------
def setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(settings.LOG_LEVEL.upper())
    root.handlers.clear()
    root.addFilter(ContextFilter())

    # WebSocket UI handler (always DEBUG)
    ws_handler = WebSocketDebugHandler()
    ws_handler.setLevel(logging.DEBUG)
    ws_handler.setFormatter(formatter)
    root.addHandler(ws_handler)

    # INFO+ permanent audit log
    info_path = settings.LOG_DIR / "backend.info.log"
    info_h = logging.handlers.RotatingFileHandler(
        info_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    info_h.setLevel(logging.INFO)
    info_h.setFormatter(formatter)
    root.addHandler(info_h)

    # Optional DEBUG file
    if settings.LOG_VERBOSE:
        debug_path = settings.LOG_DIR / "backend.debug.log"
        dbg_h = logging.handlers.RotatingFileHandler(
            debug_path, maxBytes=10 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        dbg_h.setLevel(logging.DEBUG)
        dbg_h.setFormatter(formatter)
        root.addHandler(dbg_h)

    apply_include_exclude()

# ----------------------------------------------------------
# dbg() helper
# ----------------------------------------------------------
def dbg(tag: str, *parts: Any, **kwargs: Any) -> None:
    """
    Shorthand for: logging.getLogger(tag).debug(" ".join(parts), extra=kwargs)
    """
    if not parts:
        return
    msg = " ".join(map(str, parts))
    logging.getLogger(tag).debug(msg, extra=kwargs)