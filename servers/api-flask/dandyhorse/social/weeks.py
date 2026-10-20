"""Week keys in the player's own time zone (PLAN.md §18.5).

A week is the ISO week, Monday to Sunday, in the time zone on the player's account — so somebody in Auckland
and somebody in Lisbon each get the week they actually live in. A key looks like `2026-W43`, which sorts
correctly as text within a year and is what the leaderboards store as `period_key`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..util import now as _now


def zone(name: str | None) -> ZoneInfo | timezone:
    """The named zone, or UTC for anything unknown (a stale or hand-typed `users.time_zone`)."""
    if not name:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def local_date(t: float, tz: str | None) -> date:
    return datetime.fromtimestamp(t, tz=zone(tz)).date()


def week_key(t: float, tz: str | None = None) -> str:
    """`2026-W43` for the instant `t` as lived in `tz`."""
    y, w, _ = local_date(t, tz).isocalendar()
    return f"{y}-W{w:02d}"


def month_key(t: float, tz: str | None = None) -> str:
    d = local_date(t, tz)
    return f"{d.year}-{d.month:02d}"


def week_of(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_before(key: str, weeks: int = 1) -> str:
    """The key `weeks` weeks earlier. Walking back by date keeps 52- and 53-week years right."""
    year, _, num = key.partition("-W")
    monday = date.fromisocalendar(int(year), int(num), 1)
    return week_of(monday - timedelta(weeks=weeks))


def week_bounds(key: str, tz: str | None = None) -> tuple[float, float]:
    """Epoch seconds for the start of this week and the start of the next, in `tz`."""
    year, _, num = key.partition("-W")
    monday = date.fromisocalendar(int(year), int(num), 1)
    z = zone(tz)
    start = datetime(monday.year, monday.month, monday.day, tzinfo=z)
    nxt = monday + timedelta(weeks=1)
    return start.timestamp(), datetime(nxt.year, nxt.month, nxt.day, tzinfo=z).timestamp()


def current_week(tz: str | None = None) -> str:
    return week_key(_now(), tz)
