"""Game options chosen at launch (PLAN.md §7.1): validated against metadata.json `options`, defaults filled in."""


def test_options_resolved_and_validated(client):
    games = {g["id"]: g for g in client.get("/api/games").get_json()["games"]}
    assert "route" in games["rollinghills"]["options"]
    r = client.post("/api/sessions/launch", json={"gameId": "rollinghills", "variant": "bike", "debug": True, "options": {"route": "hilly"}})
    assert r.status_code == 200, r.get_json()
    sid = r.get_json()["sessionId"]
    start = client.post("/gameapi/startsession", json={"sessionId": sid}).get_json()
    assert start["options"] == {"route": "hilly", "timeOfDay": "day"}
    row = client.get(f"/api/sessions/{sid}").get_json()
    row = row.get("session", row)
    assert row["options"]["game"] == {"route": "hilly", "timeOfDay": "day"}
    # bad value, unknown key
    assert client.post("/api/sessions/launch", json={"gameId": "rollinghills", "variant": "bike", "options": {"route": "moon"}}).get_json()["error"]["code"] == "option_invalid"
    assert client.post("/api/sessions/launch", json={"gameId": "rollinghills", "variant": "bike", "options": {"cheese": "yes"}}).get_json()["error"]["code"] == "option_unknown"
    # a game without options: {} and nothing else accepted
    r = client.post("/gameapi/startsession", json={"gameId": "mockgame", "variant": "treadmill", "debug": True})
    assert r.get_json()["options"] == {}
    assert client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "treadmill", "options": {"route": "flat"}}).status_code == 400
