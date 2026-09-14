import json
import shutil
from pathlib import Path

import pytest

from dandyhorse import create_app

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    games = tmp_path / "games" / "mockgame"
    games.mkdir(parents=True)
    src = REPO / "games" / "mockgame" / "metadata.json"
    if src.is_file():
        shutil.copy(src, games / "metadata.json")
    else:
        (games / "metadata.json").write_text(json.dumps({
            "schemaVersion": 1, "id": "mockgame", "name": "Mock Game", "version": "0.1.0",
            "entry": "index.html", "screenshot": "screenshot.png",
            "variants": [{"id": "treadmill", "name": "T", "deviceTypes": ["treadmill"]},
                         {"id": "bike", "name": "B", "deviceTypes": ["bike"]}]}))
    (games / "index.html").write_text("<html>mock</html>")
    # a game with launch options (PLAN.md §7.1)
    rh = tmp_path / "games" / "rollinghills"
    rh.mkdir(parents=True)
    rh_src = REPO / "games" / "rollinghills" / "metadata.json"
    if rh_src.is_file():
        shutil.copy(rh_src, rh / "metadata.json")
    else:
        (rh / "metadata.json").write_text(json.dumps({
            "schemaVersion": 1, "id": "rollinghills", "name": "Rolling Hills", "version": "0.1.0",
            "entry": "index.html", "options": {"route": {"enum": ["flat", "rolling", "hilly"], "default": "rolling"},
                                               "timeOfDay": {"enum": ["day", "dusk", "night", "dawn"], "default": "day"}},
            "variants": [{"id": "treadmill", "name": "T", "deviceTypes": ["treadmill"]},
                         {"id": "bike", "name": "B", "deviceTypes": ["bike"]}]}))
    (rh / "index.html").write_text("<html>rh</html>")
    # a game that opts out of automatic pauses and has an option that changes what it drives
    kt = tmp_path / "games" / "kingdomtrek"
    kt.mkdir(parents=True)
    shutil.copy(REPO / "games" / "kingdomtrek" / "metadata.json", kt / "metadata.json")
    (kt / "index.html").write_text("<html>kt</html>")
    for kind in ("consoles", "bridges"):
        d = tmp_path / kind / "web"
        d.mkdir(parents=True)
        (d / "metadata.json").write_text(json.dumps({"id": "web", "name": kind, "version": "0.1.0",
                                                     "entry": "index.html", "default": True}))
        (d / "dist").mkdir()
        (d / "dist" / "index.html").write_text(f"<html>{kind} dist</html>")
    return tmp_path


def make_app(root: Path, **over):
    # AUTH pinned so Google credentials in the developer's environment cannot switch the tests' login
    return create_app({"ROOT": str(root), "REAPER": False, "AUTH": "stub", **over})


@pytest.fixture()
def app(root: Path):
    return make_app(root)


@pytest.fixture()
def client(app):
    c = app.test_client()
    r = c.post("/api/login", json={"uid": 7})
    assert r.status_code == 200
    return c


def other_client(app, uid: int):
    c = app.test_client()
    assert c.post("/api/login", json={"uid": uid}).status_code == 200
    return c
