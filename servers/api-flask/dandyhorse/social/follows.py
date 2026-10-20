"""The people somebody is keeping an eye on (PLAN.md §18.2).

The feed was everyone or nothing, which works on a platform of ten and stops working on a platform of a
thousand: the handful of riders you actually care about — the friend you started with, the two people
just ahead of you on a board — scroll past between strangers. Following is the filter.

It is one-directional and needs no permission, like following rather than friending: you are choosing
what you want to read, not asking anything of them. Two consequences follow from that, and they are the
whole privacy design here:

- **you can only follow a public player.** A private player is not listed, not in the feed and not
  openable, so "following" them would be a way to keep a handle on somebody who has opted out.
- **nobody is told who follows them, and no follower list is public.** A count of your own following is
  yours to see; being followed is not something you are asked to consent to, so it is not something
  anybody gets to inspect. `followers()` exists for the owner's own count and nothing else reads it.
"""
from __future__ import annotations

import sqlite3

from ..util import iso


def follow(conn: sqlite3.Connection, uid: int, followed: int) -> bool:
    """Start following. False if they are private, gone, or you — the caller turns that into a 404/400."""
    if int(uid) == int(followed):
        return False
    row = conn.execute("SELECT public FROM users WHERE uid=?", (followed,)).fetchone()
    if row is None or not row["public"]:
        return False
    conn.execute("INSERT OR IGNORE INTO follows(uid, followed, created_at) VALUES (?,?,?)",
                 (int(uid), int(followed), iso()))
    conn.commit()
    return True


def unfollow(conn: sqlite3.Connection, uid: int, followed: int) -> None:
    conn.execute("DELETE FROM follows WHERE uid=? AND followed=?", (int(uid), int(followed)))
    conn.commit()


def is_following(conn: sqlite3.Connection, uid: int, followed: int) -> bool:
    return conn.execute("SELECT 1 FROM follows WHERE uid=? AND followed=?",
                        (int(uid), int(followed))).fetchone() is not None


def following(conn: sqlite3.Connection, uid: int) -> list[int]:
    """Who this player follows — and only those still public, so somebody who goes private disappears
    from their followers' feeds without anybody having to tidy up."""
    rows = conn.execute(
        "SELECT f.followed FROM follows f JOIN users u ON u.uid = f.followed "
        "WHERE f.uid = ? AND u.public = 1", (int(uid),)).fetchall()
    return [int(r["followed"]) for r in rows]


def followers(conn: sqlite3.Connection, uid: int) -> int:
    """How many people follow this player. For showing somebody their own number; see the module note."""
    row = conn.execute("SELECT COUNT(*) AS n FROM follows WHERE followed=?", (int(uid),)).fetchone()
    return int(row["n"] if row else 0)


def counts(conn: sqlite3.Connection, uid: int) -> dict[str, int]:
    return {"following": len(following(conn, uid)), "followers": followers(conn, uid)}
