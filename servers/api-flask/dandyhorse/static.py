"""Static serving of consoles/, bridges/ and games/ with dist-first resolution, and the avatar assets."""
from __future__ import annotations

from pathlib import Path

from flask import Blueprint, Flask, abort, current_app, redirect, send_from_directory
from werkzeug.security import safe_join

bp = Blueprint("static_apps", __name__)


def _serve(base: Path, name: str, path: str):
    if ".." in path.split("/") or ".." in name or "/" in name:
        abort(404)
    folder = base / name
    if not folder.is_dir():
        abort(404)
    if path == "" or path.endswith("/"):
        path = path + "index.html"
    for root in (folder / "dist", folder):
        full = safe_join(str(root), path)
        if full and Path(full).is_file():
            return send_from_directory(str(root), path, max_age=0)
    abort(404)


def _cfg():
    return current_app.dh.config  # type: ignore[attr-defined]


@bp.get("/games/<name>/")
@bp.get("/games/<name>/<path:path>")
def games(name: str, path: str = ""):
    return _serve(_cfg().games_dir, name, path)


@bp.get("/consoles/<name>/")
@bp.get("/consoles/<name>/<path:path>")
def consoles(name: str, path: str = ""):
    return _serve(_cfg().consoles_dir, name, path)


@bp.get("/bridges/<name>/")
@bp.get("/bridges/<name>/<path:path>")
def bridges(name: str, path: str = ""):
    return _serve(_cfg().bridges_dir, name, path)


@bp.get("/avatars/<path:path>")
def avatars(path: str):
    """The avatar designer's assets: mh/ (bodies, garments, hair, textures) and env/ (studio lighting). They never
    change in place, so they are cached for a day; a 404 under mh/ means `make avatar-assets` hasn't been run."""
    if ".." in path.split("/"):
        abort(404)
    root = _cfg().avatars_dir
    full = safe_join(str(root), path)
    if not full or not Path(full).is_file():
        abort(404)
    return send_from_directory(str(root), path, max_age=86400)


@bp.get("/games/<name>")
@bp.get("/consoles/<name>")
@bp.get("/bridges/<name>")
def add_slash(name: str):
    from flask import request
    return redirect(request.path + "/")


@bp.get("/")
def root():
    return redirect(current_app.dh.catalog.default_app_url("consoles"))  # type: ignore[attr-defined]


@bp.get("/bridge/")
@bp.get("/bridge")
def bridge_root():
    return redirect(current_app.dh.catalog.default_app_url("bridges"))  # type: ignore[attr-defined]


def register(app: Flask) -> None:
    app.register_blueprint(bp)
