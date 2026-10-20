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


def read_image(max_bytes: int) -> tuple[bytes, str]:
    """An uploaded PNG or JPEG, from a raw `image/*` body or JSON `{"image": "data:image/png;base64,..."}`.
    Returns the bytes and the extension, having checked the size and the file's own magic bytes — a client
    cannot pass off a script as a picture by naming its content type. Used for session pictures (§6.7) and
    for profile pictures and avatar thumbnails (§18.6)."""
    import base64

    ctype = (request.content_type or "").split(";")[0].strip()
    if ctype in ("image/png", "image/jpeg"):
        data, ext = request.get_data(), ("png" if ctype == "image/png" else "jpg")
    else:
        src = body().get("image")
        if not isinstance(src, str) or not src.startswith("data:image/"):
            raise ApiError(400, "image_invalid", "send image/png, image/jpeg, or {image: data URL}")
        header, _, payload = src.partition(",")
        ext = "png" if "image/png" in header else "jpg" if "image/jpeg" in header else ""
        if not ext:
            raise ApiError(400, "image_invalid", "only PNG and JPEG images are accepted")
        try:
            data = base64.b64decode(payload, validate=True)
        except Exception:
            raise ApiError(400, "image_invalid", "bad base64 data") from None
    if not data or len(data) > max_bytes:
        raise ApiError(413, "image_too_large", f"image must be 1..{max_bytes} bytes")
    magic_ok = data[:8] == b"\x89PNG\r\n\x1a\n" if ext == "png" else data[:3] == b"\xff\xd8\xff"
    if not magic_ok:
        raise ApiError(400, "image_invalid", "file content does not match its type")
    return data, ext
