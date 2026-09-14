"""Shared helpers for the API blueprints."""
from __future__ import annotations

from typing import Any

from flask import current_app, g, request

from ..db import get_db
from ..util import ApiError


def dh():
    return current_app.dh  # type: ignore[attr-defined]


def body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if data is None:
        if request.method in ("POST", "PUT") and request.content_length:
            raise ApiError(400, "invalid_json", "body must be a JSON object")
        return {}
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json", "body must be a JSON object")
    return data


def wait_params() -> tuple[int, float]:
    try:
        since = int(request.args.get("since", "-1"))
    except ValueError:
        since = -1
    try:
        wait = float(request.args.get("wait", "0"))
    except ValueError:
        wait = 0.0
    return since, max(0.0, min(wait, dh().config.max_wait))


def user_session(session_id: str | None):
    """Live session owned by the current user, or raise."""
    if not session_id:
        raise ApiError(400, "session_required", "sessionId is required")
    live = dh().store.get(session_id)
    if live is None:
        row = get_db().execute("SELECT uid, status FROM sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise ApiError(404, "session_not_found", "no such session")
        if row["uid"] != g.user["uid"]:
            raise ApiError(403, "forbidden", "not your session")
        raise ApiError(410, "session_ended", f"session is {row['status']}")
    if live.uid != g.user["uid"]:
        raise ApiError(403, "forbidden", "not your session")
    return live
