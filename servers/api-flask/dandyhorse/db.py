"""SQLite access: per-request connections, schema, migrations."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import Flask, g

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  uid           INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  profile       TEXT NOT NULL DEFAULT '{}',
  public        INTEGER NOT NULL DEFAULT 0,
  achievements  TEXT NOT NULL DEFAULT '{}',
  body_data     TEXT NOT NULL DEFAULT '{}',
  unit_system   TEXT NOT NULL DEFAULT 'metric',
  time_zone     TEXT NOT NULL DEFAULT 'UTC',
  preferences   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token         TEXT PRIMARY KEY,
  uid           INTEGER NOT NULL REFERENCES users(uid),
  label         TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  uid           INTEGER NOT NULL REFERENCES users(uid),
  game_id       TEXT NOT NULL,
  variant       TEXT NOT NULL,
  game_version  TEXT NOT NULL,
  device_type   TEXT NOT NULL,
  seed          INTEGER NOT NULL,
  debug         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,
  end_reason    TEXT,
  route         TEXT,
  score         REAL,
  requested_duration REAL,
  started_at    TEXT,
  ended_at      TEXT,
  duration      REAL,
  distance      REAL,
  energy        REAL,
  work          REAL,
  avg_power     REAL, max_power REAL,
  avg_speed     REAL, max_speed REAL,
  avg_hr        REAL, max_hr REAL,
  avg_cadence   REAL,
  elevation_gain REAL,
  energy_source TEXT,
  paused_seconds REAL,
  image_file    TEXT,
  sample_count  INTEGER,
  body_data     TEXT NOT NULL,
  options       TEXT NOT NULL DEFAULT '{}',
  log_file      TEXT,
  log_finalized INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_time ON sessions(uid, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_leader ON sessions(game_id, variant, route, status);
CREATE TABLE IF NOT EXISTS devices (
  device_id     INTEGER PRIMARY KEY,
  uid           INTEGER NOT NULL REFERENCES users(uid),
  type          TEXT NOT NULL,
  address       TEXT NOT NULL,
  name          TEXT NOT NULL,
  protocol      TEXT NOT NULL DEFAULT 'ftms',
  preferences   TEXT NOT NULL DEFAULT '{}',
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(uid, address)
);
CREATE TABLE IF NOT EXISTS game_preferences (
  uid INTEGER NOT NULL, game_id TEXT NOT NULL,
  preferences TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, game_id)
);
CREATE TABLE IF NOT EXISTS save_states (
  uid INTEGER NOT NULL, game_id TEXT NOT NULL, variant TEXT NOT NULL,
  save_state TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, game_id, variant)
);
CREATE TABLE IF NOT EXISTS leaderboards (
  game_id TEXT NOT NULL, variant TEXT NOT NULL, route TEXT NOT NULL DEFAULT '',
  metric  TEXT NOT NULL, period TEXT NOT NULL, period_key TEXT NOT NULL,
  uid INTEGER NOT NULL, session_id TEXT NOT NULL,
  value REAL NOT NULL, rank INTEGER NOT NULL, computed_at TEXT NOT NULL,
  PRIMARY KEY (game_id, variant, route, metric, period, period_key, uid)
);
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(path: Path) -> None:
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(sessions)")}
        if "paused_seconds" not in cols:  # added 2026-09-11
            conn.execute("ALTER TABLE sessions ADD COLUMN paused_seconds REAL")
        if "image_file" not in cols:  # added 2026-09-11: the game's session picture (PLAN.md §6.7)
            conn.execute("ALTER TABLE sessions ADD COLUMN image_file TEXT")
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        if row is None:
            conn.execute("INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,))
        conn.commit()
    finally:
        conn.close()


def get_db() -> sqlite3.Connection:
    """Connection bound to the current Flask request context."""
    from flask import current_app
    if "db" not in g:
        g.db = connect(current_app.dh.config.db_path)  # type: ignore[attr-defined]
    return g.db


def close_db(_exc: BaseException | None = None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def register(app: Flask) -> None:
    app.teardown_appcontext(close_db)


def row_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None
