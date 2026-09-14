"""Multi-bridge edge cases: conflicts, claims, leave, sticky ownership across sessions, replay consistency."""
import time

from conftest import other_client


def dev(type_="treadmill", status="simulated", address=None, role="fitness", name=None):
    return {"role": role, "type": type_ if role == "fitness" else "hrm", "name": name or f"{type_} {address}",
            "address": address or f"sim:{type_}", "status": status}


def put(c, bid, devices, actual=None, commanded=None, label=None, browser="br1"):
    r = c.post("/bridgeapi/putstate", json={"bridgeId": bid, "browserId": browser, "label": label or bid,
                                             "devices": devices, "actual": actual or {}, "commanded": commanded or {}})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def launch(c, variant="treadmill", debug=True, start=True):
    sid = c.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": variant, "debug": debug}).get_json()["sessionId"]
    if start:
        assert c.post("/gameapi/startsession", json={"sessionId": sid}).status_code == 200
    return sid


def gs(c, sid):
    return c.get(f"/gameapi/getstate?session={sid}").get_json()


def test_second_fitness_bridge_is_standby_with_conflict(client):
    sid = launch(client)
    a = put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0}, label="Chrome on Mac")
    assert a["roles"]["fitness"] == "owner" and a["conflicts"] == []
    b = put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5}, label="Chrome on Mac")
    assert b["roles"]["fitness"] == "standby"
    assert b["conflicts"] == [{"role": "fitness", "ownerBridgeId": "tabA", "ownerLabel": "Chrome on Mac", "ownerBrowserId": "br1",
                               "ownerDevice": {"name": "treadmill sim:a", "type": "treadmill", "status": "simulated"}}]
    # B keeps reporting faster than A: the game must only ever see A's values
    for _ in range(5):
        put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
        assert gs(client, sid)["speed"]["actual"] == 2.0
    g = gs(client, sid)
    roles = {b["bridgeId"]: b["roles"]["fitness"] for b in g["bridges"]}
    assert roles == {"tabA": "owner", "tabB": "standby"}
    # the bridge getstate for B says the same thing
    bg = client.get("/bridgeapi/getstate?bridgeId=tabB").get_json()
    assert bg["roles"]["fitness"] == "standby" and bg["conflicts"][0]["ownerBridgeId"] == "tabA"


def test_conflict_detected_before_any_session(client):
    put(client, "tabA", [dev("bike", address="sim:a")])
    b = put(client, "tabB", [dev("treadmill", address="sim:b")])
    assert b["session"] is None and b["roles"]["fitness"] == "standby"


def test_claim_moves_control_and_replay_uses_claimed_bridge(client):
    sid = launch(client)
    put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0})
    put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
    client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 2.0})
    r = client.post("/bridgeapi/claim", json={"bridgeId": "tabB", "role": "fitness"}).get_json()
    assert r["ok"] and r["roles"]["fitness"] == "owner"
    assert put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0})["roles"]["fitness"] == "standby"
    assert gs(client, sid)["speed"]["actual"] == 0.5
    # a claim by a bridge without a usable device is refused
    put(client, "tabC", [dev("bike", address="sim:c")])
    r = client.post("/bridgeapi/claim", json={"bridgeId": "tabC", "role": "fitness"}).get_json()
    assert r["ok"] is False and r["reason"] == "no_usable_device"
    time.sleep(1.1)
    put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0})   # standby, later than B
    put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
    client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 2.0})
    client.post("/gameapi/endsession", json={"sessionId": sid})
    tl = client.get(f"/api/sessions/{sid}/timeline").get_json()["timeline"]
    assert tl[-1]["speed"]["actual"] == 0.5, "timeline replay must follow the claim, not the freshest report"
    log = client.get(f"/gameapi/sessions/{sid}/log").get_json()["records"]
    owner_recs = [r for r in log if r["k"] == "owner"]
    assert owner_recs[0].get("snapshot") and any(r.get("claim") == "tabB" for r in owner_recs)


def test_leave_frees_control_immediately(client):
    sid = launch(client)
    put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0})
    put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
    assert gs(client, sid)["owner"]["fitness"] == "tabA"
    # sendBeacon posts text/plain-less JSON blobs; force-parse must accept it
    r = client.post("/bridgeapi/leave", data='{"bridgeId": "tabA"}', content_type="text/plain")
    assert r.get_json()["known"] is True
    g = gs(client, sid)
    assert g["owner"]["fitness"] == "tabB" and g["speed"]["actual"] == 0.5
    assert [b["bridgeId"] for b in g["bridges"]] == ["tabB"]


def test_owner_that_drops_its_device_hands_over_at_once(client):
    sid = launch(client)
    put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0})
    put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
    put(client, "tabA", [dev(address="sim:a", status="disconnected")])
    assert gs(client, sid)["owner"]["fitness"] == "tabB"
    # A reconnects: B keeps control (sticky), A is standby
    assert put(client, "tabA", [dev(address="sim:a")])["roles"]["fitness"] == "standby"


def test_ownership_survives_a_new_launch(client):
    launch(client)
    put(client, "tabA", [dev(address="sim:a")], actual={"speed": 2.0})
    put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
    sid2 = launch(client)                 # supersedes; B reported most recently
    put(client, "tabB", [dev(address="sim:b")], actual={"speed": 0.5})
    assert gs(client, sid2)["owner"]["fitness"] == "tabA"


def test_type_mismatch_and_simulator_policy_reasons(client):
    launch(client, variant="treadmill", debug=False)
    r = put(client, "tabA", [dev("bike", address="sim:bike")])
    assert r["roles"]["fitness"] == "ignored" and r["ignoredReasons"] == {"fitness": "wrong_device_type"}
    r = put(client, "tabB", [dev("treadmill", address="sim:tm")])
    assert r["roles"]["fitness"] == "ignored" and r["ignoredReasons"] == {"fitness": "simulator_not_allowed"}
    assert r["ignored"] == ["fitness"]
    r = put(client, "tabC", [dev("treadmill", address="aa:bb", status="connected")])
    assert r["roles"]["fitness"] == "owner"


def test_hrm_conflict(client):
    sid = launch(client)
    put(client, "phone", [dev(role="hrm", address="hr1")], actual={"heartRate": 140})
    r = put(client, "laptop", [dev(address="sim:a"), dev(role="hrm", address="hr2")], actual={"speed": 2.0, "heartRate": 90})
    assert r["roles"] == {"fitness": "owner", "hrm": "standby"}
    assert r["conflicts"][0]["role"] == "hrm" and r["conflicts"][0]["ownerBridgeId"] == "phone"
    assert gs(client, sid)["heartRate"]["actual"] == 140


def test_other_users_bridges_never_conflict(client, app):
    launch(client)
    put(client, "tabA", [dev(address="sim:a")])
    other = other_client(app, 8)
    assert put(other, "tabZ", [dev(address="sim:z")])["roles"]["fitness"] == "owner"


def test_user_stopped_flag_reaches_the_game(client):
    sid = launch(client)
    d = dict(dev(address="sim:a"), userStopped=True)
    put(client, "tabA", [d], actual={"speed": 0.0})
    b = gs(client, sid)["bridges"][0]
    assert b["devices"][0]["userStopped"] is True
    put(client, "tabA", [dev(address="sim:a")], actual={"speed": 0.0})
    assert "userStopped" not in gs(client, sid)["bridges"][0]["devices"][0]


def test_bridge_sees_how_long_the_game_has_been_silent(client):
    sid = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "treadmill", "debug": True}).get_json()["sessionId"]
    assert client.get("/bridgeapi/getstate?bridgeId=x").get_json()["session"]["gameAge"] is None   # pending
    client.post("/gameapi/startsession", json={"sessionId": sid})
    client.post("/gameapi/setstate", json={"sessionId": sid, "speed": 2.0})
    assert client.get("/bridgeapi/getstate?bridgeId=x").get_json()["session"]["gameAge"] < 1.0
    client.application.dh.store.get(sid).last_game_at -= 40            # game froze 40 s ago
    age = client.get("/bridgeapi/getstate?bridgeId=x").get_json()["session"]["gameAge"]
    assert 39.5 < age < 41.5
