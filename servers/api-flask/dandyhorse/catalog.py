"""Discovers games, consoles and bridges from their metadata.json files."""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any

from .config import DEVICE_TYPES, Config

ID_RE = re.compile(r"^[a-z0-9_-]{2,32}$")
SEMVER_RE = re.compile(r"^\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)?$")
CONTROLS = ("speed", "incline", "speed+incline", "grade", "power", "none")


STAT_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}$")
STAT_FORMATS = ("integer", "number", "distance", "duration")
STAT_BETTER = ("higher", "lower")


def _validate_stats(spec: Any, field: str) -> list[str]:
    """`{key: {label, unit?, better?, format?, leaderboard?}}` (PLAN.md §18.2). `leaderboard` is only read
    for `stats`; a progress counter is per-tick and never a board of its own."""
    if not isinstance(spec, dict):
        return [f"{field} must be an object of {{key: {{label, ...}}}}"]
    errs: list[str] = []
    for k, o in spec.items():
        if not isinstance(k, str) or not STAT_KEY_RE.match(k):
            errs.append(f"{field} key {k!r} must match ^[A-Za-z][A-Za-z0-9_]{{0,31}}$")
            continue
        if not isinstance(o, dict):
            errs.append(f"{field}.{k} must be an object")
            continue
        if not isinstance(o.get("label"), str) or not o["label"].strip() or len(o["label"]) > 40:
            errs.append(f"{field}.{k}: label is required (up to 40 characters)")
        if "unit" in o and (not isinstance(o["unit"], str) or len(o["unit"]) > 12):
            errs.append(f"{field}.{k}: unit must be a short string")
        if "format" in o and o["format"] not in STAT_FORMATS:
            errs.append(f"{field}.{k}: format must be one of {STAT_FORMATS}")
        if "better" in o and o["better"] not in STAT_BETTER:
            errs.append(f"{field}.{k}: better must be \"higher\" or \"lower\"")
        if "leaderboard" in o and not isinstance(o["leaderboard"], bool):
            errs.append(f"{field}.{k}: leaderboard must be true or false")
    return errs


def _validate_game(folder: Path, meta: Any) -> list[str]:
    errs: list[str] = []
    if not isinstance(meta, dict):
        return ["metadata.json is not an object"]
    gid = meta.get("id")
    if gid != folder.name:
        errs.append(f"id {gid!r} must equal folder name {folder.name!r}")
    if not isinstance(gid, str) or not ID_RE.match(gid or ""):
        errs.append("id must match ^[a-z0-9_-]{2,32}$")
    for k in ("name", "version", "entry"):
        if not isinstance(meta.get(k), str) or not meta[k]:
            errs.append(f"{k} is required")
    if isinstance(meta.get("version"), str) and not SEMVER_RE.match(meta["version"]):
        errs.append("version must be semver")
    caps = meta.get("capabilities", {})
    if not isinstance(caps, dict):
        errs.append("capabilities must be an object")
    elif "autoPause" in caps and not isinstance(caps["autoPause"], bool):
        errs.append("capabilities.autoPause must be true or false")
    if isinstance(caps, dict) and "endScreen" in caps and not isinstance(caps["endScreen"], bool):
        errs.append("capabilities.endScreen must be true or false")
    opts = meta.get("options", {})
    if not isinstance(opts, dict):
        errs.append("options must be an object of {key: {enum, default?, label?, labels?}}")
    else:
        for k, o in opts.items():
            if not isinstance(k, str) or not ID_RE.match(k) and not re.match(r"^[A-Za-z][A-Za-z0-9_]{0,31}$", k):
                errs.append(f"option key {k!r} invalid")
            if not isinstance(o, dict) or not isinstance(o.get("enum"), list) or not o["enum"] or not all(isinstance(x, str) and x for x in o["enum"]):
                errs.append(f"option {k!r}: enum must be a non-empty list of strings")
                continue
            if "default" in o and o["default"] not in o["enum"]:
                errs.append(f"option {k!r}: default must be one of enum")
            if "labels" in o and (not isinstance(o["labels"], list) or len(o["labels"]) != len(o["enum"])):
                errs.append(f"option {k!r}: labels must match enum")
            # {"on": {"treadmill": "incline", "bike": "grade"}}: choosing that value changes what the game drives
            ctl = o.get("controls", {})
            if not isinstance(ctl, dict) or any(
                    v not in o["enum"] or not isinstance(m, dict)
                    or any(d not in DEVICE_TYPES or c not in CONTROLS for d, c in m.items())
                    for v, m in ctl.items()):
                errs.append(f"option {k!r}: controls must map enum values to {{deviceType: one of {CONTROLS}}}")
    # {"turbo": {"name": "Turbo!", "description": "Filled the Turbo meter."}}: names for the Achievements page
    ach = meta.get("achievements", {})
    if not isinstance(ach, dict) or any(
            not isinstance(k, str) or not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$", k) or not isinstance(a, dict)
            or not isinstance(a.get("name"), str) or not a["name"].strip() or len(a["name"]) > 60
            or not isinstance(a.get("description", ""), str) or len(a.get("description", "")) > 200
            for k, a in ach.items()):
        errs.append('achievements must map ids to {"name", "description"?} (a name up to 60 characters, '
                    'a description up to 200)')
    # What the game counts (PLAN.md §18.2): `stats` are the end-of-session totals it sends with endsession,
    # `progress` the per-tick counters it puts in setstate.custom and the timeline keeps for competitors.
    errs += _validate_stats(meta.get("stats", {}), "stats")
    errs += _validate_stats(meta.get("progress", {}), "progress")
    variants = meta.get("variants")
    if not isinstance(variants, list) or not variants:
        errs.append("variants must be a non-empty list")
    else:
        seen: set[str] = set()
        for v in variants:
            if not isinstance(v, dict):
                errs.append("variant must be an object")
                continue
            vid = v.get("id")
            if not isinstance(vid, str) or not ID_RE.match(vid):
                errs.append(f"variant id {vid!r} invalid")
            elif vid in seen:
                errs.append(f"duplicate variant id {vid!r}")
            seen.add(vid or "")
            dts = v.get("deviceTypes")
            if not isinstance(dts, list) or not dts or any(d not in DEVICE_TYPES for d in dts):
                errs.append(f"variant {vid!r}: deviceTypes must be a non-empty list of {DEVICE_TYPES}")
            if not isinstance(v.get("name"), str):
                errs.append(f"variant {vid!r}: name required")
    return errs


def _validate_app(folder: Path, meta: Any) -> list[str]:
    errs: list[str] = []
    if not isinstance(meta, dict):
        return ["metadata.json is not an object"]
    if meta.get("id") != folder.name:
        errs.append(f"id must equal folder name {folder.name!r}")
    for k in ("name", "version", "entry"):
        if not isinstance(meta.get(k), str) or not meta[k]:
            errs.append(f"{k} is required")
    return errs


class Catalog:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self._lock = threading.Lock()
        self.games: dict[str, dict[str, Any]] = {}
        self.invalid_games: dict[str, list[str]] = {}
        self.consoles: dict[str, dict[str, Any]] = {}
        self.bridges: dict[str, dict[str, Any]] = {}
        self.rescan()

    @staticmethod
    def _scan(base: Path, validate) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
        ok: dict[str, dict[str, Any]] = {}
        bad: dict[str, list[str]] = {}
        if not base.is_dir():
            return ok, bad
        for folder in sorted(base.iterdir()):
            mf = folder / "metadata.json"
            if not folder.is_dir() or not mf.is_file():
                continue
            try:
                meta = json.loads(mf.read_text("utf-8"))
            except ValueError as e:
                bad[folder.name] = [f"metadata.json parse error: {e}"]
                continue
            errs = validate(folder, meta)
            if errs:
                bad[folder.name] = errs
            else:
                meta["_folder"] = str(folder)
                ok[folder.name] = meta
        return ok, bad

    def rescan(self) -> None:
        games, bad = self._scan(self.cfg.games_dir, _validate_game)
        consoles, _ = self._scan(self.cfg.consoles_dir, _validate_app)
        bridges, _ = self._scan(self.cfg.bridges_dir, _validate_app)
        with self._lock:
            self.games, self.invalid_games = games, bad
            self.consoles, self.bridges = consoles, bridges

    # --- games -----------------------------------------------------------
    def game(self, game_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self.games.get(game_id)

    def variant(self, game_id: str, variant_id: str) -> dict[str, Any] | None:
        g = self.game(game_id)
        if not g:
            return None
        for v in g["variants"]:
            if v["id"] == variant_id:
                return v
        return None

    def public_games(self) -> list[dict[str, Any]]:
        out = []
        with self._lock:
            games = list(self.games.values())
        for g in games:
            base = f"/games/{g['id']}/"
            variants = []
            for v in g["variants"]:
                vv = dict(v)
                shot = v.get("screenshot") or g.get("screenshot")
                vv["screenshotUrl"] = base + shot if shot else None
                # A short silent clip of a real session, played when the console hovers the card. Optional
                # everywhere: a game without one simply keeps its still.
                clip = v.get("preview") or g.get("preview")
                vv["previewUrl"] = base + clip if clip else None
                variants.append(vv)
            out.append({
                "id": g["id"], "name": g["name"], "version": g["version"],
                "author": g.get("author"), "description": g.get("description"),
                "capabilities": g.get("capabilities", {}),
                "screenshotUrl": base + g["screenshot"] if g.get("screenshot") else None,
                "previewUrl": base + g["preview"] if g.get("preview") else None,
                "entryUrl": base + g["entry"],
                "preferencesSchema": g.get("preferencesSchema"),
                "options": g.get("options", {}),
                "variants": variants,
                "achievements": g.get("achievements", {}),
                "stats": g.get("stats", {}),
                "progress": g.get("progress", {}),
            })
        return out

    def game_entry_url(self, game_id: str) -> str | None:
        g = self.game(game_id)
        return f"/games/{game_id}/{g['entry']}" if g else None

    # --- consoles / bridges ----------------------------------------------
    def apps(self, kind: str) -> list[dict[str, Any]]:
        d = self.consoles if kind == "consoles" else self.bridges
        with self._lock:
            items = list(d.values())
        return [{"id": a["id"], "name": a["name"], "version": a["version"],
                 "default": bool(a.get("default")), "url": f"/{kind}/{a['id']}/{a['entry']}"}
                for a in items]

    def default_app_url(self, kind: str) -> str:
        name = self.cfg.default_console if kind == "consoles" else self.cfg.default_bridge
        d = self.consoles if kind == "consoles" else self.bridges
        with self._lock:
            a = d.get(name)
            if a is None:
                for cand in d.values():
                    if cand.get("default"):
                        a = cand
                        break
            if a is None and d:
                a = next(iter(d.values()))
        if a is None:
            return f"/{kind}/{name}/index.html"
        return f"/{kind}/{a['id']}/{a['entry']}"


    # --- what a game counts (PLAN.md §18.2) ------------------------------
    def stats_spec(self, game_id: str) -> dict[str, Any]:
        return dict((self.game(game_id) or {}).get("stats") or {})

    def progress_keys(self, game_id: str) -> list[str]:
        """The per-tick counters this game declares; only these are kept in the derived timeline."""
        return sorted((self.game(game_id) or {}).get("progress") or {})
