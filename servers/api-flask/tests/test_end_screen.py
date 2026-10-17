"""A game's end screen (PLAN.md §6.4.1): a completed session of a game with capabilities.endScreen keeps the screen
until the player dismisses it, on a bridge or in the game, or END_SCREEN_SECONDS pass."""
from test_pause import bike, clock, put  # noqa: F401  (clock is a fixture)

from dandyhorse.sessions.lifecycle import END_SCREEN_SECONDS


def start_cd(c):
    sid = c.post("/api/sessions/launch", json={"gameId": "citydash", "variant": "bike", "debug": True}).get_json()["sessionId"]
    assert c.post("/gameapi/startsession", json={"sessionId": sid}).status_code == 200
    put(c, "phone", [bike()], {"power": 200, "cadence": 85})
    c.post("/gameapi/setstate", json={"sessionId": sid, "grade": 2.0, "speed": 5.0})
    return sid


def bridge_es(c, bid="tv"):
    return c.get(f"/bridgeapi/getstate?bridgeId={bid}").get_json()["endScreen"]


def test_brief_says_so_and_a_completed_session_opens_it(client, clock):
    sid = start_cd(client)
    assert client.get("/bridgeapi/getstate?bridgeId=tv").get_json()["session"]["endScreen"] is True
    assert bridge_es(client) is None
    assert client.post("/bridgeapi/end", json={"bridgeId": "phone", "status": "complete"}).status_code == 200
    es = bridge_es(client)
    assert es["sessionId"] == sid and abs(es["seconds"] - END_SCREEN_SECONDS) < 1
    assert client.get(f"/gameapi/endscreen?session={sid}").get_json() == {"open": True, "seconds": es["seconds"]}
    # Done on a bridge closes it everywhere
    assert client.post("/bridgeapi/endscreen", json={"sessionId": sid}).get_json()["closed"] is True
    assert bridge_es(client) is None
    assert client.get(f"/gameapi/endscreen?session={sid}").get_json()["open"] is False


def test_the_game_closes_it_and_it_times_out(client, clock):
    sid = start_cd(client)
    client.post("/gameapi/endsession", json={"sessionId": sid, "status": "complete"})
    assert bridge_es(client)["sessionId"] == sid
    assert client.post("/gameapi/endscreen", json={"sessionId": "someone-else"}).get_json()["closed"] is False
    assert client.post("/gameapi/endscreen", json={"sessionId": sid}).get_json()["closed"] is True
    assert bridge_es(client) is None
    sid = start_cd(client)
    client.post("/bridgeapi/end", json={"bridgeId": "phone", "status": "complete"})
    clock.advance(END_SCREEN_SECONDS - 1)
    assert bridge_es(client) is not None
    clock.advance(2)
    assert bridge_es(client) is None


def test_not_for_a_discard_nor_for_a_game_without_it(client, clock):
    sid = start_cd(client)
    client.post("/bridgeapi/end", json={"bridgeId": "phone", "status": "discarded"})
    assert bridge_es(client) is None
    sid = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "bike", "debug": True}).get_json()["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    put(client, "phone", [bike()], {"power": 200, "cadence": 85})
    client.post("/gameapi/setstate", json={"sessionId": sid, "grade": 2.0, "speed": 5.0})
    assert client.get("/bridgeapi/getstate?bridgeId=tv").get_json()["session"]["endScreen"] is False
    client.post("/bridgeapi/end", json={"bridgeId": "phone", "status": "complete"})
    assert bridge_es(client) is None


def test_a_new_session_closes_the_last_ones(client, clock):
    start_cd(client)
    client.post("/bridgeapi/end", json={"bridgeId": "phone", "status": "complete"})
    assert bridge_es(client) is not None
    start_cd(client)
    assert bridge_es(client) is None
