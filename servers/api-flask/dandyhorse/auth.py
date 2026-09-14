"""Stub login (uid parameter -> token cookie) and request authentication.

Later replaced by OIDC; the token table and cookie stay the same.
"""
from __future__ import annotations

import secrets
import sqlite3
from functools import wraps
from typing import Any, Callable

from flask import Response, current_app, g, request

from .db import get_db
from .util import ApiError, iso, loads

COOKIE = "dh_token"


def _new_user(conn: sqlite3.Connection, uid: int) -> None:
    t = iso()
    conn.execute(
        "INSERT INTO users(uid, username, display_name, created_at, updated_at) VALUES (?,?,?,?,?)",
        (uid, f"user{uid}", f"User {uid}", t, t),
    )


def login(uid: int, label: str | None = None) -> str:
    conn = get_db()
    if conn.execute("SELECT 1 FROM users WHERE uid=?", (uid,)).fetchone() is None:
        _new_user(conn, uid)
    token = secrets.token_urlsafe(32)
    t = iso()
    conn.execute(
        "INSERT INTO tokens(token, uid, label, created_at, last_used_at) VALUES (?,?,?,?,?)",
        (token, uid, label, t, t),
    )
    conn.commit()
    return token


def set_cookie(resp: Response, token: str) -> Response:
    resp.set_cookie(
        COOKIE, token, httponly=True, samesite="Lax",
        secure=current_app.dh.config.secure_cookie,  # type: ignore[attr-defined]
        max_age=60 * 60 * 24 * 365,
    )
    return resp


def revoke(token: str) -> None:
    conn = get_db()
    conn.execute("UPDATE tokens SET revoked=1 WHERE token=?", (token,))
    conn.commit()


def _token_from_request() -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE)


def user_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for k in ("profile", "achievements", "body_data", "preferences"):
        d[k] = loads(d.get(k))
    d["public"] = bool(d["public"])
    return d


def load_user(uid: int) -> dict[str, Any] | None:
    row = get_db().execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    return user_from_row(row) if row else None


def current_user() -> dict[str, Any] | None:
    if "user" in g:
        return g.user
    token = _token_from_request()
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT u.* FROM tokens t JOIN users u ON u.uid=t.uid WHERE t.token=? AND t.revoked=0",
        (token,),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE tokens SET last_used_at=? WHERE token=?", (iso(), token))
    conn.commit()
    g.user = user_from_row(row)
    g.token = token
    return g.user


def require_auth(fn: Callable) -> Callable:
    @wraps(fn)
    def wrapper(*a: Any, **kw: Any) -> Any:
        if current_user() is None:
            raise ApiError(401, "unauthorized", "log in first")
        return fn(*a, **kw)
    return wrapper
