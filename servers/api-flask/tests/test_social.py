"""Profiles, session stats, streaks, measured fitness, leaderboards, competitors and bots (PLAN.md §18)."""
import pytest

from conftest import make_app, other_client
from dandyhorse import util
from dandyhorse.social import boards, streaks, weeks

BIKE = [{"role": "fitness", "type": "bike", "name": "KICKR", "address": "aa:11", "protocol": "ftms",
         "status": "connected"}]


@pytest.fixture()
def clock():
    t = [1_792_000_000.0]  # a Monday in October 2026
    util.set_clock(lambda: t[0])

    class Clock:
        def advance(self, dt):
            t[0] += dt

        def set(self, v):
            t[0] = v

        @property
        def now(self):
            return t[0]

    yield Clock()
    util.set_clock(None)


def ride(c, clock, *, minutes=20.0, power=180.0, game="mockgame", variant="bike", stats=None,
         message=None, grade=2.0, custom=None, debug=False):
    """A whole real session: launch, play, end. Returns the summary."""
    sid = c.post("/api/sessions/launch", json={"gameId": game, "variant": variant, "deviceType": "bike",
                                               "debug": debug}).get_json()["sessionId"]
    assert c.post("/gameapi/startsession", json={"sessionId": sid}).status_code == 200
    for _ in range(int(minutes)):
        c.post("/bridgeapi/putstate", json={"bridgeId": "b1", "devices": BIKE,
                                            "actual": {"power": power, "speed": 7.5, "cadence": 85}})
        body = {"sessionId": sid, "grade": grade, "x": 0, "y": 0, "z": 0}
        if custom:
            body["custom"] = custom
        c.post("/gameapi/setstate", json=body)
        clock.advance(60.0)
    end = {"sessionId": sid, "status": "complete"}
    if stats is not None:
        end["stats"] = stats
    if message is not None:
        end["message"] = message
    r = c.post("/gameapi/endsession", json=end)
    assert r.status_code == 200, r.get_json()
    return r.get_json()


# --- session stats and the timeline --------------------------------------------------------------

def test_stats_and_the_games_own_message(client, clock):
    s = ride(client, clock, stats={"deliveries": 7, "crashes": 6},
             message="Seven parcels delivered — and six cars found the hard way.")
    assert s["status"] == "complete"
    assert s["stats"] == {"deliveries": 7, "crashes": 6}
    assert s["duration"] > 300
    me = client.get("/api/me").get_json()
    prof = client.get(f"/api/profiles/{me['username']}").get_json()
    assert prof["updates"][0]["text"].startswith("Seven parcels delivered")
    assert prof["updates"][0]["kind"] == "session"
    assert prof["updates"][0]["sessionId"] == s["sessionId"]
    assert prof["updates"][0]["data"]["stats"] == {"deliveries": 7, "crashes": 6}
    assert prof["totals"]["sessions"] == 1
    assert prof["recentSessions"][0]["stats"]["deliveries"] == 7


def test_a_game_that_sends_no_message_gets_a_plain_one(client, clock):
    ride(client, clock, minutes=25)
    u = client.get("/api/profiles/user7").get_json()["updates"]
    assert len(u) == 1 and "Mock Game" in u[0]["text"]
    assert "km" in u[0]["text"] or "minute" in u[0]["text"]


def test_stats_from_a_tick_survive_a_game_that_never_sends_endsession_stats(client, clock):
    sid = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "bike",
                                                    "deviceType": "bike", "debug": False}).get_json()["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    client.post("/bridgeapi/putstate", json={"bridgeId": "b1", "devices": BIKE, "actual": {"power": 150}})
    client.post("/gameapi/setstate", json={"sessionId": sid, "grade": 1, "stats": {"deliveries": 3}})
    clock.advance(600)
    s = client.post("/gameapi/endsession", json={"sessionId": sid, "status": "complete"}).get_json()
    assert s["stats"] == {"deliveries": 3}


def test_bad_stats_are_refused(client, clock):
    sid = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "bike",
                                                    "debug": True}).get_json()["sessionId"]
    client.post("/gameapi/startsession", json={"sessionId": sid})
    r = client.post("/gameapi/setstate", json={"sessionId": sid, "stats": [1, 2]})
    assert r.status_code == 400 and r.get_json()["error"]["code"] == "stats_invalid"
    r = client.post("/gameapi/setstate", json={"sessionId": sid, "stats": {"a": {"nested": 1}}})
    assert r.status_code == 400


def test_a_debug_session_leaves_no_trace_on_the_profile(client, clock):
    ride(client, clock, debug=True, stats={"deliveries": 9})
    assert client.get("/api/profiles/user7").get_json()["updates"] == []


# --- writing your own updates --------------------------------------------------------------------

def test_manual_updates(client):
    u = client.post("/api/profile/updates", json={"text": "Back on the bike after a cold."}).get_json()
    assert u["kind"] == "manual" and u["text"] == "Back on the bike after a cold."
    assert client.get("/api/profiles/user7/updates").get_json()["updates"][0]["id"] == u["id"]
    assert client.post("/api/profile/updates", json={"text": "  "}).status_code == 400
    assert client.delete(f"/api/profile/updates/{u['id']}").status_code == 200
    assert client.get("/api/profiles/user7/updates").get_json()["updates"] == []
    assert client.delete(f"/api/profile/updates/{u['id']}").status_code == 404


def test_one_player_cannot_delete_anothers_update(client, app):
    u = client.post("/api/profile/updates", json={"text": "mine"}).get_json()
    other = other_client(app, 8)
    assert other.delete(f"/api/profile/updates/{u['id']}").status_code == 404


# --- profiles ------------------------------------------------------------------------------------

def test_profile_fields_and_privacy(client, app):
    client.put("/api/me", json={"firstName": "Dana", "lastName": "Feld", "country": "us",
                                "profile": {"bio": "Rides at dawn."}})
    p = client.get("/api/profiles/user7").get_json()
    assert p["firstName"] == "Dana" and p["lastName"] == "Feld" and p["country"] == "US"
    assert p["bio"] == "Rides at dawn." and p["me"] is True
    assert client.put("/api/me", json={"country": "USA"}).status_code == 400

    # new accounts are public (PLAN.md §18.1), so they are on the Players page from the start
    other = other_client(app, 8)
    assert other.get("/api/me").get_json()["public"] is True
    names = [q["username"] for q in client.get("/api/profiles").get_json()["players"]]
    assert "user7" in names and "user8" in names

    # a player who opts out disappears from everybody else's view, but not their own
    other.put("/api/me", json={"public": False})
    assert "user8" not in [q["username"] for q in client.get("/api/profiles").get_json()["players"]]
    assert client.get("/api/profiles/user8").status_code == 404
    assert other.get("/api/profiles/user8").get_json()["username"] == "user8"


def test_profile_picture_and_thumbnail(client):
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 80)
    assert client.get("/api/profiles/user7/image").status_code == 404
    r = client.put("/api/profile/image", data=png, content_type="image/png")
    assert r.status_code == 200
    assert client.get("/api/profiles/user7/image").data == png
    assert client.get("/api/profiles/user7").get_json()["imageUrl"] == "/api/profiles/user7/image"
    assert client.put("/api/profile/thumbnail", data=png, content_type="image/png").status_code == 200
    assert client.get("/api/profiles/user7").get_json()["thumbnailUrl"] == "/api/profiles/user7/thumbnail"
    # not a PNG at all, however it is labelled
    assert client.put("/api/profile/image", data=b"<script>", content_type="image/png").status_code == 400
    assert client.delete("/api/profile/image").status_code == 200
    assert client.get("/api/profiles/user7/image").status_code == 404


# --- streaks -------------------------------------------------------------------------------------

def test_streak_counting_is_pure():
    this = "2026-W43"
    counts = {"2026-W43": 1, "2026-W42": 3, "2026-W41": 2, "2026-W39": 5}
    # goal 2: this week falls short, so it does not count yet — and does not break the streak either
    assert streaks.length(counts, 2, this) == 2
    assert streaks.length(counts, 1, this) == 3
    # W40 is missing, so nothing before it counts
    assert streaks.length(counts, 5, this) == 0
    # no goal, no streak
    assert streaks.length(counts, 0, this) == 0
    # a goal set this week cannot count last week
    assert streaks.length(counts, 1, this, since="2026-W43") == 1


def test_a_streak_grows_with_sessions_and_resets_with_the_goal(client, clock):
    client.put("/api/me", json={"streakGoal": 1})
    assert client.get("/api/me").get_json()["streak"] == {"length": 0, "goal": 1}
    ride(client, clock)
    assert client.get("/api/me").get_json()["streak"]["length"] == 1
    # changing the goal starts again from this week, as the owner asked
    client.put("/api/me", json={"streakGoal": 3})
    me = client.get("/api/me").get_json()
    assert me["streak"] == {"length": 0, "goal": 3}


def test_a_streak_milestone_reaches_the_timeline(client, clock):
    client.put("/api/me", json={"streakGoal": 1})
    for week in range(3):
        ride(client, clock, minutes=6)
        clock.set(clock.now + 7 * 86400 - 6 * 60)
    kinds = [u["kind"] for u in client.get("/api/profiles/user7/updates").get_json()["updates"]]
    assert "streak" in kinds


# --- measured fitness ----------------------------------------------------------------------------

def test_fitness_is_measured_once_there_are_sessions(client, clock):
    me = client.get("/api/me").get_json()
    assert me["fitness"] == {}
    ride(client, clock, power=200.0)
    f = client.get("/api/me").get_json()["fitness"]
    assert f["source"] == "measured" and 190 < f["watts"] < 210
    assert f["level"] == "veryfit" and f["bike"]["sessions"] == 1


def test_fitness_falls_back_to_what_the_player_declared(client, clock):
    client.put("/api/me", json={"preferences": {"ftp": 240}})
    # a session too short to say anything about fitness leaves the declared figure standing
    ride(client, clock, minutes=2)
    f = client.get("/api/me").get_json()["fitness"]
    assert f["source"] == "declared" and f["watts"] == pytest.approx(0.65 * 240, abs=0.1)


# --- leaderboards --------------------------------------------------------------------------------

def test_boards_are_precomputed_and_ranked(client, app, clock):
    other = other_client(app, 8)
    ride(client, clock, minutes=20, power=150)
    ride(other, clock, minutes=40, power=150)
    bs = {b["id"]: b for b in client.get("/api/leaderboards").get_json()["boards"]}
    assert "distance-week-bike" in bs and bs["distance-week-bike"]["unit"] == "distance"
    assert bs["distance-week-bike"]["players"] == 2
    rows = client.get("/api/leaderboards/distance-week-bike").get_json()["rows"]
    assert [r["rank"] for r in rows] == [1, 2]
    assert rows[0]["username"] == "user8"  # the longer ride went further
    assert rows[0]["value"] > rows[1]["value"]
    assert rows[1]["me"] is True
    assert client.get("/api/leaderboards/nope").status_code == 404


def test_sessions_and_explorer_boards(client, clock):
    ride(client, clock, minutes=6)
    ride(client, clock, minutes=6, game="rollinghills")
    rows = client.get("/api/leaderboards/sessions-all").get_json()["rows"]
    assert rows[0]["value"] == 2
    rows = client.get("/api/leaderboards/explorer-all").get_json()["rows"]
    assert rows[0]["value"] == 2
    assert sorted(rows[0]["detail"]["games"]) == ["mockgame", "rollinghills"]


def test_a_private_player_is_not_ranked_but_still_sees_their_own_row(client, app, clock):
    other = other_client(app, 8)
    other.put("/api/me", json={"public": False})
    ride(other, clock, minutes=40, power=200)
    ride(client, clock, minutes=10, power=120)
    mine = client.get("/api/leaderboards/distance-week-bike").get_json()["rows"]
    assert [r["username"] for r in mine] == ["user7"] and mine[0]["rank"] == 1
    theirs = other.get("/api/leaderboards/distance-week-bike").get_json()["rows"]
    assert [r["username"] for r in theirs] == ["user7", "user8"]
    assert theirs[1]["username"] == "user8" and theirs[1]["rank"] is None


def test_a_game_stat_gets_its_own_board(client, app, clock, root):
    # Cycle Dash declares `deliveries` with `leaderboard: true` in the metadata this test server scanned
    import json
    meta = root / "games" / "citydash" / "metadata.json"
    m = json.loads(meta.read_text())
    m["stats"] = {"deliveries": {"label": "Deliveries", "better": "higher", "leaderboard": True},
                  "crashes": {"label": "Cars hit", "better": "lower", "leaderboard": True}}
    m["progress"] = {"deliveries": {"label": "Deliveries"}}
    meta.write_text(json.dumps(m))
    app.dh.catalog.rescan()
    assert "citydash" not in app.dh.catalog.invalid_games

    other = other_client(app, 8)
    ride(client, clock, game="citydash", minutes=10, stats={"deliveries": 4, "crashes": 2})
    ride(client, clock, game="citydash", minutes=10, stats={"deliveries": 5, "crashes": 9})
    ride(other, clock, game="citydash", minutes=10, stats={"deliveries": 6, "crashes": 1})
    ids = [b["id"] for b in client.get("/api/leaderboards").get_json()["boards"]]
    assert "stat-citydash-deliveries" in ids and "stat-citydash-crashes" in ids

    rows = client.get("/api/leaderboards/stat-citydash-deliveries").get_json()["rows"]
    assert rows[0]["username"] == "user7" and rows[0]["value"] == 9  # totalled over both sessions
    board = client.get("/api/leaderboards/stat-citydash-crashes").get_json()
    assert board["lowerIsBetter"] is True
    # fewest in one session, not the total
    assert board["rows"][0]["username"] == "user8" and board["rows"][0]["value"] == 1
    assert board["rows"][1]["value"] == 2


# --- competitors ---------------------------------------------------------------------------------

def test_competitor_is_somebody_a_little_better(client, app, clock):
    strong = other_client(app, 8)
    weak = other_client(app, 9)
    ride(strong, clock, minutes=20, power=200)   # ~200 W
    ride(weak, clock, minutes=20, power=110)     # ~110 W
    ride(client, clock, minutes=20, power=180)   # me: ~180 W, so 200 W is the one just above

    sid = client.post("/api/sessions/launch", json={"gameId": "mockgame", "variant": "bike",
                                                    "deviceType": "bike"}).get_json()["sessionId"]
    r = client.get(f"/gameapi/competitor?session={sid}").get_json()
    assert r["competitor"]["username"] == "user8"
    assert r["competitor"]["fitness"] > 190
    assert r["timeline"] and r["timeline"][0]["elapsed"] == 0
    assert r["timeline"][-1]["distance"] > 0
    # the rows carry pace as well as totals (the very last row may fall after the last device report)
    assert any("speed" in row and "power" in row for row in r["timeline"])


def test_a_competitor_timeline_carries_the_games_declared_progress(client, app, clock, root):
    import json
    meta = root / "games" / "mockgame" / "metadata.json"
    m = json.loads(meta.read_text())
    m["progress"] = {"deliveries": {"label": "Deliveries"}}
    meta.write_text(json.dumps(m))
    app.dh.catalog.rescan()

    other = other_client(app, 8)
    ride(other, clock, minutes=10, power=185, custom={"deliveries": 3, "secret": "not declared"})
    ride(client, clock, minutes=10, power=180)
    r = client.get("/gameapi/competitor?game=mockgame&variant=bike").get_json()
    assert r["progressKeys"] == ["deliveries"]
    last = r["timeline"][-1]
    assert last["progress"] == {"deliveries": 3}


def test_no_competitor_when_nobody_has_played_it(client, clock):
    r = client.get("/gameapi/competitor?game=mockgame&variant=bike").get_json()
    assert r["competitor"] is None


def test_a_private_player_is_never_somebodys_competitor(client, app, clock):
    other = other_client(app, 8)
    other.put("/api/me", json={"public": False})
    ride(other, clock, minutes=20, power=190)
    ride(client, clock, minutes=20, power=180)
    assert client.get("/gameapi/competitor?game=mockgame&variant=bike").get_json()["competitor"] is None


def test_standing_after_a_session(client, app, clock):
    for uid, power in ((8, 170.0), (9, 185.0)):
        ride(other_client(app, uid), clock, minutes=20, power=power)
    s = ride(client, clock, minutes=30, power=180)
    st = client.get(f"/gameapi/standing?session={s['sessionId']}").get_json()
    assert st["of"] == 3 and st["rank"] == 1 and st["beaten"] == 2
    assert [r["me"] for r in st["rows"]] == [True, False, False]


def test_a_standing_widens_past_a_route_nobody_else_can_have(client, app, clock):
    """Night Racer and Night Watch name their route after the session's seed, so no two sessions share one.
    Restricting the standing to it would leave everybody first of one (PLAN.md §18.3)."""
    other = other_client(app, 8)
    s1 = ride(other, clock, minutes=20, power=175)
    s2 = ride(client, clock, minutes=20, power=180)
    # Give each one a route of its own, the way a seeded game does.
    from dandyhorse import db
    c = db.connect(app.dh.config.db_path)
    c.execute("UPDATE sessions SET route=? WHERE session_id=?", ("seeded-111", s1["sessionId"]))
    c.execute("UPDATE sessions SET route=? WHERE session_id=?", ("seeded-222", s2["sessionId"]))
    c.commit()
    c.close()
    st = client.get(f"/api/sessions/{s2['sessionId']}/standing").get_json()
    assert st["of"] == 2, "a route nobody else can share must not leave the player alone"


def test_the_session_page_can_ask_for_the_same_standing(client, app, clock):
    other = other_client(app, 8)
    ride(other, clock, minutes=20, power=175)
    s = ride(client, clock, minutes=30, power=180)
    st = client.get(f"/api/sessions/{s['sessionId']}/standing").get_json()
    assert st["rank"] == 1 and st["of"] == 2
    # a debug ride is in nobody's league, and neither is somebody else's session
    d = ride(client, clock, minutes=20, debug=True)
    assert client.get(f"/api/sessions/{d['sessionId']}/standing").get_json() == {
        "rank": None, "of": 0, "beaten": 0, "rows": []}
    assert other.get(f"/api/sessions/{s['sessionId']}/standing").status_code == 404


def test_a_session_summary_carries_the_games_numbers(client, clock):
    s = ride(client, clock, minutes=10, stats={"laps": 3})
    detail = client.get(f"/api/sessions/{s['sessionId']}").get_json()
    assert detail["stats"] == {"laps": 3}


# --- bots ----------------------------------------------------------------------------------------

def bot_app(root):
    return make_app(root, BOT_TOKEN="test-bot-token")


HEAD = {"Authorization": "Bearer test-bot-token"}

MARTA = {"username": "marta", "displayName": "Marta", "firstName": "Marta", "lastName": "Rey",
         "country": "ES", "bio": "Rides before work.", "streakGoal": 3,
         "bodyData": {"height": 1.66, "weight": 61, "sex": "female", "age": 34},
         "avatar": {"hair": {"style": "bun"}}}


def test_bots_are_off_without_a_token(client):
    assert client.post("/botapi/upsert", json=MARTA, headers=HEAD).status_code == 404


def test_bot_upsert_and_token(root):
    app = bot_app(root)
    c = app.test_client()
    assert c.post("/botapi/upsert", json=MARTA).status_code == 401
    assert c.post("/botapi/upsert", json=MARTA, headers={"Authorization": "Bearer wrong"}).status_code == 401

    r = c.post("/botapi/upsert", json=MARTA, headers=HEAD).get_json()
    assert r["created"] is True and r["uid"] >= 1001
    again = c.post("/botapi/upsert", json={**MARTA, "bio": "Changed."}, headers=HEAD).get_json()
    assert again["created"] is False and again["uid"] == r["uid"]

    tok = c.post("/botapi/token", json={"username": "marta"}, headers=HEAD).get_json()["token"]
    bot = app.test_client()
    me = bot.get("/api/me", headers={"Authorization": f"Bearer {tok}"}).get_json()
    assert me["username"] == "marta" and me["firstName"] == "Marta" and me["country"] == "ES"
    assert me["streak"]["goal"] == 3

    # a bot looks like anybody else on a profile
    person = app.test_client()
    person.post("/api/login", json={"uid": 7})
    p = person.get("/api/profiles/marta").get_json()
    assert p["bio"] == "Changed." and p["avatar"] == {"hair": {"style": "bun"}}
    assert "isBot" not in p
    assert c.post("/botapi/token", json={"username": "nobody"}, headers=HEAD).status_code == 404


def test_a_bots_whole_history_counts_towards_its_streak(root, clock):
    """A person's streak starts again when they change their goal. A bot's goal comes from bots.json before
    any of its rides exist, so the same rule would hold every bot at zero for ever (PLAN.md §18.8)."""
    app = bot_app(root)
    c = app.test_client()
    c.post("/botapi/upsert", json={**MARTA, "streakGoal": 1}, headers=HEAD)
    tok = c.post("/botapi/token", json={"username": "marta"}, headers=HEAD).get_json()["token"]
    bot = app.test_client()
    bot.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {tok}"
    # a ride last week, as a backfill would make it
    clock.set(clock.now - 7 * 86400)
    ride(bot, clock, minutes=6)
    clock.set(clock.now + 6 * 86400)
    ride(bot, clock, minutes=6)
    assert bot.get("/api/me").get_json()["streak"] == {"length": 2, "goal": 1}

    # a person in the same position starts from the week they set the goal
    person = app.test_client()
    person.post("/api/login", json={"uid": 7})
    person.put("/api/me", json={"streakGoal": 1})
    assert person.get("/api/me").get_json()["streak"]["length"] == 0


def test_a_bot_cannot_take_a_persons_username(root):
    app = bot_app(root)
    person = app.test_client()
    person.post("/api/login", json={"uid": 7})
    c = app.test_client()
    assert c.post("/botapi/upsert", json={"username": "user7"}, headers=HEAD).status_code == 409


def test_backdating_a_bots_session(root, clock):
    app = bot_app(root)
    c = app.test_client()
    uid = c.post("/botapi/upsert", json=MARTA, headers=HEAD).get_json()["uid"]
    tok = c.post("/botapi/token", json={"username": "marta"}, headers=HEAD).get_json()["token"]
    bot = app.test_client()
    bot.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {tok}"
    s = ride(bot, clock, minutes=20, power=160, message="A quiet twenty minutes.")
    old_sid = s["sessionId"]

    then = clock.now - 90 * 86400  # three months ago
    r = c.post("/botapi/backdate", json={"sessionId": old_sid, "startedAt": then}, headers=HEAD)
    assert r.status_code == 200, r.get_json()
    moved = r.get_json()
    assert moved["sessionId"] != old_sid
    assert moved["startedAt"] < s["startedAt"]

    # the row, its files and its timeline update all moved together
    hist = bot.get("/api/sessions").get_json()["sessions"]
    assert [h["sessionId"] for h in hist] == [moved["sessionId"]]
    assert hist[0]["duration"] == pytest.approx(s["duration"], abs=1)
    assert (app.dh.config.sessions_dir / moved["logFile"]).is_file()
    assert bot.get(f"/api/sessions/{moved['sessionId']}/timeline").status_code == 200
    upd = bot.get("/api/profiles/marta/updates").get_json()["updates"]
    assert len(upd) == 1 and upd[0]["sessionId"] == moved["sessionId"]
    assert upd[0]["text"] == "A quiet twenty minutes."
    # a backdated ride is no longer "this week", but it still counts for all time
    assert c.post("/botapi/backdate", json={"sessionId": "nope", "startedAt": then},
                  headers=HEAD).status_code == 404


def test_only_a_bots_session_may_be_backdated(root, clock):
    app = bot_app(root)
    person = app.test_client()
    person.post("/api/login", json={"uid": 7})
    s = ride(person, clock, minutes=6)
    r = app.test_client().post("/botapi/backdate", json={"sessionId": s["sessionId"], "startedAt": 1},
                               headers=HEAD)
    assert r.status_code == 403


# --- admin ---------------------------------------------------------------------------------------

def test_admin_edits_any_players_profile(app, clock):
    admin = app.test_client()
    admin.post("/api/login", json={"uid": 1})  # uid 1 is the admin
    player = other_client(app, 8)
    assert admin.get("/api/admin/users").status_code == 200
    users = {u["username"]: u for u in admin.get("/api/admin/users").get_json()["users"]}
    assert "user8" in users

    r = admin.put("/api/admin/users/8", json={"firstName": "Sam", "country": "pt", "streakGoal": 2,
                                              "bio": "New here.", "avatar": {"hair": {"style": "short"}}})
    assert r.status_code == 200
    p = r.get_json()["profile"]
    assert p["firstName"] == "Sam" and p["country"] == "PT" and p["bio"] == "New here."
    assert p["avatar"] == {"hair": {"style": "short"}}
    assert player.get("/api/me").get_json()["streak"]["goal"] == 2

    u = admin.post("/api/admin/users/8/updates", json={"text": "Welcome to the platform."}).get_json()
    assert player.get("/api/profiles/user8/updates").get_json()["updates"][0]["id"] == u["id"]
    assert admin.delete(f"/api/admin/users/8/updates/{u['id']}").status_code == 200
    assert admin.post("/api/admin/leaderboards/recompute").status_code == 200


def test_only_an_admin(client):
    assert client.get("/api/admin/users").status_code == 403
    assert client.put("/api/admin/users/7", json={"firstName": "x"}).status_code == 403


# --- week maths ----------------------------------------------------------------------------------

def test_week_keys():
    assert weeks.week_before("2026-W01") == "2025-W52"
    assert weeks.week_before("2021-W01") == "2020-W53"
    start, end = weeks.week_bounds("2026-W43", "UTC")
    assert end - start == 7 * 86400
    assert weeks.week_key(start, "UTC") == "2026-W43"


def test_board_period_keys():
    b = boards.REGISTRY["distance-week-bike"]
    assert b.period_key(1_792_000_000.0).startswith("2026-W")
    assert boards.REGISTRY["sessions-all"].period_key() == "all"
    s, e = boards.REGISTRY["longest-session-month"].bounds("2026-12")
    assert e > s
