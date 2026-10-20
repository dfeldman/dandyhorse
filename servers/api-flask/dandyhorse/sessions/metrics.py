"""Distance, energy, timeline derivation and session summary (PLAN.md §8.3–8.4)."""
from __future__ import annotations

from typing import Any, Sequence

from ..config import METRIC_NAMES
from .merge import empty_metrics, merged_metrics, owners

GAME_STALE = 5.0      # seconds after which game-requested values are considered gone
MAX_DT = 5.0          # never integrate across a gap longer than this
FILL = 5.0            # carry-forward window for missing timeline seconds


class Integrator:
    """Accumulates distance, work, energy and summary statistics from merged samples."""

    def __init__(self, device_type: str, body_data: dict[str, Any], efficiency: float,
                 default_weight: float) -> None:
        self.device_type = device_type
        w = body_data.get("weight")
        self.weight = float(w) if isinstance(w, (int, float)) and w > 0 else default_weight
        self.sex = body_data.get("sex")
        a = body_data.get("age")
        self.age = float(a) if isinstance(a, (int, float)) else 35.0
        self.efficiency = efficiency
        self.last_t: float | None = None
        self.last_y: float | None = None
        self.distance = 0.0
        self.work = 0.0
        self.energy = 0.0
        self.elevation_gain = 0.0
        self.energy_source = "none"
        self.n = 0
        self._stats: dict[str, list[float]] = {k: [0.0, 0.0, 0.0] for k in ("power", "speed", "heartRate", "cadence")}

    def _stat(self, key: str, v: float | None) -> None:
        if v is None:
            return
        s = self._stats[key]
        s[0] += 1
        s[1] += v
        s[2] = max(s[2], v)

    def speed_of(self, metrics: dict[str, dict[str, Any]]) -> float | None:
        if self.device_type == "treadmill":
            return metrics["speed"]["actual"]
        v = metrics["speed"]["requested"]
        return v if v is not None else metrics["speed"]["actual"]

    def sample(self, t: float, metrics: dict[str, dict[str, Any]], pos: dict[str, Any] | None,
               paused: bool = False) -> None:
        self.n += 1
        if paused:
            # Waiting for the exercise device: no distance, work, calories or averages accrue
            # (an HRM alone would otherwise keep adding heart-rate calories).
            self.last_t = t
            y = pos.get("y") if pos else None
            if isinstance(y, (int, float)):
                self.last_y = float(y)
            return
        speed = self.speed_of(metrics)
        power = metrics["power"]["actual"]
        hr = metrics["heartRate"]["actual"]
        cadence = metrics["cadence"]["actual"]
        self._stat("speed", speed)
        self._stat("power", power)
        self._stat("heartRate", hr)
        self._stat("cadence", cadence)
        if self.last_t is not None:
            dt = t - self.last_t
            if 0 < dt <= MAX_DT:
                if speed is not None:
                    self.distance += speed * dt
                if power is not None:
                    self.work += power * dt
                self.energy += self._energy_rate(metrics, speed, power, hr) * dt
        self.last_t = t
        y = pos.get("y") if pos else None
        if isinstance(y, (int, float)):
            if self.last_y is not None and y > self.last_y:
                self.elevation_gain += y - self.last_y
            self.last_y = float(y)

    def _energy_rate(self, metrics: dict[str, dict[str, Any]], speed: float | None,
                     power: float | None, hr: float | None) -> float:
        """Metabolic energy rate in W (J/s)."""
        if self.device_type == "bike" and power is not None:
            self.energy_source = "power"
            return power / self.efficiency
        if self.device_type == "treadmill" and speed is not None:
            grade = metrics["incline"]["actual"]
            if grade is None:
                grade = metrics["incline"]["commanded"]
            if grade is None:
                grade = metrics["incline"]["requested"]
            g = (grade or 0.0) / 100.0
            v = speed * 60.0  # m/min
            if speed < 1.8:
                vo2 = 3.5 + 0.1 * v + 1.8 * v * g
            else:
                vo2 = 3.5 + 0.2 * v + 0.9 * v * g
            kcal_per_min = vo2 * self.weight / 200.0
            self.energy_source = "acsm"
            return kcal_per_min * 4184.0 / 60.0
        if hr is not None:
            if self.sex == "f":
                kcal_min = (-20.4022 + 0.4472 * hr - 0.1263 * self.weight + 0.074 * self.age) / 4.184
            else:
                kcal_min = (-55.0969 + 0.6309 * hr + 0.1988 * self.weight + 0.2017 * self.age) / 4.184
            if self.energy_source == "none":
                self.energy_source = "hr"
            return max(kcal_min, 0.0) * 4184.0 / 60.0
        return 0.0

    def running(self) -> dict[str, Any]:
        return {"distance": self.distance, "energy": self.energy,
                "work": self.work if self.device_type == "bike" else None,
                # climbing so far: games show it as the ride goes on, and a competitor's timeline carries it
                "elevationGain": self.elevation_gain}

    def summary(self, duration: float | None) -> dict[str, Any]:
        def avg(k: str) -> float | None:
            s = self._stats[k]
            return s[1] / s[0] if s[0] else None

        def mx(k: str) -> float | None:
            s = self._stats[k]
            return s[2] if s[0] else None

        return {
            "duration": duration,
            "distance": self.distance,
            "energy": self.energy,
            "work": self.work if self.device_type == "bike" else None,
            "avgPower": avg("power"), "maxPower": mx("power"),
            "avgSpeed": avg("speed"), "maxSpeed": mx("speed"),
            "avgHr": avg("heartRate"), "maxHr": mx("heartRate"),
            "avgCadence": avg("cadence"),
            "elevationGain": self.elevation_gain,
            "energySource": self.energy_source,
            "sampleCount": self.n,
        }


def build_timeline(records: list[dict[str, Any]], *, device_type: str, allow_sim: bool,
                   fresh: float, body_data: dict[str, Any], efficiency: float,
                   default_weight: float,
                   progress_keys: Sequence[str] = ()) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Replay a raw log into 1 Hz merged rows plus a summary.

    `progress_keys` are the counters the game declares in `metadata.json.progress` (PLAN.md §18.2). Those
    keys, and only those, are carried out of each tick's `custom` into the row's `progress`, so a competitor
    can be asked how many deliveries they had made by a given second without opening the raw log.
    """
    start: float | None = None
    end: float | None = None
    for r in records:
        if r.get("k") == "status" and r.get("to") == "active" and start is None:
            start = r["t"]
        if r.get("k") == "end":
            end = r["t"]
    game_ts = [r["t"] for r in records if r.get("k") == "game"]
    if start is None:
        start = game_ts[0] if game_ts else None
    if start is None:
        integ = Integrator(device_type, body_data, efficiency, default_weight)
        return [], integ.summary(None)
    if end is None:
        end = max([start] + game_ts + [r["t"] for r in records if r.get("k") == "bridge"])

    integ = Integrator(device_type, body_data, efficiency, default_weight)
    requested: dict[str, Any] = {m: None for m in METRIC_NAMES}
    pos: dict[str, Any] | None = None
    progress: dict[str, float] = {}
    last_game_t: float | None = None
    reports: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    owner: dict[str, str | None] = {"fitness": None, "hrm": None}
    next_t = start
    idx = 0
    ordered = sorted((r for r in records if r.get("k") in ("game", "bridge", "owner", "status") and "t" in r),
                     key=lambda r: r["t"])

    logged_owner = any(r.get("k") == "owner" for r in records)
    paused = False

    def emit(t: float) -> None:
        req = requested if (last_game_t is not None and t - last_game_t <= FILL) else {m: None for m in METRIC_NAMES}
        nonlocal owner
        if logged_owner:
            # The live server logged every ownership decision (including claims); replay it
            # verbatim, dropping an owner whose reports have gone stale.
            own = {r: (b if b and b in reports and t - reports[b]["t"] <= fresh else None) for r, b in owner.items()}
        else:
            owner = own = owners(reports, t, device_type, allow_sim, fresh, owner)
        metrics = merged_metrics(req, reports, own) if any(own.values()) else empty_metrics(req)
        integ.sample(t, metrics, pos, paused)
        row = {"t": t, "elapsed": t - start, "position": dict(pos) if pos else None, "paused": paused}
        row.update(metrics)
        row.update(integ.running())
        if progress_keys:
            row["progress"] = dict(progress)
        rows.append(row)

    def absorb(upto: float) -> None:
        nonlocal idx, requested, pos, last_game_t, owner, paused
        while idx < len(ordered) and ordered[idx]["t"] <= upto:
            r = ordered[idx]
            idx += 1
            if r["k"] == "status":
                paused = r.get("to") == "paused"
            elif r["k"] == "owner":
                owner = dict(r.get("to") or {"fitness": None, "hrm": None})
            elif r["k"] == "game":
                requested = {m: (r.get("req") or {}).get(m) for m in METRIC_NAMES}
                if r.get("pos"):
                    pos = r["pos"]
                for key in progress_keys:
                    v = (r.get("custom") or {}).get(key)
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        progress[key] = float(v)
                last_game_t = r["t"]
            else:
                reports[r["bridgeId"]] = {"t": r["t"], "devices": r.get("devices") or [],
                                          "commanded": r.get("cmd") or {}, "actual": r.get("act") or {}}

    last_emitted: float | None = None
    while next_t <= end + 1e-9:
        absorb(next_t)
        emit(next_t)
        last_emitted = next_t
        next_t += 1.0
    if last_emitted is None or end - last_emitted > 1e-6:
        # Final partial second so short sessions and the last tick are represented.
        absorb(end)
        emit(end)
    summary = integ.summary(end - start)
    summary["pausedSeconds"] = paused_seconds(records, end)
    return rows, summary


def paused_seconds(records: list[dict[str, Any]], end: float) -> float:
    total, since = 0.0, None
    for r in sorted((r for r in records if r.get("k") == "status" and "t" in r), key=lambda r: r["t"]):
        if r.get("to") == "paused":
            since = r["t"]
        elif r.get("from") == "paused" and since is not None:
            total += r["t"] - since
            since = None
    if since is not None:
        total += max(0.0, end - since)
    return total
