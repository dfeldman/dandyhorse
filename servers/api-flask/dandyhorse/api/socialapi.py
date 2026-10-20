"""/api/profiles/*, /api/profile/*, /api/leaderboards/* and the admin's player editing (PLAN.md §18.6–18.9)."""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from flask import Blueprint, g, jsonify, request, send_file

from ..auth import require_auth
from ..db import get_db
from ..social import boards, competitors, finalize, streaks, updates
from ..util import ApiError, dumps, iso, loads
from . import body, dh, read_image

bp = Blueprint("socialapi", __name__)

IMAGE_MAX_BYTES = 1_000_000
# A thumbnail is a small square the console renders from the avatar; 200 KB is generous for one.
THUMB_MAX_BYTES = 200_000
COUNTRY = re.compile(r"^[A-Za-z]{2}$")
# The same rule the player's own `PUT /api/me` enforces (consoleapi `_HANDLE`): an admin edit and a bot's
# `bots.json` entry go through here, and a username ends up in URLs and in every game's HUD.
HANDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{1,23}")
NAME_MAX = 40
BIO_MAX = 600


# --- reading a profile ---------------------------------------------------------------------------

def _visible(row: sqlite3.Row | None, viewer_uid: int) -> sqlite3.Row:
    if row is None:
        raise ApiError(404, "user_not_found", "no such player")
    if not (row["public"] or row["uid"] == viewer_uid or dh().config.is_admin(viewer_uid)):
        raise ApiError(404, "user_not_found", "no such player")
    return row


def _totals(conn: sqlite3.Connection, uid: int) -> dict[str, Any]:
    """What this player has done in all: overall and per machine. Complete, non-debug sessions only."""
    def one(where: str, args: tuple) -> dict[str, Any]:
        r = conn.execute(
            f"SELECT COUNT(*) AS sessions, COALESCE(SUM(distance),0) AS distance, "
            f"COALESCE(SUM(duration),0) AS duration, COALESCE(SUM(energy),0) AS energy, "
            f"COALESCE(SUM(elevation_gain),0) AS climb, MAX(started_at) AS last "
            f"FROM sessions WHERE status='complete' AND debug=0 AND {where}", args).fetchone()
        return {"sessions": r["sessions"], "distance": r["distance"], "duration": r["duration"],
                "energy": r["energy"], "elevationGain": r["climb"], "lastSession": r["last"]}
    out = one("uid=?", (uid,))
    out["byDevice"] = {d: one("uid=? AND device_type=?", (uid, d)) for d in ("bike", "treadmill")}
    games = conn.execute(
        "SELECT game_id, COUNT(*) AS n, COALESCE(SUM(distance),0) AS distance FROM sessions "
        "WHERE uid=? AND status='complete' AND debug=0 GROUP BY game_id ORDER BY n DESC", (uid,)).fetchall()
    out["byGame"] = [{"gameId": r["game_id"], "sessions": r["n"], "distance": r["distance"]} for r in games]
    return out


def card(row: sqlite3.Row, viewer_uid: int) -> dict[str, Any]:
    """A player as a list entry: enough for a card or a leaderboard row, no queries of its own."""
    d = dict(row)
    u = d["username"]
    return {"uid": d["uid"], "username": u, "displayName": d.get("display_name"),
            "firstName": d.get("first_name") or "", "lastName": d.get("last_name") or "",
            "country": (d.get("country") or "").upper(),
            "public": bool(d["public"]),
            "imageUrl": f"/api/profiles/{u}/image" if d.get("image_file") else None,
            "thumbnailUrl": f"/api/profiles/{u}/thumbnail" if d.get("thumb_file") else None,
            "streak": {"length": d.get("streak_length") or 0, "goal": d.get("streak_goal") or 0},
            "fitness": loads(d.get("fitness")),
            "me": d["uid"] == viewer_uid}


def profile_view(conn: sqlite3.Connection, row: sqlite3.Row, viewer_uid: int) -> dict[str, Any]:
    d = dict(row)
    profile = loads(d.get("profile"))
    out = card(row, viewer_uid)
    out.update({
        "bio": profile.get("bio") if isinstance(profile.get("bio"), str) else "",
        # The AvatarSpec the designer saved (avatarkit): the profile page animates it.
        "avatar": profile.get("avatar") if isinstance(profile.get("avatar"), dict) else None,
        "timeZone": d.get("time_zone"), "unitSystem": d.get("unit_system"),
        "joinedAt": d.get("created_at"),
        "achievements": loads(d.get("achievements")),
        "totals": _totals(conn, d["uid"]),
        "updates": updates.timeline(conn, d["uid"], 30, viewer_uid=viewer_uid),
    })
    rows = conn.execute(
        "SELECT session_id, game_id, variant, device_type, started_at, duration, distance, energy, "
        "elevation_gain, stats, image_file FROM sessions WHERE uid=? AND status='complete' AND debug=0 "
        "ORDER BY started_at DESC LIMIT 10", (d["uid"],)).fetchall()
    out["recentSessions"] = [
        {"sessionId": r["session_id"], "gameId": r["game_id"], "variant": r["variant"],
         "deviceType": r["device_type"], "startedAt": r["started_at"], "duration": r["duration"],
         "distance": r["distance"], "energy": r["energy"], "elevationGain": r["elevation_gain"],
         "stats": loads(r["stats"]), "hasImage": bool(r["image_file"])} for r in rows]
    return out


@bp.get("/api/profiles")
@require_auth
def profiles():
    """Every public player, and yourself. A hundred or two people, so the whole list goes at once."""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM users WHERE public=1 OR uid=? ORDER BY streak_length DESC, username", (g.user["uid"],)
    ).fetchall()
    return jsonify({"players": [card(r, g.user["uid"]) for r in rows]})


def _by_username(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE lower(username)=lower(?)", (username,)).fetchone()


@bp.get("/api/profiles/<username>")
@require_auth
def profile(username: str):
    conn = get_db()
    row = _visible(_by_username(conn, username), g.user["uid"])
    return jsonify(profile_view(conn, row, g.user["uid"]))


@bp.get("/api/profiles/<username>/updates")
@require_auth
def profile_updates(username: str):
    conn = get_db()
    row = _visible(_by_username(conn, username), g.user["uid"])
    try:
        limit = int(request.args.get("limit", "30"))
    except ValueError:
        limit = 30
    return jsonify({"updates": updates.timeline(conn, row["uid"], limit, request.args.get("before"),
                                                viewer_uid=g.user["uid"])})


def _send(rel: str | None, kind: str):
    path = dh().config.profiles_dir / rel if rel else None
    if not path or not path.is_file():
        raise ApiError(404, f"no_{kind}", f"this player has no {kind}")
    return send_file(path, mimetype="image/png" if path.suffix == ".png" else "image/jpeg", max_age=300)


@bp.get("/api/profiles/<username>/image")
@require_auth
def profile_image(username: str):
    row = _visible(_by_username(get_db(), username), g.user["uid"])
    return _send(row["image_file"], "picture")


@bp.get("/api/profiles/<username>/thumbnail")
@require_auth
def profile_thumbnail(username: str):
    row = _visible(_by_username(get_db(), username), g.user["uid"])
    return _send(row["thumb_file"], "thumbnail")


# --- your own profile ----------------------------------------------------------------------------

@bp.post("/api/profile/updates")
@require_auth
def post_update():
    text = body().get("text")
    if not isinstance(text, str) or not text.strip():
        raise ApiError(400, "text_required", "an update needs some text")
    return jsonify(updates.post(get_db(), g.user["uid"], "manual", text))


@bp.post("/api/updates/<update_id>/cheer")
@require_auth
def cheer(update_id: str):
    """"Ride on": a tap of encouragement on somebody's update. Calling it again takes it back."""
    conn = get_db()
    row = conn.execute("SELECT u.public, p.uid FROM profile_updates p JOIN users u ON u.uid=p.uid "
                       "WHERE p.update_id=?", (update_id,)).fetchone()
    if row is None or not (row["public"] or row["uid"] == g.user["uid"]):
        raise ApiError(404, "update_not_found", "no such update")
    return jsonify(updates.cheer(conn, g.user["uid"], update_id))


@bp.delete("/api/profile/updates/<update_id>")
@require_auth
def delete_update(update_id: str):
    if not updates.delete(get_db(), g.user["uid"], update_id):
        raise ApiError(404, "update_not_found", "no such update of yours")
    return jsonify({"ok": True})


def _store_image(uid: int, data: bytes, ext: str, column: str) -> str:
    """One file per player per purpose, replacing whatever was there (`<uid>-<column>.<ext>`)."""
    d = dh().config.profiles_dir
    d.mkdir(parents=True, exist_ok=True)
    rel = f"{uid}-{column}.{ext}"
    for old in d.glob(f"{uid}-{column}.*"):
        if old.name != rel:
            old.unlink(missing_ok=True)
    (d / rel).write_bytes(data)
    conn = get_db()
    conn.execute(f"UPDATE users SET {column}=?, updated_at=? WHERE uid=?", (rel, iso(), uid))
    conn.commit()
    return rel


@bp.put("/api/profile/image")
@bp.post("/api/profile/image")
@require_auth
def put_profile_image():
    data, ext = read_image(IMAGE_MAX_BYTES)
    _store_image(g.user["uid"], data, ext, "image_file")
    return jsonify({"ok": True, "imageUrl": f"/api/profiles/{g.user['username']}/image"})


@bp.put("/api/profile/thumbnail")
@bp.post("/api/profile/thumbnail")
@require_auth
def put_profile_thumbnail():
    """A small PNG of the avatar, rendered by the console when the player saves one, so a page full of
    players costs no Babylon and no MakeHuman assets (§18.6)."""
    data, ext = read_image(THUMB_MAX_BYTES)
    _store_image(g.user["uid"], data, ext, "thumb_file")
    return jsonify({"ok": True, "thumbnailUrl": f"/api/profiles/{g.user['username']}/thumbnail"})


@bp.delete("/api/profile/image")
@require_auth
def delete_profile_image():
    conn = get_db()
    for old in dh().config.profiles_dir.glob(f"{g.user['uid']}-image_file.*"):
        old.unlink(missing_ok=True)
    conn.execute("UPDATE users SET image_file=NULL, updated_at=? WHERE uid=?", (iso(), g.user["uid"]))
    conn.commit()
    return jsonify({"ok": True})


@bp.get("/api/sessions/<sid>/standing")
@require_auth
def session_standing(sid: str):
    """Where one of your finished sessions stands against recent sessions by players at a similar level
    (PLAN.md §18.3) — the same comparison a game shows on its end screen, for the session page."""
    conn = get_db()
    row = conn.execute("SELECT * FROM sessions WHERE session_id=? AND uid=?", (sid, g.user["uid"])).fetchone()
    if row is None or row["status"] == "deleted":
        raise ApiError(404, "session_not_found", "no such session of yours")
    if row["status"] != "complete" or row["debug"]:
        # A ride that was thrown away, or a debug one, is in nobody's league.
        return jsonify({"rank": None, "of": 0, "beaten": 0, "rows": []})
    return jsonify(competitors.standing(conn, g.user["uid"], row))


# --- leaderboards --------------------------------------------------------------------------------

@bp.get("/api/leaderboards")
@require_auth
def leaderboards():
    """Every board there is, with its current period and how many players are on it."""
    conn = get_db()
    out = []
    for b in boards.all_boards(dh().catalog):
        key = b.period_key()
        n = conn.execute("SELECT COUNT(*) AS n FROM leaderboards WHERE board=? AND period_key=? AND rank>0",
                         (b.id, key)).fetchone()["n"]
        v = b.view()
        v.update({"periodKey": key, "players": n})
        out.append(v)
    return jsonify({"boards": out})


@bp.get("/api/leaderboards/<bid>")
@require_auth
def leaderboard(bid: str):
    b = boards.get(bid, dh().catalog)
    if b is None:
        raise ApiError(404, "board_not_found", "no such leaderboard")
    conn = get_db()
    key = request.args.get("period") or b.period_key()
    rows = boards.rows_for(conn, b, g.user["uid"], key)
    v = b.view()
    v.update({"periodKey": key, "rows": rows})
    return jsonify(v)


# --- admin: any player's profile (PLAN.md §18.9) -------------------------------------------------

def _admin() -> None:
    if not dh().config.is_admin(g.user["uid"]):
        raise ApiError(403, "forbidden", "admin only")


@bp.get("/api/admin/users")
@require_auth
def admin_users():
    _admin()
    conn = get_db()
    rows = conn.execute("SELECT * FROM users ORDER BY uid").fetchall()
    out = []
    for r in rows:
        c = card(r, g.user["uid"])
        c.update({"isBot": bool(r["is_bot"]), "timeZone": r["time_zone"], "unitSystem": r["unit_system"],
                  "bodyData": loads(r["body_data"]), "createdAt": r["created_at"],
                  "bio": (loads(r["profile"]) or {}).get("bio") or "",
                  "hasAvatar": bool((loads(r["profile"]) or {}).get("avatar"))})
        out.append(c)
    return jsonify({"users": out})


ADMIN_FIELDS = ("displayName", "firstName", "lastName", "country", "public", "bio", "avatar",
                "streakGoal", "bodyData", "timeZone", "unitSystem", "isBot", "username")


@bp.get("/api/admin/users/<int:uid>")
@require_auth
def admin_user(uid: int):
    _admin()
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if row is None:
        raise ApiError(404, "user_not_found", "no such player")
    out = profile_view(conn, row, g.user["uid"])
    out.update({"isBot": bool(row["is_bot"]), "bodyData": loads(row["body_data"]),
                "preferences": loads(row["preferences"])})
    return jsonify(out)


def apply_profile_edits(conn: sqlite3.Connection, uid: int, b: dict[str, Any]) -> list[str]:
    """Write the editable profile fields of one player. Shared by the admin page and `/botapi/upsert`,
    so a bot's profile and a person's are stored by exactly the same code."""
    row = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    if row is None:
        raise ApiError(404, "user_not_found", "no such player")
    sets: list[str] = []
    args: list[Any] = []
    changed: list[str] = []

    def put(column: str, value: Any, name: str) -> None:
        sets.append(f"{column}=?")
        args.append(value)
        changed.append(name)

    if isinstance(b.get("username"), str) and b["username"].strip():
        name = b["username"].strip()
        if not HANDLE.fullmatch(name):
            raise ApiError(400, "bad_username", "a username is 2 to 24 letters, digits, dots, dashes or "
                                                "underscores, starting with a letter or digit")
        if conn.execute("SELECT 1 FROM users WHERE lower(username)=lower(?) AND uid<>?", (name, uid)).fetchone():
            raise ApiError(409, "username_taken", "that username is taken")
        put("username", name, "username")
        put("handle_set", 1, "handle_set")
    if isinstance(b.get("displayName"), str):
        put("display_name", b["displayName"][:80], "displayName")
    for key, column in (("firstName", "first_name"), ("lastName", "last_name")):
        if isinstance(b.get(key), str):
            put(column, b[key].strip()[:NAME_MAX], key)
    if isinstance(b.get("country"), str):
        c = b["country"].strip()
        if c and not COUNTRY.match(c):
            raise ApiError(400, "country_invalid", "a country is a two-letter code, like ES or US")
        put("country", c.upper(), "country")
    if isinstance(b.get("public"), bool):
        put("public", int(b["public"]), "public")
    if isinstance(b.get("isBot"), bool):
        put("is_bot", int(b["isBot"]), "isBot")
    if isinstance(b.get("timeZone"), str) and b["timeZone"]:
        put("time_zone", b["timeZone"][:64], "timeZone")
    if b.get("unitSystem") in ("metric", "us"):
        put("unit_system", b["unitSystem"], "unitSystem")
    if isinstance(b.get("bodyData"), dict):
        put("body_data", dumps({k: v for k, v in b["bodyData"].items()
                                if k in ("height", "weight", "sex", "age")}), "bodyData")
    if isinstance(b.get("preferences"), dict):
        put("preferences", dumps(b["preferences"]), "preferences")
    # The bio and the avatar live inside the profile JSON, so read it first and change only what was sent.
    if isinstance(b.get("bio"), str) or "avatar" in b:
        profile = loads(row["profile"])
        if isinstance(b.get("bio"), str):
            profile["bio"] = b["bio"][:BIO_MAX]
            changed.append("bio")
        if "avatar" in b:
            av = b["avatar"]
            if av is None:
                profile.pop("avatar", None)
            elif isinstance(av, dict):
                profile["avatar"] = av
            else:
                raise ApiError(400, "avatar_invalid", "an avatar is the JSON object the designer saves, or null")
            changed.append("avatar")
        blob = dumps(profile)
        if len(blob) > 32 * 1024:
            raise ApiError(400, "profile_too_big", "the profile must be under 32 KB")
        sets.append("profile=?")
        args.append(blob)
    if sets:
        sets.append("updated_at=?")
        args += [iso(), uid]
        conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE uid=?", args)
        conn.commit()
    # The goal has its own rule: changing it starts the streak again (§18.5). A bot is the exception — see
    # streaks.set_goal — so its whole backfilled history counts.
    goal = b.get("streakGoal")
    if isinstance(goal, int) and not isinstance(goal, bool) and goal in (0, *streaks.GOALS):
        tz = b.get("timeZone") if isinstance(b.get("timeZone"), str) else row["time_zone"]
        is_bot = bool(b.get("isBot")) or bool(row["is_bot"])
        if goal != (row["streak_goal"] or 0):
            streaks.set_goal(conn, uid, goal, tz, from_the_start=is_bot)
            changed.append("streakGoal")
        elif is_bot and (row["streak_from"] or ""):
            # An older bot row still carries a cutoff from before this rule; clear it and recount.
            streaks.set_goal(conn, uid, goal, tz, from_the_start=True)
    return changed


@bp.put("/api/admin/users/<int:uid>")
@require_auth
def admin_put_user(uid: int):
    _admin()
    conn = get_db()
    changed = apply_profile_edits(conn, uid, body())
    finalize.recompute_player(conn, uid)
    row = conn.execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    return jsonify({"changed": changed, "profile": profile_view(conn, row, g.user["uid"])})


@bp.post("/api/admin/users/<int:uid>/updates")
@require_auth
def admin_post_update(uid: int):
    _admin()
    b = body()
    text = b.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ApiError(400, "text_required", "an update needs some text")
    return jsonify(updates.post(get_db(), uid, "manual", text))


@bp.delete("/api/admin/users/<int:uid>/updates/<update_id>")
@require_auth
def admin_delete_update(uid: int, update_id: str):
    _admin()
    if not updates.delete(get_db(), uid, update_id):
        raise ApiError(404, "update_not_found", "no such update")
    return jsonify({"ok": True})


@bp.post("/api/admin/leaderboards/recompute")
@require_auth
def admin_recompute():
    _admin()
    return jsonify({"boards": boards.compute_all(get_db(), dh().catalog)})


@bp.post("/api/admin/users/<int:uid>/recompute")
@require_auth
def admin_recompute_player(uid: int):
    _admin()
    return jsonify(finalize.recompute_player(get_db(), uid))
