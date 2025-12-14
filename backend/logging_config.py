import asyncio
import logging
import sys
import threading
import logging.handlers
import json
from fnmatch import fnmatch
from typing import Any, Dict
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone

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

@contextmanager
def file_log_context(name: str | None):
    """
    Temporarily set the per-thread filename context so logs
    appear under the 'Files' tab in the UI. Always clears.
    """
    old = getattr(thread_local, "log_context_filename", None)
    if name:
        thread_local.log_context_filename = name
    try:
        yield
    finally:
        if name:
            # restore previous context (or clear)
            thread_local.log_context_filename = old

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
        loop = EVENT_LOOP
        if not loop:
            return

        subscribers: set[asyncio.Queue] = getattr(loop, "_debug_subscribers", set())
        if not subscribers:
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

        # executed on the loop thread; swallow QueueFull here
        def _safe_put(q: asyncio.Queue, item: dict):
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                # drop silently; optionally count drops somewhere
                pass

        try:
            for q in list(subscribers):
                loop.call_soon_threadsafe(_safe_put, q, log_data)
        except Exception as e:
            # never log via logging here—write straight to stderr
            print(f"[Log Handler] error while scheduling WS log: {e}", file=sys.stderr)

def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Call this from api.py after you start the uvicorn loop."""
    global EVENT_LOOP
    EVENT_LOOP = loop

# ----------------------------------------------------------
# Formatter: JSON vs plain-text
# ----------------------------------------------------------
if settings.LOG_JSON:
    class JsonFormatter(logging.Formatter):
        def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
            # local time with millisecond precision, ISO 8601
            dt = datetime.fromtimestamp(record.created)
            return dt.isoformat(timespec="milliseconds")

        def format(self, record: logging.LogRecord) -> str:
            payload: Dict[str, Any] = {
                "timestamp": self.formatTime(record, self.datefmt),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "file": getattr(record, "fileNameFromContext", None),
                "user": getattr(record, "user", None),
            }
            # allow structured extras: log.debug("msg", extra={"foo": 1})
            if isinstance(record.args, dict):
                payload.update(record.args)
            return json.dumps(payload, ensure_ascii=False)

    formatter = JsonFormatter()
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

    # Mute 3rd-party noisy loggers even when root is DEBUG
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access", "websockets", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

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


@contextmanager
def file_context(name: str | None):
    old = getattr(thread_local, "log_context_filename", None)
    thread_local.log_context_filename = name
    try:
        yield
    finally:
        thread_local.log_context_filename = old


def set_log_level(level_name: str) -> bool:
    """Dynamically change the root logger's level."""
    level_name = level_name.upper()
    level = getattr(logging, level_name, None)

    if not isinstance(level, int):
        logging.getLogger("api.log_level").error(f"Invalid log level requested: {level_name}")
        return False

    root = logging.getLogger()
    root.setLevel(level)
    # Log the change at a high level so it's always visible
    logging.getLogger("api.log_level").warning(f"Log level changed to {level_name}")
    return True