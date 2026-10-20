"""/botapi/* — the bot players' way in (PLAN.md §18.8).

Bots are ordinary users that play the real games in a headless browser. They cannot sign in with Google and
there is no password anywhere in this platform, so the bot runner holds one shared API token
(`DANDYHORSE_BOT_TOKEN`, in the repo's git-ignored `.env`) and exchanges it for a normal login token per bot.
Everything after that — launching, the bridge, the game API — is the same code every player uses.

`/botapi/backdate` is the one thing bots need that people do not: moving a finished session into the past, so
the platform looks lived-in from the first day. It is not a timestamp update — session ids are ULIDs, history
pages on `(created_at, session_id)`, and logs live in month folders — so the session is given a new id for its
new instant and its files are moved with it.
"""
from __future__ import annotations

import sqlite3
from functools import wraps
from typing import Any, Callable

from flask import Blueprint, jsonify, request

from .. import auth
from ..db import get_db
from ..social import boards, finalize
from ..util import ApiError, iso, parse_iso, ulid
from . import body, dh
from .socialapi import HANDLE, apply_profile_edits

bp = Blueprint("botapi", __name__, url_prefix="/botapi")

# Bot accounts are numbered from here, well clear of the people who signed in first.
BOT_UID_BASE = 1001


def require_bot_token(fn: Callable) -> Callable:
    """`Authorization: Bearer <DANDYHORSE_BOT_TOKEN>`, compared in constant time."""
    @wraps(fn)
    def wrapper(*a: Any, **kw: Any) -> Any:
        import secrets
        want = dh().config.bot_token
        if not want:
            raise ApiError(404, "bots_disabled", "this server has no bot token set")
        got = request.headers.get("Authorization", "")
        got = got[7:].strip() if got.startswith("Bearer ") else ""
        if not got or not secrets.compare_digest(got, want):
            raise ApiError(401, "unauthorized", "a valid bot token is required")
        return fn(*a, **kw)
    return wrapper


def _bot_row(conn: sqlite3.Connection, username: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM users WHERE lower(username)=lower(?) AND is_bot=1", (username,)).fetchone()


def _username(b: dict[str, Any]) -> str:
    name = b.get("username")
    if not isinstance(name, str) or not name.strip():
        raise ApiError(400, "username_required", "username required")
    name = name.strip()
    # Checked here as well as in apply_profile_edits, because upsert inserts the row before it runs.
    if not HANDLE.fullmatch(name):
        raise ApiError(400, "bad_username", "a bot's username follows the same rule as a person's: 2 to 24 "
                                            "letters, digits, dots, dashes or underscores")
    return name


@bp.post("/upsert")
@require_bot_token
def upsert():
    """Create or update a bot from its `bots.json` entry. The profile fields go through exactly the same
    code as the admin page's (`socialapi.apply_profile_edits`)."""
    b = body()
    name = _username(b)
    conn = get_db()
    row = _bot_row(conn, name)
    if row is None:
        taken = conn.execute("SELECT is_bot FROM users WHERE lower(username)=lower(?)", (name,)).fetchone()
        if taken is not None:
            raise ApiError(409, "username_taken", f"{name!r} is a person's username, not a bot's")
        top = conn.execute("SELECT MAX(uid) AS m FROM users").fetchone()["m"] or 0
        uid = max(BOT_UID_BASE, top + 1)
        t = iso()
        conn.execute("INSERT INTO users(uid, username, display_name, is_bot, public, created_at, updated_at) "
                     "VALUES (?,?,?,1,1,?,?)", (uid, name, b.get("displayName") or name, t, t))
        conn.commit()
    else:
        uid = row["uid"]
    edits = dict(b)
    edits["isBot"] = True
    changed = apply_profile_edits(conn, uid, edits)
    finalize.recompute_player(conn, uid)
    return jsonify({"uid": uid, "username": name, "created": row is None, "changed": changed})


@bp.post("/token")
@require_bot_token
def token():
    """A normal login token for one bot, so the runner drives the ordinary APIs."""
    conn = get_db()
    name = _username(body())
    row = _bot_row(conn, name)
    if row is None:
        raise ApiError(404, "bot_not_found", f"no bot called {name!r} — upsert it first")
    tok = auth.issue(row["uid"], "bot runner")
    return jsonify({"uid": row["uid"], "username": row["username"], "token": tok})


@bp.get("/bots")
@require_bot_token
def list_bots():
    rows = get_db().execute("SELECT uid, username, display_name FROM users WHERE is_bot=1 ORDER BY uid").fetchall()
    return jsonify({"bots": [{"uid": r["uid"], "username": r["username"], "displayName": r["display_name"]}
                             for r in rows]})


# --- backdating ----------------------------------------------------------------------------------

def _move(src_dir, dst_dir, old_rel: str | None, new_rel: str | None) -> None:
    if not old_rel or not new_rel or old_rel == new_rel:
        return
    src, dst = src_dir / old_rel, dst_dir / new_rel
    if src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.replace(dst)


@bp.post("/backdate")
@require_bot_token
def backdate():
    """Move a finished session to `startedAt` (an ISO time or epoch seconds), keeping its duration.

    Mints a new ULID for that instant so history still sorts, moves the log, timeline and picture into the
    month folder for the new date, and carries the session's timeline update with it.
    """
    from ..sessions import log as logmod

    b = body()
    sid = b.get("sessionId")
    when = b.get("startedAt")
    if not isinstance(sid, str) or not sid:
        raise ApiError(400, "session_required", "sessionId required")
    start = parse_iso(when) if isinstance(when, str) else (float(when) if isinstance(when, (int, float)) else None)
    if start is None:
        raise ApiError(400, "started_at_required", "startedAt must be an ISO time or epoch seconds")
    conn = get_db()
    row = conn.execute("SELECT * FROM sessions WHERE session_id=?", (sid,)).fetchone()
    if row is None:
        raise ApiError(404, "session_not_found", "no such session")
    if not conn.execute("SELECT 1 FROM users WHERE uid=? AND is_bot=1", (row["uid"],)).fetchone():
        raise ApiError(403, "forbidden", "only a bot's sessions may be backdated")
    if row["status"] not in ("complete", "discarded"):
        raise ApiError(409, "session_running", "a session is backdated once it has finished")

    duration = row["duration"] or 0.0
    created = start - max(0.0, (parse_iso(row["started_at"]) or start) - (parse_iso(row["created_at"]) or start))
    new_sid = ulid(created)
    sessions_dir = dh().config.sessions_dir

    old_log = row["log_file"]
    new_log = logmod.relpath(new_sid, created) if old_log else None
    if old_log and new_log and old_log.endswith(".gz") and not new_log.endswith(".gz"):
        new_log += ".gz"
    # The derived timeline and the picture sit beside the log under the same stem.
    old_stem = old_log.split(".")[0] if old_log else None
    new_stem = new_log.split(".")[0] if new_log else None
    _move(sessions_dir, sessions_dir, old_log, new_log)
    if old_stem and new_stem:
        for suffix in (".timeline.json.gz", ".png", ".jpg"):
            _move(sessions_dir, sessions_dir, old_stem + suffix, new_stem + suffix)
    new_image = None
    if row["image_file"] and old_stem and new_stem:
        new_image = row["image_file"].replace(old_stem, new_stem, 1)

    conn.execute(
        "UPDATE sessions SET session_id=?, created_at=?, started_at=?, ended_at=?, log_file=?, image_file=?, "
        "updated_at=? WHERE session_id=?",
        (new_sid, iso(created), iso(start), iso(start + duration), new_log, new_image, iso(), sid))
    # The session's own timeline update moves with it, id and all, so the profile reads in order.
    for upd in conn.execute("SELECT update_id FROM profile_updates WHERE session_id=?", (sid,)).fetchall():
        fresh = ulid(start + duration)
        conn.execute("UPDATE profile_updates SET update_id=?, session_id=?, created_at=? WHERE update_id=?",
                     (fresh, new_sid, iso(start + duration), upd["update_id"]))
        conn.execute("UPDATE update_cheers SET update_id=? WHERE update_id=?", (fresh, upd["update_id"]))
    conn.commit()

    finalize.recompute_player(conn, row["uid"])
    boards.compute_all(conn, dh().catalog)
    return jsonify({"sessionId": new_sid, "wasSessionId": sid, "startedAt": iso(start),
                    "endedAt": iso(start + duration), "logFile": new_log})
