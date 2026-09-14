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
| `games/bikeplane/` | Flight Cycle: pedal a biplane through rings around an island city, bike only; the rings are sized for the lag between pedals and plane (see its `PLAYABILITY.md`) |
| `data/` | Runtime data (SQLite DB, session logs), gitignored |

Every console, bridge and game is a peer folder with a `metadata.json`;
the server discovers them by name and serves them under
`/consoles/<name>/`, `/bridges/<name>/`, `/games/<id>/`.

## Quick start

```bash
make install     # npm install in each frontend, uv sync for the server
make build       # build console, bridge, mockgame, rollinghills, kingdomtrek, bikeplane into their dist/ folders
make serve       # Flask on http://localhost:8080
```

Then open <http://localhost:8080/login?uid=1>. The stub login stores a
token cookie for user 1 (any positive integer works; user 1 is admin).
That is the development login; to put Dandyhorse online with Google
sign-in, see [Put it online](#put-it-online).

- Console: <http://localhost:8080/consoles/web/>
- Bridge: <http://localhost:8080/bridges/web/>
- Mock game (ad-hoc start): <http://localhost:8080/games/mockgame/index.html>
- Rolling Hills (ad-hoc start): <http://localhost:8080/games/rollinghills/>
- Kingdom Trek (standalone, a local save): <http://localhost:8080/games/kingdomtrek/>; launch it from the
  console to play on the platform
- Flight Cycle (a debug session, or practice with the keyboard): <http://localhost:8080/games/bikeplane/>;
  launch it from the console to fly with a bike

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
make dev-bikeplane     # :5177 (http://localhost:5177/games/bikeplane/)
```

Run the API server with `make serve` (no reloader: a reload would wipe
live sessions). Environment: `DANDYHORSE_ROOT`, `DANDYHORSE_DATA`,
`DANDYHORSE_PORT`, `DANDYHORSE_ADMIN_UID`, `DANDYHORSE_SECURE_COOKIE`
(on by itself when `DANDYHORSE_PUBLIC_URL` is https), and the login settings below.

Web Bluetooth needs a secure context: `localhost` is fine on the machine
running the server; a phone needs HTTPS (see PLAN.md §9.5).

## Put it online

For a few friends, through a Cloudflare tunnel, with Google sign-in. The user-number login is for
development only: it turns itself off when Google sign-in is set up, and it refuses anything that comes
through a tunnel.

1. **A Google OAuth client.** Google Cloud Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application. Authorized redirect URI: `https://<your-hostname>/oidc/authorize`
   (and `http://localhost:8081/oidc/authorize` to try it on this machine first). Download the JSON.
2. **A data folder for the online server**, apart from your development data, with the JSON in it. A
   `client_secrets.json` in the data folder is what switches the server to Google sign-in (or set
   `DANDYHORSE_GOOGLE_CLIENT_ID` and `DANDYHORSE_GOOGLE_CLIENT_SECRET`):

   ```bash
   mkdir -p ~/dandyhorse-online && cp ~/Downloads/client_secret_*.json ~/dandyhorse-online/client_secrets.json
   ```

3. **Start it** with its public address, on a port apart from the development server's:

   ```bash
   DANDYHORSE_DATA=~/dandyhorse-online DANDYHORSE_PORT=8081 DANDYHORSE_PUBLIC_URL=https://<your-hostname> make serve
   ```

   The log says `login: Google sign-in; redirect URI https://<your-hostname>/oidc/authorize`.
4. **A named tunnel** to it. A quick `trycloudflare.com` tunnel gets a new hostname every run, and Google
   only returns to redirect URIs you registered. With `cloudflared tunnel create dandyhorse` and
   `cloudflared tunnel route dns dandyhorse <your-hostname>`, then this in `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: dandyhorse
   credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: <your-hostname>
       service: http://localhost:8081
     - service: http_status:404
   ```

   run `cloudflared tunnel run dandyhorse`.
5. **Sign in first.** On a fresh data folder the first person to sign in is user 1, the admin. Everyone
   picks a username the first time they sign in.

| Setting | |
|---|---|
| `DANDYHORSE_PUBLIC_URL` | The address people use. Google returns to `<it>/oidc/authorize`; https turns on secure cookies. |
| `DANDYHORSE_ALLOWED_EMAILS` | Comma-separated Google accounts that may sign in. Empty: anyone with a Google account can make an account. |
| `DANDYHORSE_AUTH` | `stub` or `oidc`, to override the choice made from the data folder. |
| `DANDYHORSE_SECRET_KEY` | The master secret behind login tokens. Unset: one is made in `<data>/secret.key`. A new one logs everyone out. |
| `DANDYHORSE_ADMIN_UIDS` | More admins, by user number (`2,5`). |

The server is Flask's own threaded server, fine for a handful of people. The tunnel's HTTPS also lets
phones run the bridge (Web Bluetooth needs it). How login works: PLAN.md §11.
