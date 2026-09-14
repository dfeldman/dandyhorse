"""D-pad input: session prompts with layout=dpad keep every press; the no-session remote channel long-polls."""
import threading
import time

from test_api_flow import BIKE_DEV, launch


def _start(client):
    sid = launch(client)["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    client.post("/bridgeapi/putstate", json={"bridgeId": "b1", "devices": BIKE_DEV, "actual": {"power": 100}})
    return sid


def test_dpad_prompt_keeps_every_press(client):
    sid = _start(client)
    prompt = {"promptId": "d1", "prompt": "Steer", "choices": ["up", "down", "left", "right"], "persistent": True, "layout": "dpad"}
    client.post("/gameapi/setstate", json={"sessionId": sid, "requestedInput": prompt})
    for choice in ("left", "left", "up"):
        assert client.post("/bridgeapi/sendinput", json={"bridgeId": "b1", "promptId": "d1", "choice": choice}).get_json()["accepted"]
    # "select" is not among the choices of this prompt
    assert client.post("/bridgeapi/sendinput", json={"bridgeId": "b1", "promptId": "d1", "choice": "select"}).get_json()["accepted"] is False
    gs = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert gs["requestedInput"]["layout"] == "dpad"  # persistent: still open
    assert [i["choice"] for i in gs["inputs"]] == ["left", "left", "up"]
    ns = [i["n"] for i in gs["inputs"]]
    assert ns == sorted(ns) and len(set(ns)) == 3
    assert gs["input"]["choice"] == "up"
    # the game processes only what is newer than the last n it handled
    client.post("/bridgeapi/sendinput", json={"bridgeId": "b1", "promptId": "d1", "choice": "down"})
    gs2 = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert [i["choice"] for i in gs2["inputs"] if i["n"] > ns[-1]] == ["down"]


def test_remote_channel_without_session(client):
    assert client.get("/api/sessions/current").get_json()["session"] is None
    assert client.get("/api/remote").get_json() == {"n": 0, "events": []}
    assert client.post("/bridgeapi/remote", json={"bridgeId": "b1", "button": "diagonal"}).status_code == 400
    assert client.post("/bridgeapi/remote", json={"bridgeId": "b1", "button": "down"}).get_json() == {"ok": True, "n": 1}
    assert client.post("/bridgeapi/remote", json={"bridgeId": "b1", "button": "select"}).get_json()["n"] == 2
    r = client.get("/api/remote?since=0").get_json()
    assert r["n"] == 2 and [e["button"] for e in r["events"]] == ["down", "select"]
    assert client.get("/api/remote?since=1").get_json()["events"][0]["button"] == "select"
    assert client.get("/api/remote?since=2").get_json()["events"] == []
    # without since: nothing already pressed, only the current counter
    assert client.get("/api/remote").get_json() == {"n": 2, "events": []}


def test_remote_long_poll(client):
    t0 = time.monotonic()
    assert client.get("/api/remote?since=0&wait=0.3").get_json()["events"] == []
    assert time.monotonic() - t0 >= 0.25  # waited for the timeout

    # press from another thread while a long-poll is waiting on the same channel
    ch = client.application.dh.store.remote_for(7)
    threading.Timer(0.15, lambda: ch.press("right", "b2", 0.0)).start()
    t1 = time.monotonic()
    r = client.get("/api/remote?since=0&wait=2").get_json()
    assert [e["button"] for e in r["events"]] == ["right"] and r["events"][0]["bridgeId"] == "b2"
    assert time.monotonic() - t1 < 1.0  # returned on the press, not at the timeout
