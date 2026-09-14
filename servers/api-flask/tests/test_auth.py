"""Login: encrypted tokens, the stub's limits, and Google sign-in (oidc.py) with Google stood in for."""
import base64
import json
import time
from urllib.parse import parse_qs, urlparse

from conftest import make_app
from dandyhorse import db, util

GOOGLE = "https://accounts.google.com"


def bearer(tok: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def stub_token(app, uid: int = 7) -> str:
    r = app.test_client().post("/api/login", json={"uid": uid})
    assert r.status_code == 200
    return r.get_json()["token"]


def oidc_app(root, **over):
    app = make_app(root, AUTH="oidc", GOOGLE_CLIENT_ID="cid.apps.googleusercontent.com",
                   GOOGLE_CLIENT_SECRET="shh", PUBLIC_URL="https://dh.example.com", **over)
    # Google's discovery document, as if fetched already: the tests never touch the network
    app.extensions["dh_oidc"].oauth.oidc.server_metadata.update({
        "issuer": GOOGLE, "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs", "_loaded_at": time.time()})
    return app


def google(client, sub="109876543210987654321", email="robin@example.com", verified=True,
           nxt="/consoles/web/", **claims):
    """Stand in for Flask-OIDC's /oidc/authorize: the verified ID token's claims in the sign-in cookie."""
    with client.session_transaction() as s:
        s["oidc_auth_token"] = {"access_token": "at", "expires_at": int(time.time()) + 3600,
                                "userinfo": {"iss": GOOGLE, "sub": sub, "email": email, "email_verified": verified,
                                             "given_name": "Robin", **claims}}
    return client.get("/auth/complete", query_string={"next": nxt})


def identities(app) -> list[dict]:
    conn = db.connect(app.dh.config.db_path)
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM oidc_identities ORDER BY uid")]
    finally:
        conn.close()


# --- tokens -----------------------------------------------------------------------

def test_login_token_is_an_encrypted_jwt(app):
    tok = stub_token(app)
    assert tok.count(".") == 4  # JWE compact: header, key, iv, ciphertext, tag
    header = json.loads(base64.urlsafe_b64decode(tok.split(".")[0] + "=="))
    assert header["alg"] == "dir" and header["enc"] == "A256GCM"
    assert app.test_client().get("/api/me", headers=bearer(tok)).get_json()["uid"] == 7


def test_tampered_foreign_and_junk_tokens_are_refused(app, root, tmp_path):
    tok = stub_token(app)
    parts = tok.split(".")
    parts[3] = ("B" if parts[3][0] == "A" else "A") + parts[3][1:]
    c = app.test_client()
    for bad in [".".join(parts), "abc", "a.b.c.d.e", "Bearer", tok[:-4]]:
        assert c.get("/api/me", headers=bearer(bad)).status_code == 401, bad
    other = make_app(root, DATA_DIR=str(tmp_path / "other-data"))  # another server: another secret
    assert other.test_client().get("/api/me", headers=bearer(tok)).status_code == 401


def test_expired_and_revoked_tokens_are_refused(app):
    past = time.time() - 366 * 24 * 3600
    util.set_clock(lambda: past)
    try:
        old = stub_token(app)
    finally:
        util.set_clock(None)
    assert app.test_client().get("/api/me", headers=bearer(old)).status_code == 401
    tok = stub_token(app)
    c = app.test_client()
    assert c.post("/api/logout", headers=bearer(tok), json={}).status_code == 200
    assert c.get("/api/me", headers=bearer(tok)).status_code == 401


def test_tokens_survive_a_restart(root):
    a = make_app(root)
    tok = stub_token(a)
    assert (a.dh.config.data_dir / "secret.key").stat().st_mode & 0o777 == 0o600
    b = make_app(root)  # same data folder, so the same secret.key
    assert b.test_client().get("/api/me", headers=bearer(tok)).status_code == 200


# --- the stub ---------------------------------------------------------------------

def test_stub_login_refuses_requests_through_a_tunnel(app):
    c = app.test_client()
    tunnel = {"Cf-Connecting-Ip": "203.0.113.9"}
    r = c.post("/api/login", json={"uid": 7}, headers=tunnel)
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "stub_local_only"
    assert c.get("/login?uid=7", headers=tunnel).status_code == 403
    assert c.get("/api/auth").get_json() == {"mode": "stub", "loginUrl": "/login"}


def test_stub_login_only_goes_back_to_this_server(app):
    c = app.test_client()
    home = app.dh.catalog.default_app_url("consoles")
    for bad in ["//evil.example/", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"]:
        assert c.get("/login", query_string={"uid": 7, "next": bad}).location == home, bad
    assert c.get("/login", query_string={"uid": 7, "next": "/bridges/web/#/x"}).location == "/bridges/web/#/x"
    assert c.get("/login?next=/bridges/web/").location == "/bridges/web/"  # no uid: the login screen there


# --- Google -----------------------------------------------------------------------

def test_google_sign_in_turns_the_stub_off(root):
    c = oidc_app(root).test_client()
    assert c.get("/api/auth").get_json() == {"mode": "oidc", "loginUrl": "/login"}
    r = c.post("/api/login", json={"uid": 1})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "stub_disabled"
    # the games' "log in and come back" links carry ?uid=1: under Google it is ignored, never obeyed
    r = c.get("/login?uid=1&next=/games/rollinghills/")
    assert r.status_code == 302 and r.location.startswith("/oidc/login?next=")
    assert c.get("/api/me").status_code == 401


def test_login_goes_to_google_with_the_public_redirect_uri(root):
    c = oidc_app(root).test_client()
    r = c.get("/login?next=/bridges/web/")
    assert r.status_code == 302 and r.location.startswith("/oidc/login?next=")
    r = c.get(r.location)
    assert r.status_code == 302 and r.location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    q = parse_qs(urlparse(r.location).query)
    assert q["redirect_uri"] == ["https://dh.example.com/oidc/authorize"]
    assert q["client_id"] == ["cid.apps.googleusercontent.com"]
    assert q["scope"] == ["openid email profile"] and q["state"] and q["nonce"]
    with c.session_transaction() as s:
        assert s["next"] == "/auth/complete?next=/bridges/web/"


def test_first_sign_in_makes_a_user_who_then_picks_a_username(root):
    app = oidc_app(root)
    c = app.test_client()
    r = google(c)
    assert r.status_code == 302 and r.location == "/consoles/web/"
    with c.session_transaction() as s:
        assert dict(s) == {}  # the sign-in cookie is emptied: no Google token is kept
    me = c.get("/api/me").get_json()
    assert me["needsHandle"] is True and me["username"].startswith("rider-") and me["displayName"] == "Robin"
    assert c.put("/api/me", json={"username": "x"}).status_code == 400
    assert c.put("/api/me", json={"username": "no spaces"}).status_code == 400
    me2 = c.put("/api/me", json={"username": "robin_r"}).get_json()
    assert me2["needsHandle"] is False and me2["username"] == "robin_r"

    # signing in again, anywhere: the same user, with the email as Google has it now
    c2 = app.test_client()
    google(c2, email="Robin@Example.org")
    assert c2.get("/api/me").get_json()["uid"] == me["uid"]
    [ident] = identities(app)
    assert ident["subject"] == "109876543210987654321" and ident["issuer"] == GOOGLE
    assert ident["uid"] == me["uid"] and ident["email"] == "robin@example.org"


def test_keeping_the_placeholder_username_still_counts_as_picking_it(root):
    c = oidc_app(root).test_client()
    google(c)
    name = c.get("/api/me").get_json()["username"]
    assert c.put("/api/me", json={"username": name}).get_json()["needsHandle"] is False


def test_each_google_account_is_its_own_user_and_usernames_are_unique(root):
    app = oidc_app(root)
    a, b = app.test_client(), app.test_client()
    google(a, sub="1", email="a@example.com")
    google(b, sub="2", email="b@example.com")
    ua, ub = a.get("/api/me").get_json(), b.get("/api/me").get_json()
    assert ua["uid"] != ub["uid"]
    assert a.put("/api/me", json={"username": "Robin"}).status_code == 200
    r = b.put("/api/me", json={"username": "robin"})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "username_taken"
    assert [i["subject"] for i in identities(app)] == ["1", "2"]


def test_unverified_and_uninvited_emails_are_refused(root):
    app = oidc_app(root, ALLOWED_EMAILS="friend@example.com, Me@Example.com")
    c = app.test_client()
    r = google(c, email="stranger@example.com")
    assert r.status_code == 403 and b"guest list" in r.data
    assert google(c, email="me@example.com", verified=False).status_code == 403
    assert identities(app) == []
    assert google(c, email="ME@example.com").status_code == 302  # the list ignores case
    assert c.get("/api/me").status_code == 200


def test_after_google_the_browser_only_goes_back_to_this_server(root):
    app = oidc_app(root)
    home = app.dh.catalog.default_app_url("consoles")
    for bad in ["//evil.example/", "https://evil.example/", "/\\evil.example"]:
        assert google(app.test_client(), nxt=bad).location == home, bad
    assert google(app.test_client(), nxt="/bridges/web/#/x").location == "/bridges/web/#/x"


def test_complete_without_a_google_sign_in_starts_one(root):
    r = oidc_app(root).test_client().get("/auth/complete?next=/bridges/web/")
    assert r.status_code == 302 and r.location.startswith("/oidc/login?next=")


def test_a_cancelled_sign_in_gets_a_page_not_json(root):
    r = oidc_app(root).test_client().get("/oidc/authorize?error=access_denied&state=nope")
    assert r.status_code == 401 and b"Try again" in r.data
