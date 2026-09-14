"""A game that opts out of automatic pauses (capabilities.autoPause false), the game's own pause
(POST /gameapi/pause), and a launch option that changes what the game drives."""
import json

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


def tm(status="simulated"):
    return {"role": "fitness", "type": "treadmill", "name": "Sim treadmill", "address": "sim:tm", "status": status}


HRM = {"role": "hrm", "type": "hrm", "name": "Strap", "address": "hr1", "status": "connected"}


def start(c, device_type="treadmill", options=None, game="kingdomtrek", variant="trek"):
    body = {"gameId": game, "variant": variant, "deviceType": device_type, "debug": True}
    if options is not None:
        body["options"] = options
    r = c.post("/api/sessions/launch", json=body)
    assert r.status_code == 200, r.get_json()
    sid = r.get_json()["sessionId"]
    assert c.post("/gameapi/startsession", json={"sessionId": sid}).status_code == 200
    return sid, r.get_json()["session"]


def put(c, bid, devices, actual):
    return c.post("/bridgeapi/putstate", json={"bridgeId": bid, "label": "Chrome on Mac", "devices": devices,
                                                "actual": actual, "commanded": {}}).get_json()


def run(c, clock, sid, seconds, devices=None, actual=None):
    for _ in range(seconds):
        clock.advance(1)
        if devices is not None:
            put(c, "tabA", devices, actual or {})
        c.post("/gameapi/setstate", json={"sessionId": sid})


def gs(c, sid):
    return c.get(f"/gameapi/getstate?session={sid}").get_json()


def records(c, sid, kind):
    return [r for r in c.get(f"/gameapi/sessions/{sid}/log").get_json()["records"] if r["k"] == kind]


def test_opt_out_never_pauses_for_missing_data(client, clock):
    sid, brief = start(client)
    assert brief["autoPause"] is False
    run(client, clock, sid, 8)                                             # no device at all
    assert gs(client, sid)["sessionStatus"] == "active"
    run(client, clock, sid, 8, devices=[tm()], actual={"speed": None})     # a device sending nulls
    run(client, clock, sid, 8, devices=[HRM], actual={"heartRate": 120})   # a strap alone
    assert gs(client, sid)["sessionStatus"] == "active"
    assert not [r for r in records(client, sid, "status") if r["to"] == "paused"]


def test_ordinary_games_still_pause(client, clock):
    sid, brief = start(client, game="mockgame", variant="treadmill")
    assert brief["autoPause"] is True
    run(client, clock, sid, 6)
    assert gs(client, sid)["pause"]["reason"] == "no_device"


def test_opt_out_play_resumes_without_a_device(client, clock):
    sid, _ = start(client)
    run(client, clock, sid, 2, devices=[HRM], actual={"heartRate": 120})
    assert client.post("/bridgeapi/pause", json={"bridgeId": "tabA"}).get_json()["session"]["status"] == "paused"
    run(client, clock, sid, 3)
    r = client.post("/bridgeapi/resume", json={"bridgeId": "tabA"}).get_json()
    assert r["session"]["status"] == "active" and r["session"]["pausedSeconds"] == 3.0


def test_game_pause_round_trip(client, clock):
    sid, _ = start(client)
    run(client, clock, sid, 2)
    r = client.post("/gameapi/pause", json={"sessionId": sid, "paused": True}).get_json()
    assert r["sessionStatus"] == "paused" and r["pause"]["reason"] == "user"
    assert r["pause"]["message"] == "Paused in the game. Resume there, or press Play."
    b = client.get("/bridgeapi/getstate?bridgeId=tabA").get_json()["session"]
    assert b["status"] == "paused" and b["pause"]["reason"] == "user"      # bridges offer ▶ Play
    run(client, clock, sid, 4)
    r = client.post("/gameapi/pause", json={"sessionId": sid, "paused": False}).get_json()
    assert r["sessionStatus"] == "active" and r["pause"] is None
    assert abs(gs(client, sid)["pausedSeconds"] - 4.0) < 1e-6
    assert [(x["action"], x["by"]) for x in records(client, sid, "userPause")] == [("pause", "game"), ("resume", "game")]


def test_game_and_bridge_pauses_undo_each_other(client, clock):
    sid, _ = start(client)
    client.post("/gameapi/pause", json={"sessionId": sid, "paused": True})
    assert client.post("/bridgeapi/resume", json={"bridgeId": "tabA"}).get_json()["session"]["status"] == "active"
    client.post("/bridgeapi/pause", json={"bridgeId": "tabA"})
    assert gs(client, sid)["pause"]["message"] == "Paused from Chrome on Mac. Press Play to continue." or \
        gs(client, sid)["pause"]["message"].startswith("Paused from")
    assert client.post("/gameapi/pause", json={"sessionId": sid, "paused": False}).get_json()["sessionStatus"] == "active"
    # pausing twice from the game is harmless
    client.post("/gameapi/pause", json={"sessionId": sid, "paused": True})
    assert client.post("/gameapi/pause", json={"sessionId": sid, "paused": True}).get_json()["sessionStatus"] == "paused"


def test_game_resume_on_an_ordinary_game_still_waits_for_data(client, clock):
    sid, _ = start(client, game="mockgame", variant="treadmill")
    run(client, clock, sid, 2, devices=[tm()], actual={"speed": 2.0})
    client.post("/gameapi/pause", json={"sessionId": sid, "paused": True})
    run(client, clock, sid, 7)                                              # the bridge went silent meanwhile
    r = client.post("/gameapi/pause", json={"sessionId": sid, "paused": False}).get_json()
    assert r["sessionStatus"] == "paused" and r["pause"]["reason"] == "bridge_silent"


def test_game_pause_validation(client):
    sid, _ = start(client)
    assert client.post("/gameapi/pause", json={"sessionId": sid}).status_code == 400
    client.post("/gameapi/endsession", json={"sessionId": sid, "status": "complete"})
    assert client.post("/gameapi/pause", json={"sessionId": sid, "paused": True}).status_code == 410


def test_option_changes_what_the_game_drives(client):
    assert start(client, "treadmill")[1]["controls"] == "none"
    assert start(client, "treadmill", options={"hills": "on"})[1]["controls"] == "incline"
    assert start(client, "bike", options={"hills": "on"})[1]["controls"] == "grade"
    assert start(client, "bike", options={"hills": "off"})[1]["controls"] == "none"


def test_metadata_validation_of_new_fields(root, app):
    bad = root / "games" / "badmeta"
    bad.mkdir()
    (bad / "metadata.json").write_text(json.dumps({
        "id": "badmeta", "name": "Bad", "version": "0.1.0", "entry": "index.html",
        "capabilities": {"autoPause": "no"},
        "options": {"hills": {"enum": ["off", "on"], "controls": {"on": {"treadmill": "warp"}}}},
        "variants": [{"id": "v", "name": "V", "deviceTypes": ["treadmill"]}]}))
    app.dh.catalog.rescan()
    errs = app.dh.catalog.invalid_games["badmeta"]
    assert any("autoPause" in e for e in errs) and any("controls" in e for e in errs)
    assert "kingdomtrek" in app.dh.catalog.games
