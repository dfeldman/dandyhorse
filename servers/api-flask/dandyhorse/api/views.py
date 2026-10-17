"""Builders for the merged state views returned to games and bridges."""
from __future__ import annotations

import sqlite3
from typing import Any

from ..config import DEFAULT_LIMITS, METRIC_NAMES
from ..sessions.lifecycle import session_brief
from ..sessions.merge import empty_metrics, merged_metrics
from ..sessions.store import LiveSession
from ..util import loads, now as _now


def bridges_view(reports: dict[str, dict[str, Any]], own: dict[str, str | None] | None = None,
                 device_type: str | None = None, allow_sim: bool = True, now: float | None = None,
                 fresh: float = 5.0) -> list[dict[str, Any]]:
    from ..sessions.merge import roles_for
    now = _now() if now is None else now
    out = []
    for bid, r in sorted(reports.items(), key=lambda kv: -kv[1].get("t", 0)):
        roles, reasons = roles_for(bid, r, own or {}, now, device_type, allow_sim, fresh)
        out.append({"bridgeId": bid, "browserId": r.get("browserId"), "label": r.get("label"), "lastSeen": r.get("t"),
                    "fresh": now - r.get("t", 0) <= fresh, "devices": r.get("devices") or [],
                    "roles": roles, "ignoredReasons": reasons})
    return out


def game_view(dh, live: LiveSession) -> dict[str, Any]:
    from ..sessions.lifecycle import resolve_owners
    t = _now()
    reports, own, _, _ = resolve_owners(dh, live.uid, t, live)
    metrics = merged_metrics(live.requested, reports, own) if any(own.values()) else empty_metrics(live.requested)
    out: dict[str, Any] = {
        "sessionId": live.session_id, "sessionStatus": live.status, "endReason": live.end_reason,
        "seq": live.seq, "serverTime": t,
        "elapsed": (t - live.started_at) if live.started_at else 0.0,
        "requestedDuration": live.requested_duration,
    }
    out.update(metrics)
    out["position"] = dict(live.position) if live.position else None
    out.update(live.integrator.running())
    from ..sessions.lifecycle import pause_view, paused_so_far
    out["sessionStatus"] = live.status  # re-read: resolving owners may have paused/resumed
    out["pause"] = pause_view(live, t)
    out["pausedSeconds"] = paused_so_far(live, t)
    out["activeSeconds"] = out["elapsed"] - out["pausedSeconds"]  # elapsed is wall clock; this excludes pauses
    out["input"] = live.input
    out["inputs"] = list(live.inputs)
    out["requestedInput"] = live.prompt
    out["bridges"] = bridges_view(reports, own, live.device_type, live.allow_sim, t, dh.config.fresh_seconds)
    out["owner"] = own
    out["devicePreferences"] = device_prefs_for_owner(dh, live, reports, own)
    out["custom"] = live.custom
    return out


def ended_game_view(row: sqlite3.Row) -> dict[str, Any]:
    out: dict[str, Any] = {"sessionId": row["session_id"], "sessionStatus": row["status"],
                           "endReason": row["end_reason"], "seq": 0, "serverTime": _now(), "elapsed": None,
                           "requestedDuration": row["requested_duration"]}
    out.update(empty_metrics())
    out.update({"position": None, "distance": row["distance"], "energy": row["energy"], "work": row["work"],
                "input": None, "requestedInput": None, "bridges": [], "owner": {"fitness": None, "hrm": None},
                "devicePreferences": {}, "custom": {}, "pause": None,
                "pausedSeconds": row["paused_seconds"] if "paused_seconds" in row.keys() else None})
    return out


def _fitness_address(report: dict[str, Any] | None) -> str | None:
    for d in (report or {}).get("devices") or []:
        if d.get("role") == "fitness" and d.get("address"):
            return d["address"]
    return None


def device_prefs(conn: sqlite3.Connection, uid: int, address: str | None) -> dict[str, Any]:
    if not address:
        return {}
    row = conn.execute("SELECT preferences FROM devices WHERE uid=? AND address=?", (uid, address)).fetchone()
    return loads(row["preferences"]) if row else {}


def limits_for(conn: sqlite3.Connection, uid: int, device_type: str | None, address: str | None) -> dict[str, Any]:
    base = dict(DEFAULT_LIMITS.get(device_type or "treadmill", DEFAULT_LIMITS["treadmill"]))
    prefs = device_prefs(conn, uid, address)
    for k in base:
        v = prefs.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            base[k] = float(v)
    return base


def device_prefs_for_owner(dh, live: LiveSession, reports, own) -> dict[str, Any]:
    from ..db import get_db
    try:
        conn = get_db()
    except RuntimeError:
        return {}
    rep = reports.get(own.get("fitness")) if own.get("fitness") else None
    return device_prefs(conn, live.uid, _fitness_address(rep))


def bridge_view(dh, conn: sqlite3.Connection, uid: int, bridge_id: str | None) -> dict[str, Any]:
    from ..sessions.lifecycle import bridge_standing, resolve_owners
    t = _now()
    live = dh.store.current_for(uid)
    if live is not None and live.terminal:
        live = None
    reports, own, dtype, allow_sim = resolve_owners(dh, uid, t, live)
    mine = reports.get(bridge_id) if bridge_id else None
    device_type = live.device_type if live else None
    if device_type is None and mine:
        for d in mine.get("devices") or []:
            if d.get("role") == "fitness" and d.get("type"):
                device_type = d["type"]
    address = _fitness_address(mine)
    out: dict[str, Any] = {"serverTime": t, "session": None,
                           "requested": {m: None for m in METRIC_NAMES},
                           "limits": limits_for(conn, uid, device_type, address),
                           "devicePreferences": {},
                           "requestedInput": None, "input": None,
                           "owner": own,
                           "otherBridges": [b for b in bridges_view(reports, own, dtype, allow_sim, t, dh.config.fresh_seconds)
                                            if b["bridgeId"] != bridge_id]}
    out.update(bridge_standing(dh, uid, bridge_id or "", reports, own, dtype, allow_sim, t))
    # a completed game showing its summary (PLAN.md §6.4.1): bridges keep it on screen and offer Done
    out["endScreen"] = dh.store.end_screen_for(uid, t)
    if address:
        out["devicePreferences"][address] = device_prefs(conn, uid, address)
    if live is not None:
        out["session"] = session_brief(dh, live)
        out["requested"] = dict(live.requested)
        out["requestedInput"] = live.prompt
        out["input"] = live.input
        merged = merged_metrics(live.requested, reports, own) if any(own.values()) else empty_metrics(live.requested)
        out["merged"] = merged
        out["position"] = dict(live.position) if live.position else None
        out.update(live.integrator.running())
    else:
        out["merged"] = empty_metrics()
        out["position"] = None
        out.update({"distance": None, "energy": None, "work": None})
    return out
