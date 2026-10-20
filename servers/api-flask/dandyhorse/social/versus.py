"""You against one other player (PLAN.md §18.6).

A profile without this is a page of somebody else's numbers: you can read that Priya holds 216 W and
rode four times this week, and it tells you nothing, because the question anybody actually has when they
open another rider's profile on a competitive platform is "how do I compare?". This answers it.

Three kinds of comparison, because they motivate differently:

- **the measures** — steady watts, this week's sessions, the streak: who is ahead, and by how much;
- **the boards you are both on** — the one place a direct ranking already exists and is already fair;
- **the games you have both finished** — your best against theirs, which is the comparison people
  actually argue about.

It is deliberately not a score. Totting the whole thing up into "you are 62% of Priya" would be both
meaningless and discouraging; a list of where each of you is ahead gives somebody something to go and do.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from . import boards as board_registry, fitness, weeks
from ..util import now as _now

# A game you both merely opened once is not a rivalry. Both of you need a session worth comparing.
MIN_DURATION = 240.0
# At most this many games in the list, the ones you have played most between you.
GAMES = 8


def _week_sessions(conn: sqlite3.Connection, uid: int, tz: str | None, key: str) -> int:
    rows = conn.execute(
        "SELECT created_at FROM sessions WHERE uid=? AND status='complete' AND debug=0 "
        "AND created_at >= datetime('now', '-15 days')", (uid,)).fetchall()
    return sum(1 for r in rows if weeks.week_key(_epoch(r["created_at"]), tz) == key)


def _epoch(iso_text: str) -> float:
    try:
        return datetime.fromisoformat(str(iso_text).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _measure(label: str, mine: float, theirs: float, unit: str, *, higher_is_better: bool = True) -> dict[str, Any]:
    lead = mine - theirs if higher_is_better else theirs - mine
    return {"label": label, "mine": mine, "theirs": theirs, "unit": unit,
            "leader": "me" if lead > 0 else "them" if lead < 0 else "level"}


def _best_per_game(conn: sqlite3.Connection, uid: int) -> dict[str, dict[str, Any]]:
    """The furthest this player has gone in each game, and how long it took."""
    rows = conn.execute(
        "SELECT game_id, distance, duration, created_at FROM sessions "
        "WHERE uid=? AND status='complete' AND debug=0 AND duration >= ?", (uid, MIN_DURATION)).fetchall()
    best: dict[str, dict[str, Any]] = {}
    for r in rows:
        g = r["game_id"]
        cur = best.get(g)
        if cur is None or (r["distance"] or 0) > cur["distance"]:
            best[g] = {"distance": r["distance"] or 0, "duration": r["duration"] or 0, "at": r["created_at"]}
    return best


def compare(conn: sqlite3.Connection, me_uid: int, them_row: sqlite3.Row, catalog=None) -> dict[str, Any]:
    """How the viewer stands against this player. Both rows must be ones the viewer may see."""
    me = conn.execute("SELECT * FROM users WHERE uid=?", (me_uid,)).fetchone()
    them = dict(them_row)
    if me is None or int(them["uid"]) == int(me_uid):
        return {"self": True, "measures": [], "boards": [], "games": []}

    tz = me["time_zone"]
    this_week = weeks.week_key(_now(), tz)
    measures = [
        _measure("Steady power", round(fitness.watts_of(me), 1), round(fitness.watts_of(them_row), 1), "W"),
        _measure("Sessions this week", _week_sessions(conn, me_uid, tz, this_week),
                 _week_sessions(conn, int(them["uid"]), them.get("time_zone"), this_week), "sessions"),
        _measure("Streak", int(me["streak_length"] or 0), int(them.get("streak_length") or 0), "weeks"),
    ]

    # Boards you are both ranked on. `leaderboards` already holds the computed ranks.
    rows = conn.execute(
        "SELECT a.board, a.rank AS my_rank, b.rank AS their_rank, a.period_key "
        "FROM leaderboards a JOIN leaderboards b ON a.board = b.board AND a.period_key = b.period_key "
        "WHERE a.uid = ? AND b.uid = ? ORDER BY a.rank", (me_uid, int(them["uid"]))).fetchall()
    boards = []
    for r in rows:
        b = board_registry.get(r["board"], catalog)
        boards.append({"board": r["board"], "title": b.title if b else r["board"],
                       "myRank": int(r["my_rank"]), "theirRank": int(r["their_rank"]),
                       "leader": "me" if r["my_rank"] < r["their_rank"] else
                                 "them" if r["their_rank"] < r["my_rank"] else "level"})

    # Games you have both finished a real session of.
    mine_best, theirs_best = _best_per_game(conn, me_uid), _best_per_game(conn, int(them["uid"]))
    shared = sorted(set(mine_best) & set(theirs_best),
                    key=lambda g: -(mine_best[g]["distance"] + theirs_best[g]["distance"]))[:GAMES]
    games = []
    for g in shared:
        game = catalog.game(g) if catalog else None
        games.append({"gameId": g, "gameName": (game or {}).get("name") or g,
                      "mine": mine_best[g], "theirs": theirs_best[g],
                      "leader": "me" if mine_best[g]["distance"] > theirs_best[g]["distance"]
                                else "them" if theirs_best[g]["distance"] > mine_best[g]["distance"] else "level"})

    ahead = sum(1 for m in measures + boards + games if m["leader"] == "me")
    behind = sum(1 for m in measures + boards + games if m["leader"] == "them")
    return {"self": False, "measures": measures, "boards": boards, "games": games,
            "ahead": ahead, "behind": behind}
