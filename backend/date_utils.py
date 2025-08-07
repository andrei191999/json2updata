# backend/date_utils.py
from __future__ import annotations
import re
from datetime import datetime, date, timezone
from typing import Any, Optional
from backend.logging_config import dbg, thread_local
from backend.settings       import get_settings

settings = get_settings()


_RE_ISO_DATE   = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_ISO_DT     = re.compile(r"^\d{4}-\d{2}-\d{2}T.*[Z+-].*$")
_RE_YYYYMMDD   = re.compile(r"^\d{8}$")
_RE_DDMMYY     = re.compile(r"^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])\d{2}$")
_RE_DDMMYYYY      = re.compile(
    r"^(0[1-9]|[12]\d|3[01])"      # day   01-31
    r"(0[1-9]|1[0-2])"             # month 01-12
    r"(19|20)\d{2}$")                     # year  4-digit

_EPOCH_MIN = 946684800          # 2000-01-01
_EPOCH_MAX = 4102444800         # 2100-01-01


# ──────────────────────────────────────────────────────────────
def to_iso(val: Any) -> Optional[str]:
    """Return an ISO-8601 *date* (`YYYY-MM-DD`) or **None** if unparsable."""
    # plain rejects
    if val in ("", None, [], {}, False, True):
        return None

    # datetime / date instances
    if isinstance(val, datetime):
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()

    # epoch seconds
    if isinstance(val, (int, float)):
        if _EPOCH_MIN < val < _EPOCH_MAX:
            return datetime.fromtimestamp(val, tz=timezone.utc).date().isoformat()
        return None

    if not isinstance(val, str):
        return None

    s = val.strip()

    # fast regex routes
    if _RE_ISO_DATE.match(s):
        return s
    if _RE_ISO_DT.match(s):
        return s[:10]
    if len(s) == 8 and s.isdigit():
        # 1) try YYYYMMDD (e.g. 20250618)
        try:
            result = datetime.strptime(s, "%Y%m%d").date().isoformat()
            dbg("date_utils", "Parsed date via YYYYMMDD", raw=s, parsed=result)
            return result
        except ValueError:
            pass
        # 2) fallback DDMMYYYY (e.g. 25052004)
        try:
            result = datetime.strptime(s, "%d%m%Y").date().isoformat()
            dbg("date_utils", "Parsed date via YYYYMMDD", raw=s, parsed=result)
            return result
        except ValueError:
            pass
    if _RE_YYYYMMDD.match(s):
        try:
            result = datetime.strptime(s, "%Y%m%d").date().isoformat()
            dbg("date_utils", "Parsed date via YYYYMMDD", raw=s, parsed=result)
            return result
        except ValueError:
            return None
    if _RE_DDMMYYYY.match(s):
        try:
            result = datetime.strptime(s, "%d%m%Y").date().isoformat()
            dbg("date_utils", "Parsed date via YYYYMMDD", raw=s, parsed=result)
            return result
        except ValueError:
            return None
    if _RE_DDMMYY.match(s):
        date = datetime.strptime(s, "%d%m%y").date()
        if date.year < 1990:
            return None

        dbg("date_utils", "Parsed date via YYYYMMDD", raw=s, parsed=date.isoformat())
        return date.isoformat()

    # fallback humane forms
    for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%m-%d-%Y"):
        try:
            result = datetime.strptime(s[:10], fmt).date().isoformat()
            dbg("date_utils", "Parsed date via YYYYMMDD", raw=s, parsed=result)
            return result
        except ValueError:
            pass
    # no match
    dbg("date_utils", "FAILED to parse date", value=val)
    return None


def looks_like_date(val: Any) -> bool:
    """Loose heuristic for “is this probably a date value?”."""
    if isinstance(val, bool):
        return False
    if isinstance(val, (int, float)):
        return _EPOCH_MIN < val < _EPOCH_MAX
    if isinstance(val, (date, datetime)):
        return True
    if not isinstance(val, str):
        return False

    s = val.strip()
    return any(r.match(s) for r in (
        _RE_ISO_DATE, _RE_ISO_DT, _RE_YYYYMMDD,
        _RE_DDMMYY, _RE_DDMMYYYY,
    ))
