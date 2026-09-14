"""Device-loss pause: the server pauses a running session after 5 s without exercise-device data."""
import pytest

from dandyhorse import util


@pytest.fixture()
def clock():
    t = [1_800_000_000.0]
    util.set_clock(lambda: t[0])

    class Clock:
        def advance(self, dt):
            t[0] += dt

    yield Clock()
    util.set_clock(None)


def tm(status="simulated", address="sim:tm", name="Sim treadmill"):
    return {"role": "fitness", "type": "treadmill", "name": name, "address": address, "status": status}


def bike(status="simulated"):
    return {"role": "fitness", "type": "bike", "name": "Sim bike", "address": "sim:bike", "status": status}


HRM = {"role": "hrm", "type": "hrm", "name": "Strap", "address": "hr1", "status": "connected"}


def start(c, variant="treadmill"):
    sid = c.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": variant, "debug": True}).get_json()["sessionId"]
    assert c.post("/gameapi/startsession", json={"sessionId": sid}).status_code == 200
    return sid


def put(c, bid, devices, actual, label="Chrome on Mac"):
    return c.post("/bridgeapi/putstate", json={"bridgeId": bid, "label": label, "devices": devices,
                                                "actual": actual, "commanded": {}}).get_json()


def gs(c, sid):
    return c.get(f"/gameapi/getstate?session={sid}").get_json()


def run(c, clock, sid, seconds, bid="tabA", devices=None, actual=None, game=True):
    """Advance time 1 s at a time; the bridge (if devices given) and the game report each second."""
    for _ in range(seconds):
        clock.advance(1)
        if devices is not None:
            put(c, bid, devices, actual or {})
        if game:
            c.post("/gameapi/setstate", json={"sessionId": sid, "speed": 2.0})


def statuses(c, sid):
    recs = c.get(f"/gameapi/sessions/{sid}/log").get_json()["records"]
    return [(r.get("from"), r.get("to"), r.get("reason")) for r in recs if r["k"] == "status"]


def test_bridge_going_silent_pauses_and_resumes(client, clock):
    sid = start(client)
    run(client, clock, sid, 3, devices=[tm()], actual={"speed": 2.0})
    assert gs(client, sid)["sessionStatus"] == "active"
    run(client, clock, sid, 6)                      # bridge tab fell asleep; game keeps ticking (pause after >5 s)
    g = gs(client, sid)
    assert g["sessionStatus"] == "paused"
    assert g["pause"]["reason"] == "bridge_silent" and "Chrome on Mac stopped reporting" in g["pause"]["message"]
    assert g["pause"]["seconds"] >= 0
    # the game may keep calling setstate while paused
    r = client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 0.0})
    assert r.status_code == 200 and r.get_json()["sessionStatus"] == "paused"
    # one valid report is not enough (debounce); a second one a second later resumes
    put(client, "tabA", [tm()], {"speed": 0.0})
    assert gs(client, sid)["sessionStatus"] == "paused"
    clock.advance(1)
    put(client, "tabA", [tm()], {"speed": 0.0})
    g = gs(client, sid)
    # paused at the first check past 5 s of silence, resumed on the second valid report 1 s later
    assert g["sessionStatus"] == "active" and g["pause"] is None and abs(g["pausedSeconds"] - 1.0) < 1e-6
    assert statuses(client, sid)[-2:] == [("active", "paused", "bridge_silent"), ("paused", "active", None)]


def test_bridge_sending_nulls_pauses_with_no_data(client, clock):
    sid = start(client)
    run(client, clock, sid, 2, devices=[tm()], actual={"speed": 2.0})
    run(client, clock, sid, 6, devices=[tm()], actual={"speed": None, "heartRate": 140})  # HR does not count
    g = gs(client, sid)
    assert g["sessionStatus"] == "paused" and g["pause"]["reason"] == "no_data"
    assert g["pause"]["message"] == "Sim treadmill on Chrome on Mac is connected but not sending data."


def test_device_turned_off_is_device_unavailable(client, clock):
    sid = start(client)
    run(client, clock, sid, 2, devices=[tm()], actual={"speed": 2.0})
    run(client, clock, sid, 6, devices=[tm(status="disconnected")], actual={})
    g = gs(client, sid)
    assert g["pause"]["reason"] == "device_unavailable" and g["pause"]["deviceStatus"] == "disconnected"
    assert "Sim treadmill on Chrome on Mac is disconnected" in g["pause"]["message"]
    # the bridge now goes silent too: the message follows the situation
    run(client, clock, sid, 6)
    assert gs(client, sid)["pause"]["reason"] == "bridge_silent"


def test_no_device_ever(client, clock):
    sid = start(client)
    run(client, clock, sid, 4)
    assert gs(client, sid)["sessionStatus"] == "active"      # 5 s grace from activation
    run(client, clock, sid, 2)
    g = gs(client, sid)
    assert g["pause"]["reason"] == "no_device" and "No treadmill is connected" in g["pause"]["message"]


def test_wrong_device_explains_itself(client, clock):
    sid = start(client)
    run(client, clock, sid, 6, devices=[bike()], actual={"power": 150})
    assert "this session needs a treadmill" in gs(client, sid)["pause"]["message"]


def test_heart_rate_monitor_never_pauses(client, clock):
    sid = start(client)
    for _ in range(4):
        clock.advance(1)
        put(client, "tabA", [tm()], {"speed": 2.0})
        put(client, "phone", [HRM], {"heartRate": 130}, label="Phone")
    for _ in range(8):                               # HRM bridge vanishes; treadmill carries on
        clock.advance(1)
        put(client, "tabA", [tm()], {"speed": 2.0})
    assert gs(client, sid)["sessionStatus"] == "active"
    for _ in range(6):                               # treadmill vanishes; HRM alone cannot keep it running
        clock.advance(1)
        put(client, "phone", [HRM], {"heartRate": 130}, label="Phone")
    assert gs(client, sid)["sessionStatus"] == "paused"


def test_bike_zero_power_is_data(client, clock):
    sid = start(client, "bike")
    run(client, clock, sid, 8, devices=[bike()], actual={"power": 0, "cadence": 0})
    assert gs(client, sid)["sessionStatus"] == "active"
    run(client, clock, sid, 6, devices=[bike()], actual={"power": None, "cadence": None})
    assert gs(client, sid)["pause"]["reason"] == "no_data"


def test_intermittent_data_does_not_flap(client, clock):
    sid = start(client)
    run(client, clock, sid, 2, devices=[tm()], actual={"speed": 2.0})
    for _ in range(4):                               # one valid sample every 7 s
        run(client, clock, sid, 6)
        clock.advance(1)
        put(client, "tabA", [tm()], {"speed": 2.0})
    transitions = [s for s in statuses(client, sid) if s[0] in ("active", "paused")]
    assert transitions == [("active", "paused", "bridge_silent")]


def test_watchdog_pauses_with_nobody_calling(client, clock, app):
    sid = start(client)
    put(client, "tabA", [tm()], {"speed": 2.0})
    live = app.dh.store.get(sid)
    seq = live.seq
    clock.advance(6)
    app.dh.watchdog_once()
    assert live.status == "paused" and live.seq > seq   # long-polls wake up


def test_paused_time_is_excluded_and_reported(client, clock):
    sid = start(client)
    run(client, clock, sid, 5, devices=[tm()], actual={"speed": 2.0})
    run(client, clock, sid, 10, devices=[tm()], actual={"speed": None, "heartRate": 150})
    assert gs(client, sid)["sessionStatus"] == "paused"
    s = client.post("/gameapi/endsession", json={"sessionId": sid, "status": "complete"}).get_json()
    assert s["status"] == "complete" and 3 <= s["pausedSeconds"] <= 6
    assert s["distance"] < 14                        # about 2 m/s for the ~6 s with data, nothing while paused
    lst = client.get("/api/sessions").get_json()["sessions"][0]
    assert lst["pausedSeconds"] == s["pausedSeconds"]
    tl = client.get(f"/api/sessions/{sid}/timeline").get_json()["timeline"]
    assert any(r["paused"] for r in tl) and not tl[0]["paused"]


def test_console_sees_paused_and_supersede_still_works(client, clock):
    sid = start(client)
    run(client, clock, sid, 6)
    assert client.get("/api/sessions").get_json()["sessions"][0]["status"] == "paused"
    cur = client.get("/api/sessions/current").get_json()["session"]
    assert cur["status"] == "paused" and cur["pause"]["reason"] == "no_device"
    assert client.delete(f"/api/sessions/{sid}").status_code == 409
    start(client)                                    # supersedes the paused session
    assert client.get(f"/api/sessions/{sid}").get_json()["endReason"] == "superseded"


def test_user_pause_and_play(client, clock):
    sid = start(client)
    run(client, clock, sid, 3, devices=[tm()], actual={"speed": 2.0})
    r = client.post("/bridgeapi/pause", json={"bridgeId": "tabA"}).get_json()
    assert r["session"]["status"] == "paused" and r["session"]["pause"]["reason"] == "user"
    assert r["session"]["pause"]["message"] == "Paused from Chrome on Mac. Press Play to continue."
    run(client, clock, sid, 4, devices=[tm()], actual={"speed": 0.0})   # data keeps flowing: still held
    assert gs(client, sid)["pause"]["reason"] == "user"
    r = client.post("/bridgeapi/resume", json={"bridgeId": "tabA"}).get_json()
    assert r["session"]["status"] == "active" and r["session"]["pausedSeconds"] == 4.0
    kinds = [x["k"] for x in client.get(f"/gameapi/sessions/{sid}/log").get_json()["records"]]
    assert kinds.count("userPause") == 2


def test_play_without_device_stays_paused_for_the_device(client, clock):
    sid = start(client)
    run(client, clock, sid, 2, devices=[tm()], actual={"speed": 2.0})
    client.post("/bridgeapi/pause", json={"bridgeId": "tabA"})
    run(client, clock, sid, 7)                                          # the bridge goes silent meanwhile
    assert gs(client, sid)["pause"]["reason"] == "user"                 # user pause shadows device loss
    r = client.post("/bridgeapi/resume", json={"bridgeId": "tabA"}).get_json()
    assert r["session"]["status"] == "paused" and r["session"]["pause"]["reason"] == "bridge_silent"


def test_pause_needs_a_running_session(client):
    client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "treadmill", "debug": True})
    assert client.post("/bridgeapi/pause", json={"bridgeId": "x"}).status_code == 409   # still pending


def test_game_reload_while_paused_rejoins(client, clock):
    sid = start(client)
    run(client, clock, sid, 6)
    assert gs(client, sid)["sessionStatus"] == "paused"
    r = client.post("/gameapi/startsession", json={"sessionId": sid})   # the game page was reloaded
    assert r.status_code == 200 and r.get_json()["sessionId"] == sid
    clock.advance(2)
    g = gs(client, sid)
    assert g["sessionStatus"] == "paused" and abs(g["pausedSeconds"] - 2.0) < 1e-6
    assert abs(g["activeSeconds"] - (g["elapsed"] - g["pausedSeconds"])) < 1e-6 and g["activeSeconds"] < g["elapsed"]
