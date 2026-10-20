"""The platform's activity feed: what everybody has been doing (PLAN.md §18.2).

A profile's timeline answers "what has *this* person been up to"; the feed answers "what is going on here",
which is the question somebody has when they open the app and have not ridden yet. It is the same
`profile_updates` rows, read across players instead of down one.

**Private players are not in it at all.** That is a deliberate difference from the leaderboards, where a
private player is ranked under a pseudonym: a board that quietly left people out would be a lie about who
is fastest, so there they stay, unnamed. A feed ranks nothing, so leaving somebody out says nothing untrue
— and a feed entry is far harder to anonymise than a board row. Its text is written by the game and may
name anybody ("beat Kenji on the last climb"), and its timestamp says exactly when somebody rode, which on
a quiet platform is identifying by itself. So the rule here is the simple one, and `visible_uids` is the
single place that decides it.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from ..util import loads
from . import follows

# A feed page. Enough to fill a screen and scroll a little, not enough to be a bandwidth decision.
PAGE = 25


def visible_uids(conn: sqlite3.Connection, viewer_uid: int) -> list[int]:
    """Whose updates may appear in the feed: every public player, and you (so your own ride shows up the
    moment you finish it, whatever your privacy settings)."""
    rows = conn.execute("SELECT uid FROM users WHERE public=1 OR uid=?", (viewer_uid,)).fetchall()
    return [int(r["uid"]) for r in rows]


def recent(conn: sqlite3.Connection, viewer_uid: int, limit: int = PAGE,
           before: str | None = None, uid: int | None = None,
           only_following: bool = False) -> list[dict[str, Any]]:
    """The latest updates across the platform, newest first.

    `before` is the id of the oldest row you already have, for the next page — ids are ULIDs, so ordering
    by id is ordering by time and a page boundary needs no second column. `uid` narrows it to one player;
    `only_following` narrows it to the people the viewer follows, and to the viewer, so their own ride
    still appears the moment they finish it.
    """
    allowed = visible_uids(conn, viewer_uid)
    if only_following:
        mine = set(follows.following(conn, viewer_uid)) | {int(viewer_uid)}
        allowed = [u for u in allowed if u in mine]
    if uid is not None:
        allowed = [u for u in allowed if u == uid]
    if not allowed:
        return []
    marks = ",".join("?" * len(allowed))
    args: list[Any] = [*allowed]
    where = f"u.uid IN ({marks})"
    if before:
        where += " AND p.update_id < ?"
        args.append(before)
    rows = conn.execute(
        f"SELECT p.*, u.username, u.display_name, u.first_name, u.last_name, u.country, u.thumb_file "
        f"FROM profile_updates p JOIN users u ON u.uid = p.uid "
        f"WHERE {where} ORDER BY p.update_id DESC LIMIT ?",
        (*args, max(1, min(limit, 100)))).fetchall()
    if not rows:
        return []

    ids = [r["update_id"] for r in rows]
    holes = ",".join("?" * len(ids))
    counts = {r["update_id"]: r["n"] for r in conn.execute(
        f"SELECT update_id, COUNT(*) AS n FROM update_cheers WHERE update_id IN ({holes}) GROUP BY update_id",
        ids)}
    mine = {r["update_id"] for r in conn.execute(
        f"SELECT update_id FROM update_cheers WHERE uid=? AND update_id IN ({holes})", (viewer_uid, *ids))}
    return [_entry(r, counts.get(r["update_id"], 0), r["update_id"] in mine, viewer_uid) for r in rows]


def _entry(row: Any, cheers: int, cheered: bool, viewer_uid: int) -> dict[str, Any]:
    """One feed line: the update, and enough of the player to show a face and a name beside it.

    Everybody here is public (or the viewer), so this carries their name on purpose — see the module
    docstring for why a private player never reaches this function.
    """
    d = dict(row)
    u = d["username"]
    return {
        "id": d["update_id"], "kind": d["kind"], "text": d["text"],
        "gameId": d["game_id"], "sessionId": d["session_id"], "data": loads(d["data"]),
        "createdAt": d["created_at"],
        "cheers": cheers, "cheered": cheered,
        "player": {
            "uid": d["uid"], "username": u, "displayName": d.get("display_name"),
            "firstName": d.get("first_name") or "", "lastName": d.get("last_name") or "",
            "country": (d.get("country") or "").upper(),
            "thumbnailUrl": f"/api/profiles/{u}/thumbnail" if d.get("thumb_file") else None,
            "me": int(d["uid"]) == int(viewer_uid),
        },
    }


def cheers_received(conn: sqlite3.Connection, uid: int, limit: int = PAGE,
                    before: str | None = None) -> list[dict[str, Any]]:
    """Who has cheered your updates, newest first (PLAN.md §18.6).

    Encouragement nobody ever sees is wasted, and until this there was no way to find out somebody had
    cheered you except by scrolling your own timeline counting thumbs. A cheer from a private player is
    counted but not named: they get to stay private even while being kind.
    """
    args: list[Any] = [uid]
    where = "p.uid = ?"
    if before:
        where += " AND c.rowid < ?"
        args.append(before)
    rows = conn.execute(
        f"SELECT c.rowid AS mark, c.created_at, c.uid AS uid, "   # `uid` is what anon.row_view reads
        
        f"       p.update_id, p.text, p.kind, p.game_id, "
        f"       u.username, u.display_name, u.first_name, u.last_name, u.country, u.thumb_file, "
        f"       u.public, u.pseudonym "
        f"FROM update_cheers c "
        f"JOIN profile_updates p ON p.update_id = c.update_id "
        f"JOIN users u ON u.uid = c.uid "
        f"WHERE {where} AND c.uid <> ? "
        f"ORDER BY c.rowid DESC LIMIT ?",
        (*args, uid, max(1, min(limit, 100)))).fetchall()
    from . import anon
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        who = anon.row_view(conn, d)
        out.append({"mark": d["mark"], "at": d["created_at"], "from": who,
                    "updateId": d["update_id"], "text": d["text"], "kind": d["kind"],
                    "gameId": d["game_id"]})
    return out


def unseen_cheers(conn: sqlite3.Connection, uid: int, since: str | None) -> int:
    """How many cheers have arrived since the player last looked, for the badge on the nav."""
    if since:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM update_cheers c JOIN profile_updates p ON p.update_id = c.update_id "
            "WHERE p.uid=? AND c.uid<>? AND c.created_at > ?", (uid, uid, since)).fetchone()
    else:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM update_cheers c JOIN profile_updates p ON p.update_id = c.update_id "
            "WHERE p.uid=? AND c.uid<>?", (uid, uid)).fetchone()
    return int(row["n"] if row else 0)
