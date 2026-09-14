"""/bridgeapi/* — the bridge-facing API (PLAN.md §9.2)."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..config import DEVICE_TYPES
from ..db import get_db
from ..sessions import lifecycle
from ..util import ApiError, dumps, iso, loads
from . import body, dh, wait_params
from .views import bridge_view

bp = Blueprint("bridgeapi", __name__, url_prefix="/bridgeapi")


@bp.get("/getstate")
@require_auth
def getstate():
    bridge_id = request.args.get("bridgeId")
    since, wait = wait_params()
    live = dh().store.current_for(g.user["uid"])
    if wait > 0 and since >= 0:
        if live is not None:
            live.wait_seq(since, wait)
        else:
            with dh().store.presence_cond:
                dh().store.presence_cond.wait(wait)
    return jsonify(bridge_view(dh(), get_db(), g.user["uid"], bridge_id))


@bp.post("/putstate")
@require_auth
def putstate():
    return jsonify(lifecycle.bridge_report(dh(), get_db(), g.user, body()))


@bp.post("/claim")
@require_auth
def claim():
    """Take control of a role (e.g. the fitness device) away from another bridge."""
    b = body()
    ok, reason = lifecycle.claim_role(dh(), g.user["uid"], str(b.get("bridgeId") or ""), str(b.get("role") or "fitness"))
    return jsonify({"ok": ok, "reason": reason, **bridge_view(dh(), get_db(), g.user["uid"], b.get("bridgeId"))})


@bp.post("/leave")
@require_auth
def leave():
    """Sent with navigator.sendBeacon on pagehide so ownership moves immediately instead of after 5 s."""
    b = request.get_json(silent=True, force=True) or {}
    gone = dh().store.leave(g.user["uid"], str(b.get("bridgeId") or ""))
    live = dh().store.current_for(g.user["uid"])
    if live is not None:
        live.bump()
    return jsonify({"ok": True, "known": gone})


def _running_session():
    from ..sessions.store import RUNNING
    live = dh().store.current_for(g.user["uid"])
    if live is None or live.status not in RUNNING:
        raise ApiError(409, "session_not_running", "no running session to pause or resume")
    return live


def _label(bridge_id: str, body_label: object) -> str | None:
    rep = dh().store.reports(g.user["uid"], lifecycle._now()).get(bridge_id)
    return (rep or {}).get("label") or (str(body_label)[:60] if body_label else None)


@bp.post("/pause")
@require_auth
def pause():
    """User convenience: pause the game from a bridge (Play resumes)."""
    b = body()
    live = _running_session()
    bid = str(b.get("bridgeId") or "")
    lifecycle.user_pause(dh(), live, bid, _label(bid, b.get("label")))
    return jsonify({"ok": True, "session": lifecycle.session_brief(dh(), live)})


@bp.post("/end")
@require_auth
def end():
    """The user ends the session from a bridge: `complete` (saved to history, the game may still attach
    its session image for 10 minutes) or `discarded`. A pending session can only be discarded."""
    b = body()
    status = b.get("status", "complete")
    if status not in ("complete", "discarded"):
        raise ApiError(400, "status_invalid", "status must be complete or discarded")
    live = dh().store.current_for(g.user["uid"])
    if live is None or live.terminal:
        raise ApiError(409, "session_not_running", "no session to end")
    bid = str(b.get("bridgeId") or "")
    summary = lifecycle.end(dh(), get_db(), live, status, f"bridge:{bid}" if bid else "bridge")
    return jsonify({"ok": True, "status": summary.get("status", status), "summary": summary})


@bp.post("/resume")
@require_auth
def resume():
    b = body()
    live = _running_session()
    lifecycle.user_resume(dh(), live, str(b.get("bridgeId") or ""))
    return jsonify({"ok": True, "session": lifecycle.session_brief(dh(), live)})


@bp.post("/sendinput")
@require_auth
def sendinput():
    b = body()
    live = dh().store.current_for(g.user["uid"])
    if live is None:
        return jsonify({"accepted": False, "reason": "no_session"})
    ok = lifecycle.answer_input(dh(), live, str(b.get("promptId") or ""), str(b.get("choice") or ""),
                                f"bridge:{b.get('bridgeId') or '?'}")
    return jsonify({"accepted": ok})


@bp.post("/remote")
@require_auth
def remote():
    """A d-pad press meant for the console (no session needed). PLAN.md §9.7."""
    from ..sessions.store import REMOTE_BUTTONS
    from ..util import now
    b = body()
    button = str(b.get("button") or "")
    if button not in REMOTE_BUTTONS:
        raise ApiError(400, "bad_button", f"button must be one of {', '.join(REMOTE_BUTTONS)}")
    ev = dh().store.remote_for(g.user["uid"]).press(button, str(b.get("bridgeId") or "?"), now())
    return jsonify({"ok": True, "n": ev["n"]})


def device_row(r) -> dict:
    return {"deviceId": r["device_id"], "type": r["type"], "address": r["address"], "name": r["name"],
            "protocol": r["protocol"], "preferences": loads(r["preferences"]),
            "lastSeenAt": r["last_seen_at"], "createdAt": r["created_at"]}


@bp.get("/devices")
@require_auth
def list_devices():
    rows = get_db().execute("SELECT * FROM devices WHERE uid=? ORDER BY last_seen_at DESC", (g.user["uid"],)).fetchall()
    return jsonify({"devices": [device_row(r) for r in rows]})


@bp.post("/devices")
@require_auth
def upsert_device():
    b = body()
    dtype, address, name = b.get("type"), b.get("address"), b.get("name")
    if dtype not in (*DEVICE_TYPES, "hrm") or not isinstance(address, str) or not address:
        raise ApiError(400, "invalid", "type (treadmill|bike|hrm) and address required")
    conn = get_db()
    t = iso()
    row = conn.execute("SELECT * FROM devices WHERE uid=? AND address=?", (g.user["uid"], address)).fetchone()
    if row is None:
        conn.execute("INSERT INTO devices(uid, type, address, name, protocol, preferences, last_seen_at, created_at) "
                     "VALUES (?,?,?,?,?,?,?,?)",
                     (g.user["uid"], dtype, address, str(name or dtype)[:80], str(b.get("protocol") or "ftms"),
                      dumps(b.get("preferences") or {}), t, t))
    else:
        conn.execute("UPDATE devices SET type=?, name=COALESCE(NULLIF(?,''), name), protocol=?, last_seen_at=? WHERE device_id=?",
                     (dtype, str(name or "")[:80], str(b.get("protocol") or row["protocol"]), t, row["device_id"]))
    conn.commit()
    row = conn.execute("SELECT * FROM devices WHERE uid=? AND address=?", (g.user["uid"], address)).fetchone()
    return jsonify(device_row(row))


@bp.put("/devices/<int:device_id>/preferences")
@require_auth
def put_device_prefs(device_id: int):
    b = body()
    prefs = b.get("preferences", b)
    if not isinstance(prefs, dict):
        raise ApiError(400, "invalid", "preferences object required")
    conn = get_db()
    cur = conn.execute("UPDATE devices SET preferences=? WHERE device_id=? AND uid=?",
                       (dumps(prefs), device_id, g.user["uid"]))
    conn.commit()
    if cur.rowcount == 0:
        raise ApiError(404, "device_not_found", "no such device")
    row = conn.execute("SELECT * FROM devices WHERE device_id=?", (device_id,)).fetchone()
    live = dh().store.current_for(g.user["uid"])
    if live is not None:
        live.bump()
    return jsonify(device_row(row))
