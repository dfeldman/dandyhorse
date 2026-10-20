"""SQLite access: per-request connections, schema, migrations."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import Flask, g

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  uid           INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  profile       TEXT NOT NULL DEFAULT '{}',  -- bio and avatar (an AvatarSpec); PLAN.md §8.1
  public        INTEGER NOT NULL DEFAULT 1,  -- a social platform: public unless the player opts out (§18.1)
  achievements  TEXT NOT NULL DEFAULT '{}',
  body_data     TEXT NOT NULL DEFAULT '{}',
  -- the social platform (PLAN.md §18.1)
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT '',    -- ISO 3166-1 alpha-2, uppercase
  is_bot        INTEGER NOT NULL DEFAULT 0,
  fitness       TEXT NOT NULL DEFAULT '{}',  -- measured fitness, recomputed at finalize (§18.4)
  streak_goal   INTEGER NOT NULL DEFAULT 0,  -- 0 none, else 1-3 sessions a week (§18.5)
  streak_length INTEGER NOT NULL DEFAULT 0,
  streak_from   TEXT NOT NULL DEFAULT '',    -- the week the goal was set; earlier weeks never count
  pseudonym     TEXT NOT NULL DEFAULT '',    -- what a private player is called where others can see (§18.7)
  anon_id       INTEGER,                     -- their number, when they have chosen no pseudonym
  image_file    TEXT,                        -- profile picture, data/profiles/<uid>.<ext>
  thumb_file    TEXT,                        -- avatar thumbnail rendered by the console (§18.6)
  action_file   TEXT,                        -- the same avatar on its bike, rendered alongside it
  cheers_seen_at TEXT,                       -- when they last looked at who had cheered them
  unit_system   TEXT NOT NULL DEFAULT 'metric',
  time_zone     TEXT NOT NULL DEFAULT 'UTC',
  preferences   TEXT NOT NULL DEFAULT '{}',
  handle_set    INTEGER NOT NULL DEFAULT 1,  -- 0: made by a Google sign-in, still to pick a username
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token         TEXT PRIMARY KEY,  -- the login token's id (its jti); the token itself is an encrypted JWT
  uid           INTEGER NOT NULL REFERENCES users(uid),
  label         TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oidc_identities (
  issuer        TEXT NOT NULL,  -- https://accounts.google.com
  subject       TEXT NOT NULL,  -- the account's "sub": Google's id for it, which never changes
  uid           INTEGER NOT NULL REFERENCES users(uid),
  email         TEXT,           -- as of the last sign-in; for people, never for matching
  created_at    TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS oidc_identities_uid ON oidc_identities(uid);
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
  stats         TEXT NOT NULL DEFAULT '{}',  -- what the game counted this session (PLAN.md §18.2)
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
  board       TEXT NOT NULL,                 -- a board id from the registry (PLAN.md §18.7)
  period_key  TEXT NOT NULL,                 -- '2026-W43', '2026-10' or 'all'
  rank        INTEGER NOT NULL,
  uid         INTEGER NOT NULL,
  value       REAL NOT NULL,
  session_id  TEXT,                          -- the session behind a one-session board
  detail      TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL,
  PRIMARY KEY (board, period_key, uid)
);
CREATE INDEX IF NOT EXISTS leaderboards_rank ON leaderboards(board, period_key, rank);
CREATE TABLE IF NOT EXISTS profile_updates (  -- the status timeline (PLAN.md §18.1)
  update_id  TEXT PRIMARY KEY,               -- ulid, so rows sort by time
  uid        INTEGER NOT NULL REFERENCES users(uid),
  kind       TEXT NOT NULL,                  -- manual | session | streak | achievement
  text       TEXT NOT NULL,
  game_id    TEXT,
  session_id TEXT,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS profile_updates_uid ON profile_updates(uid, created_at DESC);
CREATE TABLE IF NOT EXISTS update_cheers (   -- "ride on": one tap of encouragement per player (PLAN.md §18.6)
  update_id  TEXT NOT NULL REFERENCES profile_updates(update_id) ON DELETE CASCADE,
  uid        INTEGER NOT NULL REFERENCES users(uid),
  created_at TEXT NOT NULL,
  PRIMARY KEY (update_id, uid)
);
CREATE INDEX IF NOT EXISTS update_cheers_update ON update_cheers(update_id);
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


# Columns added after a table first shipped: SQLite can only add them one at a time, and `CREATE TABLE IF NOT
# EXISTS` leaves an existing table alone. {table: {column: "<type and default>"}}.
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "sessions": {
        "paused_seconds": "REAL",                          # 2026-09-11
        "image_file": "TEXT",                              # 2026-09-11: the game's session picture (§6.7)
        "stats": "TEXT NOT NULL DEFAULT '{}'",             # 2026-10-19: what the game counted (§18.2)
    },
    "users": {
        "handle_set": "INTEGER NOT NULL DEFAULT 1",        # 2026-09-14: Google sign-in asks for a username
        # 2026-10-19, the social platform (§18.1)
        "first_name": "TEXT NOT NULL DEFAULT ''",
        "last_name": "TEXT NOT NULL DEFAULT ''",
        "country": "TEXT NOT NULL DEFAULT ''",
        "is_bot": "INTEGER NOT NULL DEFAULT 0",
        "fitness": "TEXT NOT NULL DEFAULT '{}'",
        "streak_goal": "INTEGER NOT NULL DEFAULT 0",
        "streak_length": "INTEGER NOT NULL DEFAULT 0",
        "streak_from": "TEXT NOT NULL DEFAULT ''",
        "anon_id": "INTEGER",
        "pseudonym": "TEXT NOT NULL DEFAULT ''",
        "image_file": "TEXT",
        "thumb_file": "TEXT",
        "action_file": "TEXT",
        "cheers_seen_at": "TEXT",
    },
}

# Indexes over columns that were added later. `CREATE TABLE IF NOT EXISTS` leaves an existing table alone,
# so on a database made before the column existed these have to run *after* the ALTER TABLEs below — putting
# them in SCHEMA would fail with "no such column" on every upgrade.
LATE_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS users_anon_id ON users(anon_id) WHERE anon_id IS NOT NULL;
"""

# A table whose shape changed outright: dropped and remade when its columns are not these. Only for tables
# nothing depends on keeping — `leaderboards` is entirely derived and recomputed (§18.7).
REBUILT_TABLES = {
    "leaderboards": {"board", "period_key", "rank", "uid", "value", "session_id", "detail", "computed_at"},
}


def init_schema(path: Path) -> None:
    conn = connect(path)
    try:
        for table, want in REBUILT_TABLES.items():
            have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            if have and have != want:
                conn.execute(f"DROP TABLE {table}")
        conn.executescript(SCHEMA)
        for table, columns in ADDED_COLUMNS.items():
            have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            for column, decl in columns.items():
                if column not in have:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        conn.executescript(LATE_INDEXES)
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        was = int(row["version"]) if row is not None else SCHEMA_VERSION
        if row is None:
            conn.execute("INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,))
        else:
            conn.execute("UPDATE schema_version SET version=?", (SCHEMA_VERSION,))
        if was < 2:
            # 2026-10-19: a social platform is public unless somebody opts out (PLAN.md §18.1). The column's
            # own default cannot be changed in place, so accounts made before this are flipped once here;
            # `auth._new_user` names the value for every account made since.
            conn.execute("UPDATE users SET public=1")
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
