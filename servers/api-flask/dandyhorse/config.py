"""Configuration, paths and platform constants."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

# The nine physical metrics tracked uniformly for every device type.
METRIC_NAMES = ("speed", "incline", "cadence", "power", "grade", "wind", "crr", "cw", "heartRate")
# Metrics a bridge may command on a device.
COMMANDABLE = ("speed", "incline", "power", "grade", "wind", "crr", "cw")
DEVICE_TYPES = ("treadmill", "bike")
ROLES = ("fitness", "hrm")
ACTIVE_DEVICE_STATUSES = ("connected", "simulated", "readonly")

_LIMIT_KEYS = {
    "maxSpeed": 4.5, "minSpeed": 0.0,
    "maxIncline": 15.0, "minIncline": 0.0,
    "maxSpeedChangePerSecond": 0.5, "maxInclineChangePerSecond": 1.0,
    "speedScale": 1.0, "inclineScale": 1.0,
    "gradeCap": 20.0, "difficulty": 1.0, "powerOffset": 0.0,
}
DEFAULT_LIMITS: dict[str, dict[str, float]] = {
    "treadmill": dict(_LIMIT_KEYS),
    "bike": dict(_LIMIT_KEYS),
}


def _default_root() -> Path:
    # .../servers/api-flask/dandyhorse/config.py -> repo root
    return Path(__file__).resolve().parents[3]


class Config:
    def __init__(self, overrides: dict[str, Any] | None = None) -> None:
        o = overrides or {}
        env = os.environ
        self.root = Path(o.get("ROOT") or env.get("DANDYHORSE_ROOT") or _default_root()).resolve()
        self.data_dir = Path(o.get("DATA_DIR") or env.get("DANDYHORSE_DATA") or self.root / "data").resolve()
        self.db_path = self.data_dir / "dandyhorse.db"
        self.sessions_dir = self.data_dir / "sessions"
        self.games_dir = Path(o.get("GAMES_DIR") or self.root / "games")
        self.consoles_dir = Path(o.get("CONSOLES_DIR") or self.root / "consoles")
        self.bridges_dir = Path(o.get("BRIDGES_DIR") or self.root / "bridges")
        # the avatar designer's assets: mh/ (MakeHuman bodies and garments, put there by `make avatar-assets`) and
        # env/ (the studio lighting). See libs/avatarkit/README.md.
        self.avatars_dir = Path(o.get("AVATARS_DIR") or env.get("DANDYHORSE_AVATARS") or self.root / "libs/avatarkit/public")
        self.default_console = o.get("DEFAULT_CONSOLE", env.get("DANDYHORSE_CONSOLE", "web"))
        self.default_bridge = o.get("DEFAULT_BRIDGE", env.get("DANDYHORSE_BRIDGE", "web"))

        self.fresh_seconds = float(o.get("FRESH_SECONDS", 5.0))
        self.active_timeout = float(o.get("ACTIVE_TIMEOUT", 300.0))
        self.pending_timeout = float(o.get("PENDING_TIMEOUT", 600.0))
        self.recovery_min_seconds = float(o.get("RECOVERY_MIN_SECONDS", 60.0))
        # pause an active session when no exercise-device data has arrived for this long
        self.pause_after = float(o.get("PAUSE_AFTER", 5.0))
        # resume only after valid data has flowed without a gap for this long (stops flapping)
        self.resume_streak = float(o.get("RESUME_STREAK", 0.9))
        self.watchdog_interval = float(o.get("WATCHDOG_INTERVAL", 1.0))
        self.reaper_interval = float(o.get("REAPER_INTERVAL", 30.0))
        self.reaper_enabled = bool(o.get("REAPER", True))
        self.max_wait = 2.0
        self.efficiency = 0.24
        self.default_weight = 75.0
        self.host = env.get("DANDYHORSE_HOST", "0.0.0.0")
        self.port = int(env.get("DANDYHORSE_PORT", "8080"))
        # Where people reach this server, e.g. https://dandyhorse.example.com through a Cloudflare tunnel.
        # Google sends people back to <public_url>/oidc/authorize after they sign in.
        self.public_url = str(o.get("PUBLIC_URL") or env.get("DANDYHORSE_PUBLIC_URL")
                              or f"http://localhost:{self.port}").rstrip("/")
        secure = o.get("SECURE_COOKIE", env.get("DANDYHORSE_SECURE_COOKIE"))
        # cookies only over HTTPS: when asked (1), or when the public address is https
        self.secure_cookie = self.public_url.startswith("https://") if secure is None else secure in (True, "1")

        # Login (PLAN.md §10.4): "stub" asks for a user number, for development; "oidc" signs in with Google.
        # Unset: oidc when Google's client id and secret are configured, else stub.
        self.google_client_id = str(o.get("GOOGLE_CLIENT_ID") or env.get("DANDYHORSE_GOOGLE_CLIENT_ID") or "")
        self.google_client_secret = str(o.get("GOOGLE_CLIENT_SECRET") or env.get("DANDYHORSE_GOOGLE_CLIENT_SECRET") or "")
        self.client_secrets_file = Path(o.get("CLIENT_SECRETS") or env.get("DANDYHORSE_CLIENT_SECRETS")
                                        or self.data_dir / "client_secrets.json")
        mode = str(o.get("AUTH") or env.get("DANDYHORSE_AUTH") or "")
        if not mode:
            mode = "oidc" if self.google_client_id or self.client_secrets_file.is_file() else "stub"
        if mode not in ("stub", "oidc"):
            raise ValueError(f"DANDYHORSE_AUTH must be stub or oidc, not {mode!r}")
        self.auth_mode = mode
        # Google accounts that may sign in (comma-separated emails); empty lets any verified Google account in.
        raw_emails = o.get("ALLOWED_EMAILS", env.get("DANDYHORSE_ALLOWED_EMAILS", ""))
        emails = raw_emails if isinstance(raw_emails, (list, tuple)) else str(raw_emails).split(",")
        self.allowed_emails = {e.strip().lower() for e in emails if e.strip()}
        # The master secret behind login tokens and the sign-in cookie. Unset: made once into data/secret.key.
        self.secret_key = str(o.get("SECRET_KEY") or env.get("DANDYHORSE_SECRET_KEY") or "")
        self.admin_uid = int(o.get("ADMIN_UID", env.get("DANDYHORSE_ADMIN_UID", "1")))
        # Short list of admin users (the console shows them the Admin tab). ADMIN_UIDS="1,7" or a list.
        raw = o.get("ADMIN_UIDS", env.get("DANDYHORSE_ADMIN_UIDS", ""))
        ids = raw if isinstance(raw, (list, tuple)) else [x for x in str(raw).split(",") if x.strip()]
        self.admin_uids = sorted({self.admin_uid, *(int(x) for x in ids)})

    def is_admin(self, uid: int) -> bool:
        return uid in self.admin_uids
