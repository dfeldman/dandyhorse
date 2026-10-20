"""Leaderboards (PLAN.md §18.7).

Every board is its own function, registered by `@board`, free to compute however it likes. Boards are
precomputed into the `leaderboards` table: all of them whenever a session completes, on an admin's request,
and once a day so a week rolls over by itself.

A board's period is in **UTC** — one global board cannot be in everybody's own week at once. Streaks, which
are personal, are the player's own weeks (streaks.py).

Private players are computed but left unranked (`rank` 0); the API serves such a row only to that player, so
a private account neither appears on a board nor leaves a hole in it.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Callable

from datetime import datetime

from ..util import dumps, iso, loads, parse_iso
from . import weeks

# A session shorter than this says nothing about how fit or improved somebody is.
MIN_RIDE = 300.0

# What a value is, so a client can format it without knowing the board: metres, joules, seconds, a plain count.
UNITS = ("distance", "energy", "duration", "elevation", "count", "weeks", "number", "power")


@dataclass
class Row:
    uid: int
    value: float
    session_id: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class Board:
    id: str
    title: str
    subtitle: str
    period: str   # 'week' | 'month' | 'all'
    unit: str
    device: str | None
    lower_is_better: bool
    fn: Callable[[sqlite3.Connection, float | None, float | None], list[Row]]

    def period_key(self, t: float | None = None) -> str:
        from ..util import now as _now
        t = _now() if t is None else t
        return {"week": weeks.week_key, "month": weeks.month_key}[self.period](t, "UTC") \
            if self.period in ("week", "month") else "all"

    def bounds(self, period_key: str) -> tuple[float | None, float | None]:
        if self.period == "week":
            return weeks.week_bounds(period_key, "UTC")
        if self.period == "month":
            year, _, month = period_key.partition("-")
            from datetime import datetime, timezone as _tz
            start = datetime(int(year), int(month), 1, tzinfo=_tz.utc)
            nxt = datetime(int(year) + (month == "12"), 1 if month == "12" else int(month) + 1, 1, tzinfo=_tz.utc)
            return start.timestamp(), nxt.timestamp()
        return None, None

    def view(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "subtitle": self.subtitle, "period": self.period,
                "unit": self.unit, "device": self.device, "lowerIsBetter": self.lower_is_better}


REGISTRY: dict[str, Board] = {}


def board(bid: str, title: str, *, subtitle: str = "", period: str = "all", unit: str = "number",
          device: str | None = None, lower_is_better: bool = False):
    def wrap(fn):
        REGISTRY[bid] = Board(bid, title, subtitle, period, unit, device, lower_is_better, fn)
        return fn
    return wrap


# --- the sessions every board counts -------------------------------------------------------------
# Complete, not discarded, not debug. A window of (since, until) when the board has a period.

def _window(since: float | None, until: float | None) -> tuple[str, list[Any]]:
    where = "s.status='complete' AND s.debug=0"
    args: list[Any] = []
    if since is not None:
        where += " AND s.started_at >= ?"
        args.append(iso(since))
    if until is not None:
        where += " AND s.started_at < ?"
        args.append(iso(until))
    return where, args


def _sum(conn: sqlite3.Connection, column: str, since: float | None, until: float | None,
         device: str | None = None) -> list[Row]:
    where, args = _window(since, until)
    if device:
        where += " AND s.device_type=?"
        args.append(device)
    rows = conn.execute(
        f"SELECT s.uid, SUM(s.{column}) AS v, COUNT(*) AS n FROM sessions s "
        f"WHERE {where} AND s.{column} IS NOT NULL AND s.{column} > 0 GROUP BY s.uid", args).fetchall()
    return [Row(uid=r["uid"], value=float(r["v"]), detail={"sessions": r["n"]}) for r in rows]


# --- the boards ----------------------------------------------------------------------------------

@board("distance-week-bike", "Distance this week", subtitle="Cycling", period="week",
       unit="distance", device="bike")
def _distance_week_bike(conn, since, until):
    return _sum(conn, "distance", since, until, "bike")


@board("distance-week-treadmill", "Distance this week", subtitle="Running and walking", period="week",
       unit="distance", device="treadmill")
def _distance_week_treadmill(conn, since, until):
    return _sum(conn, "distance", since, until, "treadmill")


@board("climb-week-bike", "Climbing this week", subtitle="Metres of hill, cycling", period="week",
       unit="elevation", device="bike")
def _climb_week_bike(conn, since, until):
    return _sum(conn, "elevation_gain", since, until, "bike")


@board("energy-week", "Calories this week", subtitle="Every game, both machines", period="week", unit="energy")
def _energy_week(conn, since, until):
    return _sum(conn, "energy", since, until)


@board("sessions-all", "Most sessions", subtitle="All time", unit="count")
def _sessions_all(conn, since, until):
    where, args = _window(since, until)
    rows = conn.execute(f"SELECT s.uid, COUNT(*) AS n, SUM(s.distance) AS d FROM sessions s "
                        f"WHERE {where} GROUP BY s.uid", args).fetchall()
    return [Row(uid=r["uid"], value=float(r["n"]), detail={"distance": r["d"]}) for r in rows]


@board("streak-all", "Longest streak", subtitle="Weeks in a row at their own goal", unit="weeks")
def _streak(conn, since, until):
    rows = conn.execute("SELECT uid, streak_length, streak_goal FROM users WHERE streak_length > 0").fetchall()
    return [Row(uid=r["uid"], value=float(r["streak_length"]), detail={"goal": r["streak_goal"]}) for r in rows]


@board("furthest-ride-week", "Furthest single ride", subtitle="One session, this week", period="week",
       unit="distance", device="bike")
def _furthest_ride_week(conn, since, until):
    where, args = _window(since, until)
    rows = conn.execute(
        f"SELECT s.uid, s.session_id, s.distance AS v FROM sessions s WHERE {where} AND s.device_type='bike' "
        f"AND s.distance > 0 ORDER BY s.uid, s.distance DESC", args).fetchall()
    best: dict[int, Any] = {}
    for r in rows:
        best.setdefault(r["uid"], r)
    return [Row(uid=r["uid"], value=float(r["v"]), session_id=r["session_id"]) for r in best.values()]


@board("longest-session-month", "Longest session", subtitle="One sitting, this month", period="month",
       unit="duration")
def _longest_session_month(conn, since, until):
    where, args = _window(since, until)
    rows = conn.execute(
        f"SELECT s.uid, s.session_id, MAX(s.duration) AS v FROM sessions s WHERE {where} AND s.duration > 0 "
        f"GROUP BY s.uid", args).fetchall()
    return [Row(uid=r["uid"], value=float(r["v"]), session_id=r["session_id"]) for r in rows]


@board("achievements-all", "Most achievements", subtitle="Everything every game hands out", unit="count")
def _achievements(conn, since, until):
    rows = conn.execute("SELECT uid, achievements FROM users").fetchall()
    out = []
    for r in rows:
        ach = loads(r["achievements"])
        if isinstance(ach, dict) and ach:
            out.append(Row(uid=r["uid"], value=float(len(ach))))
    return out


@board("explorer-all", "Most games played", subtitle="Different games finished at least once", unit="count")
def _explorer(conn, since, until):
    where, args = _window(since, until)
    rows = conn.execute(f"SELECT s.uid, COUNT(DISTINCT s.game_id) AS n, "
                        f"GROUP_CONCAT(DISTINCT s.game_id) AS games FROM sessions s WHERE {where} "
                        f"GROUP BY s.uid", args).fetchall()
    return [Row(uid=r["uid"], value=float(r["n"]), detail={"games": (r["games"] or "").split(",")})
            for r in rows]


# How many sessions make up each half of the "most improved" comparison.
IMPROVED_HALF = 5


@board("improved-all", "Most improved", subtitle="Recent rides against the ones before, in watts",
       unit="number")
def _improved(conn, since, until):
    """The percentage between the average power of a player's last five rides and the five before them.
    Needs ten rides, so it is a board people arrive at rather than start on."""
    rows = conn.execute(
        "SELECT uid, avg_power FROM sessions WHERE status='complete' AND debug=0 AND device_type='bike' "
        "AND avg_power > 0 AND duration >= ? ORDER BY uid, started_at DESC", (MIN_RIDE,)).fetchall()
    by_uid: dict[int, list[float]] = {}
    for r in rows:
        by_uid.setdefault(r["uid"], []).append(float(r["avg_power"]))
    out = []
    for uid, powers in by_uid.items():
        if len(powers) < IMPROVED_HALF * 2:
            continue
        recent = powers[:IMPROVED_HALF]
        before = powers[IMPROVED_HALF:IMPROVED_HALF * 2]
        base = sum(before) / len(before)
        if base <= 0:
            continue
        gain = (sum(recent) / len(recent) - base) / base * 100.0
        if gain > 0:
            out.append(Row(uid=uid, value=round(gain, 1),
                           detail={"from": round(base, 1), "to": round(sum(recent) / len(recent), 1)}))
    return out


@board("steepest-month", "Steepest rider", subtitle="Metres climbed for every kilometre, cycling",
       period="month", unit="number", device="bike")
def _steepest(conn, since, until):
    where, args = _window(since, until)
    rows = conn.execute(
        f"SELECT s.uid, SUM(s.elevation_gain) AS climb, SUM(s.distance) AS dist FROM sessions s "
        f"WHERE {where} AND s.device_type='bike' AND s.elevation_gain IS NOT NULL AND s.distance > 0 "
        f"GROUP BY s.uid", args).fetchall()
    out = []
    for r in rows:
        km = (r["dist"] or 0) / 1000.0
        # A single hilly kilometre is not a climbing habit.
        if km >= 10 and r["climb"]:
            out.append(Row(uid=r["uid"], value=round(float(r["climb"]) / km, 1),
                           detail={"climb": r["climb"], "distance": r["dist"]}))
    return out


def _by_local_hour(conn: sqlite3.Connection, since: float | None, until: float | None,
                   keep) -> list[Row]:
    """Sessions counted by the hour they began **where the player lives** — an early start in Lisbon and an
    early start in Auckland are both early."""
    where, args = _window(since, until)
    rows = conn.execute(f"SELECT s.uid, s.started_at, u.time_zone FROM sessions s JOIN users u ON u.uid=s.uid "
                        f"WHERE {where} AND s.started_at IS NOT NULL", args).fetchall()
    counts: dict[int, int] = {}
    for r in rows:
        t = parse_iso(r["started_at"])
        if t is None:
            continue
        hour = datetime.fromtimestamp(t, tz=weeks.zone(r["time_zone"])).hour
        if keep(hour):
            counts[r["uid"]] = counts.get(r["uid"], 0) + 1
    return [Row(uid=uid, value=float(n)) for uid, n in counts.items() if n > 0]


@board("earlybird-month", "Early birds", subtitle="Sessions begun before 7 in the morning", period="month",
       unit="count")
def _earlybird(conn, since, until):
    return _by_local_hour(conn, since, until, lambda h: h < 7)


@board("nightowl-month", "Night owls", subtitle="Sessions begun after 9 at night", period="month", unit="count")
def _nightowl(conn, since, until):
    return _by_local_hour(conn, since, until, lambda h: h >= 21)


# --- boards a game declares ----------------------------------------------------------------------
# metadata.json `stats: {key: {label, better, leaderboard: true}}` (§18.2). `better: higher` totals the
# stat over every session; `better: lower` takes the best single session, which is the only way a
# lower-is-better number makes sense as a board.

STAT_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}$")
# A session too short to be a fair best-of: a 30-second ride with no crashes is not a record.
STAT_MIN_DURATION = 300.0


def stat_boards(catalog) -> list[Board]:
    out: list[Board] = []
    for game in sorted(catalog.public_games(), key=lambda g: g["id"]):
        for key, spec in sorted((game.get("stats") or {}).items()):
            if not spec.get("leaderboard") or not STAT_KEY.match(key):
                continue
            lower = spec.get("better") == "lower"
            label = spec.get("label") or key
            out.append(Board(
                id=f"stat-{game['id']}-{key}", title=f"{label} in {game['name']}",
                subtitle="Best session" if lower else "All time",
                period="all", unit=spec.get("unit") or "number", device=None, lower_is_better=lower,
                fn=_stat_fn(game["id"], key, lower)))
    return out


def _stat_fn(game_id: str, key: str, lower: bool):
    def fn(conn: sqlite3.Connection, since: float | None, until: float | None) -> list[Row]:
        where, args = _window(since, until)
        where += " AND s.game_id=? AND v IS NOT NULL"
        args.append(game_id)
        agg = "MIN(v)" if lower else "SUM(v)"
        if lower:
            where += " AND s.duration >= ?"
            args.append(STAT_MIN_DURATION)
        rows = conn.execute(
            f"SELECT uid, {agg} AS value, session_id FROM ("
            f"  SELECT s.uid, s.session_id, json_extract(s.stats, '$.{key}') AS v, s.duration, s.status,"
            f"         s.debug, s.started_at, s.game_id FROM sessions s) s "
            f"WHERE {where} GROUP BY uid", args).fetchall()
        out = []
        for r in rows:
            v = r["value"]
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out.append(Row(uid=r["uid"], value=float(v), session_id=r["session_id"] if lower else None))
        return out
    return fn


def all_boards(catalog=None) -> list[Board]:
    return [*REGISTRY.values(), *(stat_boards(catalog) if catalog is not None else [])]


def get(bid: str, catalog=None) -> Board | None:
    b = REGISTRY.get(bid)
    if b is not None:
        return b
    for cand in stat_boards(catalog) if catalog is not None else []:
        if cand.id == bid:
            return cand
    return None


# --- computing -----------------------------------------------------------------------------------

def compute(conn: sqlite3.Connection, b: Board, period_key: str | None = None) -> int:
    """Run one board and replace its stored rows. Returns how many rows it has."""
    key = period_key or b.period_key()
    since, until = b.bounds(key)
    rows = [r for r in b.fn(conn, since, until) if r.value is not None]
    rows.sort(key=lambda r: r.value, reverse=not b.lower_is_better)
    public = {r["uid"] for r in conn.execute("SELECT uid FROM users WHERE public=1")}
    t = iso()
    conn.execute("DELETE FROM leaderboards WHERE board=? AND period_key=?", (b.id, key))
    rank = 0
    for r in rows:
        if r.uid in public:
            rank += 1
        conn.execute(
            "INSERT INTO leaderboards(board, period_key, rank, uid, value, session_id, detail, computed_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (b.id, key, rank if r.uid in public else 0, r.uid, r.value, r.session_id, dumps(r.detail), t))
    conn.commit()
    return len(rows)


def compute_all(conn: sqlite3.Connection, catalog=None) -> dict[str, int]:
    """Every board, for its current period. Cheap at this scale: a few queries over a few hundred rows."""
    return {b.id: compute(conn, b) for b in all_boards(catalog)}


def rows_for(conn: sqlite3.Connection, b: Board, viewer_uid: int, period_key: str | None = None,
             limit: int = 100) -> list[dict[str, Any]]:
    """A board's rows with each player's name, for the console. A private player sees their own row and
    nobody else's; everybody else sees the ranked (public) rows."""
    key = period_key or b.period_key()
    rows = conn.execute(
        "SELECT l.*, u.username, u.display_name, u.first_name, u.last_name, u.country, u.public, u.thumb_file "
        "FROM leaderboards l JOIN users u ON u.uid=l.uid WHERE l.board=? AND l.period_key=? "
        "AND (l.rank > 0 OR l.uid=?) ORDER BY l.rank=0, l.rank LIMIT ?",
        (b.id, key, viewer_uid, max(1, min(limit, 500)))).fetchall()
    out = []
    for r in rows:
        out.append({"rank": r["rank"] or None, "uid": r["uid"], "username": r["username"],
                    "displayName": r["display_name"], "firstName": r["first_name"], "lastName": r["last_name"],
                    "country": r["country"], "value": r["value"], "sessionId": r["session_id"],
                    "detail": loads(r["detail"]), "me": r["uid"] == viewer_uid,
                    "thumbnailUrl": f"/api/profiles/{r['username']}/thumbnail" if r["thumb_file"] else None})
    return out
