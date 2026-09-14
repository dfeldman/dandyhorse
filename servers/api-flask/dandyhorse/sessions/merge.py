"""Multi-bridge merge policy (PLAN.md §9.3).

Pure functions over bridge reports so the live store and the offline
timeline builder produce identical results.
"""
from __future__ import annotations

from typing import Any

from ..config import ACTIVE_DEVICE_STATUSES, METRIC_NAMES, ROLES


def device_allowed(dev: dict[str, Any], device_type: str | None, allow_sim: bool) -> bool:
    if dev.get("status") not in ACTIVE_DEVICE_STATUSES:
        return False
    role = dev.get("role")
    if role == "fitness":
        if device_type is not None and dev.get("type") != device_type:
            return False
        if dev.get("status") == "simulated" and not allow_sim:
            return False
        return True
    return role == "hrm"


def ignored_roles(report: dict[str, Any], device_type: str | None, allow_sim: bool) -> list[str]:
    """Roles this report offers that the server will not use."""
    out: list[str] = []
    for dev in report.get("devices") or []:
        role = dev.get("role")
        if role in ROLES and dev.get("status") in ACTIVE_DEVICE_STATUSES \
                and not device_allowed(dev, device_type, allow_sim) and role not in out:
            out.append(role)
    return out


def owners(reports: dict[str, dict[str, Any]], now: float, device_type: str | None,
           allow_sim: bool, fresh: float, prev: dict[str, str | None] | None = None) -> dict[str, str | None]:
    """Pick the owning bridge per role.

    Sticky: a previous owner keeps the role while its reports stay fresh and
    still offer a matching device; otherwise the freshest candidate wins.
    Without stickiness two live bridges would alternate every report.
    """
    candidates: dict[str, dict[str, float]] = {r: {} for r in ROLES}
    for bid, rep in reports.items():
        t = rep.get("t", 0.0)
        if now - t > fresh:
            continue
        for dev in rep.get("devices") or []:
            if not device_allowed(dev, device_type, allow_sim):
                continue
            candidates[dev["role"]][bid] = t
    out: dict[str, str | None] = {}
    for role in ROLES:
        cands = candidates[role]
        keep = (prev or {}).get(role)
        if keep in cands:
            out[role] = keep
        elif cands:
            out[role] = max(cands.items(), key=lambda kv: kv[1])[0]
        else:
            out[role] = None
    return out


def merged_metrics(requested: dict[str, Any], reports: dict[str, dict[str, Any]],
                   own: dict[str, str | None]) -> dict[str, dict[str, Any]]:
    fit = reports.get(own["fitness"]) if own.get("fitness") else None
    hrm = reports.get(own["hrm"]) if own.get("hrm") else None
    fit_cmd = (fit or {}).get("commanded") or {}
    fit_act = (fit or {}).get("actual") or {}
    hrm_act = (hrm or {}).get("actual") or {}
    out: dict[str, dict[str, Any]] = {}
    for m in METRIC_NAMES:
        req = requested.get(m)
        if m == "heartRate":
            hr = hrm_act.get("heartRate")
            act = hr if hr is not None else fit_act.get("heartRate")
            out[m] = {"requested": req, "commanded": None, "actual": act}
        else:
            out[m] = {"requested": req, "commanded": fit_cmd.get(m), "actual": fit_act.get(m)}
    return out


def empty_metrics(requested: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    requested = requested or {}
    return {m: {"requested": requested.get(m), "commanded": None, "actual": None} for m in METRIC_NAMES}


def has_fitness_data(report: dict[str, Any] | None, device_type: str | None) -> bool:
    """Does this report carry real exercise-device data? Heart rate never counts.

    Treadmill: a belt speed (0 is data). Bike: power or cadence (0 is data).
    """
    act = (report or {}).get("actual") or {}
    if device_type == "treadmill":
        return act.get("speed") is not None
    if device_type == "bike":
        return act.get("power") is not None or act.get("cadence") is not None
    return any(act.get(m) is not None for m in ("speed", "power", "cadence"))


def ignore_reason(dev: dict[str, Any], device_type: str | None, allow_sim: bool) -> str | None:
    """Why an active device of a fresh report is not usable, or None if it is."""
    if dev.get("status") not in ACTIVE_DEVICE_STATUSES:
        return None
    if dev.get("role") == "fitness":
        if device_type is not None and dev.get("type") != device_type:
            return "wrong_device_type"
        if dev.get("status") == "simulated" and not allow_sim:
            return "simulator_not_allowed"
    return None


def roles_for(bridge_id: str, report: dict[str, Any] | None, own: dict[str, str | None], now: float,
              device_type: str | None, allow_sim: bool, fresh: float) -> tuple[dict[str, str | None], dict[str, str]]:
    """This bridge's standing per role: owner | standby | ignored | None (offers nothing).

    Returns (roles, reasons) where reasons explains every 'ignored' role.
    """
    roles: dict[str, str | None] = {r: None for r in ROLES}
    reasons: dict[str, str] = {}
    if report is None or now - report.get("t", 0.0) > fresh:
        return roles, reasons
    for dev in report.get("devices") or []:
        role = dev.get("role")
        if role not in ROLES or dev.get("status") not in ACTIVE_DEVICE_STATUSES:
            continue
        why = ignore_reason(dev, device_type, allow_sim)
        if why is not None:
            if roles[role] is None:
                roles[role] = "ignored"
                reasons[role] = why
            continue
        roles[role] = "owner" if own.get(role) == bridge_id else "standby"
        reasons.pop(role, None)
    return roles, reasons
