"""The strip at the top of the Games page: where you are this week, and one thing to do about it.

This exists because the console's first screen used to be a grid of games and nothing else, which tells a
returning player nothing about themselves. The numbers here are all ones the platform already keeps — this
module only gathers and phrases them.

The nudge is chosen by `_nudge`, and the ordering of its cases is the whole design: the most actionable
thing a player could do right now wins. "You are one session from keeping your streak" beats "you are 3rd
on a board", because one is a thing to do this evening and the other is a fact.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from ..util import now as _now
from . import bests, feed, fitness, notices, weeks

# How far back the SQL scan reaches before Python picks out the local week. Comfortably more than one
# week in any time zone, and small enough that the scan stays cheap.
LOOKBACK_DAYS = 15


def summary(conn: sqlite3.Connection, uid: int) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if row is None:
        return {}
    d = dict(row)
    tz = d.get("time_zone")
    t = _now()
    this_week = weeks.week_key(t, tz)

    week = _this_week(conn, uid, tz, this_week)
    goal = int(d.get("streak_goal") or 0)
    streak = int(d.get("streak_length") or 0)
    standing = _best_rank(conn, uid)

    return {
        "week": week,
        "weekKey": this_week,
        "goal": goal,
        "streak": streak,
        "fitness": fitness.watts_of(row),
        "best": standing,
        "bests": bests.for_player(conn, uid),
        # One badge for everything waiting: a cheer and being passed both mean "somebody look".
        "unseenCheers": (feed.unseen_cheers(conn, uid, d.get("cheers_seen_at"))
                         + notices.unseen(conn, uid, d.get("notices_seen_at"))),
        "nudge": _nudge(week, goal, streak, standing),
    }


def _this_week(conn: sqlite3.Connection, uid: int, tz: str | None, this_week: str) -> dict[str, Any]:
    """What they have done in the week they are living in — counted by local week, not by "last 7 days",
    because the goal they set is "sessions a week" and the two disagree every Sunday night."""
    floor = (datetime.now(tz=timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat().replace("+00:00", "Z")
    rows = conn.execute(
        "SELECT created_at, distance, duration, energy, elevation_gain FROM sessions "
        "WHERE uid=? AND status='complete' AND debug=0 AND created_at >= ?", (uid, floor)).fetchall()
    week = {"sessions": 0, "distance": 0.0, "duration": 0.0, "energy": 0.0, "climb": 0.0}
    for r in rows:
        if weeks.week_key(_epoch(r["created_at"]), tz) != this_week:
            continue
        week["sessions"] += 1
        week["distance"] += r["distance"] or 0
        week["duration"] += r["duration"] or 0
        week["energy"] += r["energy"] or 0
        week["climb"] += r["elevation_gain"] or 0
    return week


def _epoch(iso_text: str) -> float:
    try:
        return datetime.fromisoformat(str(iso_text).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _best_rank(conn: sqlite3.Connection, uid: int) -> dict[str, Any] | None:
    """The board they are doing best on. Their proudest number, whatever it happens to be about."""
    row = conn.execute(
        "SELECT board, period_key, rank, value FROM leaderboards WHERE uid=? ORDER BY rank LIMIT 1",
        (uid,)).fetchone()
    if row is None:
        return None
    return {"board": row["board"], "periodKey": row["period_key"],
            "rank": int(row["rank"]), "value": row["value"]}


def _nudge(week: dict[str, Any], goal: int, streak: int, standing: dict[str, Any] | None) -> dict[str, str]:
    """One line, and a word for the button beside it. Ordered by what is most worth doing now."""
    done = int(week["sessions"])
    if goal and done >= goal:
        # Past the goal, "3 of 2" reads like a mistake, so the count stands on its own.
        count = f"{done} session{'s' if done != 1 else ''} this week"
        met = f"that is your goal of {goal}" if done == goal else f"past your goal of {goal}"
        kept = f", and a {streak}-week streak kept" if streak else ""
        return {"text": f"{count} — {met}{kept}.", "action": "ride", "tone": "good"}
    if goal and done == goal - 1:
        return {"text": f"One more session this week and you keep a {streak + 1}-week streak.",
                "action": "ride", "tone": "urgent"}
    if goal:
        left = goal - done
        return {"text": f"{done} of {goal} sessions this week. {left} to go.",
                "action": "ride", "tone": "normal"}
    if done:
        return {"text": f"{done} session{'s' if done != 1 else ''} this week. Set a weekly goal and it "
                        f"becomes a streak.", "action": "goal", "tone": "normal"}
    if standing and standing["rank"] <= 3:
        return {"text": f"You are {standing['rank']} on a leaderboard. Ride this week and stay there.",
                "action": "ride", "tone": "normal"}
    return {"text": "Nothing this week yet. One session is enough to start a streak.",
            "action": "ride", "tone": "normal"}
