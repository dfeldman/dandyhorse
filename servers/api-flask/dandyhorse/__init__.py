"""Dandyhorse reference API server (Flask)."""
from __future__ import annotations

import logging
import threading
from typing import Any

from flask import Flask, jsonify

from . import auth, db, static, util
from .catalog import Catalog
from .config import Config
from .sessions.store import Store
from .util import ApiError

log = logging.getLogger("dandyhorse")


class Platform:
    """Process-wide state: config, catalog, live session store, reaper."""

    def __init__(self, cfg: Config) -> None:
        self.config = cfg
        self.catalog = Catalog(cfg)
        self.store = Store()
        self._stop = threading.Event()
        self._reaper: threading.Thread | None = None

    def reap_once(self) -> list[str]:
        from .sessions import lifecycle
        conn = db.connect(self.config.db_path)
        try:
            return lifecycle.reap(self, conn)
        finally:
            conn.close()

    def watchdog_once(self) -> None:
        """Re-evaluate pause state for running sessions even when nobody is calling the server."""
        from .sessions import lifecycle
        t = util.now()
        for live in self.store.all_live():
            if live.status in ("active", "paused"):
                lifecycle.resolve_owners(self, live.uid, t, live)

    def start_reaper(self) -> None:
        if self._reaper is not None:
            return

        def loop() -> None:
            import time as _time
            last_reap = _time.monotonic()
            while not self._stop.wait(self.config.watchdog_interval):
                try:
                    self.watchdog_once()
                except Exception:  # noqa: BLE001
                    log.exception("watchdog failed")
                if _time.monotonic() - last_reap < self.config.reaper_interval:
                    continue
                last_reap = _time.monotonic()
                try:
                    reaped = self.reap_once()
                    if reaped:
                        log.info("reaped sessions: %s", reaped)
                except Exception:  # noqa: BLE001
                    log.exception("reaper failed")

        self._reaper = threading.Thread(target=loop, name="dh-reaper", daemon=True)
        self._reaper.start()

    def stop(self) -> None:
        self._stop.set()


def create_app(overrides: dict[str, Any] | None = None) -> Flask:
    cfg = Config(overrides)
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    cfg.sessions_dir.mkdir(parents=True, exist_ok=True)
    db.init_schema(cfg.db_path)

    app = Flask(__name__, static_folder=None)
    app.config["JSON_SORT_KEYS"] = False
    dh = Platform(cfg)
    app.dh = dh  # type: ignore[attr-defined]
    db.register(app)

    # Recover sessions abandoned by a previous process.
    from .sessions import lifecycle
    conn = db.connect(cfg.db_path)
    try:
        recovered = lifecycle.recover(dh, conn)
        if recovered:
            log.info("recovered sessions: %s", recovered)
    finally:
        conn.close()

    from .api import bridgeapi, consoleapi, gameapi
    app.register_blueprint(consoleapi.bp)
    app.register_blueprint(gameapi.bp)
    app.register_blueprint(bridgeapi.bp)
    static.register(app)

    @app.errorhandler(ApiError)
    def _api_error(e: ApiError):
        return jsonify({"error": {"code": e.code, "message": e.message}}), e.status

    @app.errorhandler(404)
    def _not_found(_e):
        return jsonify({"error": {"code": "not_found", "message": "not found"}}), 404

    @app.errorhandler(405)
    def _bad_method(_e):
        return jsonify({"error": {"code": "method_not_allowed", "message": "method not allowed"}}), 405

    if cfg.reaper_enabled:
        dh.start_reaper()
    return app
