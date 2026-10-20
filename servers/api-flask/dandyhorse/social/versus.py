"""You against one other player, in one line (PLAN.md §18.11).

A profile with no comparison at all is a page of somebody else's numbers, when the question anybody
opens one with is "how do I compare?". But the first version of this answered it far too thoroughly —
board by board and game by game, eleven lines of who beat whom.

Owner, 2026-10-20: *"I don't love the head-to-head comparison on profile screens. Maybe a very limited
comparison. We don't want players all getting mad at each other. Maybe just show fitness level
comparison."* Which is right: a full ledger is an argument waiting to happen between two people who came
here to ride. Wanting to measure yourself against somebody is healthy; being handed a scoreboard of every
way they beat you is not.

So: steady power, yours against theirs, and nothing else. Anybody who wants the competitive version has
`challenges.py`, where you ride against them rather than read about them.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from . import boards as board_registry, fitness, weeks
from ..util import now as _now

def compare(conn: sqlite3.Connection, me_uid: int, them_row: sqlite3.Row) -> dict[str, Any]:
    """Steady power, yours against theirs. `self` when it is your own profile and there is nothing to say."""
    me = conn.execute("SELECT * FROM users WHERE uid=?", (me_uid,)).fetchone()
    if me is None or int(them_row["uid"]) == int(me_uid):
        return {"self": True}
    mine, theirs = round(fitness.watts_of(me), 1), round(fitness.watts_of(them_row), 1)
    # A couple of watts apart is the same rider on a different day, not a difference worth a verdict.
    gap = mine - theirs
    leader = "me" if gap > LEVEL else "them" if gap < -LEVEL else "level"
    return {"self": False, "mine": mine, "theirs": theirs, "unit": "W", "leader": leader}


# Inside this many watts, call it level: measured fitness moves by more than this between two rides.
LEVEL = 5.0
