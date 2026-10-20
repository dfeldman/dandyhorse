"""Who a private player is, on a page other people can see (PLAN.md §18.7).

Three states, and the player picks:

- **public** — their name, their flag and their picture, linking to their profile;
- **private** — their pseudonym, or "Anonymous 104" if they have not chosen one. Ranked like anybody else,
  because a board that quietly leaves people out is a lie, but carrying nothing that identifies them;
- **private and unlisted** — not on the boards at all, beyond their own row shown to themselves.

An anonymous row is built here rather than at each call site, so there is one place to be sure about: no
username, no account number, no country, no picture, and no session id (a session id is a ULID, so it would
give away when they rode). Only a rank and a number.

The fallback number is a counter, not anything derived from the account, so it is unique, stable, and says
nothing. It is handed out the first time it is needed.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

# Three digits reads better than "Anonymous 1", and leaves room below for anything wanting a reserved number.
FIRST = 101

PSEUDONYM_MAX = 24
# Letters, digits, spaces and a few marks. No "@", so a pseudonym can never be read as a username.
PSEUDONYM = re.compile(r"^[\w .'’-]{2,24}$", re.UNICODE)


def number_for(conn: sqlite3.Connection, uid: int) -> int:
    """This player's number, assigning one if they have never needed it before."""
    row = conn.execute("SELECT anon_id FROM users WHERE uid=?", (uid,)).fetchone()
    if row is not None and row["anon_id"]:
        return int(row["anon_id"])
    top = conn.execute("SELECT MAX(anon_id) AS m FROM users").fetchone()["m"] or (FIRST - 1)
    n = max(FIRST, int(top) + 1)
    conn.execute("UPDATE users SET anon_id=? WHERE uid=?", (n, uid))
    conn.commit()
    return n


def name_for(conn: sqlite3.Connection, uid: int, pseudonym: str | None = None) -> str:
    """What to call them: the name they chose to be known by, else their number."""
    chosen = (pseudonym or "").strip()
    return chosen if chosen else f"Anonymous {number_for(conn, uid)}"


def valid_pseudonym(value: str) -> bool:
    return bool(PSEUDONYM.fullmatch(value.strip()))


def hidden_from_boards(preferences: Any) -> bool:
    """`preferences.hideFromLeaderboards`: off the boards altogether, not merely unnamed."""
    return bool(isinstance(preferences, dict) and preferences.get("hideFromLeaderboards"))


def row_view(conn: sqlite3.Connection, row: Any) -> dict[str, Any]:
    """The parts of a leaderboard row that say who somebody is — and, for a private player, the parts that
    say nothing. Callers add the rank and the value."""
    d = dict(row)
    if d.get("public"):
        u = d["username"]
        return {
            "uid": d["uid"], "username": u, "displayName": d.get("display_name"),
            "firstName": d.get("first_name") or "", "lastName": d.get("last_name") or "",
            "country": (d.get("country") or "").upper(),
            "thumbnailUrl": f"/api/profiles/{u}/thumbnail" if d.get("thumb_file") else None,
            "anonymous": False,
        }
    # Everything here is deliberately absent. Adding a field to this branch tells people something about
    # somebody who asked not to be known.
    return {
        "uid": None, "username": None, "displayName": name_for(conn, d["uid"], d.get("pseudonym")),
        "firstName": "", "lastName": "", "country": "", "thumbnailUrl": None,
        "anonymous": True,
    }
