"""Things that happened *to* somebody (PLAN.md §18.2).

The feed says what everybody did; a notice says what somebody did to you. Being overtaken is the one
that actually makes people ride: a board you were third on is an abstraction until the moment Priya goes
past, and then it is personal.

Two rules keep this from becoming the thing people turn off:

- **only a real overtake.** Not "your rank changed" — somebody has to have been below you and now be
  above you. A board reshuffling because a stranger joined is not news.
- **once a day per board, per person.** The boards are recomputed every time anybody anywhere finishes a
  session, so without this one back-and-forth on a busy board would arrive as a dozen notices.

Private players never appear as the actor. They opted out of being visible, and "Anonymous 104 passed
you" tells the reader nothing while still leaking that a particular hidden person rode.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from ..util import dumps, iso, loads, now as _now, parse_iso, ulid

# How long before the same person overtaking you on the same board is worth saying again.
QUIET = 24 * 3600.0
PAGE = 25


def _recently_told(conn: sqlite3.Connection, uid: int, actor: int, board: str) -> bool:
    row = conn.execute(
        "SELECT created_at FROM notifications WHERE uid=? AND actor=? AND kind='passed' "
        "AND json_extract(data, '$.board')=? ORDER BY id DESC LIMIT 1", (uid, actor, board)).fetchone()
    if row is None:
        return False
    return (_now() - (parse_iso(row["created_at"]) or 0)) < QUIET


def overtaken(conn: sqlite3.Connection, board_id: str, title: str, period_key: str,
              before: dict[int, int], after: dict[int, int], public: set[int]) -> int:
    """Tell anybody who has just been passed on this board. `before`/`after` are uid -> rank.

    Only a crossing counts: the actor was below them — or not on the board at all, which for this
    purpose is the same thing — and is now above them, and both of their ranks are real (rank 0 is
    somebody who asked to be off the boards and is shown only to themselves).
    """
    told = 0
    for uid, new_rank in after.items():
        old_rank = before.get(uid)
        if not old_rank or not new_rank or new_rank <= old_rank:
            continue                                   # new to the board, hidden, or not worse off
        for actor, actor_new in after.items():
            if actor == uid or actor not in public:
                continue
            actor_old = before.get(actor)
            # Behind you before (or not there at all), ahead of you now: an overtake, not a reshuffle.
            was_behind = actor_old is None or actor_old == 0 or actor_old > old_rank
            if not actor_new or not was_behind or actor_new >= new_rank:
                continue
            if _recently_told(conn, uid, actor, board_id):
                continue
            name = conn.execute("SELECT first_name, display_name, username FROM users WHERE uid=?",
                                (actor,)).fetchone()
            who = (name["first_name"] or name["display_name"] or name["username"]) if name else "Somebody"
            conn.execute(
                "INSERT INTO notifications(id, uid, kind, actor, text, data, created_at) VALUES (?,?,?,?,?,?,?)",
                (ulid(), uid, "passed", actor, f"{who} passed you on {title}.",
                 dumps({"board": board_id, "periodKey": period_key, "title": title,
                        "yourRank": new_rank, "theirRank": actor_new}), iso()))
            told += 1
    if told:
        conn.commit()
    return told


def recent(conn: sqlite3.Connection, uid: int, limit: int = PAGE,
           before: str | None = None) -> list[dict[str, Any]]:
    args: list[Any] = [uid]
    where = "n.uid = ?"
    if before:
        where += " AND n.id < ?"
        args.append(before)
    rows = conn.execute(
        f"SELECT n.*, u.username, u.display_name, u.first_name, u.last_name, u.country, u.thumb_file "
        f"FROM notifications n LEFT JOIN users u ON u.uid = n.actor "
        f"WHERE {where} ORDER BY n.id DESC LIMIT ?", (*args, max(1, min(limit, 100)))).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        u = d.get("username")
        out.append({
            "id": d["id"], "kind": d["kind"], "text": d["text"], "data": loads(d["data"]),
            "at": d["created_at"],
            "from": None if not u else {
                "uid": d["actor"], "username": u, "displayName": d.get("display_name"),
                "firstName": d.get("first_name") or "", "lastName": d.get("last_name") or "",
                "country": (d.get("country") or "").upper(),
                "thumbnailUrl": f"/api/profiles/{u}/thumbnail" if d.get("thumb_file") else None,
                "anonymous": False,
            },
        })
    return out


def unseen(conn: sqlite3.Connection, uid: int, since: str | None) -> int:
    if since:
        row = conn.execute("SELECT COUNT(*) AS n FROM notifications WHERE uid=? AND created_at > ?",
                           (uid, since)).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) AS n FROM notifications WHERE uid=?", (uid,)).fetchone()
    return int(row["n"] if row else 0)
