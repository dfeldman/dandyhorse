"""Somebody to ride against (PLAN.md §18.3).

A game asks for a competitor when a session starts. We hand back a real past session by a real other
player who is a little better than this one — their 1 Hz timeline, so the game can say at any moment
"they were 400 m up the road by now, and they had made four deliveries". Nothing here is specific to a
game: the progress counters come from whatever the game declared (§18.2).

When the session ends, `standing()` ranks it against recent sessions by players at a similar level: the
small, personal leaderboard the end screen shows.
"""
from __future__ import annotations

import random
import sqlite3
from typing import Any

from ..util import loads, parse_iso
from . import fitness

# A session too short to race against.
MIN_DURATION = 240.0
# How many recent candidate sessions to consider.
CANDIDATES = 200
# Bands of relative fitness, tried in order: a little better, then roughly similar, then anybody.
BANDS = ((1.00, 1.15), (0.85, 1.30), (0.0, 99.0))
# Among the closest few, pick at random, so a popular route is not everybody racing the same ghost.
SHORTLIST = 5
# The ideal competitor is this much stronger than the player.
TARGET = 1.07
# Rows in a competitor timeline: 900 covers a 45-minute session at 3-second steps.
MAX_ROWS = 900
# What a competitor row carries. Position is left out: two players on generated terrain share no map.
FIELDS = ("distance", "energy", "work", "elevationGain")


def _candidates(conn: sqlite3.Connection, uid: int, game_id: str, variant: str,
                route: str | None) -> list[sqlite3.Row]:
    where = ["s.status='complete'", "s.debug=0", "s.uid<>?", "u.public=1", "s.game_id=?", "s.variant=?",
             "s.duration >= ?", "s.log_finalized=1"]
    args: list[Any] = [uid, game_id, variant, MIN_DURATION]
    if route:
        where.append("s.route=?")
        args.append(route)
    return conn.execute(
        f"SELECT s.session_id, s.uid, s.started_at, s.duration, s.distance, s.route, s.stats, "
        f"       u.username, u.display_name, u.first_name, u.last_name, u.country, u.fitness, "
        f"       u.preferences, u.thumb_file "
        f"FROM sessions s JOIN users u ON u.uid=s.uid WHERE {' AND '.join(where)} "
        f"ORDER BY s.started_at DESC LIMIT ?", (*args, CANDIDATES)).fetchall()


def pick(conn: sqlite3.Connection, uid: int, game_id: str, variant: str, route: str | None = None,
         seed: str | None = None) -> sqlite3.Row | None:
    """A session to race, or None when nobody suitable has played this yet."""
    rows = _candidates(conn, uid, game_id, variant, route)
    if not rows:
        return None
    me = conn.execute("SELECT fitness, preferences FROM users WHERE uid=?", (uid,)).fetchone()
    mine = fitness.watts_of(me) if me else fitness.DEFAULT_STEADY_WATTS
    # One session per player: a league of one person's twenty rides is not a league.
    best_per_uid: dict[int, sqlite3.Row] = {}
    for r in rows:
        best_per_uid.setdefault(r["uid"], r)
    pool = list(best_per_uid.values())
    rng = random.Random(seed or "")
    for low, high in BANDS:
        band = [r for r in pool if low * mine <= fitness.watts_of(r) <= high * mine]
        if not band:
            continue
        band.sort(key=lambda r: abs(fitness.watts_of(r) - mine * TARGET))
        return rng.choice(band[:SHORTLIST])
    return None


def _downsample(rows: list[dict[str, Any]], progress_keys: list[str]) -> list[dict[str, Any]]:
    step = max(1, (len(rows) + MAX_ROWS - 1) // MAX_ROWS)
    out = []
    for i in range(0, len(rows), step):
        r = rows[i]
        row: dict[str, Any] = {"elapsed": round(r.get("elapsed") or 0.0, 1)}
        for k in FIELDS:
            v = r.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                row[k] = round(float(v), 2)
        speed = (r.get("speed") or {}).get("actual") if isinstance(r.get("speed"), dict) else None
        req = (r.get("speed") or {}).get("requested") if isinstance(r.get("speed"), dict) else None
        v = speed if speed is not None else req
        if isinstance(v, (int, float)):
            row["speed"] = round(float(v), 2)
        power = (r.get("power") or {}).get("actual") if isinstance(r.get("power"), dict) else None
        if isinstance(power, (int, float)):
            row["power"] = round(float(power), 1)
        if progress_keys:
            row["progress"] = {k: v for k, v in (r.get("progress") or {}).items() if k in progress_keys}
        out.append(row)
    # Always keep the last row: a competitor who stops one sample short of the finish looks beaten.
    if rows and out and out[-1]["elapsed"] != round(rows[-1].get("elapsed") or 0.0, 1):
        out.append(_downsample([rows[-1]], progress_keys)[0])
    return out


def player_view(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    return {"uid": d["uid"], "username": d["username"], "displayName": d.get("display_name"),
            "firstName": d.get("first_name"), "lastName": d.get("last_name"), "country": d.get("country"),
            "fitness": round(fitness.watts_of(row), 1),
            "thumbnailUrl": f"/api/profiles/{d['username']}/thumbnail" if d.get("thumb_file") else None}


def competitor_view(dh, conn: sqlite3.Connection, row: sqlite3.Row, timeline: list[dict[str, Any]],
                    game_id: str) -> dict[str, Any]:
    keys = dh.catalog.progress_keys(game_id)
    # What the game calls each counter (metadata.json `progress`), so the HUD can label them without every
    # game repeating itself — and without one of them getting it wrong.
    spec = (dh.catalog.game(game_id) or {}).get("progress") or {}
    labels = {k: (spec.get(k) or {}).get("label") or k for k in keys}
    return {
        "competitor": player_view(row),
        "sessionId": row["session_id"], "startedAt": row["started_at"],
        "duration": row["duration"], "distance": row["distance"], "route": row["route"],
        "stats": loads(row["stats"]),
        "progressKeys": keys,
        "progressLabels": labels,
        "timeline": _downsample(timeline or [], keys),
    }


# --- ghosts: several of them, to ride among (PLAN.md §18.12) -------------------------------------

# More than this on the road at once and they stop being people you are racing and become traffic.
GHOSTS_MAX = 6


def ghosts(conn: sqlite3.Connection, uid: int, game_id: str, variant: str, route: str | None,
           want: int, challenged: list[int] | None = None) -> list[sqlite3.Row]:
    """Several past sessions to ride against at once, newest-best first.

    Anybody the player challenged comes first and regardless of their level — that is the point of having
    challenged them. The rest fill up from the same fitness-banded pool a single competitor is drawn from,
    one session per player, so you are not racing the same person three times.
    """
    want = max(0, min(want, GHOSTS_MAX))
    if not want:
        return []
    out: list[sqlite3.Row] = []
    seen: set[int] = set()
    for target in (challenged or []):
        best = _best_for(conn, int(target), game_id, variant)
        if best is not None and int(best["uid"]) not in seen:
            out.append(best)
            seen.add(int(best["uid"]))
        if len(out) >= want:
            return out

    me = conn.execute("SELECT fitness, preferences FROM users WHERE uid=?", (uid,)).fetchone()
    mine = fitness.watts_of(me) if me else fitness.DEFAULT_STEADY_WATTS
    rows = _candidates(conn, uid, game_id, variant, route)
    if not rows and route:
        rows = _candidates(conn, uid, game_id, variant, None)
    # Nearest in strength first: a ghost you can almost hold is worth more than one you will never see.
    rows = sorted(rows, key=lambda r: abs(fitness.watts_of(r) - mine))
    for r in rows:
        if int(r["uid"]) in seen or not r["distance"]:
            continue
        out.append(r)
        seen.add(int(r["uid"]))
        if len(out) >= want:
            break
    return out


# --- the end-of-session standing ----------------------------------------------------------------

# How many other players' recent sessions the standing compares against.
STANDING_POOL = 40
# Fitness band for the standing: close enough that the comparison means something.
STANDING_BAND = (0.8, 1.25)


def _best_for(conn: sqlite3.Connection, uid: int, game_id: str, variant: str) -> sqlite3.Row | None:
    """This player's furthest complete session of a game, for putting beside somebody who challenged them.

    The same columns `_candidates` selects, because `player_view` reads the player off the row.
    """
    return conn.execute(
        "SELECT s.session_id, s.uid, s.started_at, s.duration, s.distance, s.route, s.stats, "
        "       u.username, u.display_name, u.first_name, u.last_name, u.country, u.fitness, "
        "       u.preferences, u.thumb_file "
        "FROM sessions s JOIN users u ON u.uid=s.uid "
        "WHERE s.uid=? AND s.game_id=? AND s.variant=? AND s.status='complete' AND s.debug=0 "
        "AND u.public=1 AND s.distance > 0 AND s.duration >= ? "
        "ORDER BY s.distance DESC LIMIT 1",
        (int(uid), game_id, variant, MIN_DURATION)).fetchone()


def standing(conn: sqlite3.Connection, uid: int, session_row: sqlite3.Row) -> dict[str, Any]:
    """This session against recent sessions of the same game and variant by players at a similar level.
    Ranked on distance — the one measure every game on every machine shares."""
    me = conn.execute("SELECT fitness, preferences FROM users WHERE uid=?", (uid,)).fetchone()
    mine = fitness.watts_of(me) if me else fitness.DEFAULT_STEADY_WATTS
    rows = _candidates(conn, uid, session_row["game_id"], session_row["variant"], session_row["route"])
    if not rows and session_row["route"]:
        # A game whose route carries its seed (Night Racer, Night Watch) gives every session a route of its
        # own, so nobody ever shares one. A league of one is no league: widen to the game itself. A game
        # whose route is a real place still gets its own, because somebody rode it.
        rows = _candidates(conn, uid, session_row["game_id"], session_row["variant"], None)
    low, high = STANDING_BAND
    pool: dict[int, sqlite3.Row] = {}
    for r in rows:
        if low * mine <= fitness.watts_of(r) <= high * mine and r["distance"]:
            pool.setdefault(r["uid"], r)
    entries = [{"player": player_view(r), "sessionId": r["session_id"], "distance": float(r["distance"]),
                "duration": r["duration"], "startedAt": r["started_at"], "stats": loads(r["stats"]),
                "me": False, "challenged": False}
               for r in list(pool.values())[:STANDING_POOL]]

    # Anybody they took on before this ride goes in whatever their level: the whole point of a challenge
    # is to measure yourself against somebody you chose, not somebody the band picked for you.
    taken = [int(u) for u in loads(session_row["challenged"] if "challenged" in session_row.keys() else "[]")]
    have = {e["player"]["uid"] for e in entries}
    for target in taken:
        if target in have:
            for e in entries:
                if e["player"]["uid"] == target:
                    e["challenged"] = True
            continue
        best = _best_for(conn, target, session_row["game_id"], session_row["variant"])
        if best is None:
            continue           # they have never ridden this one; nothing to put beside you
        entries.append({"player": player_view(best), "sessionId": best["session_id"],
                        "distance": float(best["distance"]), "duration": best["duration"],
                        "startedAt": best["started_at"], "stats": loads(best["stats"]),
                        "me": False, "challenged": True})
    d = session_row["distance"]
    own = {"player": {"uid": uid, "username": None, "displayName": None, "firstName": None, "lastName": None,
                      "country": None, "fitness": round(mine, 1), "thumbnailUrl": None},
           "sessionId": session_row["session_id"], "distance": float(d) if d else 0.0,
           "duration": session_row["duration"], "startedAt": session_row["started_at"],
           "stats": loads(session_row["stats"]), "me": True, "challenged": False}
    entries.append(own)
    entries.sort(key=lambda e: -e["distance"])
    for i, e in enumerate(entries, 1):
        e["rank"] = i
    return {"rank": own["rank"], "of": len(entries), "rows": entries,
            "beaten": sum(1 for e in entries if not e["me"] and e["distance"] < own["distance"])}


def session_age_days(row: sqlite3.Row) -> float | None:
    from ..util import now as _now
    t = parse_iso(row["started_at"])
    return None if t is None else (_now() - t) / 86400.0
