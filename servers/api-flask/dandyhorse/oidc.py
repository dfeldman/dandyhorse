"""Sign in with Google (OpenID Connect), through Flask-OIDC (PLAN.md §10.4).

Flask-OIDC, on Authlib, does the protocol: Google's discovery document, state and nonce, the code exchange,
and checking the ID token's signature, issuer, audience and expiry. Its routes are under /oidc: /oidc/login
starts a sign-in, and /oidc/authorize is the redirect URI registered with Google.

This module does the rest. /auth/complete maps the verified Google account (issuer, subject) to a Dandyhorse
user through oidc_identities, making the user on the first sign-in, and sets the same login token as the
development stub. The Flask session cookie (dh_oidc) only carries a sign-in in progress: it is cleared as
soon as the login token is set, so no Google token is kept.
"""
from __future__ import annotations

import html
import json
import logging
import secrets
import sqlite3
from typing import Any

from flask import Blueprint, Flask, Response, current_app, jsonify, redirect, request, session, url_for
from flask_oidc import OpenIDConnect

from . import auth
from .config import Config
from .db import get_db
from .util import iso

log = logging.getLogger("dandyhorse")

GOOGLE_ISSUER = "https://accounts.google.com"
_GOOGLE_ISSUERS = (GOOGLE_ISSUER, "accounts.google.com")  # Google's ID tokens may carry either
EXTENSION = "dh_oidc"

bp = Blueprint("oidc_login", __name__)


def client_secrets(cfg: Config) -> dict[str, Any]:
    """The 'web' block of Google's client_secrets.json, or the client id and secret from the environment."""
    if cfg.google_client_id:
        web: dict[str, Any] = {"client_id": cfg.google_client_id, "client_secret": cfg.google_client_secret}
    else:
        try:
            data = json.loads(cfg.client_secrets_file.read_text())
        except (OSError, ValueError) as e:
            raise RuntimeError(f"Google sign-in: cannot read {cfg.client_secrets_file}: {e}") from e
        web = data.get("web") or data.get("installed") or data
    if not web.get("client_id") or not web.get("client_secret"):
        raise RuntimeError("Google sign-in needs a client id and secret: client_secrets.json in the data folder, "
                           "or DANDYHORSE_GOOGLE_CLIENT_ID and DANDYHORSE_GOOGLE_CLIENT_SECRET")
    # Google's download has no issuer; Flask-OIDC finds the discovery document from it.
    return {"web": {**web, "issuer": web.get("issuer") or GOOGLE_ISSUER}}


def redirect_uri(cfg: Config) -> str:
    return f"{cfg.public_url}/oidc/authorize"


def init_app(app: Flask, cfg: Config) -> None:
    app.config.update(
        OIDC_CLIENT_SECRETS=client_secrets(cfg),
        OIDC_SCOPES="openid email profile",
        # Behind a tunnel the request's own host and scheme are not the public ones, so say it outright.
        OIDC_OVERWRITE_REDIRECT_URI=redirect_uri(cfg),
        # The ID token already carries the email and name: skip the extra userinfo call.
        OIDC_USER_INFO_ENABLED=False,
    )
    app.extensions[EXTENSION] = OpenIDConnect(app, prefix="/oidc")
    app.register_blueprint(bp)
    app.register_error_handler(401, _unauthorized)
    log.info("login: Google sign-in; redirect URI %s", redirect_uri(cfg))


def start(next_path: str) -> Response:
    """Send the browser to Google. It comes back to /auth/complete, which then goes on to next_path."""
    oidc: OpenIDConnect = current_app.extensions[EXTENSION]
    return oidc.redirect_to_auth_server(destination=url_for("oidc_login.complete", next=next_path))


@bp.get("/auth/complete")
def complete():
    """After Google: find or make the user, set the login token, forget the sign-in, go on."""
    cfg = current_app.dh.config  # type: ignore[attr-defined]
    nxt = auth.safe_next(request.args.get("next"))
    token = session.get("oidc_auth_token")
    if not token:  # not signed in with Google yet, or the sign-in cookie was lost: start again
        return start(nxt)
    claims = dict(token.get("userinfo") or {})
    session.clear()
    issuer = GOOGLE_ISSUER if claims.get("iss") in _GOOGLE_ISSUERS else claims.get("iss")
    subject = claims.get("sub")
    email = str(claims.get("email") or "").strip().lower()
    if issuer != GOOGLE_ISSUER or not isinstance(subject, str) or not subject:
        return page("Sign-in failed", "Google did not say who you are.", 400, retry=nxt)
    if claims.get("email_verified") is not True or not email:
        return page("Sign-in failed", "Your Google account's email address is not verified yet.", 403, retry=nxt)
    if cfg.allowed_emails and email not in cfg.allowed_emails:
        log.info("sign-in refused: %s is not in DANDYHORSE_ALLOWED_EMAILS", email)
        return page("Not on the guest list",
                    f"{email} is not on this server's guest list. Ask whoever runs it to add you.", 403)
    uid = user_for(get_db(), issuer, subject, email, claims)
    login_token = auth.issue(uid, request.headers.get("User-Agent", "")[:120])
    return auth.set_cookie(redirect(nxt), login_token)


def user_for(conn: sqlite3.Connection, issuer: str, subject: str, email: str, claims: dict[str, Any]) -> int:
    """The uid for a Google account, making the user on its first sign-in."""
    t = iso()
    conn.execute("BEGIN IMMEDIATE")  # one sign-in at a time, so a double click cannot make two users
    try:
        row = conn.execute("SELECT uid FROM oidc_identities WHERE issuer=? AND subject=?",
                           (issuer, subject)).fetchone()
        if row is not None:
            uid = int(row["uid"])
            conn.execute("UPDATE oidc_identities SET email=?, last_login_at=? WHERE issuer=? AND subject=?",
                         (email, t, issuer, subject))
        else:
            uid = _new_user(conn, str(claims.get("given_name") or claims.get("name") or "").strip()[:80] or None, t)
            conn.execute(
                "INSERT INTO oidc_identities(issuer, subject, uid, email, created_at, last_login_at) "
                "VALUES (?,?,?,?,?,?)", (issuer, subject, uid, email, t, t))
            log.info("new user %s, signed in with Google as %s", uid, email)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return uid


def _new_user(conn: sqlite3.Connection, display_name: str | None, t: str) -> int:
    """A user with a placeholder username until they pick one (the console asks at once)."""
    for _ in range(5):
        try:
            cur = conn.execute(
                "INSERT INTO users(username, display_name, handle_set, created_at, updated_at) VALUES (?,?,0,?,?)",
                (f"rider-{secrets.token_hex(4)}", display_name, t, t))
        except sqlite3.IntegrityError:  # the placeholder is taken: roll again
            continue
        return int(cur.lastrowid)  # type: ignore[arg-type]
    raise RuntimeError("could not make a placeholder username")


def _unauthorized(_e):
    """Flask-OIDC answers a cancelled or failed sign-in with 401; say so in words and offer another go."""
    if request.path.startswith("/oidc/"):
        return page("Sign-in didn't finish", "Google sign-in was cancelled or did not go through.", 401,
                    retry=auth.safe_next(None))
    return jsonify({"error": {"code": "unauthorized", "message": "log in first"}}), 401


def page(title: str, message: str, status: int, retry: str | None = None) -> tuple[str, int]:
    """A small page for the browser, for the ends of the sign-in that are not API calls."""
    again = (f'<p><a class="btn" href="/login?next={html.escape(retry, quote=True)}">Try again</a></p>'
             if retry else "")
    return (f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)} · Dandyhorse</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;background:#f6f5f2;color:#1d1d1f;display:grid;place-items:center;
min-height:100vh;margin:0}}main{{max-width:28rem;padding:2rem;background:#fff;border-radius:12px;
box-shadow:0 1px 4px #0002}}h1{{font-size:1.3rem;margin:0 0 .5rem}}.btn{{display:inline-block;padding:.5rem 1rem;
border-radius:8px;background:#1d1d1f;color:#fff;text-decoration:none}}</style></head>
<body><main><h1>{html.escape(title)}</h1><p>{html.escape(message)}</p>{again}</main></body></html>""", status)
