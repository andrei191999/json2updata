# backend/api_state.py
from __future__ import annotations
import redis
from typing import Dict, Set, Optional
import asyncio
from pathlib import Path
import threading


PROGRESS: Dict[str, int] = {}
PROGRESS_TOTAL: Dict[str, int] = {}
DEBUG_SUBSCRIBERS: Set[asyncio.Queue] = set()
DEBUG_LOCK: Optional[asyncio.Lock] = None
ACTIVE_PID: Optional[str] = None
# ✅ Create a single, shared lock for all file writing operations
FILE_WRITER_LOCK = threading.RLock()
# Names being allocated right now (prevents two threads from grabbing the same path)
RESERVED_PATHS: Set[str] = set()

redis_pool = redis.ConnectionPool(host='localhost', port=6379, db=0, decode_responses=True)
_RESERVED: set[Path] = set()

def is_reserved(p: Path) -> bool:
    return p in _RESERVED

def reserve_path(p: Path) -> None:
    with FILE_WRITER_LOCK:
        _RESERVED.add(p)

def release_path(p: Path) -> None:
    with FILE_WRITER_LOCK:
        _RESERVED.discard(p)

def get_redis_conn() -> redis.Redis:
    """Creates a brand new, fresh connection to Redis."""
    return redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

def check_if_cancelled(pid: str) -> bool:
    """The definitive check for cancellation using a fresh connection."""
    # Note: .get() returns None if the key doesn't exist.
    return get_redis_conn().get(f"cancel:{pid}") == "1"

def start_run(pid: str, total: int) -> None:
    """Sets the initial state for a new run to 'running'."""
    global ACTIVE_PID
    ACTIVE_PID = pid
    PROGRESS[pid] = 0
    PROGRESS_TOTAL[pid] = total
    # ✅ Set the state to "0" for "running". Expires after 1 hour.
    get_redis_conn().set(f"cancel:{pid}", "0", ex=3600)

def end_run(pid: str) -> None:
    """Cleans up the state key for a finished/aborted run."""
    global ACTIVE_PID
    get_redis_conn().delete(f"cancel:{pid}")
    if ACTIVE_PID == pid:
        ACTIVE_PID = None

def cancel_run(pid: str) -> bool:
    """Sets the state to 'cancelled'."""
    # ✅ Set the state to "1" for "cancelled".
    get_redis_conn().set(f"cancel:{pid}", "1", ex=3600)
    return True