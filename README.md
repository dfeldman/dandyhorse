# Dandyhorse

A multiuser exergaming platform for treadmills and bike trainers. Games are
independent web apps; a shared **console** launches sessions and shows
history; a **bridge** connects the platform to real hardware over Bluetooth
(FTMS) and heart-rate monitors; the **server** owns users, sessions, logs,
preferences, achievements and leaderboards, and serves every frontend.

Read [PLAN.md](PLAN.md) for the full design. Game developers: start with
[docs/GAME_DEVELOPER_GUIDE.md](docs/GAME_DEVELOPER_GUIDE.md) (tutorial, uses the
`@dandyhorse/gamekit` library in `libs/gamekit`); the wire contract is in
[docs/GAME_AUTHORING.md](docs/GAME_AUTHORING.md).

## Layout

| Folder | What |
|---|---|
| `servers/api-flask/` | Reference API server (Python 3.12+, Flask, SQLite) |
| `consoles/web/` | Web console (Vue 3 + TypeScript) |
| `bridges/web/` | Web bridge (Vue 3 + TypeScript, Web Bluetooth through `devicelib`) |
| `libs/gamekit/` | Game client library (`@dandyhorse/gamekit`): API, SessionClient, units, prompts |
| `devicelib/` | Bluetooth device library (`@bikebike/devicelib`): model registry and quirks, FTMS and sensor drivers, simulators; the bridge's device layer |
| `games/mockgame/` | Reference game exercising every API |
| `games/rollinghills/` | Rolling Hills: a 3D bike ride over generated hills, for bike trainers and treadmills (ported from bikebike) |
| `games/kingdomtrek/` | Kingdom Trek: a role-playing adventure paced by your effort against your own steady pace, on either machine, played from a phone menu or at the screen (see its `INTEGRATION.md`) |
| `data/` | Runtime data (SQLite DB, session logs), gitignored |

Every console, bridge and game is a peer folder with a `metadata.json`;
the server discovers them by name and serves them under
`/consoles/<name>/`, `/bridges/<name>/`, `/games/<id>/`.

## Quick start

```bash
make install     # npm install in each frontend, uv sync for the server
make build       # build console, bridge, mockgame, rollinghills, kingdomtrek into their dist/ folders
make serve       # Flask on http://localhost:8080
```

Then open <http://localhost:8080/login?uid=1>. The stub login stores a
token cookie for user 1 (any positive integer works; user 1 is admin).

- Console: <http://localhost:8080/consoles/web/>
- Bridge: <http://localhost:8080/bridges/web/>
- Mock game (ad-hoc start): <http://localhost:8080/games/mockgame/index.html>
- Rolling Hills (ad-hoc start): <http://localhost:8080/games/rollinghills/>
- Kingdom Trek (standalone, a local save): <http://localhost:8080/games/kingdomtrek/>; launch it from the
  console to play on the platform

Try a session without hardware: in the console pick Mock Game (Bike) with
debug on, which opens the bridge; on the Devices tab enable the bike
simulator; press Start game.

## Development

```bash
make test          # pytest + vitest
make dev-console   # vite dev server on :5173 proxying APIs to :8080
make dev-bridge    # :5174
make dev-mockgame  # :5175
make dev-rollinghills  # :5176
make dev-kingdomtrek   # :5188 (http://localhost:5188/games/kingdomtrek/)
```

Run the API server with `make serve` (no reloader: a reload would wipe
live sessions). Environment: `DANDYHORSE_ROOT`, `DANDYHORSE_DATA`,
`DANDYHORSE_PORT`, `DANDYHORSE_ADMIN_UID`, `DANDYHORSE_SECURE_COOKIE=1`
behind HTTPS.

Web Bluetooth needs a secure context: `localhost` is fine on the machine
running the server; a phone needs HTTPS (see PLAN.md §9.5).
