"""Session lifecycle: launch, activate, tick, end, supersede, reap, recover."""
from __future__ import annotations

# A silent game keeps (completes) its session once this much active time has passed; before that it is discarded.
KEEP_SILENT_AFTER = 60.0

import random
import sqlite3
from typing import TYPE_CHECKING, Any

from ..config import METRIC_NAMES
from ..util import ApiError, dumps, iso, loads, now as _now, num_or_none, parse_iso, ulid
from . import log as logmod
from .metrics import Integrator, build_timeline
from .store import RUNNING, LiveSession

if TYPE_CHECKING:
    from .. import Platform

MAX_CUSTOM = 8 * 1024


def _allow_sim(user: dict[str, Any], debug: bool) -> bool:
    return bool(debug or user.get("preferences", {}).get("allowSimulatorInRealSessions"))


def _insert_row(conn: sqlite3.Connection, live: LiveSession) -> None:
    t = iso(live.created_at)
    conn.execute(
        """INSERT INTO sessions(session_id, uid, game_id, variant, game_version, device_type, seed, debug,
           status, requested_duration, body_data, options, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (live.session_id, live.uid, live.game_id, live.variant, live.game_version, live.device_type,
         live.seed, int(live.debug), live.status, live.requested_duration, dumps(live.body_data),
         dumps(live.options), t, t),
    )
    conn.commit()


def resolve_game_options(game: dict[str, Any], chosen: dict[str, Any] | None) -> dict[str, Any]:
    """Game options (PLAN.md §7.1): every key in the game's schema gets the chosen value or its default;
    unknown keys and values outside the enum are errors, so a game can trust what it receives."""
    schema = game.get("options") or {}
    chosen = dict(chosen or {})
    for k in chosen:
        if k not in schema:
            raise ApiError(400, "option_unknown", f"unknown option {k!r}")
    out: dict[str, Any] = {}
    for k, o in schema.items():
        enum = o.get("enum") or []
        if k in chosen:
            if chosen[k] not in enum:
                raise ApiError(400, "option_invalid", f"option {k!r} must be one of {enum}")
            out[k] = chosen[k]
        else:
            out[k] = o.get("default", enum[0] if enum else None)
    return out


def launch(dh: "Platform", conn: sqlite3.Connection, user: dict[str, Any], *, game_id: str,
           variant: str, device_type: str | None, duration: float | None, seed: int | None,
           debug: bool, options: dict[str, Any] | None = None, game_options: dict[str, Any] | None = None) -> LiveSession:
    game = dh.catalog.game(game_id)
    if game is None:
        raise ApiError(404, "game_not_found", f"unknown game {game_id!r}")
    options = dict(options or {})
    options["game"] = resolve_game_options(game, game_options)
    var = dh.catalog.variant(game_id, variant)
    if var is None:
        raise ApiError(404, "variant_not_found", f"unknown variant {variant!r}")
    if device_type is None:
        device_type = var["deviceTypes"][0]
    if device_type not in var["deviceTypes"]:
        raise ApiError(400, "device_type_unsupported", f"variant does not support {device_type!r}")
    if seed is None:
        seed = random.getrandbits(32)
    if duration is None:
        duration = var.get("defaultDuration")
    supersede(dh, conn, user["uid"])
    t = _now()
    live = LiveSession(
        session_id=ulid(t), uid=user["uid"], game_id=game_id, variant=variant,
        game_version=game["version"], device_type=device_type, seed=int(seed) & 0xFFFFFFFF,
        debug=bool(debug), requested_duration=num_or_none(duration), body_data=dict(user.get("body_data") or {}),
        options=dict(options or {}), created_at=t, allow_sim=_allow_sim(user, bool(debug)),
        integrator=Integrator(device_type, user.get("body_data") or {}, dh.config.efficiency, dh.config.default_weight),
        auto_pause=(game.get("capabilities") or {}).get("autoPause") is not False,
    )
    _insert_row(conn, live)
    dh.store.add(live)
    live.bump()
    return live


def supersede(dh: "Platform", conn: sqlite3.Connection, uid: int) -> None:
    live = dh.store.current_for(uid)
    if live is not None:
        end(dh, conn, live, "discarded", "superseded")
    # Also clean any DB rows that somehow remain non-terminal without a live object.
    conn.execute(
        "UPDATE sessions SET status='discarded', end_reason='superseded', ended_at=?, updated_at=? "
        "WHERE uid=? AND status IN ('pending','active')", (iso(), iso(), uid))
    conn.commit()


def activate(dh: "Platform", conn: sqlite3.Connection, live: LiveSession) -> None:
    if live.status in RUNNING:
        return  # idempotent: a game page reloaded mid-session (even while paused) just carries on
    if live.status != "pending":
        raise ApiError(410, "session_ended", f"session is {live.status}")
    t = _now()
    live.status = "active"
    live.started_at = t
    live.last_game_at = t
    live.fitness_data_at = t  # grace: the device has PAUSE_AFTER seconds to show up
    live.log_rel = logmod.relpath(live.session_id, live.created_at)
    live.writer = logmod.LogWriter(dh.config.sessions_dir, live.log_rel)
    live.append({"k": "header", "v": 1, "sessionId": live.session_id, "uid": live.uid,
                 "gameId": live.game_id, "variant": live.variant, "gameVersion": live.game_version,
                 "deviceType": live.device_type, "seed": live.seed, "debug": live.debug,
                 "bodyData": live.body_data, "createdAt": iso(live.created_at)})
    live.append({"k": "status", "t": t, "from": "pending", "to": "active"})
    _, own, _, _ = resolve_owners(dh, live.uid, t, live)
    live.append({"k": "owner", "t": t, "from": None, "to": dict(own), "snapshot": True})
    conn.execute("UPDATE sessions SET status='active', started_at=?, log_file=?, updated_at=? WHERE session_id=?",
                 (iso(t), live.log_rel, iso(t), live.session_id))
    conn.commit()
    live.bump()


def game_tick(dh: "Platform", live: LiveSession, body: dict[str, Any]) -> int:
    """Apply a game setstate. Returns the new seq."""
    if live.status not in RUNNING:
        raise ApiError(410 if live.terminal else 409, "session_not_active", f"session is {live.status}")
    t = _now()
    req = {m: num_or_none(body.get(m)) for m in METRIC_NAMES}
    pos = None
    if all(isinstance(body.get(k), (int, float)) and not isinstance(body.get(k), bool) for k in ("x", "y", "z")):
        pos = {"x": float(body["x"]), "y": float(body["y"]), "z": float(body["z"])}
    custom = body.get("custom")
    if custom is not None and (not isinstance(custom, dict) or len(dumps(custom)) > MAX_CUSTOM):
        raise ApiError(400, "custom_invalid", "custom must be an object of at most 8 KB")
    prompt = _validate_prompt(body.get("requestedInput"))
    ach = body.get("achievements") or []
    if not isinstance(ach, list) or any(not isinstance(a, str) for a in ach):
        raise ApiError(400, "achievements_invalid", "achievements must be a list of strings")

    live.requested = req
    if pos is not None:
        live.position = pos
    if custom is not None:
        live.custom = custom
    if isinstance(body.get("route"), str) and body["route"]:
        live.route = body["route"][:120]
    score = num_or_none(body.get("score"))
    if score is not None:
        live.score = score
    live.prompt = prompt if (prompt and prompt["promptId"] not in live.answered) else None
    live.last_game_at = t
    live.append({"k": "game", "t": t, "tc": num_or_none(body.get("timestamp")), "seq": live.seq + 1,
                 "req": req, "pos": pos, "ach": ach, "prompt": _loggable_prompt(live, prompt), "route": live.route,
                 "score": live.score, "custom": custom, "urgent": bool(body.get("urgent"))})
    new_ach = []
    if not live.debug:
        for a in ach:
            key = f"{live.game_id}:{a}"
            if key not in live.achievements:
                live.achievements[key] = {"t": iso(t), "sessionId": live.session_id}
                new_ach.append(key)
                live.append({"k": "achievement", "t": t, "id": key})
    # Running metrics use the current merged view.
    from .merge import merged_metrics, empty_metrics
    reports, own, _, _ = resolve_owners(dh, live.uid, t, live)
    metrics = merged_metrics(req, reports, own) if any(own.values()) else empty_metrics(req)
    live.integrator.sample(t, metrics, live.position, paused=live.status == "paused")
    return live.bump()


MENU_ITEMS_MAX = 100


def _validate_prompt(p: Any) -> dict[str, Any] | None:
    if p is None:
        return None
    if not isinstance(p, dict):
        raise ApiError(400, "prompt_invalid", "requestedInput must be an object")
    if p.get("layout") == "menu":
        return _validate_menu(p)
    pid = p.get("promptId")
    choices = p.get("choices")
    if not isinstance(pid, str) or not pid or not isinstance(choices, list) or not (1 <= len(choices) <= 10) \
            or any(not isinstance(c, str) or not c or len(c) > 40 for c in choices):
        raise ApiError(400, "prompt_invalid", "promptId and 1-10 string choices (<=40 chars) required")
    out = {"promptId": pid[:64], "prompt": str(p.get("prompt") or "")[:200], "choices": choices,
           "persistent": bool(p.get("persistent"))}
    if p.get("layout") in ("buttons", "dpad"):
        out["layout"] = p["layout"]  # dpad: bridge renders a cross; choices name the buttons (up/down/left/right/ok/back)
    if num_or_none(p.get("timeout")) is not None:
        out["timeout"] = num_or_none(p.get("timeout"))
    return out


def _validate_menu(p: dict[str, Any]) -> dict[str, Any]:
    """A menu prompt (PLAN.md §6.3): the game's whole choice list, so a phone can mirror it. Items carry stable ids;
    `choices` names the d-pad buttons shown beside the list; `rev` changes whenever the list does. Always persistent."""
    from .store import REMOTE_BUTTONS
    pid = p.get("promptId")
    if not isinstance(pid, str) or not pid:
        raise ApiError(400, "prompt_invalid", "promptId required")
    buttons = p.get("choices") if p.get("choices") is not None else []
    if not isinstance(buttons, list) or any(b not in REMOTE_BUTTONS for b in buttons):
        raise ApiError(400, "prompt_invalid", f"a menu's choices are d-pad buttons ({', '.join(REMOTE_BUTTONS)})")
    raw = p.get("items")
    if not isinstance(raw, list) or not 1 <= len(raw) <= MENU_ITEMS_MAX:
        raise ApiError(400, "prompt_invalid", f"a menu needs 1-{MENU_ITEMS_MAX} items")
    items: list[dict[str, Any]] = []
    ids: set[str] = set()
    for it in raw:
        iid = it.get("id") if isinstance(it, dict) else None
        label = it.get("label") if isinstance(it, dict) else None
        # An item id may not be a d-pad button name, so an answer is never ambiguous (gamekit escapes them).
        if not isinstance(iid, str) or not 1 <= len(iid) <= 64 or iid in ids or iid in REMOTE_BUTTONS \
                or not isinstance(label, str) or not 1 <= len(label) <= 40:
            raise ApiError(400, "prompt_invalid",
                           "menu items need a unique id (1-64 chars, not a d-pad button name) and a label (1-40 chars)")
        ids.add(iid)
        item: dict[str, Any] = {"id": iid, "label": label}
        if isinstance(it.get("hint"), str) and it["hint"]:
            item["hint"] = it["hint"][:200]
        if it.get("disabled") is True:
            item["disabled"] = True
        items.append(item)
    rev = p.get("rev")
    countdown = num_or_none(p.get("countdown"))
    return {"promptId": pid[:64], "prompt": str(p.get("prompt") or "")[:200], "choices": list(dict.fromkeys(buttons)),
            "persistent": True, "layout": "menu", "items": items,
            "highlight": p["highlight"] if p.get("highlight") in ids else None,
            "back": p["back"] if p.get("back") in ids else None,
            "rev": rev if isinstance(rev, int) and not isinstance(rev, bool) else 0,
            "countdown": countdown if countdown is not None and countdown >= 0 else None}


def _loggable_prompt(live: LiveSession, prompt: dict[str, Any] | None) -> dict[str, Any] | None:
    """A menu prompt can carry 100 items every second: the log gets it in full only when its list changes (a new
    promptId or rev), otherwise just where the highlight is."""
    if not prompt or prompt.get("layout") != "menu":
        return prompt
    key = (prompt["promptId"], prompt["rev"])
    if live.logged_prompt == key:
        return {"promptId": prompt["promptId"], "rev": prompt["rev"], "highlight": prompt["highlight"]}
    live.logged_prompt = key
    return prompt


def parse_rev(v: Any) -> int | None:
    """The menu `rev` an answer was aimed at (PLAN.md §6.3), or None."""
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _answer_ok(prompt: dict[str, Any], choice: str) -> bool:
    if choice in prompt["choices"]:
        return True
    return prompt.get("layout") == "menu" and any(
        it["id"] == choice and not it.get("disabled") for it in prompt.get("items") or [])


def answer_input(dh: "Platform", live: LiveSession, prompt_id: str, choice: str, source: str,
                 rev: int | None = None) -> bool:
    if live.status not in RUNNING:
        return False
    if prompt_id in live.answered:
        return False
    if live.prompt is None or live.prompt["promptId"] != prompt_id:
        return False
    if not _answer_ok(live.prompt, choice):
        return False
    t = _now()
    if not live.prompt.get("persistent"):
        # one-shot: first answer wins and the prompt disappears everywhere
        live.answered.add(prompt_id)
        live.prompt = None
    live.input = {"promptId": prompt_id, "choice": choice, "t": t, "source": source}
    if rev is not None:
        live.input["rev"] = rev  # which version of a menu the tap was aimed at; the game drops stale ones
    live.inputs.append({**live.input, "n": live.seq + 1})
    live.append({"k": "input", "t": t, "source": source, "promptId": prompt_id, "choice": choice,
                 **({"rev": rev} if rev is not None else {})})
    live.bump()
    return True


def bridge_report(dh: "Platform", conn: sqlite3.Connection, user: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """Apply a bridge putstate. Returns {seq, session, ignored}."""
    bridge_id = body.get("bridgeId")
    if not isinstance(bridge_id, str) or not bridge_id:
        raise ApiError(400, "bridge_id_required", "bridgeId is required")
    t = _now()
    devices = body.get("devices") or []
    if not isinstance(devices, list):
        raise ApiError(400, "devices_invalid", "devices must be a list")
    devs = []
    for d in devices:
        if not isinstance(d, dict):
            continue
        devs.append({"role": d.get("role"), "type": d.get("type"), "name": str(d.get("name") or "")[:80],
                     "address": str(d.get("address") or "")[:120], "protocol": d.get("protocol"),
                     "status": d.get("status"), "features": d.get("features") or None,
                     **({"userStopped": True} if d.get("userStopped") is True else {})})
    cmd_in = body.get("commanded") or {}
    act_in = body.get("actual") or {}
    cmd = {m: num_or_none(cmd_in.get(m)) for m in METRIC_NAMES if m != "heartRate"} if isinstance(cmd_in, dict) else {}
    act = {m: num_or_none(act_in.get(m)) for m in METRIC_NAMES} if isinstance(act_in, dict) else {}
    browser_id = str(body.get("browserId"))[:64] if body.get("browserId") else None
    rep = {"t": t, "tc": num_or_none(body.get("timestamp")), "bridgeId": bridge_id, "browserId": browser_id,
           "label": (str(body.get("label"))[:60] if body.get("label") else None),
           "devices": devs, "commanded": cmd, "actual": act}
    dh.store.report(user["uid"], bridge_id, rep)
    # remember devices
    for d in devs:
        # Simulators are never remembered as the user's devices unless explicitly registered.
        if d.get("protocol") in ("sim", "simulator") or d["address"].startswith("sim:") or d["status"] == "simulated":
            continue
        if d["address"] and d["role"] in ("fitness", "hrm") and d["status"] in ("connected", "readonly"):
            dtype = d["type"] if d["role"] == "fitness" else "hrm"
            _touch_device(conn, user["uid"], dtype, d["address"], d["name"], d.get("protocol") or "ftms")
    live = dh.store.current_for(user["uid"])
    if live is not None and live.terminal:
        live = None
    reports, own, device_type, allow_sim = resolve_owners(dh, user["uid"], t, live)
    standing = bridge_standing(dh, user["uid"], bridge_id, reports, own, device_type, allow_sim, t)
    session = None
    seq = 0
    if live is not None:
        if live.status in RUNNING:
            live.append({"k": "bridge", "t": t, "tc": rep["tc"], "seq": live.seq + 1, "bridgeId": bridge_id,
                         "label": rep["label"], "devices": devs, "cmd": cmd, "act": act,
                         "urgent": bool(body.get("urgent"))})
        seq = live.bump()
        session = session_brief(dh, live)
    return {"seq": seq, "session": session, "serverTime": t, "owner": own, **standing}


def _touch_device(conn: sqlite3.Connection, uid: int, dtype: str, address: str, name: str, protocol: str) -> None:
    t = iso()
    row = conn.execute("SELECT device_id FROM devices WHERE uid=? AND address=?", (uid, address)).fetchone()
    if row is None:
        conn.execute("INSERT INTO devices(uid, type, address, name, protocol, last_seen_at, created_at) VALUES (?,?,?,?,?,?,?)",
                     (uid, dtype, address, name or dtype, protocol, t, t))
    else:
        conn.execute("UPDATE devices SET last_seen_at=?, name=COALESCE(NULLIF(?,''), name) WHERE device_id=?",
                     (t, name, row["device_id"]))
    conn.commit()


def resolve_controls(game: dict[str, Any], var: dict[str, Any], device_type: str, chosen: dict[str, Any]) -> str:
    """What the game drives on this device type (metadata `controls`, §7.1): "incline" is the usual treadmill game,
    "none" a read-only one. A launch option may change it: an option's `controls` maps one of its values to
    per-device-type controls (Kingdom Trek's Hills: On drives incline / grade, Off only reads the machine)."""
    controls = (var.get("controls") or {}).get(device_type) or "none"
    for key, spec in (game.get("options") or {}).items():
        by_value = spec.get("controls") if isinstance(spec, dict) else None
        over = ((by_value or {}).get(chosen.get(key)) or {}).get(device_type)
        if isinstance(over, str) and over:
            controls = over
    return controls


def session_brief(dh: "Platform", live: LiveSession) -> dict[str, Any]:
    t = _now()
    entry = dh.catalog.game_entry_url(live.game_id) or f"/games/{live.game_id}/index.html"
    var = dh.catalog.variant(live.game_id, live.variant) or {}
    # Bridges use `controls` for wording.
    controls = resolve_controls(dh.catalog.game(live.game_id) or {}, var, live.device_type,
                                (live.options or {}).get("game") or {})
    return {
        "sessionId": live.session_id, "status": live.status, "endReason": live.end_reason,
        "gameId": live.game_id, "variant": live.variant, "deviceType": live.device_type,
        "seed": live.seed, "debug": live.debug, "seq": live.seq, "controls": controls,
        # False: the game plays on without a machine (a heart-rate strap alone is fine) and only the user pauses.
        "autoPause": live.auto_pause,
        "elapsed": (t - live.started_at) if live.started_at else 0.0,
        "requestedDuration": live.requested_duration, "route": live.route,
        # seconds since the game last called setstate; bridges hold, then ramp a treadmill down, when it grows
        "gameAge": (t - live.last_game_at) if live.status in RUNNING and live.last_game_at else None,
        "pause": pause_view(live, t),
        "pausedSeconds": paused_so_far(live, t),
        "activeSeconds": ((t - live.started_at) - paused_so_far(live, t)) if live.started_at else 0.0,
        "gameEntryUrl": f"{entry}?session={live.session_id}&variant={live.variant}&seed={live.seed}&debug={1 if live.debug else 0}",
    }


def end(dh: "Platform", conn: sqlite3.Connection, live: LiveSession, status: str, reason: str) -> dict[str, Any]:
    """Finalize a live session. Idempotent."""
    if live.terminal:
        return summary_from_db(conn, live.session_id) or {}
    t = _now()
    if live.status == "pending":
        status = "discarded"
    live.status = status
    live.end_reason = reason
    live.ended_at = t
    rows: list[dict[str, Any]] = []
    summary: dict[str, Any] = live.integrator.summary(None)
    log_rel = live.log_rel
    if live.writer is not None:
        live.append({"k": "end", "t": t, "status": status, "endReason": reason})
        live.writer.close()
        live.writer = None
        rows, summary = build_timeline(
            live.records, device_type=live.device_type, allow_sim=live.allow_sim,
            fresh=dh.config.fresh_seconds, body_data=live.body_data, efficiency=dh.config.efficiency,
            default_weight=dh.config.default_weight)
        assert live.log_rel is not None
        log_rel = logmod.finalize(dh.config.sessions_dir, live.log_rel)
        logmod.write_timeline(dh.config.sessions_dir, log_rel, rows)
        summary["duration"] = t - (live.started_at or t)
    if live.paused_since is not None:
        live.paused_total += t - live.paused_since
        live.paused_since = None
    summary.setdefault("pausedSeconds", live.paused_total)
    _write_final_row(conn, live.session_id, status, reason, t, summary, log_rel, live.route, live.score)
    if status == "complete" and not live.debug:
        _apply_achievements(conn, live.uid, live.achievements)
        _platform_achievements(conn, live.uid, live.session_id, live.device_type)
    dh.store.remove(live.session_id)
    live.bump()
    return summary_from_db(conn, live.session_id) or {}


def _write_final_row(conn: sqlite3.Connection, session_id: str, status: str, reason: str, t: float,
                     s: dict[str, Any], log_rel: str | None, route: str | None, score: float | None) -> None:
    conn.execute(
        """UPDATE sessions SET status=?, end_reason=?, ended_at=?, duration=?, distance=?, energy=?, work=?,
           avg_power=?, max_power=?, avg_speed=?, max_speed=?, avg_hr=?, max_hr=?, avg_cadence=?,
           elevation_gain=?, energy_source=?, sample_count=?, log_file=?, log_finalized=?, route=?, score=?,
           paused_seconds=?, updated_at=? WHERE session_id=?""",
        (status, reason, iso(t), s.get("duration"), s.get("distance"), s.get("energy"), s.get("work"),
         s.get("avgPower"), s.get("maxPower"), s.get("avgSpeed"), s.get("maxSpeed"), s.get("avgHr"),
         s.get("maxHr"), s.get("avgCadence"), s.get("elevationGain"), s.get("energySource"),
         s.get("sampleCount"), log_rel, 1 if log_rel else 0, route, score, s.get("pausedSeconds"), iso(t), session_id))
    conn.commit()


def _apply_achievements(conn: sqlite3.Connection, uid: int, new: dict[str, dict[str, Any]]) -> None:
    if not new:
        return
    row = conn.execute("SELECT achievements FROM users WHERE uid=?", (uid,)).fetchone()
    ach = loads(row["achievements"]) if row else {}
    changed = False
    for k, v in new.items():
        if k not in ach:
            ach[k] = v
            changed = True
    if changed:
        conn.execute("UPDATE users SET achievements=?, updated_at=? WHERE uid=?", (dumps(ach), iso(), uid))
        conn.commit()


def _platform_achievements(conn: sqlite3.Connection, uid: int, session_id: str, device_type: str) -> None:
    agg = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(distance),0) AS dist, COALESCE(MAX(duration),0) AS longest, "
        "COUNT(DISTINCT device_type) AS types FROM sessions WHERE uid=? AND status='complete' AND debug=0",
        (uid,)).fetchone()
    earned: dict[str, dict[str, Any]] = {}
    stamp = {"t": iso(), "sessionId": session_id}
    if agg["n"] >= 1:
        earned["platform:first_session"] = stamp
    if agg["n"] >= 10:
        earned["platform:sessions_10"] = stamp
    if agg["n"] >= 100:
        earned["platform:sessions_100"] = stamp
    if agg["dist"] >= 100_000:
        earned["platform:total_distance_100km"] = stamp
    if agg["dist"] >= 1_000_000:
        earned["platform:total_distance_1000km"] = stamp
    if agg["longest"] >= 3600:
        earned["platform:longest_session_1h"] = stamp
    if agg["types"] >= 2:
        earned["platform:every_device_type"] = stamp
    _apply_achievements(conn, uid, earned)


def summary_from_db(conn: sqlite3.Connection, session_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM sessions WHERE session_id=?", (session_id,)).fetchone()
    return row_to_summary(row) if row else None


def row_to_summary(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    return {
        "sessionId": d["session_id"], "uid": d["uid"], "gameId": d["game_id"], "variant": d["variant"],
        "gameVersion": d["game_version"], "deviceType": d["device_type"], "seed": d["seed"],
        "debug": bool(d["debug"]), "status": d["status"], "endReason": d["end_reason"],
        "route": d["route"], "score": d["score"], "requestedDuration": d["requested_duration"],
        "createdAt": d["created_at"], "startedAt": d["started_at"], "endedAt": d["ended_at"],
        "duration": d["duration"], "distance": d["distance"], "energy": d["energy"], "work": d["work"],
        "avgPower": d["avg_power"], "maxPower": d["max_power"], "avgSpeed": d["avg_speed"],
        "maxSpeed": d["max_speed"], "avgHr": d["avg_hr"], "maxHr": d["max_hr"], "avgCadence": d["avg_cadence"],
        "elevationGain": d["elevation_gain"], "energySource": d["energy_source"], "sampleCount": d["sample_count"],
        "pausedSeconds": d["paused_seconds"] if "paused_seconds" in d.keys() else None,
        "hasImage": bool(d.get("image_file")),
        "bodyData": loads(d["body_data"]), "options": loads(d["options"]), "hasLog": bool(d["log_finalized"]),
    }


def reap(dh: "Platform", conn: sqlite3.Connection, now: float | None = None) -> list[str]:
    now = _now() if now is None else now
    reaped: list[str] = []
    for live in dh.store.all_live():
        if live.status in RUNNING and live.last_game_at is not None and now - live.last_game_at > dh.config.active_timeout:
            # A game that fell silent (closed tab, crash, lost screen) must not throw a workout away: once the
            # session has a minute of active time it completes; only a ride that never really began is dropped.
            active = (now - (live.started_at or now)) - paused_so_far(live, now)
            end(dh, conn, live, "complete" if active >= KEEP_SILENT_AFTER else "discarded", "timeout")
            reaped.append(live.session_id)
        elif live.status == "pending" and now - live.created_at > dh.config.pending_timeout:
            end(dh, conn, live, "discarded", "never_started")
            reaped.append(live.session_id)
    return reaped


def recover(dh: "Platform", conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """Finalize sessions left pending/active by a previous process."""
    out: list[tuple[str, str]] = []
    rows = conn.execute("SELECT * FROM sessions WHERE status IN ('pending','active')").fetchall()
    for row in rows:
        sid = row["session_id"]
        if row["status"] == "pending" or not row["log_file"]:
            _write_final_row(conn, sid, "discarded", "never_started", _now(), {}, row["log_file"], row["route"], row["score"])
            out.append((sid, "discarded"))
            continue
        records = logmod.read_records(dh.config.sessions_dir, row["log_file"])
        game_ts = [r["t"] for r in records if r.get("k") == "game"]
        span = (max(game_ts) - min(game_ts)) if len(game_ts) >= 2 else 0.0
        status = "complete" if span >= dh.config.recovery_min_seconds else "discarded"
        body = loads(row["body_data"])
        user = conn.execute("SELECT preferences FROM users WHERE uid=?", (row["uid"],)).fetchone()
        allow_sim = bool(row["debug"]) or bool(loads(user["preferences"]).get("allowSimulatorInRealSessions") if user else False)
        end_t = max(game_ts) if game_ts else (parse_iso(row["started_at"]) or _now())
        rel = row["log_file"]
        if not rel.endswith(".gz"):
            # append an end marker then gzip
            w = logmod.LogWriter(dh.config.sessions_dir, rel)
            w.write({"k": "end", "t": end_t, "status": status, "endReason": "server_restart"})
            w.close()
            records.append({"k": "end", "t": end_t, "status": status, "endReason": "server_restart"})
            rel = logmod.finalize(dh.config.sessions_dir, rel)
        rows_tl, summary = build_timeline(records, device_type=row["device_type"], allow_sim=allow_sim,
                                          fresh=dh.config.fresh_seconds, body_data=body,
                                          efficiency=dh.config.efficiency, default_weight=dh.config.default_weight)
        logmod.write_timeline(dh.config.sessions_dir, rel, rows_tl)
        started = parse_iso(row["started_at"])
        summary["duration"] = (end_t - started) if started else summary.get("duration")
        route, score = row["route"], row["score"]
        for r in records:
            if r.get("k") == "game":
                route = r.get("route") or route
                score = r.get("score") if r.get("score") is not None else score
        _write_final_row(conn, sid, status, "server_restart", end_t, summary, rel, route, score)
        if status == "complete" and not row["debug"]:
            ach = {r["id"]: {"t": iso(r["t"]), "sessionId": sid} for r in records if r.get("k") == "achievement"}
            _apply_achievements(conn, row["uid"], ach)
            _platform_achievements(conn, row["uid"], sid, row["device_type"])
        out.append((sid, status))
    return out


def timeline_for(dh: "Platform", conn: sqlite3.Connection, session_id: str) -> list[dict[str, Any]] | None:
    live = dh.store.get(session_id)
    if live is not None:
        rows, _ = build_timeline(live.records, device_type=live.device_type, allow_sim=live.allow_sim,
                                 fresh=dh.config.fresh_seconds, body_data=live.body_data,
                                 efficiency=dh.config.efficiency, default_weight=dh.config.default_weight)
        return rows
    row = conn.execute("SELECT log_file FROM sessions WHERE session_id=?", (session_id,)).fetchone()
    if row is None or not row["log_file"]:
        return None
    cached = logmod.read_timeline(dh.config.sessions_dir, row["log_file"])
    if cached is not None:
        return cached
    return []


# --- bridge ownership ---------------------------------------------------------

def resolve_owners(dh: "Platform", uid: int, t: float, live: LiveSession | None = None
                   ) -> tuple[dict[str, dict[str, Any]], dict[str, str | None], str | None, bool]:
    """Current fresh reports and sticky owners for a user.

    With a live session, candidates must match its device type and simulator policy.
    Without one, any fitness device qualifies (so two bridges still conflict before launch).
    Ownership changes are logged into an active session's log.
    """
    from .merge import owners
    if live is not None and live.terminal:
        live = None
    device_type = live.device_type if live else None
    allow_sim = live.allow_sim if live else True
    reports = dh.store.reports(uid, t)
    with dh.store.lock:
        prev = dict(dh.store.owner.get(uid) or {"fitness": None, "hrm": None})
        own = owners(reports, t, device_type, allow_sim, dh.config.fresh_seconds, prev)
        changed = own != prev
        if changed:
            dh.store.owner[uid] = dict(own)
    if changed and live is not None and live.status in RUNNING:
        live.append({"k": "owner", "t": t, "from": prev, "to": dict(own)})
    if live is not None and live.status in RUNNING:
        with dh.store.lock:
            _update_pause(dh, live, reports, own, t, device_type, allow_sim)
    return reports, own, device_type, allow_sim


def claim_role(dh: "Platform", uid: int, bridge_id: str, role: str) -> tuple[bool, str | None]:
    """Make `bridge_id` the owner of `role` if it currently offers a usable device for it."""
    from .merge import device_allowed
    if role not in ("fitness", "hrm"):
        return False, "role_invalid"
    t = _now()
    live = dh.store.current_for(uid)
    reports, own, device_type, allow_sim = resolve_owners(dh, uid, t, live)
    rep = reports.get(bridge_id)
    if rep is None or t - rep.get("t", 0.0) > dh.config.fresh_seconds:
        return False, "bridge_not_reporting"
    if not any(d.get("role") == role and device_allowed(d, device_type, allow_sim) for d in rep.get("devices") or []):
        return False, "no_usable_device"
    if own.get(role) == bridge_id:
        return True, None
    new = dict(own)
    new[role] = bridge_id
    with dh.store.lock:
        dh.store.owner[uid] = new
    if live is not None and live.status in RUNNING:
        live.append({"k": "owner", "t": t, "from": own, "to": dict(new), "claim": bridge_id})
    if live is not None:
        live.bump()
    return True, None


def bridge_standing(dh: "Platform", uid: int, bridge_id: str, reports: dict[str, dict[str, Any]],
                    own: dict[str, str | None], device_type: str | None, allow_sim: bool, t: float) -> dict[str, Any]:
    """roles / ignoredReasons / conflicts for one bridge, for putstate and getstate responses."""
    from .merge import roles_for
    mine = reports.get(bridge_id)
    roles, reasons = roles_for(bridge_id, mine, own, t, device_type, allow_sim, dh.config.fresh_seconds)
    conflicts = []
    for role, standing in roles.items():
        if standing != "standby":
            continue
        ob = own.get(role)
        orep = reports.get(ob) if ob else None
        dev = next((d for d in (orep or {}).get("devices") or [] if d.get("role") == role), None)
        conflicts.append({"role": role, "ownerBridgeId": ob, "ownerLabel": (orep or {}).get("label"),
                          "ownerBrowserId": (orep or {}).get("browserId"),
                          "ownerDevice": {"name": dev.get("name"), "type": dev.get("type"), "status": dev.get("status")} if dev else None})
    return {"roles": roles, "ignoredReasons": reasons, "ignored": sorted(reasons), "conflicts": conflicts}



# --- device-loss pause ----------------------------------------------------------
#
# A running session pauses when the bridge that owns the exercise device has sent no valid
# exercise data for PAUSE_AFTER seconds: either it stopped reporting (tab asleep, phone locked,
# network) or it reports but its values are null (device off, not streaming). Heart rate never
# pauses a session. It resumes once valid data has flowed for RESUME_STREAK seconds.

STREAK_GAP = 2.0  # a gap this long between valid reports restarts the resume streak


def _fitness_dev(rep: dict[str, Any] | None) -> dict[str, Any] | None:
    return next((d for d in (rep or {}).get("devices") or [] if d.get("role") == "fitness"), None)


def _update_pause(dh: "Platform", live: LiveSession, reports: dict[str, dict[str, Any]],
                  own: dict[str, str | None], t: float, device_type: str | None, allow_sim: bool) -> None:
    from .merge import has_fitness_data
    cfg = dh.config
    ob = own.get("fitness")
    rep = reports.get(ob) if ob else None
    if rep is not None:
        dev = _fitness_dev(rep)
        live.last_fitness = {"bridgeId": ob, "label": rep.get("label"), "deviceName": (dev or {}).get("name")}
    if rep is not None and has_fitness_data(rep, device_type):
        rt = rep["t"]
        if live.last_valid_t is None or live.valid_since is None or rt - live.last_valid_t > STREAK_GAP:
            live.valid_since = rt
        live.last_valid_t = max(live.last_valid_t or rt, rt)
        live.fitness_data_at = max(live.fitness_data_at or rt, rt)
    else:
        live.valid_since = None
        live.last_valid_t = None

    silent = t - (live.fitness_data_at if live.fitness_data_at is not None else t)

    # A pause pressed on a bridge (or in the game) wins over everything until Play; device loss cannot resume it.
    if live.user_pause is not None:
        up = live.user_pause
        message = ("Paused in the game. Resume there, or press Play." if up.get("by") == "game"
                   else f"Paused from {up.get('label') or 'a bridge'}. Press Play to continue.")
        info = {"reason": "user", "message": message,
                "bridgeId": up.get("bridgeId"), "bridgeLabel": up.get("label"), "deviceName": None, "deviceStatus": None}
        if live.status == "active":
            _enter_pause(live, t, info)
        elif (live.pause or {}).get("message") != message:
            live.pause = info  # paused for the device, or by someone else; now held by this user pause
            live.bump()
        return

    if not live.auto_pause:
        # The game opted out (capabilities.autoPause false): missing data never pauses it, and once the user's
        # pause is lifted it runs again at once, whatever the device is doing.
        if live.status == "paused":
            _leave_pause(live, t)
        return

    if live.status == "active":
        if silent > cfg.pause_after:
            _enter_pause(live, t, _pause_info(live, reports, own, t, device_type, allow_sim, cfg.fresh_seconds))
        return
    # paused
    streak = (live.last_valid_t - live.valid_since) if live.valid_since is not None and live.last_valid_t is not None else -1
    if streak >= cfg.resume_streak and silent <= cfg.pause_after:
        _leave_pause(live, t)
        return
    info = _pause_info(live, reports, own, t, device_type, allow_sim, cfg.fresh_seconds)
    if live.pause is None or info["message"] != live.pause.get("message"):
        live.pause = info  # the situation changed (e.g. the bridge came back but the device is still off)
        live.bump()


def _enter_pause(live: LiveSession, t: float, info: dict[str, Any]) -> None:
    live.status = "paused"
    live.paused_since = t
    live.pause = info
    live.append({"k": "status", "t": t, "from": "active", "to": "paused", "reason": info["reason"], "message": info["message"]})
    live.bump()


def _leave_pause(live: LiveSession, t: float) -> None:
    live.paused_total += t - (live.paused_since or t)
    live.status = "active"
    live.paused_since = None
    live.pause = None
    live.append({"k": "status", "t": t, "from": "paused", "to": "active"})
    live.bump()


def user_pause(dh: "Platform", live: LiveSession, bridge_id: str | None, label: str | None, by: str = "bridge") -> None:
    """The user pressed Pause on a bridge, or paused inside the game (`by="game"`, POST /gameapi/pause)."""
    if live.status not in RUNNING:
        raise ApiError(409, "session_not_running", f"session is {live.status}")
    t = _now()
    live.user_pause = {"bridgeId": bridge_id, "label": label, "t": t, "by": by}
    live.append({"k": "userPause", "t": t, "action": "pause", "by": bridge_id if by == "bridge" else by})
    resolve_owners(dh, live.uid, t, live)


def user_resume(dh: "Platform", live: LiveSession, bridge_id: str) -> None:
    """The user pressed Play. The session resumes only if exercise data is flowing; otherwise it stays
    paused and the pause reason switches to what is wrong with the device."""
    if live.status not in RUNNING:
        raise ApiError(409, "session_not_running", f"session is {live.status}")
    t = _now()
    if live.user_pause is not None:
        live.user_pause = None
        live.append({"k": "userPause", "t": t, "action": "resume", "by": bridge_id})
    resolve_owners(dh, live.uid, t, live)


def _pause_info(live: LiveSession, reports: dict[str, dict[str, Any]], own: dict[str, str | None], t: float,
                device_type: str | None, allow_sim: bool, fresh: float) -> dict[str, Any]:
    """Why the session is paused, with a message every game can show as-is."""
    from ..config import ACTIVE_DEVICE_STATUSES
    from .merge import ignore_reason
    noun = "treadmill" if live.device_type == "treadmill" else "bike trainer"
    why_text = {"wrong_device_type": f"this session needs a {noun}",
                "simulator_not_allowed": "simulators only count in debug sessions"}

    def info(reason: str, message: str, bid: str | None = None, rep: dict[str, Any] | None = None,
             dev: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"reason": reason, "message": message, "bridgeId": bid, "bridgeLabel": (rep or {}).get("label"),
                "deviceName": (dev or {}).get("name"), "deviceStatus": (dev or {}).get("status")}

    ob = own.get("fitness")
    if ob:
        rep = reports[ob]
        dev = _fitness_dev(rep)
        return info("no_data", f"{(dev or {}).get('name') or 'The ' + noun} on {rep.get('label') or 'the bridge'} "
                               f"is connected but not sending data.", ob, rep, dev)

    lf = live.last_fitness
    if lf is None:
        for bid, rep in reports.items():
            if t - rep.get("t", 0.0) > fresh:
                continue
            for d in rep.get("devices") or []:
                if d.get("role") == "fitness" and d.get("status") in ACTIVE_DEVICE_STATUSES:
                    why = ignore_reason(d, device_type, allow_sim)
                    if why:
                        return info("device_unavailable", f"{d.get('name')} on {rep.get('label') or 'the bridge'} "
                                                          f"can't be used: {why_text.get(why, why)}.", bid, rep, d)
        return info("no_device", f"No {noun} is connected. Open the bridge and connect one.")

    rep = reports.get(lf["bridgeId"])
    label = (rep or {}).get("label") or lf.get("label") or "The bridge"
    if rep is not None and t - rep.get("t", 0.0) <= fresh:
        dev = _fitness_dev(rep)
        if dev is None:
            return info("device_unavailable", f"{label} no longer has a {noun} connected.", lf["bridgeId"], rep)
        why = ignore_reason(dev, device_type, allow_sim)
        if why:
            return info("device_unavailable", f"{dev.get('name')} on {label} can't be used: {why_text.get(why, why)}.",
                        lf["bridgeId"], rep, dev)
        return info("device_unavailable", f"{dev.get('name') or 'The ' + noun} on {label} is {dev.get('status')}.",
                    lf["bridgeId"], rep, dev)
    return info("bridge_silent", f"{label} stopped reporting. Is its tab asleep or closed, or the phone locked?",
                lf["bridgeId"], rep or {"label": lf.get("label")}, {"name": lf.get("deviceName")})


def pause_view(live: LiveSession, t: float) -> dict[str, Any] | None:
    if live.status != "paused" or live.pause is None:
        return None
    return {**live.pause, "since": live.paused_since, "seconds": t - (live.paused_since or t)}


def paused_so_far(live: LiveSession, t: float) -> float:
    return live.paused_total + ((t - live.paused_since) if live.paused_since is not None else 0.0)
