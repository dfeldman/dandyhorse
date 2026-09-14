"""Menu prompts (PLAN.md §6.3): a game's whole choice list for a phone to mirror, answered by item id or d-pad."""


def launch(c):
    sid = c.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "treadmill", "debug": True}).get_json()["sessionId"]
    assert c.post("/gameapi/startsession", json={"sessionId": sid}).status_code == 200
    return sid


def menu(rev=1, **over):
    p = {"promptId": "kt", "prompt": "Oakvale", "layout": "menu", "rev": rev,
         "choices": ["up", "down", "left", "right", "select", "back"],
         "items": [{"id": "place:mayor", "label": "🏛️ Mayor's hall"},
                   {"id": "place:shop", "label": "🛒 The Copper Kettle", "hint": "Buy and sell"},
                   {"id": "gate", "label": "🚪 The Gate", "disabled": True},
                   {"id": "pause", "label": "⏸ Pause"}],
         "highlight": "place:shop", "back": "pause", "countdown": None}
    p.update(over)
    return p


def tick(c, sid, prompt):
    return c.post("/gameapi/setstate", json={"sessionId": sid, "requestedInput": prompt})


def test_menu_prompt_reaches_game_and_bridge(client):
    sid = launch(client)
    assert tick(client, sid, menu()).status_code == 200
    p = client.get(f"/gameapi/getstate?session={sid}").get_json()["requestedInput"]
    assert p["layout"] == "menu" and p["persistent"] is True and p["rev"] == 1
    assert [i["id"] for i in p["items"]] == ["place:mayor", "place:shop", "gate", "pause"]
    assert p["highlight"] == "place:shop" and p["back"] == "pause" and p["items"][2]["disabled"] is True
    assert client.get("/bridgeapi/getstate?bridgeId=b").get_json()["requestedInput"]["items"][1]["hint"] == "Buy and sell"


def test_menu_answers_by_item_or_button_carry_rev(client):
    sid = launch(client)
    tick(client, sid, menu(rev=17))

    def send(choice, rev=17):
        return client.post("/bridgeapi/sendinput", json={"bridgeId": "phone", "promptId": "kt", "choice": choice,
                                                         "rev": rev}).get_json()["accepted"]

    assert send("place:shop") and send("down") and send("select", rev=16)
    assert not send("gate")        # disabled
    assert not send("nowhere")     # not an item
    assert client.post("/gameapi/answerinput", json={"sessionId": sid, "promptId": "kt", "choice": "pause",
                                                     "rev": 17}).get_json()["accepted"]
    g = client.get(f"/gameapi/getstate?session={sid}").get_json()
    assert [(i["choice"], i.get("rev")) for i in g["inputs"]] == [("place:shop", 17), ("down", 17), ("select", 16), ("pause", 17)]
    assert g["inputs"][-1]["source"] == "game"
    assert g["requestedInput"]["promptId"] == "kt"   # persistent: still open after answers


def test_menu_validation(client):
    sid = launch(client)
    bad = [
        menu(items=[]),
        menu(items=[{"id": f"i{n}", "label": "x"} for n in range(101)]),
        menu(items=[{"id": "a", "label": "x" * 41}]),
        menu(items=[{"id": "a", "label": "x"}, {"id": "a", "label": "y"}]),
        menu(items=[{"id": "back", "label": "↩ Back"}]),   # ambiguous with the Back button
        menu(choices=["up", "jump"]),                       # choices are d-pad buttons
    ]
    for p in bad:
        assert tick(client, sid, p).status_code == 400, p
    ok = menu(items=[{"id": f"i{n}", "label": f"Item {n}"} for n in range(100)], highlight="zzz", back="zzz")
    del ok["choices"]
    assert tick(client, sid, ok).status_code == 200
    p = client.get(f"/gameapi/getstate?session={sid}").get_json()["requestedInput"]
    assert len(p["items"]) == 100 and p["highlight"] is None and p["back"] is None and p["choices"] == []


def test_menu_is_logged_in_full_only_when_rev_changes(client):
    sid = launch(client)
    for rev, hl in ((1, "place:shop"), (1, "place:mayor"), (1, "place:shop"), (2, "pause"), (2, "pause")):
        tick(client, sid, menu(rev=rev, highlight=hl))
    recs = [r for r in client.get(f"/gameapi/sessions/{sid}/log").get_json()["records"] if r["k"] == "game"]
    assert [r["prompt"]["rev"] for r in recs if "items" in r["prompt"]] == [1, 2]
    assert recs[1]["prompt"] == {"promptId": "kt", "rev": 1, "highlight": "place:mayor"}


def test_button_prompts_unchanged(client):
    sid = launch(client)
    assert tick(client, sid, {"promptId": "p", "choices": []}).status_code == 400
    assert tick(client, sid, {"promptId": "p", "choices": ["up", "select"], "layout": "dpad", "persistent": True}).status_code == 200
