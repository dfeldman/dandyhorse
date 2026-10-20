"""Personal bests, and noticing when somebody has just set one (PLAN.md §18.4).

A leaderboard tells you where you stand against other people, which is motivating right up until everybody
ahead of you is out of reach. A personal best is the other kind of progress: it only ever compares you with
yourself, so it is available to the slowest rider on the platform on their first good day.

The four here are the ones every session already measures, so no game has to opt in. They are deliberately
*not* rates — no average speed, no watts — because a best average speed rewards stopping early, and the
point of this is to reward riding more rather than riding cleverly.
"""
from __future__ import annotations

import sqlite3
from typing import Any

# column, what to call it, how to say it in an update, and the smallest value worth calling a record.
# The floors keep a first-ever two-minute test ride from announcing four personal bests at once.
BESTS: tuple[tuple[str, str, str, float], ...] = (
    ("distance", "Furthest ride", "the furthest you have ridden", 2000.0),
    ("duration", "Longest session", "your longest session yet", 900.0),
    ("elevation_gain", "Most climbing", "more climbing than you have done before", 100.0),
    ("energy", "Most energy", "more work than you have put in before", 200_000.0),
)

# A session has to beat the old mark by this much to count, so a rounding difference is not a "record".
MARGIN = 1.01


def _rows(conn: sqlite3.Connection, uid: int, before_id: str | None = None) -> list[sqlite3.Row]:
    where = "uid=? AND status='complete' AND debug=0"
    args: list[Any] = [uid]
    if before_id:
        where += " AND session_id <> ?"
        args.append(before_id)
    return conn.execute(
        f"SELECT session_id, game_id, distance, duration, elevation_gain, energy, created_at "
        f"FROM sessions WHERE {where}", args).fetchall()


def for_player(conn: sqlite3.Connection, uid: int) -> list[dict[str, Any]]:
    """Each best this player holds, with the session that set it. Bests they have not reached are left
    out rather than shown as zero: a row of noughts reads as failure, and an absent one as room."""
    rows = _rows(conn, uid)
    out: list[dict[str, Any]] = []
    for column, title, _phrase, floor in BESTS:
        best: sqlite3.Row | None = None
        for r in rows:
            v = r[column] or 0
            if v >= floor and (best is None or v > (best[column] or 0)):
                best = r
        if best is not None:
            out.append({"key": column, "title": title, "value": best[column] or 0,
                        "sessionId": best["session_id"], "gameId": best["game_id"],
                        "at": best["created_at"]})
    return out


def check(conn: sqlite3.Connection, uid: int, session: Any) -> list[dict[str, Any]]:
    """Which personal bests this session has just set.

    Compared against every *other* complete session, so it works whether it is called before or after the
    session itself has landed in the table.
    """
    d = dict(session)
    sid = d.get("session_id") or d.get("sessionId")
    others = _rows(conn, uid, before_id=sid)
    got: list[dict[str, Any]] = []
    for column, title, phrase, floor in BESTS:
        mine = d.get(column) or d.get(_camel(column)) or 0
        if not mine or mine < floor:
            continue
        previous = max((r[column] or 0) for r in others) if others else 0
        if previous and mine < previous * MARGIN:
            continue
        if not previous and len(others) < 1:
            # Their first ever session is not a "record"; it is just their first.
            continue
        got.append({"key": column, "title": title, "phrase": phrase,
                    "value": mine, "previous": previous})
    return got


def _camel(column: str) -> str:
    head, _, tail = column.partition("_")
    return head + tail.title() if tail else head


def line(got: list[dict[str, Any]]) -> str | None:
    """One sentence for the timeline, or none. Several bests at once become one line, not four."""
    if not got:
        return None
    if len(got) == 1:
        return f"A personal best: {got[0]['phrase']}."
    titles = [g["title"].lower() for g in got]
    return f"Personal bests: {', '.join(titles[:-1])} and {titles[-1]}."
