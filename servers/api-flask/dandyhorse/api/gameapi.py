"""/gameapi/* — the game-facing API (PLAN.md §6)."""
from __future__ import annotations

from typing import Any

from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..db import get_db
from ..sessions import lifecycle
from ..sessions import log as logmod
from ..sessions.log import read_records
from ..util import ApiError, dumps, iso, loads, now as _now, num_or_none
from . import body, dh, user_session, wait_params
from .views import device_prefs, ended_game_view, game_view

bp = Blueprint("gameapi", __name__, url_prefix="/gameapi")

MAX_PREFS = 64 * 1024
MAX_SAVE = 256 * 1024


def _prefs(conn, uid: int, game_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT preferences FROM game_preferences WHERE uid=? AND game_id=?", (uid, game_id)).fetchone()
    return loads(row["preferences"]) if row else {}


def _save(conn, uid: int, game_id: str, variant: str) -> Any:
    row = conn.execute("SELECT save_state FROM save_states WHERE uid=? AND game_id=? AND variant=?",
                       (uid, game_id, variant)).fetchone()
    return loads(row["save_state"], default=None) if row else None


@bp.post("/startsession")
@require_auth
def startsession():
    b = body()
    conn = get_db()
    user = g.user
    sid = b.get("sessionId")
    if sid:
        live = user_session(sid)
    else:
        game_id, variant = b.get("gameId"), b.get("variant")
        if not game_id or not variant:
            raise ApiError(400, "game_required", "sessionId, or gameId and variant, required")
        live = lifecycle.launch(dh(), conn, user, game_id=game_id, variant=variant,
                                device_type=b.get("deviceType"), duration=num_or_none(b.get("duration")),
                                seed=b.get("seed") if isinstance(b.get("seed"), int) else None,
                                debug=bool(b.get("debug")), options={"adhoc": True},
                                game_options=b.get("options") if isinstance(b.get("options"), dict) else None)
    if isinstance(b.get("route"), str) and b["route"]:
        live.route = b["route"][:120]
    lifecycle.activate(dh(), conn, live)
    from .views import _fitness_address
    t = _now()
    reports, own, _, _ = lifecycle.resolve_owners(dh(), live.uid, t, live)
    rep = reports.get(own["fitness"]) if own["fitness"] else None
    return jsonify({
        "sessionId": live.session_id, "gameId": live.game_id, "variant": live.variant,
        "gameVersion": live.game_version, "seed": live.seed, "requestedDuration": live.requested_duration,
        "username": user["username"], "uid": user["uid"], "debug": live.debug, "deviceType": live.device_type,
        "unitSystem": user["unit_system"], "timeZone": user["time_zone"], "bodyData": live.body_data,
        "achievements": user.get("achievements", {}),
        "options": dict((live.options or {}).get("game") or {}),
        "preferences": {"global": user.get("preferences", {}),
                        "device": device_prefs(conn, user["uid"], _fitness_address(rep)),
                        "game": _prefs(conn, user["uid"], live.game_id)},
        "saveState": _save(conn, user["uid"], live.game_id, live.variant),
        "serverTime": t,
    })


@bp.get("/getstate")
@require_auth
def getstate():
    sid = request.args.get("session")
    if not sid:
        raise ApiError(400, "session_required", "session query parameter required")
    live = dh().store.get(sid)
    if live is None or live.uid != g.user["uid"]:
        row = get_db().execute("SELECT * FROM sessions WHERE session_id=?", (sid,)).fetchone()
        if row is None:
            raise ApiError(404, "session_not_found", "no such session")
        if row["uid"] != g.user["uid"]:
            raise ApiError(403, "forbidden", "not your session")
        return jsonify(ended_game_view(row))
    since, wait = wait_params()
    if wait > 0 and since >= 0:
        live.wait_seq(since, wait)
    return jsonify(game_view(dh(), live))


@bp.post("/setstate")
@require_auth
def setstate():
    b = body()
    live = user_session(b.get("sessionId"))
    seq = lifecycle.game_tick(dh(), live, b)
    return jsonify({"seq": seq, "sessionStatus": live.status})


@bp.post("/answerinput")
@require_auth
def answerinput():
    b = body()
    live = user_session(b.get("sessionId"))
    ok = lifecycle.answer_input(dh(), live, str(b.get("promptId") or ""), str(b.get("choice") or ""), "game")
    return jsonify({"accepted": ok})


@bp.post("/endsession")
@require_auth
def endsession():
    b = body()
    sid = b.get("sessionId")
    status = b.get("status", "complete")
    if status not in ("complete", "discarded"):
        raise ApiError(400, "status_invalid", "status must be complete or discarded")
    conn = get_db()
    live = dh().store.get(sid or "")
    if live is None:
        summary = lifecycle.summary_from_db(conn, sid or "")
        if summary is None:
            raise ApiError(404, "session_not_found", "no such session")
        if summary["uid"] != g.user["uid"]:
            raise ApiError(403, "forbidden", "not your session")
        return jsonify(summary)
    if live.uid != g.user["uid"]:
        raise ApiError(403, "forbidden", "not your session")
    reason = "completed" if status == "complete" else "discarded_by_game"
    if isinstance(b.get("reason"), str) and b["reason"]:
        reason = b["reason"][:80] if status == "discarded" else reason
    return jsonify(lifecycle.end(dh(), conn, live, status, reason))


# --- session image (PLAN.md §6.7) --------------------------------------------

IMAGE_MAX_BYTES = 1_000_000
IMAGE_GRACE_S = 600.0  # a game may still send the picture this long after the session ended


@bp.put("/sessions/<sid>/image")
@bp.post("/sessions/<sid>/image")
@require_auth
def put_session_image(sid: str):
    """The game's picture of the session (route map, inventory, ...): the History thumbnail.
    Body: raw image/png or image/jpeg, or JSON {"image": "data:image/png;base64,..."}."""
    import base64
    conn = get_db()
    row = conn.execute("SELECT uid, status, created_at, ended_at FROM sessions WHERE session_id=?", (sid,)).fetchone()
    if row is None or row["status"] == "deleted":
        raise ApiError(404, "session_not_found", "no such session")
    if row["uid"] != g.user["uid"]:
        raise ApiError(403, "forbidden", "not your session")
    if row["status"] in ("complete", "discarded") and row["ended_at"]:
        from datetime import datetime
        ended = datetime.fromisoformat(row["ended_at"].replace("Z", "+00:00")).timestamp()
        if lifecycle._now() - ended > IMAGE_GRACE_S:
            raise ApiError(410, "session_ended", "too late to attach an image")
    ctype = (request.content_type or "").split(";")[0].strip()
    if ctype in ("image/png", "image/jpeg"):
        data, ext = request.get_data(), ("png" if ctype == "image/png" else "jpg")
    else:
        b = body()
        src = b.get("image")
        if not isinstance(src, str) or not src.startswith("data:image/"):
            raise ApiError(400, "image_invalid", "send image/png, image/jpeg, or {image: data URL}")
        header, _, payload = src.partition(",")
        ext = "png" if "image/png" in header else "jpg" if "image/jpeg" in header else None
        if ext is None:
            raise ApiError(400, "image_invalid", "only PNG and JPEG images are accepted")
        try:
            data = base64.b64decode(payload, validate=True)
        except Exception:
            raise ApiError(400, "image_invalid", "bad base64 data") from None
    if not data or len(data) > IMAGE_MAX_BYTES:
        raise ApiError(413, "image_too_large", f"image must be 1..{IMAGE_MAX_BYTES} bytes")
    magic_ok = data[:8] == b"\x89PNG\r\n\x1a\n" if ext == "png" else data[:3] == b"\xff\xd8\xff"
    if not magic_ok:
        raise ApiError(400, "image_invalid", "file content does not match its type")
    from datetime import datetime
    created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).timestamp()
    rel = logmod.relpath(sid, created).rsplit(".", 1)[0] + f".{ext}"
    path = dh().config.sessions_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    conn.execute("UPDATE sessions SET image_file=? WHERE session_id=?", (rel, sid))
    conn.commit()
    live = dh().store.get(sid)
    if live is not None:
        live.bump()
    return jsonify({"ok": True, "imageUrl": f"/api/sessions/{sid}/image", "bytes": len(data)})


# --- preferences and save state ---------------------------------------------

@bp.get("/preferences")
@require_auth
def get_preferences():
    game = request.args.get("game")
    if not game:
        raise ApiError(400, "game_required", "game query parameter required")
    return jsonify({"game": game, "preferences": _prefs(get_db(), g.user["uid"], game)})


@bp.put("/putpreferences")
@bp.post("/putpreferences")
@require_auth
def put_preferences():
    b = body()
    game = b.get("game")
    prefs = b.get("preferences")
    if not isinstance(game, str) or not game or not isinstance(prefs, dict):
        raise ApiError(400, "invalid", "game and preferences object required")
    s = dumps(prefs)
    if len(s) > MAX_PREFS:
        raise ApiError(400, "too_large", "preferences exceed 64 KB")
    conn = get_db()
    conn.execute("INSERT INTO game_preferences(uid, game_id, preferences, updated_at) VALUES (?,?,?,?) "
                 "ON CONFLICT(uid, game_id) DO UPDATE SET preferences=excluded.preferences, updated_at=excluded.updated_at",
                 (g.user["uid"], game, s, iso()))
    conn.commit()
    return jsonify({"game": game, "preferences": prefs})


@bp.get("/getsave")
@require_auth
def getsave():
    game, variant = request.args.get("game"), request.args.get("variant")
    if not game or not variant:
        raise ApiError(400, "game_required", "game and variant query parameters required")
    return jsonify({"game": game, "variant": variant, "saveState": _save(get_db(), g.user["uid"], game, variant)})


@bp.put("/putsave")
@bp.post("/putsave")
@require_auth
def putsave():
    b = body()
    game, variant = b.get("game"), b.get("variant")
    if not isinstance(game, str) or not isinstance(variant, str) or "saveState" not in b:
        raise ApiError(400, "invalid", "game, variant and saveState required")
    s = dumps(b["saveState"])
    if len(s) > MAX_SAVE:
        raise ApiError(400, "too_large", "saveState exceeds 256 KB")
    conn = get_db()
    conn.execute("INSERT INTO save_states(uid, game_id, variant, save_state, updated_at) VALUES (?,?,?,?,?) "
                 "ON CONFLICT(uid, game_id, variant) DO UPDATE SET save_state=excluded.save_state, updated_at=excluded.updated_at",
                 (g.user["uid"], game, variant, s, iso()))
    conn.commit()
    return jsonify({"game": game, "variant": variant, "saveState": b["saveState"]})


# --- history and ghosts ------------------------------------------------------

@bp.get("/me")
@require_auth
def me():
    u = g.user
    return jsonify({"uid": u["uid"], "username": u["username"], "unitSystem": u["unit_system"],
                    "timeZone": u["time_zone"], "achievements": u.get("achievements", {}),
                    "preferences": u.get("preferences", {})})


@bp.get("/sessions")
@require_auth
def sessions():
    conn = get_db()
    where = ["s.status != 'deleted'"]
    args: list[Any] = []
    scope = request.args.get("scope", "me")
    if scope == "public":
        where.append("u.public=1 AND s.uid != ?")
        args.append(g.user["uid"])
    else:
        where.append("s.uid=?")
        args.append(g.user["uid"])
    for key, col in (("game", "s.game_id"), ("variant", "s.variant"), ("route", "s.route"), ("status", "s.status")):
        v = request.args.get(key)
        if v:
            where.append(f"{col}=?")
            args.append(v)
    before = request.args.get("before")
    if before:
        where.append("(s.created_at, s.session_id) < (SELECT created_at, session_id FROM sessions WHERE session_id=?)")
        args.append(before)
    limit = min(max(int(request.args.get("limit", "50") or 50), 1), 200)
    rows = conn.execute(
        f"SELECT s.*, u.username FROM sessions s JOIN users u ON u.uid=s.uid WHERE {' AND '.join(where)} "
        f"ORDER BY s.created_at DESC, s.session_id DESC LIMIT ?", (*args, limit)).fetchall()
    out = []
    for r in rows:
        d = lifecycle.row_to_summary(r)
        d["username"] = r["username"]
        out.append(d)
    return jsonify({"sessions": out})


def _readable_session(conn, sid: str):
    row = conn.execute("SELECT s.*, u.public FROM sessions s JOIN users u ON u.uid=s.uid WHERE session_id=?",
                       (sid,)).fetchone()
    if row is None or row["status"] == "deleted":
        raise ApiError(404, "session_not_found", "no such session")
    if row["uid"] != g.user["uid"] and not (row["public"] and row["status"] == "complete"):
        raise ApiError(403, "forbidden", "not your session")
    return row


@bp.get("/sessions/<sid>/timeline")
@require_auth
def timeline(sid: str):
    conn = get_db()
    _readable_session(conn, sid)
    rows = lifecycle.timeline_for(dh(), conn, sid)
    return jsonify({"sessionId": sid, "timeline": rows or []})


@bp.get("/sessions/<sid>/log")
@require_auth
def log(sid: str):
    conn = get_db()
    row = _readable_session(conn, sid)
    if row["uid"] != g.user["uid"]:
        raise ApiError(403, "forbidden", "raw logs are private")
    live = dh().store.get(sid)
    records = list(live.records) if live else read_records(dh().config.sessions_dir, row["log_file"])
    return jsonify({"sessionId": sid, "records": records})
