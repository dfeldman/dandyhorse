"""/api/* — the console-facing API (PLAN.md §10.1)."""
from __future__ import annotations

import gzip
import re
from typing import Any

from flask import Blueprint, Response, g, jsonify, redirect, request, session

from .. import auth
from ..auth import require_auth
from ..config import DEVICE_TYPES
from ..db import get_db
from ..sessions import lifecycle
from ..util import ApiError, dumps, iso, loads, num_or_none
from . import body, dh, wait_params
from .bridgeapi import device_row
from .views import bridges_view

bp = Blueprint("consoleapi", __name__)

_ME_FIELDS = ("username", "display_name", "profile", "public", "body_data", "unit_system", "time_zone", "preferences")


def _me(u: dict[str, Any]) -> dict[str, Any]:
    return {"uid": u["uid"], "username": u["username"], "displayName": u.get("display_name"),
            "profile": u.get("profile", {}), "public": u["public"], "achievements": u.get("achievements", {}),
            "bodyData": u.get("body_data", {}), "unitSystem": u["unit_system"], "timeZone": u["time_zone"],
            "preferences": u.get("preferences", {}), "isAdmin": dh().config.is_admin(u["uid"]),
            # made by a Google sign-in and still on its placeholder username: the console asks for one
            "needsHandle": not u.get("handle_set", True)}


# --- auth --------------------------------------------------------------------

def _stub_only() -> None:
    """The user-number login is for development: off with Google sign-in, and never through a tunnel."""
    if dh().config.auth_mode != "stub":
        raise ApiError(403, "stub_disabled", "this server signs in with Google, not with a user number")
    if request.headers.get("Cf-Connecting-Ip"):  # Cloudflare adds it to every request through a tunnel
        raise ApiError(403, "stub_local_only", "the user-number login does not work through a tunnel; "
                                               "set up Google sign-in (README: Put it online)")


@bp.get("/api/auth")
def auth_info():
    """How to log in here, for the login screens (no login needed): a user number, or Google at loginUrl."""
    return jsonify({"mode": dh().config.auth_mode, "loginUrl": "/login"})


@bp.post("/api/login")
def login():
    _stub_only()
    b = body()
    uid = b.get("uid")
    if not isinstance(uid, int) or isinstance(uid, bool) or uid <= 0:
        raise ApiError(400, "uid_required", "uid must be a positive integer")
    token = auth.login(uid, request.headers.get("User-Agent", "")[:120])
    resp = jsonify({"ok": True, "uid": uid, "token": token})
    return auth.set_cookie(resp, token)


@bp.get("/login")
def login_redirect():
    """Google sign-in: /login?next=/path signs in, then goes there.
    Stub: /login?uid=7 sets the cookie and lands on the console (or ?next=); without a uid, the login screen."""
    nxt = auth.safe_next(request.args.get("next"))
    if dh().config.auth_mode == "oidc" and "uid" not in request.args:
        from .. import oidc
        return oidc.start(nxt)
    _stub_only()
    if "uid" not in request.args:
        return redirect(nxt)
    try:
        uid = int(request.args.get("uid", ""))
    except ValueError:
        raise ApiError(400, "uid_required", "uid query parameter required")
    if uid <= 0:
        raise ApiError(400, "uid_required", "uid must be a positive integer")
    token = auth.login(uid, request.headers.get("User-Agent", "")[:120])
    return auth.set_cookie(redirect(nxt), token)


@bp.post("/api/logout")
@require_auth
def logout():
    auth.revoke(g.token)
    session.clear()  # a Google sign-in in progress, if any
    resp = jsonify({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@bp.get("/api/me")
@require_auth
def get_me():
    return jsonify(_me(g.user))


_HANDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{1,23}")


@bp.put("/api/me")
@require_auth
def put_me():
    b = body()
    conn = get_db()
    sets: list[str] = []
    args: list[Any] = []
    name = b["username"].strip() if isinstance(b.get("username"), str) else ""
    # checked only when it changes (older names may not fit the rule), or when a new user picks it
    if name and (name != g.user["username"] or not g.user["handle_set"]):
        if not _HANDLE.fullmatch(name):
            raise ApiError(400, "bad_username", "a username is 2 to 24 letters, digits, dots, dashes or "
                                                "underscores, starting with a letter or digit")
        if conn.execute("SELECT 1 FROM users WHERE lower(username)=lower(?) AND uid<>?",
                        (name, g.user["uid"])).fetchone():
            raise ApiError(409, "username_taken", "that username is taken")
        sets.append("username=?")
        args.append(name)
        sets.append("handle_set=1")
    if isinstance(b.get("displayName"), str):
        sets.append("display_name=?")
        args.append(b["displayName"][:80])
    if isinstance(b.get("profile"), dict):
        sets.append("profile=?")
        args.append(dumps(b["profile"]))
    if isinstance(b.get("public"), bool):
        sets.append("public=?")
        args.append(int(b["public"]))
    if isinstance(b.get("bodyData"), dict):
        bd = {k: v for k, v in b["bodyData"].items() if k in ("height", "weight", "sex", "age")}
        sets.append("body_data=?")
        args.append(dumps(bd))
    if b.get("unitSystem") in ("metric", "us"):
        sets.append("unit_system=?")
        args.append(b["unitSystem"])
    if isinstance(b.get("timeZone"), str) and b["timeZone"]:
        sets.append("time_zone=?")
        args.append(b["timeZone"][:64])
    if isinstance(b.get("preferences"), dict):
        sets.append("preferences=?")
        args.append(dumps(b["preferences"]))
    if sets:
        sets.append("updated_at=?")
        args.append(iso())
        args.append(g.user["uid"])
        try:
            conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE uid=?", args)
            conn.commit()
        except Exception as e:  # sqlite3.IntegrityError on username
            if "UNIQUE" in str(e):
                raise ApiError(409, "username_taken", "that username is taken")
            raise
    return jsonify(_me(auth.load_user(g.user["uid"])))


# --- catalog -----------------------------------------------------------------

@bp.get("/api/games")
@require_auth
def games():
    cat = dh().catalog
    out = {"games": cat.public_games()}
    if dh().config.is_admin(g.user["uid"]):
        out["invalid"] = cat.invalid_games
    return jsonify(out)


@bp.get("/api/catalog")
@require_auth
def catalog():
    cat = dh().catalog
    return jsonify({"consoles": cat.apps("consoles"), "bridges": cat.apps("bridges"),
                    "defaultConsole": cat.default_app_url("consoles"), "defaultBridge": cat.default_app_url("bridges")})


# --- sessions ----------------------------------------------------------------

def _bridge_base() -> str:
    base = dh().catalog.default_app_url("bridges")
    return base[:-len("index.html")] if base.endswith("/index.html") else base


def _bridge_url(sid: str, with_game: bool) -> str:
    return f"{_bridge_base()}#/session/{sid}" + ("?game=1" if with_game else "")


@bp.post("/api/sessions/launch")
@require_auth
def launch():
    b = body()
    game_id, variant = b.get("gameId"), b.get("variant")
    if not isinstance(game_id, str) or not isinstance(variant, str):
        raise ApiError(400, "game_required", "gameId and variant required")
    dt = b.get("deviceType")
    if dt is not None and dt not in DEVICE_TYPES:
        raise ApiError(400, "device_type_invalid", f"deviceType must be one of {DEVICE_TYPES}")
    seed = b.get("seed") if isinstance(b.get("seed"), int) and not isinstance(b.get("seed"), bool) else None
    live = lifecycle.launch(dh(), get_db(), g.user, game_id=game_id, variant=variant, device_type=dt,
                            duration=num_or_none(b.get("duration")), seed=seed, debug=bool(b.get("debug")),
                            options={k: b[k] for k in ("duration", "seed", "debug") if k in b},
                            game_options=b.get("options") if isinstance(b.get("options"), dict) else None)
    return jsonify({"sessionId": live.session_id, "bridgeUrl": _bridge_url(live.session_id, True),
                    "joinUrl": _bridge_base() + "#/join",
                    "session": lifecycle.session_brief(dh(), live)})


@bp.get("/api/sessions/current")
@require_auth
def current():
    live = dh().store.current_for(g.user["uid"])
    t = lifecycle._now()
    reports, own, dtype, allow_sim = lifecycle.resolve_owners(dh(), g.user["uid"], t, live)
    bridges = bridges_view(reports, own, dtype, allow_sim, t, dh().config.fresh_seconds)
    if live is None or live.terminal:
        return jsonify({"session": None, "bridges": bridges, "owner": own})
    brief = lifecycle.session_brief(dh(), live)
    brief["bridgeUrl"] = _bridge_url(live.session_id, True)
    brief["joinUrl"] = _bridge_base() + "#/join"
    game = dh().catalog.game(live.game_id)
    var = dh().catalog.variant(live.game_id, live.variant)
    brief["gameName"] = game["name"] if game else live.game_id
    brief["variantName"] = var["name"] if var else live.variant
    return jsonify({"session": brief, "bridges": bridges, "owner": own})


@bp.get("/api/sessions")
@require_auth
def list_sessions():
    conn = get_db()
    where = ["uid=?", "status != 'deleted'"]
    args: list[Any] = [g.user["uid"]]
    # Discarded sessions (never started, timed out, quit) pile up by the thousands: hidden unless asked for,
    # either explicitly (status=discarded) or with includeDiscarded=1.
    if not request.args.get("status") and request.args.get("includeDiscarded") not in ("1", "true"):
        where.append("status != 'discarded'")
    for key, col in (("game", "game_id"), ("variant", "variant"), ("status", "status"), ("deviceType", "device_type")):
        v = request.args.get(key)
        if v:
            where.append(f"{col}=?")
            args.append(v)
    before = request.args.get("before")
    if before:
        where.append("(created_at, session_id) < (SELECT created_at, session_id FROM sessions WHERE session_id=?)")
        args.append(before)
    limit = min(max(int(request.args.get("limit", "50") or 50), 1), 200)
    rows = conn.execute(f"SELECT * FROM sessions WHERE {' AND '.join(where)} ORDER BY created_at DESC, session_id DESC LIMIT ?",
                        (*args, limit)).fetchall()
    out = [lifecycle.row_to_summary(r) for r in rows]
    live = dh().store.current_for(g.user["uid"])
    cat = dh().catalog
    for s in out:
        game = cat.game(s["gameId"])
        var = cat.variant(s["gameId"], s["variant"])
        s["gameName"] = game["name"] if game else s["gameId"]
        s["variantName"] = var["name"] if var else s["variant"]
        s["imageUrl"] = _session_image(s, game, var)
        if live and s["sessionId"] == live.session_id:
            brief = lifecycle.session_brief(dh(), live)
            s["elapsed"] = brief["elapsed"]
            s["status"] = live.status  # the DB says active; paused lives only in memory
            s["pause"] = brief["pause"]
            s["pausedSeconds"] = brief["pausedSeconds"]
            s.update(live.integrator.running())
    return jsonify({"sessions": out, "nextBefore": out[-1]["sessionId"] if len(out) == limit else None})


def _session_image(s: dict[str, Any], game: dict[str, Any] | None, var: dict[str, Any] | None) -> str | None:
    """Picture for the History gallery: the game's own session image when it sent one (§6.7), else the
    variant's screenshot, else the game's."""
    if s.get("hasImage"):
        return f"/api/sessions/{s['sessionId']}/image"
    shot = (var or {}).get("screenshot") or (game or {}).get("screenshot")
    return f"/games/{s['gameId']}/{shot}" if shot else None


def _own_row(conn, sid: str):
    row = conn.execute("SELECT * FROM sessions WHERE session_id=?", (sid,)).fetchone()
    if row is None or row["status"] == "deleted":
        raise ApiError(404, "session_not_found", "no such session")
    if row["uid"] != g.user["uid"]:
        raise ApiError(403, "forbidden", "not your session")
    return row


@bp.get("/api/sessions/<sid>")
@require_auth
def get_session(sid: str):
    conn = get_db()
    row = _own_row(conn, sid)
    s = lifecycle.row_to_summary(row)
    live = dh().store.get(sid)
    if live:
        brief = lifecycle.session_brief(dh(), live)
        s["elapsed"] = brief["elapsed"]
        s["status"] = live.status
        s["pause"] = brief["pause"]
        s["pausedSeconds"] = brief["pausedSeconds"]
        s.update(live.integrator.running())
    ach = loads(g.user.get("achievements")) if isinstance(g.user.get("achievements"), str) else g.user.get("achievements", {})
    s["achievements"] = [k for k, v in ach.items() if isinstance(v, dict) and v.get("sessionId") == sid]
    game = dh().catalog.game(s["gameId"])
    var = dh().catalog.variant(s["gameId"], s["variant"])
    s["gameName"] = game["name"] if game else s["gameId"]
    s["variantName"] = var["name"] if var else s["variant"]
    s["imageUrl"] = _session_image(s, game, var)
    return jsonify(s)


@bp.get("/api/sessions/<sid>/timeline")
@require_auth
def session_timeline(sid: str):
    conn = get_db()
    _own_row(conn, sid)
    return jsonify({"sessionId": sid, "timeline": lifecycle.timeline_for(dh(), conn, sid) or []})


@bp.get("/api/sessions/<sid>/log")
@require_auth
def session_log(sid: str):
    conn = get_db()
    row = _own_row(conn, sid)
    live = dh().store.get(sid)
    if live:
        data = "\n".join(dumps(r) for r in live.records) + "\n"
    else:
        from ..sessions.log import read_records
        data = "\n".join(dumps(r) for r in read_records(dh().config.sessions_dir, row["log_file"])) + "\n"
    payload = gzip.compress(data.encode("utf-8"))
    return Response(payload, mimetype="application/gzip",
                    headers={"Content-Disposition": f"attachment; filename={sid}.jsonl.gz"})


@bp.get("/api/sessions/<sid>/image")
@require_auth
def session_image(sid: str):
    from flask import send_file
    row = _own_row(get_db(), sid)
    rel = row["image_file"] if "image_file" in row.keys() else None
    path = dh().config.sessions_dir / rel if rel else None
    if not path or not path.is_file():
        raise ApiError(404, "no_image", "this session has no image")
    resp = send_file(path, mimetype="image/png" if path.suffix == ".png" else "image/jpeg", max_age=86400)
    return resp


@bp.delete("/api/sessions/<sid>")
@require_auth
def delete_session(sid: str):
    conn = get_db()
    row = _own_row(conn, sid)
    if row["status"] in ("pending", "active"):
        raise ApiError(409, "session_active", "end the session before deleting it")
    conn.execute("UPDATE sessions SET status='deleted', updated_at=? WHERE session_id=?", (iso(), sid))
    conn.commit()
    return jsonify({"ok": True})


@bp.post("/api/sessions/<sid>/end")
@require_auth
def end_session(sid: str):
    b = body()
    status = b.get("status", "discarded")
    if status not in ("complete", "discarded"):
        raise ApiError(400, "status_invalid", "status must be complete or discarded")
    conn = get_db()
    _own_row(conn, sid)
    live = dh().store.get(sid)
    if live is None:
        raise ApiError(409, "session_not_live", "session is not live")
    return jsonify(lifecycle.end(dh(), conn, live, status, "console"))


# --- devices -----------------------------------------------------------------

@bp.get("/api/remote")
@require_auth
def remote_events():
    """Long-poll for bridge d-pad presses: ?since=<n>&wait=<s>. Returns events with n > since."""
    since, wait = wait_params()
    ch = dh().store.remote_for(g.user["uid"])
    events = ch.since(max(since, 0) if since >= 0 else ch.n, wait)
    return jsonify({"n": ch.n, "events": events})


@bp.get("/api/devices")
@require_auth
def devices():
    rows = get_db().execute("SELECT * FROM devices WHERE uid=? ORDER BY last_seen_at DESC", (g.user["uid"],)).fetchall()
    return jsonify({"devices": [device_row(r) for r in rows]})


@bp.post("/api/devices")
@require_auth
def create_device():
    from .bridgeapi import upsert_device
    return upsert_device()


@bp.put("/api/devices/<int:device_id>")
@require_auth
def update_device(device_id: int):
    b = body()
    conn = get_db()
    row = conn.execute("SELECT * FROM devices WHERE device_id=? AND uid=?", (device_id, g.user["uid"])).fetchone()
    if row is None:
        raise ApiError(404, "device_not_found", "no such device")
    name = b["name"][:80] if isinstance(b.get("name"), str) and b["name"] else row["name"]
    dtype = b["type"] if b.get("type") in (*DEVICE_TYPES, "hrm") else row["type"]
    prefs = dumps(b["preferences"]) if isinstance(b.get("preferences"), dict) else row["preferences"]
    conn.execute("UPDATE devices SET name=?, type=?, preferences=? WHERE device_id=?", (name, dtype, prefs, device_id))
    conn.commit()
    live = dh().store.current_for(g.user["uid"])
    if live is not None:
        live.bump()
    return jsonify(device_row(conn.execute("SELECT * FROM devices WHERE device_id=?", (device_id,)).fetchone()))


@bp.delete("/api/devices/<int:device_id>")
@require_auth
def delete_device(device_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM devices WHERE device_id=? AND uid=?", (device_id, g.user["uid"]))
    conn.commit()
    if cur.rowcount == 0:
        raise ApiError(404, "device_not_found", "no such device")
    return jsonify({"ok": True})


@bp.post("/api/devices/<int:device_id>/merge")
@require_auth
def merge_device(device_id: int):
    b = body()
    into = b.get("into")
    conn = get_db()
    src = conn.execute("SELECT * FROM devices WHERE device_id=? AND uid=?", (device_id, g.user["uid"])).fetchone()
    dst = conn.execute("SELECT * FROM devices WHERE device_id=? AND uid=?", (into, g.user["uid"])).fetchone()
    if src is None or dst is None:
        raise ApiError(404, "device_not_found", "no such device")
    merged = {**loads(dst["preferences"]), **loads(src["preferences"])}
    conn.execute("UPDATE devices SET preferences=? WHERE device_id=?", (dumps(merged), dst["device_id"]))
    conn.execute("DELETE FROM devices WHERE device_id=?", (src["device_id"],))
    conn.commit()
    return jsonify(device_row(conn.execute("SELECT * FROM devices WHERE device_id=?", (dst["device_id"],)).fetchone()))


# --- game preferences, leaderboards, users, admin ----------------------------

@bp.get("/api/game-preferences/<game_id>")
@require_auth
def get_game_prefs(game_id: str):
    row = get_db().execute("SELECT preferences FROM game_preferences WHERE uid=? AND game_id=?",
                           (g.user["uid"], game_id)).fetchone()
    return jsonify({"game": game_id, "preferences": loads(row["preferences"]) if row else {}})


@bp.put("/api/game-preferences/<game_id>")
@require_auth
def put_game_prefs(game_id: str):
    b = body()
    prefs = b.get("preferences", b)
    if not isinstance(prefs, dict):
        raise ApiError(400, "invalid", "preferences object required")
    conn = get_db()
    conn.execute("INSERT INTO game_preferences(uid, game_id, preferences, updated_at) VALUES (?,?,?,?) "
                 "ON CONFLICT(uid, game_id) DO UPDATE SET preferences=excluded.preferences, updated_at=excluded.updated_at",
                 (g.user["uid"], game_id, dumps(prefs), iso()))
    conn.commit()
    return jsonify({"game": game_id, "preferences": prefs})


@bp.get("/api/leaderboards")
@require_auth
def leaderboards():
    # Phase 5: precomputed table. For now, a live query over complete public sessions.
    conn = get_db()
    metric = request.args.get("metric", "distance")
    col = {"distance": "distance", "energy": "energy", "duration": "duration", "avg_power": "avg_power",
           "score": "score"}.get(metric)
    if col is None:
        raise ApiError(400, "metric_invalid", "unknown metric")
    where = ["s.status='complete'", "s.debug=0", f"s.{col} IS NOT NULL", "(u.public=1 OR s.uid=?)"]
    args: list[Any] = [g.user["uid"]]
    for key, c in (("game", "s.game_id"), ("variant", "s.variant"), ("route", "s.route")):
        v = request.args.get(key)
        if v:
            where.append(f"{c}=?")
            args.append(v)
    rows = conn.execute(
        f"SELECT s.uid, u.username, u.public, s.session_id, s.game_id, s.variant, s.route, MAX(s.{col}) AS value "
        f"FROM sessions s JOIN users u ON u.uid=s.uid WHERE {' AND '.join(where)} "
        f"GROUP BY s.uid ORDER BY value DESC LIMIT 100", args).fetchall()
    out = []
    rank = 0
    for r in rows:
        if r["public"] or r["uid"] == g.user["uid"]:
            rank += 1
            out.append({"rank": rank if r["public"] else None, "uid": r["uid"], "username": r["username"],
                        "sessionId": r["session_id"], "gameId": r["game_id"], "variant": r["variant"],
                        "route": r["route"], "value": r["value"], "me": r["uid"] == g.user["uid"]})
    return jsonify({"metric": metric, "rows": out})


@bp.get("/api/users/<username>")
@require_auth
def public_user(username: str):
    row = get_db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if row is None or not (row["public"] or row["uid"] == g.user["uid"]):
        raise ApiError(404, "user_not_found", "no such user")
    return jsonify({"uid": row["uid"], "username": row["username"], "displayName": row["display_name"],
                    "profile": loads(row["profile"]), "achievements": loads(row["achievements"])})


@bp.post("/api/admin/rescan")
@require_auth
def rescan():
    if not dh().config.is_admin(g.user["uid"]):
        raise ApiError(403, "forbidden", "admin only")
    dh().catalog.rescan()
    return jsonify({"games": list(dh().catalog.games), "invalid": dh().catalog.invalid_games})
