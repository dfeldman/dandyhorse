"""Login tokens and request authentication.

A login token is an encrypted JWT (JWE: dir, A256GCM) holding the uid and a token id (jti): nobody can read
or forge one without the server's secret. Every token also has a row in the tokens table, keyed by its jti,
so logging out revokes it. Both ways in hand out the same token: the development stub (a user number,
login() here) and Google sign-in (oidc.py).
"""
from __future__ import annotations

import os
import secrets
import sqlite3
from functools import wraps
from typing import Any, Callable

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from flask import Response, current_app, g, request
from joserfc import jwt
from joserfc.jwe import JWERegistry
from joserfc.jwk import OctKey

from .config import Config
from .db import get_db
from .util import ApiError, iso, loads, now

COOKIE = "dh_token"
TOKEN_SECONDS = 365 * 24 * 3600  # as long as the cookie; logging out revokes a token sooner
_HEADER = {"alg": "dir", "enc": "A256GCM"}
_JWE = JWERegistry(algorithms=["dir", "A256GCM"])


# --- the server's secret -------------------------------------------------------

def master_secret(cfg: Config) -> bytes:
    """DANDYHORSE_SECRET_KEY, else data/secret.key: made on first start, readable only by its owner."""
    if cfg.secret_key:
        return cfg.secret_key.encode()
    path = cfg.data_dir / "secret.key"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return path.read_bytes().strip()
    with os.fdopen(fd, "w") as f:
        f.write(secrets.token_hex(32))
    return path.read_bytes().strip()


def derive(master: bytes, purpose: str) -> bytes:
    """A 256-bit key for one purpose, so the token key and the cookie-signing key are never the same."""
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=f"dandyhorse {purpose}".encode()).derive(master)


def token_key(master: bytes) -> OctKey:
    return OctKey.import_key(derive(master, "login token"))


def _key() -> OctKey:
    return current_app.dh.token_key  # type: ignore[attr-defined]


# --- tokens --------------------------------------------------------------------

def issue(uid: int, label: str | None = None) -> str:
    """A new login token for uid: its revocable row, and the encrypted JWT that names it."""
    jti = secrets.token_urlsafe(16)
    t = now()
    conn = get_db()
    conn.execute(
        "INSERT INTO tokens(token, uid, label, created_at, last_used_at) VALUES (?,?,?,?,?)",
        (jti, uid, label, iso(t), iso(t)),
    )
    conn.commit()
    claims = {"uid": uid, "jti": jti, "iat": int(t), "exp": int(t) + TOKEN_SECONDS}
    return jwt.encode(_HEADER, claims, _key(), registry=_JWE)


def read(token: str) -> dict[str, Any] | None:
    """The claims of an unexpired login token this server made; None for anything else."""
    try:
        claims = jwt.decode(token, _key(), registry=_JWE).claims
    except Exception:  # noqa: BLE001 -- whatever fails to decrypt is simply not a login
        return None
    uid, jti, exp = claims.get("uid"), claims.get("jti"), claims.get("exp")
    if not isinstance(uid, int) or isinstance(uid, bool) or not isinstance(jti, str):
        return None
    if not isinstance(exp, (int, float)) or exp <= now():
        return None
    return claims


def _new_user(conn: sqlite3.Connection, uid: int) -> None:
    t = iso()
    # `public` is named rather than left to the column default: a database made before PLAN.md §18.1 still
    # has the old default of 0, and a new account there should be public like any other.
    conn.execute(
        "INSERT INTO users(uid, username, display_name, public, created_at, updated_at) VALUES (?,?,?,1,?,?)",
        (uid, f"user{uid}", f"User {uid}", t, t),
    )


def login(uid: int, label: str | None = None) -> str:
    """The development stub: log in as user `uid`, making the user if new."""
    conn = get_db()
    if conn.execute("SELECT 1 FROM users WHERE uid=?", (uid,)).fetchone() is None:
        _new_user(conn, uid)
    return issue(uid, label)


def set_cookie(resp: Response, token: str) -> Response:
    resp.set_cookie(
        COOKIE, token, httponly=True, samesite="Lax",
        secure=current_app.dh.config.secure_cookie,  # type: ignore[attr-defined]
        max_age=TOKEN_SECONDS,
    )
    return resp


def revoke(jti: str) -> None:
    conn = get_db()
    conn.execute("UPDATE tokens SET revoked=1 WHERE token=?", (jti,))
    conn.commit()


def safe_next(value: str | None) -> str:
    """A path on this server to go to after logging in. Anything else (another site, //host) goes to the console."""
    if (not value or not value.startswith("/") or value.startswith(("//", "/\\")) or len(value) > 200
            or any(ord(c) < 32 for c in value)):
        return current_app.dh.catalog.default_app_url("consoles")  # type: ignore[attr-defined]
    return value


# --- requests ------------------------------------------------------------------

def _token_from_request() -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE)


def user_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for k in ("profile", "achievements", "body_data", "preferences", "fitness"):
        d[k] = loads(d.get(k))
    d["public"] = bool(d["public"])
    d["handle_set"] = bool(d.get("handle_set", 1))
    return d


def load_user(uid: int) -> dict[str, Any] | None:
    row = get_db().execute("SELECT * FROM users WHERE uid=?", (uid,)).fetchone()
    return user_from_row(row) if row else None


def current_user() -> dict[str, Any] | None:
    if "user" in g:
        return g.user
    token = _token_from_request()
    claims = read(token) if token else None
    if claims is None:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT u.* FROM tokens t JOIN users u ON u.uid=t.uid WHERE t.token=? AND t.uid=? AND t.revoked=0",
        (claims["jti"], claims["uid"]),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE tokens SET last_used_at=? WHERE token=?", (iso(), claims["jti"]))
    conn.commit()
    g.user = user_from_row(row)
    g.token = claims["jti"]
    return g.user


def require_auth(fn: Callable) -> Callable:
    @wraps(fn)
    def wrapper(*a: Any, **kw: Any) -> Any:
        if current_user() is None:
            raise ApiError(401, "unauthorized", "log in first")
        return fn(*a, **kw)
    return wrapper
