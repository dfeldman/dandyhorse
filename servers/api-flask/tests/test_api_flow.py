"""End-to-end HTTP tests: console launch -> bridge -> game -> end, plus edge cases."""
import gzip
import json
import time

from conftest import make_app, other_client

BIKE_DEV = [{"role": "fitness", "type": "bike", "name": "Sim bike", "address": "sim:bike", "protocol": "simulator", "status": "simulated"}]
TM_DEV = [{"role": "fitness", "type": "treadmill", "name": "TM", "address": "aa:bb", "protocol": "ftms", "status": "connected"}]


def launch(client, variant="bike", debug=True, **kw):
    r = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": variant, "debug": debug, **kw})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def test_login_and_me(client):
    me = client.get("/api/me").get_json()
    assert me["uid"] == 7 and me["username"] == "user7" and me["unitSystem"] == "metric"
    assert client.get("/api/games").get_json()["games"][0]["id"] == "mockgame"
    anon = client.application.test_client()
    assert anon.get("/api/me").status_code == 401


def test_static_dist_first(client):
    assert b"consoles dist" in client.get("/consoles/web/").data
    assert client.get("/").status_code == 302
    assert client.get("/bridge/").headers["Location"].startswith("/bridges/web/")
    assert b"mock" in client.get("/games/mockgame/index.html").data
    assert client.get("/games/mockgame/metadata.json").status_code == 200
    assert client.get("/games/../servers/x").status_code == 404


def test_full_flow(client):
    l = launch(client)
    sid = l["sessionId"]
    assert l["bridgeUrl"].endswith(f"#/session/{sid}?game=1")
    cur = client.get("/api/sessions/current").get_json()["session"]
    assert cur["status"] == "pending" and cur["gameEntryUrl"].startswith("/games/mockgame/index.html?session=")

    # bridge joins before the game starts
    bs = client.get("/bridgeapi/getstate?bridgeId=b1").get_json()
    assert bs["session"]["sessionId"] == sid and bs["session"]["controls"] == "grade"
    assert bs["limits"]["gradeCap"] == 20.0

    # game starts
    r = client.post("/gameapi/startsession", json={"sessionId": sid, "route": "Loop"})
    assert r.status_code == 200
    st = r.get_json()
    assert st["deviceType"] == "bike" and st["debug"] is True and st["username"] == "user7"
    assert st["preferences"] == {"global": {}, "device": {}, "game": {}}

    # game tick with a prompt and an achievement (debug: achievement ignored)
    r = client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 9.0, "grade": 4.5, "x": 0, "y": 0, "z": 0,
                                                "requestedInput": {"promptId": "p1", "prompt": "Way?", "choices": ["L", "R"]},
                                                "achievements": ["fast"], "custom": {"lap": 1}})
    assert r.status_code == 200 and r.get_json()["sessionStatus"] == "active"

    # bridge sees the request and the prompt, reports commanded/actual
    bs = client.get("/bridgeapi/getstate?bridgeId=b1").get_json()
    assert bs["requested"]["grade"] == 4.5 and bs["requestedInput"]["promptId"] == "p1"
    r = client.post("/bridgeapi/putstate", json={"bridgeId": "b1", "label": "laptop", "devices": BIKE_DEV,
                                                  "commanded": {"grade": 4.5}, "actual": {"power": 200, "cadence": 90}})
    assert r.get_json()["ignored"] == []
    r = client.post("/bridgeapi/sendinput", json={"bridgeId": "b1", "promptId": "p1", "choice": "R"})
    assert r.get_json()["accepted"] is True
    assert client.post("/bridgeapi/sendinput", json={"bridgeId": "b1", "promptId": "p1", "choice": "L"}).get_json()["accepted"] is False

    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["sessionStatus"] == "active"
    assert gs["grade"] == {"requested": 4.5, "commanded": 4.5, "actual": None}
    assert gs["power"]["actual"] == 200 and gs["cadence"]["actual"] == 90
    assert gs["input"]["choice"] == "R" and gs["requestedInput"] is None
    assert gs["owner"]["fitness"] == "b1" and gs["bridges"][0]["label"] == "laptop"
    assert gs["custom"] == {"lap": 1}

    # simulators are never auto-registered; a real device would be. Register the sim explicitly.
    assert client.get("/api/devices").get_json()["devices"] == []
    client.post("/bridgeapi/putstate", json={"bridgeId": "b1", "devices": [{"role": "fitness", "type": "bike", "name": "KICKR",
                                              "address": "aa:11", "protocol": "ftms", "status": "connected"}], "actual": {"power": 1}})
    assert [d["address"] for d in client.get("/api/devices").get_json()["devices"]] == ["aa:11"]
    client.post("/bridgeapi/devices", json={"type": "bike", "address": "sim:bike", "name": "Sim bike", "protocol": "sim"})
    devs = [d for d in client.get("/api/devices").get_json()["devices"] if d["address"] == "sim:bike"]
    assert devs[0]["type"] == "bike"
    # back on the simulator: prefs of the currently reported device change limits immediately
    client.post("/bridgeapi/putstate", json={"bridgeId": "b1", "devices": [{"role": "fitness", "type": "bike", "name": "sim",
                                              "address": "sim:bike", "protocol": "sim", "status": "simulated"}], "actual": {"power": 200}})
    client.put(f"/api/devices/{devs[0]['deviceId']}", json={"preferences": {"gradeCap": 8, "difficulty": 0.5}})
    bs = client.get("/bridgeapi/getstate?bridgeId=b1").get_json()
    assert bs["limits"]["gradeCap"] == 8.0 and bs["limits"]["difficulty"] == 0.5

    # second tick, then end
    client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 9.0, "grade": 4.5, "x": 9, "y": 0.4, "z": 0})
    r = client.post("/gameapi/endsession", json={"sessionId": sid, "status": "complete"})
    s = r.get_json()
    assert s["status"] == "complete" and s["endReason"] == "completed" and s["hasLog"]
    assert s["route"] == "Loop"
    assert client.get(f"/gameapi/getstate?session={sid}").get_json()["sessionStatus"] == "complete"
    assert client.get("/api/sessions/current").get_json()["session"] is None
    tl = client.get(f"/api/sessions/{sid}/timeline").get_json()["timeline"]
    assert tl and tl[-1]["power"]["actual"] == 200
    lst = client.get("/api/sessions").get_json()["sessions"]
    assert lst[0]["sessionId"] == sid
    raw = gzip.decompress(client.get(f"/api/sessions/{sid}/log").data).decode()
    kinds = [json.loads(l)["k"] for l in raw.strip().splitlines()]
    assert kinds[0] == "header" and "input" in kinds and kinds[-1] == "end"
    # debug session earns nothing
    assert client.get("/api/me").get_json()["achievements"] == {}
    # soft delete
    assert client.delete(f"/api/sessions/{sid}").status_code == 200
    assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_supersede_and_single_active_session(client):
    a = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": a})
    b = launch(client, variant="treadmill")["sessionId"]
    assert client.get(f"/gameapi/getstate?session={a}").get_json()["sessionStatus"] == "discarded"
    r = client.post("/gameapi/setstate", json={"sessionId": a, "speed": 1})
    assert r.status_code == 410
    assert client.get("/api/sessions/current").get_json()["session"]["sessionId"] == b
    old = client.get(f"/api/sessions/{a}").get_json()
    assert old["endReason"] == "superseded"


def test_adhoc_start_and_non_debug_simulator_ignored(client):
    r = client.post("/gameapi/startsession", json={"gameId": "mockgame", "variant": "treadmill", "debug": False})
    sid = r.get_json()["sessionId"]
    r = client.post("/bridgeapi/putstate", json={"bridgeId": "sim", "devices": [dict(BIKE_DEV[0], type="treadmill")],
                                                  "actual": {"speed": 2.0}})
    assert r.get_json()["ignored"] == ["fitness"]
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["speed"]["actual"] is None and gs["owner"]["fitness"] is None
    # a real treadmill is used, and its user-driven actual differs from requested
    client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 2.5, "incline": 1.0})
    client.post("/bridgeapi/putstate", json={"bridgeId": "real", "devices": TM_DEV,
                                              "commanded": {"speed": 2.5, "incline": 1.0}, "actual": {"speed": 2.8, "incline": 1.0}})
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["speed"] == {"requested": 2.5, "commanded": 2.5, "actual": 2.8}
    # non-debug achievements stick
    client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 2.5, "achievements": ["fast"]})
    client.post("/gameapi/endsession", json={"sessionId": sid})
    ach = client.get("/api/me").get_json()["achievements"]
    assert "mockgame:fast" in ach and "platform:first_session" in ach


def test_ownership_handoff_between_bridges(client):
    sid = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    # first bridge to offer a usable device owns it; the second is standby
    client.post("/bridgeapi/putstate", json={"bridgeId": "phone", "devices": BIKE_DEV, "actual": {"power": 100}})
    r = client.post("/bridgeapi/putstate", json={"bridgeId": "laptop", "devices": BIKE_DEV, "actual": {"power": 150}}).get_json()
    assert r["roles"]["fitness"] == "standby"
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["owner"]["fitness"] == "phone" and gs["power"]["actual"] == 100
    # sticky: phone keeps control while fresh even though laptop reports more recently
    client.post("/bridgeapi/putstate", json={"bridgeId": "laptop", "devices": BIKE_DEV, "actual": {"power": 150}})
    client.post("/bridgeapi/putstate", json={"bridgeId": "phone", "devices": BIKE_DEV, "actual": {"power": 120}})
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["owner"]["fitness"] == "phone" and gs["power"]["actual"] == 120
    client.application.dh.store.presence[7]["phone"]["t"] -= 10   # phone goes stale
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["owner"]["fitness"] == "laptop" and gs["power"]["actual"] == 150
    # HR-only bridge supplies heart rate
    client.post("/bridgeapi/putstate", json={"bridgeId": "watch", "devices": [{"role": "hrm", "name": "HR", "address": "hr1", "status": "connected"}],
                                              "commanded": None, "actual": {"heartRate": 140}})
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["owner"] == {"fitness": "laptop", "hrm": "watch"} and gs["heartRate"]["actual"] == 140


def test_game_answerinput_and_prompt_lifecycle(client):
    sid = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    client.post("/gameapi/setstate", json={"sessionId": sid, "requestedInput": {"promptId": "q", "choices": ["a", "b"]}})
    assert client.post("/gameapi/answerinput", json={"sessionId": sid, "promptId": "q", "choice": "zzz"}).get_json()["accepted"] is False
    assert client.post("/gameapi/answerinput", json={"sessionId": sid, "promptId": "q", "choice": "a"}).get_json()["accepted"] is True
    assert client.get("/bridgeapi/getstate?bridgeId=x").get_json()["requestedInput"] is None
    # game keeps sending the same prompt (level-triggered): stays answered
    client.post("/gameapi/setstate", json={"sessionId": sid, "requestedInput": {"promptId": "q", "choices": ["a", "b"]}})
    assert client.get(f"/gameapi/getstate?session={sid}").get_json()["requestedInput"] is None


def test_long_poll_returns_on_seq_change(client):
    sid = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    seq = client.get(f"/gameapi/getstate?session={sid}").get_json()["seq"]
    t0 = time.time()
    r = client.get(f"/gameapi/getstate?session={sid}&since={seq}&wait=0.3").get_json()
    assert time.time() - t0 >= 0.25 and r["seq"] == seq
    t0 = time.time()
    r = client.get(f"/gameapi/getstate?session={sid}&since={seq - 1}&wait=1").get_json()
    assert time.time() - t0 < 0.2


def test_preferences_and_save_state(client):
    r = client.put("/gameapi/putpreferences", json={"game": "mockgame", "preferences": {"showMinimap": False}})
    assert r.status_code == 200
    assert client.get("/gameapi/preferences?game=mockgame").get_json()["preferences"] == {"showMinimap": False}
    client.put("/gameapi/putsave", json={"game": "mockgame", "variant": "bike", "saveState": {"laps": 3}})
    assert client.get("/gameapi/getsave?game=mockgame&variant=bike").get_json()["saveState"] == {"laps": 3}
    assert client.get("/gameapi/getsave?game=mockgame&variant=treadmill").get_json()["saveState"] is None
    st = client.post("/gameapi/startsession", json={"gameId": "mockgame", "variant": "bike"}).get_json()
    assert st["saveState"] == {"laps": 3} and st["preferences"]["game"] == {"showMinimap": False}


def test_user_isolation(client, app):
    sid = launch(client)["sessionId"]
    other = other_client(app, 8)
    assert other.get(f"/gameapi/getstate?session={sid}").status_code == 403
    assert other.post("/gameapi/setstate", json={"sessionId": sid}).status_code == 403
    assert other.get(f"/api/sessions/{sid}").status_code == 403
    assert other.get("/api/sessions/current").get_json()["session"] is None


def test_reaper_timeouts(root):
    app = make_app(root, ACTIVE_TIMEOUT=1, PENDING_TIMEOUT=1)
    c = app.test_client()
    c.post("/api/login", json={"uid": 1})
    a = launch(c)["sessionId"]
    dh = app.dh
    assert dh.reap_once() == []
    live = dh.store.get(a)
    live.created_at -= 5
    assert dh.reap_once() == [a]
    assert c.get(f"/api/sessions/{a}").get_json()["endReason"] == "never_started"
    b = launch(c)["sessionId"]
    c.post("/gameapi/startsession", json={"sessionId": b})
    dh.store.get(b).last_game_at -= 5
    assert dh.reap_once() == [b]
    row = c.get(f"/api/sessions/{b}").get_json()
    assert row["endReason"] == "timeout" and row["status"] == "discarded"   # never really began
    # a ride with a minute of activity behind it is kept when the game goes silent
    d = launch(c)["sessionId"]
    c.post("/gameapi/startsession", json={"sessionId": d})
    live = dh.store.get(d)
    live.started_at -= 120
    live.last_game_at -= 5
    assert dh.reap_once() == [d]
    row = c.get(f"/api/sessions/{d}").get_json()
    assert row["endReason"] == "timeout" and row["status"] == "complete"


def test_restart_recovery(root):
    app = make_app(root, RECOVERY_MIN_SECONDS=1)
    c = app.test_client()
    c.post("/api/login", json={"uid": 1})
    sid = launch(c)["sessionId"]
    c.post("/gameapi/startsession", json={"sessionId": sid})
    live = app.dh.store.get(sid)
    t = time.time()
    live.append({"k": "game", "t": t - 5, "req": {"speed": 2.0, "grade": 1.0}, "pos": {"x": 0, "y": 0, "z": 0}})
    live.append({"k": "bridge", "t": t - 4.9, "bridgeId": "b", "devices": BIKE_DEV, "cmd": {"grade": 1.0},
                 "act": {"power": 150.0, "cadence": 80.0}})
    live.append({"k": "game", "t": t, "req": {"speed": 2.0, "grade": 1.0}, "pos": {"x": 10, "y": 1, "z": 0},
                 "route": "Loop", "score": 42})
    live.writer.close()
    app.dh.store.remove(sid)          # emulate a crash: nothing finalized, DB row still 'active'
    c2u = other_client(app, 2)
    pending = launch(c2u, variant="treadmill")["sessionId"]
    app.dh.store.remove(pending)
    app.dh.stop()

    app2 = make_app(root, RECOVERY_MIN_SECONDS=1)
    c2 = app2.test_client()
    c2.post("/api/login", json={"uid": 1})
    s = c2.get(f"/api/sessions/{sid}").get_json()
    assert s["status"] == "complete" and s["endReason"] == "server_restart" and s["hasLog"]
    assert s["distance"] and s["distance"] > 0
    assert s["route"] == "Loop" and s["score"] == 42
    assert list(app2.dh.config.sessions_dir.glob(f"**/{sid}.jsonl.gz")) and not list(app2.dh.config.sessions_dir.glob(f"**/{sid}.jsonl"))
    assert c2.get(f"/api/sessions/{sid}/timeline").get_json()["timeline"]
    assert c2.get("/api/sessions/current").get_json()["session"] is None
    c3 = other_client(app2, 2)
    p = c3.get(f"/api/sessions/{pending}").get_json()
    assert p["status"] == "discarded" and p["endReason"] == "never_started"


def test_persistent_prompt_stays_until_game_drops_it(client):
    sid = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    gear = {"promptId": "gear", "choices": ["up", "down"], "persistent": True}
    client.post("/gameapi/setstate", json={"sessionId": sid, "requestedInput": gear})
    assert client.post("/bridgeapi/sendinput", json={"bridgeId": "p", "promptId": "gear", "choice": "up"}).get_json()["accepted"]
    assert client.post("/bridgeapi/sendinput", json={"bridgeId": "p", "promptId": "gear", "choice": "down"}).get_json()["accepted"]
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["requestedInput"]["promptId"] == "gear" and gs["input"]["choice"] == "down"
    client.post("/gameapi/setstate", json={"sessionId": sid})
    assert client.get("/bridgeapi/getstate?bridgeId=p").get_json()["requestedInput"] is None


def test_history_hides_discarded_by_default(client):
    kept = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": kept})
    client.post("/gameapi/endsession", json={"sessionId": kept, "status": "complete"})
    dropped = launch(client)["sessionId"]
    client.post(f"/api/sessions/{dropped}/end", json={"status": "discarded"})
    ids = [s["sessionId"] for s in client.get("/api/sessions").get_json()["sessions"]]
    assert kept in ids and dropped not in ids
    ids = [s["sessionId"] for s in client.get("/api/sessions?includeDiscarded=1").get_json()["sessions"]]
    assert kept in ids and dropped in ids
    ids = [s["sessionId"] for s in client.get("/api/sessions?status=discarded").get_json()["sessions"]]
    assert ids == [dropped]
    s = client.get("/api/sessions").get_json()["sessions"][0]
    assert s["imageUrl"] == "/games/mockgame/screenshot.png"
    assert "imageUrl" in client.get(f"/api/sessions/{kept}").get_json()


def test_admin_list(client):
    # the default admin list is [ADMIN_UID]; uid 7 (the test client) is not on it
    assert client.get("/api/me").get_json()["isAdmin"] is False
    from conftest import make_app
    app = make_app(client.application.dh.config.root, ADMIN_UIDS="7, 9")
    c = app.test_client()
    c.post("/api/login", json={"uid": 7})
    assert c.get("/api/me").get_json()["isAdmin"] is True
    assert app.dh.config.admin_uids == [1, 7, 9]


PNG_1PX = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000000ffff0300060002fe9e3e0a0000000049454e44ae426082")


def test_session_image(client):
    sid = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    # before any image: the variant screenshot
    assert client.get(f"/api/sessions/{sid}").get_json()["imageUrl"] == "/games/mockgame/screenshot.png"
    assert client.get(f"/api/sessions/{sid}/image").status_code == 404
    # bad uploads
    assert client.put(f"/gameapi/sessions/{sid}/image", json={"image": "data:image/gif;base64,AAAA"}).status_code == 400
    assert client.put(f"/gameapi/sessions/{sid}/image", data=b"nope", content_type="image/png").status_code == 400
    # data-URL upload while live
    import base64
    r = client.put(f"/gameapi/sessions/{sid}/image", json={"image": "data:image/png;base64," + base64.b64encode(PNG_1PX).decode()})
    assert r.status_code == 200 and r.get_json()["imageUrl"] == f"/api/sessions/{sid}/image"
    assert client.get(f"/api/sessions/{sid}").get_json()["imageUrl"] == f"/api/sessions/{sid}/image"
    img = client.get(f"/api/sessions/{sid}/image")
    assert img.status_code == 200 and img.data == PNG_1PX and img.mimetype == "image/png"
    # raw upload after the end still works (grace period), and the gallery uses it
    client.post("/gameapi/endsession", json={"sessionId": sid, "status": "complete"})
    assert client.put(f"/gameapi/sessions/{sid}/image", data=PNG_1PX, content_type="image/png").status_code == 200
    assert client.get("/api/sessions").get_json()["sessions"][0]["imageUrl"] == f"/api/sessions/{sid}/image"
    # another user cannot see it
    other = other_client(client.application, 8)
    assert other.get(f"/api/sessions/{sid}/image").status_code == 403
