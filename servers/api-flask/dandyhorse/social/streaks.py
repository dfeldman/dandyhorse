"""Weekly streaks (PLAN.md §18.5).

A player picks a goal of 1, 2 or 3 sessions a week. Their streak is how many weeks in a row, counting back
from this one, met that goal. The week in progress counts as soon as it has met the goal and never breaks
the streak before it is over — nobody should watch their streak die on a Monday morning. Changing the goal
starts again from zero: `users.streak_from` holds the week it was set, and no week before it counts.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from ..util import iso, parse_iso
from . import weeks

GOALS = (1, 2, 3)
# No point walking back further than this; a streak longer than five years is not the problem we have.
MAX_WEEKS = 300


def week_counts(conn: sqlite3.Connection, uid: int, tz: str | None) -> dict[str, int]:
    """Complete, non-debug sessions per week key, in the player's own time zone."""
    rows = conn.execute(
        "SELECT started_at, created_at FROM sessions WHERE uid=? AND status='complete' AND debug=0",
        (uid,)).fetchall()
    counts: dict[str, int] = {}
    for r in rows:
        t = parse_iso(r["started_at"] or r["created_at"])
        if t is None:
            continue
        key = weeks.week_key(t, tz)
        counts[key] = counts.get(key, 0) + 1
    return counts


def length(counts: dict[str, int], goal: int, this_week: str, since: str = "") -> int:
    """Weeks in a row meeting `goal`, counting back from `this_week`; `since` is as far back as we may look."""
    if goal <= 0:
        return 0
    key = this_week
    n = 0
    # The week in progress only adds to the streak; falling short of the goal in it changes nothing yet.
    if counts.get(key, 0) >= goal:
        n += 1
    for _ in range(MAX_WEEKS):
        key = weeks.week_before(key)
        if since and key < since:
            break
        if counts.get(key, 0) < goal:
            break
        n += 1
    return n


def recompute(conn: sqlite3.Connection, uid: int) -> int:
    """Recompute and store one player's streak. Returns its length."""
    row = conn.execute("SELECT streak_goal, streak_from, time_zone FROM users WHERE uid=?", (uid,)).fetchone()
    if row is None:
        return 0
    goal = int(row["streak_goal"] or 0)
    tz = row["time_zone"]
    n = 0 if goal <= 0 else length(week_counts(conn, uid, tz), goal, weeks.current_week(tz), row["streak_from"] or "")
    conn.execute("UPDATE users SET streak_length=?, updated_at=? WHERE uid=?", (n, iso(), uid))
    conn.commit()
    return n


def set_goal(conn: sqlite3.Connection, uid: int, goal: int, tz: str | None,
             from_the_start: bool = False) -> dict[str, Any]:
    """Change the goal: the streak starts again from this week (the owner's rule), then is recomputed — so a
    goal met already this week shows 1, not 0.

    `from_the_start` leaves no cutoff, so every week of the player's history counts. That is for bots
    (PLAN.md §18.8): their goal is part of who they are in `bots.json`, not something they changed this
    week, and their rides are created *after* it is set, so the ordinary rule would hold them at zero
    for ever.
    """
    since = "" if from_the_start or not goal else weeks.current_week(tz)
    conn.execute("UPDATE users SET streak_goal=?, streak_length=0, streak_from=?, updated_at=? WHERE uid=?",
                 (goal, since, iso(), uid))
    conn.commit()
    return {"goal": goal, "length": recompute(conn, uid)}
