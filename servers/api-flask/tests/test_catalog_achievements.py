"""Games name their achievements in metadata.json; the catalog checks the names and hands them to the console."""
from pathlib import Path

from dandyhorse.catalog import _validate_game


def meta(**over):
    return {"id": "g1", "name": "G", "version": "1.0.0", "entry": "index.html",
            "variants": [{"id": "bike", "name": "B", "deviceTypes": ["bike"]}], **over}


def test_named_achievements_reach_the_console(client):
    games = {g["id"]: g for g in client.get("/api/games").get_json()["games"]}
    assert games["kingdomtrek"]["achievements"]["kingdom-saved"]["name"] == "Kingdom saved"
    assert all(isinstance(g["achievements"], dict) for g in games.values())


def test_achievement_names_are_checked():
    folder = Path("/games/g1")
    assert _validate_game(folder, meta()) == []
    assert _validate_game(folder, meta(achievements={"turbo": {"name": "Turbo!", "description": "Filled the meter."},
                                                     "level-5": {"name": "Level 5"}})) == []
    for bad in [[], {"turbo": "Turbo!"}, {"turbo": {"name": " "}}, {"turbo": {"name": "x" * 61}},
                {"bad id!": {"name": "X"}}, {"turbo": {"name": "T", "description": 5}},
                {"turbo": {"name": "T", "description": "x" * 201}}]:
        assert any("achievements" in e for e in _validate_game(folder, meta(achievements=bad))), bad
