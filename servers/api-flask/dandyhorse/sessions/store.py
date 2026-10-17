"""In-memory live sessions and bridge presence."""
from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..config import METRIC_NAMES
from .log import LogWriter
from .metrics import Integrator

TERMINAL = ("complete", "discarded", "deleted")
RUNNING = ("active", "paused")  # the game is running; paused = waiting for exercise-device data
PRESENCE_TTL = 60.0


@dataclass
class LiveSession:
    session_id: str
    uid: int
    game_id: str
    variant: str
    game_version: str
    device_type: str
    seed: int
    debug: bool
    requested_duration: float | None
    body_data: dict[str, Any]
    options: dict[str, Any]
    created_at: float
    allow_sim: bool
    integrator: Integrator
    status: str = "pending"
    end_reason: str | None = None
    started_at: float | None = None
    ended_at: float | None = None
    seq: int = 0
    requested: dict[str, Any] = field(default_factory=lambda: {m: None for m in METRIC_NAMES})
    position: dict[str, Any] | None = None
    custom: dict[str, Any] = field(default_factory=dict)
    route: str | None = None
    score: float | None = None
    prompt: dict[str, Any] | None = None
    input: dict[str, Any] | None = None
    # Recent answers with the seq at which each landed, so a game polling slower than the user taps
    # (d-pad) still sees every press: process entries with n > the last n handled.
    inputs: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=32))
    answered: set[str] = field(default_factory=set)
    achievements: dict[str, dict[str, Any]] = field(default_factory=dict)
    last_game_at: float | None = None
    # --- device-loss pause (PLAN.md §5.2) ---
    fitness_data_at: float | None = None      # server time of the fitness owner's last report with valid data
    valid_since: float | None = None          # start of the current unbroken run of valid reports
    last_valid_t: float | None = None
    paused_since: float | None = None
    paused_total: float = 0.0
    pause: dict[str, Any] | None = None
    last_fitness: dict[str, Any] | None = None  # bridge/device that last supplied fitness data
    user_pause: dict[str, Any] | None = None    # {bridgeId, label, t, by} while the user pressed Pause (bridge or game)
    # capabilities.autoPause (PLAN.md §5.3): False = missing device data never pauses; only the user does.
    auto_pause: bool = True
    # capabilities.endScreen (PLAN.md §6.4.1): the game shows its own summary when the session completes, and bridges
    # keep it on screen until the player dismisses it (or END_SCREEN_SECONDS pass)
    end_screen: bool = False
    # (promptId, rev) of the menu prompt last written to the log in full (PLAN.md §6.3)
    logged_prompt: tuple[str, Any] | None = None
    records: list[dict[str, Any]] = field(default_factory=list)
    writer: LogWriter | None = None
    log_rel: str | None = None
    cond: threading.Condition = field(default_factory=threading.Condition)

    def bump(self) -> int:
        with self.cond:
            self.seq += 1
            self.cond.notify_all()
            return self.seq

    def wait_seq(self, since: int, timeout: float) -> None:
        with self.cond:
            if self.seq > since:
                return
            self.cond.wait(timeout)

    def append(self, rec: dict[str, Any]) -> None:
        self.records.append(rec)
        if self.writer is not None:
            self.writer.write(rec)

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL


REMOTE_BUTTONS = ("up", "down", "left", "right", "select", "back")


class RemoteChannel:
    """Presses from a user's bridges meant for the console, not for a session. Not logged."""

    def __init__(self) -> None:
        self.cond = threading.Condition()
        self.n = 0
        self.events: deque[dict[str, Any]] = deque(maxlen=64)

    def press(self, button: str, bridge_id: str, t: float) -> dict[str, Any]:
        with self.cond:
            self.n += 1
            ev = {"n": self.n, "button": button, "bridgeId": bridge_id, "t": t}
            self.events.append(ev)
            self.cond.notify_all()
            return ev

    def since(self, n: int, timeout: float = 0.0) -> list[dict[str, Any]]:
        with self.cond:
            if timeout > 0 and self.n <= n:
                self.cond.wait(timeout)
            return [e for e in self.events if e["n"] > n]


class Store:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.sessions: dict[str, LiveSession] = {}
        self.by_uid: dict[int, str] = {}
        self.presence: dict[int, dict[str, dict[str, Any]]] = {}
        self.presence_cond = threading.Condition()
        # Sticky owner per user and role. Lives with presence, not with a session, so the
        # bridge that controls the machine keeps control when a new session is launched.
        self.owner: dict[int, dict[str, str | None]] = {}
        # Per-user remote-control channel (PLAN.md §9.7): bridge d-pad presses for the console.
        self.remote: dict[int, RemoteChannel] = {}
        # Per-user end screen (PLAN.md §6.4.1): {sessionId, until} while a completed game shows its summary.
        self.end_screens: dict[int, dict[str, Any]] = {}

    # --- end screens (PLAN.md §6.4.1) ---------------------------------------
    def open_end_screen(self, uid: int, session_id: str, until: float) -> None:
        with self.lock:
            self.end_screens[uid] = {"sessionId": session_id, "until": until}
        with self.presence_cond:
            self.presence_cond.notify_all()

    def end_screen_for(self, uid: int, now: float) -> dict[str, Any] | None:
        """The open end screen, with the seconds it has left; None once closed or timed out."""
        with self.lock:
            es = self.end_screens.get(uid)
            if es is None:
                return None
            if now >= es["until"]:
                del self.end_screens[uid]
                return None
            return {**es, "seconds": es["until"] - now}

    def close_end_screen(self, uid: int, session_id: str | None = None) -> bool:
        """Close it (any, or only this session's). Wakes the bridges' long-polls."""
        with self.lock:
            es = self.end_screens.get(uid)
            if es is None or (session_id and es["sessionId"] != session_id):
                return False
            del self.end_screens[uid]
        with self.presence_cond:
            self.presence_cond.notify_all()
        return True

    def remote_for(self, uid: int) -> "RemoteChannel":
        with self.lock:
            ch = self.remote.get(uid)
            if ch is None:
                ch = self.remote[uid] = RemoteChannel()
            return ch

    def add(self, live: LiveSession) -> None:
        with self.lock:
            self.sessions[live.session_id] = live
            self.by_uid[live.uid] = live.session_id

    def remove(self, session_id: str) -> None:
        with self.lock:
            live = self.sessions.pop(session_id, None)
            if live and self.by_uid.get(live.uid) == session_id:
                del self.by_uid[live.uid]

    def get(self, session_id: str) -> LiveSession | None:
        with self.lock:
            return self.sessions.get(session_id)

    def current_for(self, uid: int) -> LiveSession | None:
        with self.lock:
            sid = self.by_uid.get(uid)
            return self.sessions.get(sid) if sid else None

    def all_live(self) -> list[LiveSession]:
        with self.lock:
            return list(self.sessions.values())

    # --- bridge presence ---------------------------------------------------
    def report(self, uid: int, bridge_id: str, rep: dict[str, Any]) -> None:
        with self.lock:
            self.presence.setdefault(uid, {})[bridge_id] = rep
        with self.presence_cond:
            self.presence_cond.notify_all()

    def leave(self, uid: int, bridge_id: str) -> bool:
        """A bridge page is going away (pagehide beacon): forget it now instead of after FRESH seconds."""
        with self.lock:
            gone = self.presence.get(uid, {}).pop(bridge_id, None) is not None
            own = self.owner.get(uid)
            if own:
                for role, bid in own.items():
                    if bid == bridge_id:
                        own[role] = None
        with self.presence_cond:
            self.presence_cond.notify_all()
        return gone

    def reports(self, uid: int, now: float) -> dict[str, dict[str, Any]]:
        with self.lock:
            d = self.presence.get(uid, {})
            stale = [b for b, r in d.items() if now - r.get("t", 0) > PRESENCE_TTL]
            for b in stale:
                del d[b]
            return {b: dict(r) for b, r in d.items()}
