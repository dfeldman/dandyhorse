"""The status timeline (PLAN.md §18.1, §18.2).

Every profile has a timeline. A player writes to it themselves, and the platform writes to it when
something happens: a session finishes, a streak grows, an achievement is earned. A session's line is
composed *by the game* — only Cycle Dash knows that six cars were hit — and sent with `endsession`
as `message`. Games that send nothing get the plain line `_plain()` writes.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from ..util import dumps, iso, loads, ulid

TEXT_MAX = 280
KINDS = ("manual", "session", "streak", "achievement")


def post(conn: sqlite3.Connection, uid: int, kind: str, text: str, *, game_id: str | None = None,
         session_id: str | None = None, data: dict[str, Any] | None = None, t: float | None = None) -> dict[str, Any]:
    """One update. `t` backdates it, which the bots need (§18.8); the id is a ULID for that instant, so the
    timeline stays in order."""
    uid_ = int(uid)
    row = {"update_id": ulid(t), "uid": uid_, "kind": kind, "text": text.strip()[:TEXT_MAX],
           "game_id": game_id, "session_id": session_id, "data": dumps(data or {}), "created_at": iso(t)}
    conn.execute("INSERT INTO profile_updates(update_id, uid, kind, text, game_id, session_id, data, created_at) "
                 "VALUES (:update_id,:uid,:kind,:text,:game_id,:session_id,:data,:created_at)", row)
    conn.commit()
    return view(row)


def view(row: Any, cheers: int = 0, cheered: bool = False) -> dict[str, Any]:
    d = dict(row)
    return {"id": d["update_id"], "uid": d["uid"], "kind": d["kind"], "text": d["text"],
            "gameId": d["game_id"], "sessionId": d["session_id"], "data": loads(d["data"]),
            "createdAt": d["created_at"],
            # "Ride on": how many people cheered this, and whether you are one of them.
            "cheers": cheers, "cheered": cheered}


def timeline(conn: sqlite3.Connection, uid: int, limit: int = 30, before: str | None = None,
             viewer_uid: int | None = None) -> list[dict[str, Any]]:
    args: list[Any] = [uid]
    where = "uid=?"
    if before:
        where += " AND update_id < ?"
        args.append(before)
    rows = conn.execute(f"SELECT * FROM profile_updates WHERE {where} ORDER BY update_id DESC LIMIT ?",
                        (*args, max(1, min(limit, 200)))).fetchall()
    if not rows:
        return []
    ids = [r["update_id"] for r in rows]
    marks = ",".join("?" * len(ids))
    counts = {r["update_id"]: r["n"] for r in conn.execute(
        f"SELECT update_id, COUNT(*) AS n FROM update_cheers WHERE update_id IN ({marks}) GROUP BY update_id",
        ids)}
    mine: set[str] = set()
    if viewer_uid is not None:
        mine = {r["update_id"] for r in conn.execute(
            f"SELECT update_id FROM update_cheers WHERE uid=? AND update_id IN ({marks})", (viewer_uid, *ids))}
    return [view(r, counts.get(r["update_id"], 0), r["update_id"] in mine) for r in rows]


def cheer(conn: sqlite3.Connection, viewer_uid: int, update_id: str) -> dict[str, Any]:
    """Toggle a "ride on" (PLAN.md §18.6). One per player per update; cheering your own is allowed — it is
    a nicer way of saying "yes, that happened" than a reply nobody reads."""
    row = conn.execute("SELECT uid FROM profile_updates WHERE update_id=?", (update_id,)).fetchone()
    if row is None:
        return {"found": False}
    had = conn.execute("SELECT 1 FROM update_cheers WHERE update_id=? AND uid=?",
                       (update_id, viewer_uid)).fetchone() is not None
    if had:
        conn.execute("DELETE FROM update_cheers WHERE update_id=? AND uid=?", (update_id, viewer_uid))
    else:
        conn.execute("INSERT INTO update_cheers(update_id, uid, created_at) VALUES (?,?,?)",
                     (update_id, viewer_uid, iso()))
    conn.commit()
    n = conn.execute("SELECT COUNT(*) AS n FROM update_cheers WHERE update_id=?", (update_id,)).fetchone()["n"]
    return {"found": True, "cheers": n, "cheered": not had}


def delete(conn: sqlite3.Connection, uid: int, update_id: str) -> bool:
    cur = conn.execute("DELETE FROM profile_updates WHERE update_id=? AND uid=?", (update_id, uid))
    conn.commit()
    return cur.rowcount > 0


def _plain(summary: dict[str, Any], game_name: str) -> str:
    """The line for a game that sent none: distance if there is any, else how long they were at it."""
    km = (summary.get("distance") or 0) / 1000.0
    minutes = round((summary.get("duration") or 0) / 60.0)
    if km >= 0.1:
        return f"Rode {km:.1f} km in {game_name}." if summary.get("deviceType") == "bike" \
            else f"Covered {km:.1f} km in {game_name}."
    if minutes >= 1:
        return f"Put in {minutes} minute{'s' if minutes != 1 else ''} of {game_name}."
    return f"Played {game_name}."


def for_session(conn: sqlite3.Connection, uid: int, summary: dict[str, Any], game_name: str,
                message: str | None, stats: dict[str, Any] | None, t: float | None = None) -> dict[str, Any]:
    """Post a session's update: the game's own line, or a plain one."""
    text = (message or "").strip() or _plain(summary, game_name)
    data = {"distance": summary.get("distance"), "duration": summary.get("duration"),
            "energy": summary.get("energy"), "elevationGain": summary.get("elevationGain"),
            "deviceType": summary.get("deviceType"), "stats": stats or {}}
    return post(conn, uid, "session", text, game_id=summary.get("gameId"),
                session_id=summary.get("sessionId"), data=data, t=t)


def for_streak(conn: sqlite3.Connection, uid: int, weeks_long: int, goal: int,
               t: float | None = None) -> dict[str, Any] | None:
    """A milestone only: every week would drown the timeline."""
    if weeks_long < 2 or (weeks_long % 4 and weeks_long not in (2, 3)):
        return None
    text = f"{weeks_long} weeks in a row at {goal} session{'s' if goal != 1 else ''} a week."
    return post(conn, uid, "streak", text, data={"weeks": weeks_long, "goal": goal}, t=t)
