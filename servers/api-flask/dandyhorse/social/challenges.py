"""Challenging somebody (PLAN.md §18.11).

Owner, 2026-10-20: *"I would like a way to 'challenge' a player though, which would just mean that in
your next game, they'd be one of your competitors on the leaderboard. It doesn't do anything
synchronously, it's not really multiplayer, and it's only stored for one session. You can challenge
multiple players."*

So this is the friendly end of the same urge the profile comparison was serving badly: rather than read a
list of ways somebody beats you, you put them in your next ride and find out. Nothing is sent to them,
nothing waits on them, and nothing persists.

**It lasts exactly one session.** A challenge is picked up when a session is finalized and then deleted,
whether or not that session turned out to have anything to compare. Anything else and a challenge made
one evening would quietly change a standing a fortnight later.

Challenges are not visible to the person challenged: being measured against is not something anybody has
to consent to, and telling them would turn a private "I want to beat Priya" into a provocation. For the
same reason a private player cannot be challenged — they are not in the standings anybody else reads.
"""
from __future__ import annotations

import sqlite3

from ..util import iso

# One ride against a crowd is not a ride against anybody. Past this the standing stops being personal.
MAX = 5


def add(conn: sqlite3.Connection, uid: int, target: int) -> bool:
    """Challenge somebody for your next session. False when they cannot be: private, gone, you, or you
    already have as many as a standing can usefully hold."""
    if int(uid) == int(target):
        return False
    row = conn.execute("SELECT public FROM users WHERE uid=?", (target,)).fetchone()
    if row is None or not row["public"]:
        return False
    if len(listed(conn, uid)) >= MAX and not challenged(conn, uid, target):
        return False
    conn.execute("INSERT OR IGNORE INTO challenges(uid, target, created_at) VALUES (?,?,?)",
                 (int(uid), int(target), iso()))
    conn.commit()
    return True


def remove(conn: sqlite3.Connection, uid: int, target: int) -> None:
    conn.execute("DELETE FROM challenges WHERE uid=? AND target=?", (int(uid), int(target)))
    conn.commit()


def challenged(conn: sqlite3.Connection, uid: int, target: int) -> bool:
    return conn.execute("SELECT 1 FROM challenges WHERE uid=? AND target=?",
                        (int(uid), int(target))).fetchone() is not None


def listed(conn: sqlite3.Connection, uid: int) -> list[int]:
    """Who this player has lined up, still public. Somebody who goes private drops out on their own."""
    rows = conn.execute(
        "SELECT c.target FROM challenges c JOIN users u ON u.uid = c.target "
        "WHERE c.uid = ? AND u.public = 1 ORDER BY c.created_at", (int(uid),)).fetchall()
    return [int(r["target"]) for r in rows]


def take(conn: sqlite3.Connection, uid: int) -> list[int]:
    """The challenges for the session just finished, cleared as they are taken: one session only."""
    out = listed(conn, uid)
    conn.execute("DELETE FROM challenges WHERE uid=?", (int(uid),))
    conn.commit()
    return out
