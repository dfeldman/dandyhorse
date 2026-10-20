"""Measured fitness (PLAN.md §18.4).

The platform already knows a *declared* fitness: `preferences.steadyWatts`, or 0.65 × `ftp`, or 130 W
(libs/gamekit/src/effort.ts and consoles/web/src/fitness.ts — keep the three in step). That is what a player
says about themselves. For matching one player against another we want what they actually do, so this
averages their recent complete sessions and keeps the result on `users.fitness`.

One number decides a match: `watts`. A treadmill player has no power meter, so their average speed is
converted with the same equivalence the fitness levels use (consoles/web/src/fitness.ts FITNESS_LEVELS:
5 km/h up 5% ≈ 100 W, 10 km/h ≈ 200 W).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from ..util import dumps, iso, loads

# How many recent sessions make up the average.
WINDOW = 10
# A session shorter than this says nothing about fitness (a false start, a minute of fiddling).
MIN_DURATION = 300.0

DEFAULT_STEADY_WATTS = 130.0
FTP_TO_STEADY = 0.65

# (id, watts) — consoles/web/src/fitness.ts FITNESS_LEVELS.
LEVELS: tuple[tuple[str, float], ...] = (("starting", 100.0), ("regular", 130.0), ("fit", 160.0), ("veryfit", 200.0))

# Treadmill speed (m/s) to roughly equivalent watts, from the fitness levels' own pairs: 1.39 m/s ≈ 100 W
# at the walking inclines they assume, 2.78 m/s ≈ 200 W. Linear between and beyond.
_SPEED_TO_WATTS = 200.0 / 2.78


def level_of(watts: float) -> str:
    return min(LEVELS, key=lambda lv: abs(lv[1] - watts))[0]


def watts_from_speed(speed: float | None) -> float | None:
    return None if not speed or speed <= 0 else speed * _SPEED_TO_WATTS


def declared_watts(preferences: dict[str, Any]) -> float:
    """What the player says their steady effort is, in the same order gamekit reads it."""
    w = preferences.get("steadyWatts")
    if isinstance(w, (int, float)) and not isinstance(w, bool) and w > 0:
        return float(w)
    ftp = preferences.get("ftp")
    if isinstance(ftp, (int, float)) and not isinstance(ftp, bool) and ftp > 0:
        return FTP_TO_STEADY * float(ftp)
    return DEFAULT_STEADY_WATTS


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def measure(conn: sqlite3.Connection, uid: int) -> dict[str, Any]:
    """Recompute `users.fitness` for one player from their recent complete sessions."""
    out: dict[str, Any] = {}
    for device, column in (("bike", "avg_power"), ("treadmill", "avg_speed")):
        rows = conn.execute(
            f"SELECT {column} AS v FROM sessions WHERE uid=? AND device_type=? AND status='complete' "
            f"AND debug=0 AND {column} IS NOT NULL AND {column} > 0 AND duration >= ? "
            f"ORDER BY started_at DESC LIMIT ?", (uid, device, MIN_DURATION, WINDOW)).fetchall()
        if not rows:
            continue
        mean = _mean([float(r["v"]) for r in rows])
        out[device] = {"watts" if device == "bike" else "speed": round(mean, 2),
                       "sessions": len(rows), "updatedAt": iso()}
    bike = (out.get("bike") or {}).get("watts")
    tread = watts_from_speed((out.get("treadmill") or {}).get("speed"))
    # A player who does both is matched on the bike figure: it is the measured one, not a conversion.
    watts = bike if bike is not None else tread
    if watts is None:
        row = conn.execute("SELECT preferences FROM users WHERE uid=?", (uid,)).fetchone()
        watts = declared_watts(loads(row["preferences"]) if row else {})
        out["source"] = "declared"
    else:
        out["source"] = "measured"
    out["watts"] = round(float(watts), 1)
    out["level"] = level_of(out["watts"])
    return out


def store(conn: sqlite3.Connection, uid: int) -> dict[str, Any]:
    f = measure(conn, uid)
    conn.execute("UPDATE users SET fitness=?, updated_at=? WHERE uid=?", (dumps(f), iso(), uid))
    conn.commit()
    return f


def watts_of(user_row: Any) -> float:
    """The one number competitor matching and bot pairing use: measured if we have it, else declared."""
    d = dict(user_row)
    f = loads(d.get("fitness"))
    w = f.get("watts") if isinstance(f, dict) else None
    if isinstance(w, (int, float)) and not isinstance(w, bool) and w > 0:
        return float(w)
    return declared_watts(loads(d.get("preferences")))
