"""A bridge ends the session for the user (PLAN.md §9.2 /bridgeapi/end): complete keeps it, discarded drops it."""
from test_pause import gs, put, start, tm

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


def test_bridge_end_completes_and_game_can_still_attach_image(client):
    sid = start(client)
    put(client, "tabA", [tm()], {"speed": 2.0, "incline": 0})
    client.post("/gameapi/setstate", json={"sessionId": sid, "incline": 1.0, "x": 1, "y": 2, "z": 3})
    r = client.post("/bridgeapi/end", json={"bridgeId": "tabA", "status": "complete"})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["status"] == "complete"
    s = gs(client, sid)
    assert s["sessionStatus"] == "complete"
    assert s["endReason"] == "bridge:tabA"
    # the game sees the end and still gets its picture in
    assert client.put(f"/gameapi/sessions/{sid}/image", json={"image": PNG}).status_code == 200
    row = client.get(f"/api/sessions/{sid}").get_json()
    row = row.get("session", row)
    assert row["status"] == "complete" and row["hasImage"] is True
    # ending twice is a 409, not a crash
    assert client.post("/bridgeapi/end", json={"bridgeId": "tabA", "status": "complete"}).status_code == 409


def test_bridge_end_discard_and_pending_only_discards(client):
    sid = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "treadmill", "debug": True}).get_json()["sessionId"]
    # pending: asking for complete still discards (nothing was ridden)
    r = client.post("/bridgeapi/end", json={"bridgeId": "tabA", "status": "complete"})
    assert r.status_code == 200 and r.get_json()["status"] == "discarded"
    assert client.get(f"/api/sessions/{sid}").get_json().get("session", {}).get("status", "discarded") == "discarded"
    sid = start(client)
    assert client.post("/bridgeapi/end", json={"bridgeId": "tabA", "status": "nonsense"}).status_code == 400
    assert client.post("/bridgeapi/end", json={"bridgeId": "tabA", "status": "discarded"}).status_code == 200
    assert gs(client, sid)["sessionStatus"] == "discarded"
