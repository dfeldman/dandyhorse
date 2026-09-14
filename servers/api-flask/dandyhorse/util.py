"""Small helpers: clock, ULID, ISO time, JSON."""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


_clock = time.time


def now() -> float:
    return _clock()


def set_clock(fn=None) -> None:
    """Tests only: replace the server clock (None restores the real one)."""
    global _clock
    _clock = fn if fn is not None else time.time


def iso(t: float | None = None) -> str:
    dt = datetime.fromtimestamp(now() if t is None else t, tz=timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(s: str | None) -> float | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def ulid(t: float | None = None) -> str:
    ms = int((now() if t is None else t) * 1000)
    tpart = []
    for _ in range(10):
        tpart.append(_CROCKFORD[ms & 31])
        ms >>= 5
    rnd = int.from_bytes(os.urandom(10), "big")
    rpart = []
    for _ in range(16):
        rpart.append(_CROCKFORD[rnd & 31])
        rnd >>= 5
    return "".join(reversed(tpart)) + "".join(reversed(rpart))


def dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def loads(s: str | None, default: Any = None) -> Any:
    if s is None or s == "":
        return {} if default is None else default
    try:
        return json.loads(s)
    except ValueError:
        return {} if default is None else default


def num_or_none(v: Any) -> float | None:
    """Accept numbers, reject everything else (including bools) as null."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return f
    return None


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.status = status
        self.code = code
        self.message = message or code
