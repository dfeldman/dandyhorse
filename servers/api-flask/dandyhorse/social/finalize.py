"""What happens to a profile when a session completes (PLAN.md §18).

One place, called from `lifecycle.end` for complete, non-debug sessions: the session's line goes on the
player's timeline, their measured fitness and streak are recomputed, and the leaderboards are rebuilt.
None of it may throw away a workout, so the caller runs it after the session row is safely written.
"""
from __future__ import annotations

import logging
import sqlite3
from typing import Any

from ..util import dumps
from . import bests, boards, challenges, fitness, streaks, updates

log = logging.getLogger("dandyhorse")


def after_session(dh, conn: sqlite3.Connection, uid: int, summary: dict[str, Any],
                  message: str | None, t: float | None = None) -> dict[str, Any]:
    game = dh.catalog.game(summary.get("gameId") or "") or {}
    name = game.get("name") or summary.get("gameId") or "a game"
    stats = summary.get("stats") or {}

    # Anybody they challenged is taken now and written against this session: a challenge lasts exactly
    # one session, and keeping it here is what makes the standing reproducible afterwards.
    taken = challenges.take(conn, uid)
    if taken:
        conn.execute("UPDATE sessions SET challenged=? WHERE session_id=?",
                     (dumps(taken), summary.get("sessionId")))
        conn.commit()

    update = updates.for_session(conn, uid, summary, name, message, stats, t=t)

    # Anything they have just done better than ever before. Checked before the timeline line for the
    # streak so that, on a day somebody does both, the best is the one nearer their session.
    records = bests.check(conn, uid, summary)
    best_update = None
    line = bests.line(records)
    if line:
        best_update = updates.post(conn, uid, "achievement", line,
                                   game_id=summary.get("gameId"), session_id=summary.get("sessionId"),
                                   data={"bests": records}, t=t)

    f = fitness.store(conn, uid)

    row = conn.execute("SELECT streak_goal FROM users WHERE uid=?", (uid,)).fetchone()
    goal = int((row["streak_goal"] if row else 0) or 0)
    before = conn.execute("SELECT streak_length FROM users WHERE uid=?", (uid,)).fetchone()
    was = int((before["streak_length"] if before else 0) or 0)
    length = streaks.recompute(conn, uid)
    streak_update = None
    # A bot's sessions are played now and then moved into the past (PLAN.md §18.8), so a milestone line
    # posted here would be dated the day the backfill ran, beside rides from months ago. Their streak
    # number is still right; only the timeline line is skipped.
    is_bot = conn.execute("SELECT is_bot FROM users WHERE uid=?", (uid,)).fetchone()
    if length > was and not (is_bot and is_bot["is_bot"]):
        streak_update = updates.for_streak(conn, uid, length, goal, t=t)

    try:
        boards.compute_all(conn, dh.catalog)
    except Exception:  # noqa: BLE001 -- a board with bad SQL must not cost anybody their session
        log.exception("leaderboard recompute failed")

    return {"update": update, "streakUpdate": streak_update, "bestUpdate": best_update,
            "bests": records, "streak": length, "fitness": f, "challenged": taken}


def recompute_player(conn: sqlite3.Connection, uid: int) -> dict[str, Any]:
    """Fitness and streak for one player, without a session behind it: after an admin edit, or a goal change."""
    return {"fitness": fitness.store(conn, uid), "streak": streaks.recompute(conn, uid)}
