# Dandyhorse — Platform Plan

Dandyhorse is a multiuser exergaming platform for treadmills and bike trainers.
Games are independent web apps. A shared **console** launches sessions in any
game, shows session history, devices, preferences, and leaderboards. A
**bridge** app connects the platform to real fitness hardware over Bluetooth
(FTMS) and to heart-rate monitors. The **server** (Python/Flask) owns users,
sessions, session logs, preferences, achievements, and leaderboards, and
serves every frontend statically.

This document is the single source of truth for the platform. It resolves
every ambiguity in the original brief with an explicit decision; where the
brief was silent, the decision is marked **(decision)**. Games themselves are
out of scope for now; a mock game and the bridge's debug simulator are the
test harness.


---

## 0. As-built status (2026-09-11)

This section describes what exists today. The rest of the document is the
design; where the two differ, this section says so.

**Runs today.** `make install && make build && make serve`, then open
`http://localhost:8080/login?uid=1`. Everything is same-origin on one Flask
process with SQLite and JSONL logs under `data/`.

| Component | Folder | Tests |
|---|---|---|
| API server (Flask) | `servers/api-flask` | 57 pytest |
| Web console (Vue) | `consoles/web` | 78 vitest |
| Web bridge (Vue) | `bridges/web` | 60 vitest |
| Game library (TS) | `libs/gamekit` | 11 vitest |
| Device library (TS) | `devicelib` | 43 node:test; the bridge's Bluetooth layer since 2026-09-13 |
| Mock game (TS) | `games/mockgame` | built, driven by hand and scripts |
| Rolling Hills (JS + TS adapter) | `games/rollinghills` | 6 vitest (drive model); ridden with both simulators |

**Built and verified in the browser** (with the bridge simulator; no real
hardware yet):
- Console → bridge → game-in-iframe launch, active-session modal (open
  bridge with game / without game / pick new game), session history with
  minimap, profile and graphs, devices, preferences, status.
- Game API end to end in the mock game: start, get/set state, end, prompts
  one-shot and persistent (answered from game or bridge), achievements,
  save state, per-game preferences.
- Multiple bridges: per-tab identity, first-bridge-wins ownership with a
  red standby error and "Take control here" on the second bridge, fast
  handoff on reload (leave beacon), 5 s fallback when a bridge vanishes,
  wrong-device-type and simulator-not-allowed warnings.
- Safety: E-stop; the bridge never restarts a machine the user stopped;
  manual +/− presses on the machine are respected; a silent game holds the
  belt then ramps it to 0; a lost server ramps it to 0.
- **Pausing** (§5.3): the server pauses a session after 5 s without
  exercise-device data (bridge silent, device off, device sending nulls,
  no device ever) and resumes it by itself; heart rate never pauses;
  Pause/Play buttons on the bridge. Paused time is excluded from distance
  and calories and reported as `pausedSeconds`.
- Server restart recovery of live sessions from their logs.

**Kingdom Trek and what it added (2026-09-13).** `games/kingdomtrek` is integrated: its
`INTEGRATION.md` is the design, with the decisions made while building it in §13. What it added to the platform:
- **Menu prompts** (`layout: "menu"`, §6.3): a game's whole choice list, mirrored on the phone.
- **`capabilities.autoPause: false`** (§5.3): no automatic pauses, and sessions without a machine.
- **The game's own pause**, `POST /gameapi/pause` (§5.3).
- **Launch options that change `controls`** (§7.1).
- **Effort preferences** (`steadyWatts`, `steadyPace`, `restingHr`, `steadyHr`, §8.5), with the console's Fitness
  panel and gamekit's `effort.ts`.
- **Bridge:** the menu panel, a hold-to-repeat d-pad, gamepad and focus in the game iframe, and a console-launched
  bridge that returns to the console after a game.
- **Console:** device buttons in the launch dialog, defaulting to the machine the user owns.

**Google sign-in (2026-09-14).** OIDC through Flask-OIDC, login tokens as encrypted JWTs, Google accounts mapped
to uids in `oidc_identities`, a username asked on the first sign-in, and the user-number login kept for
development only (§11; setup in README "Put it online").

**Not built yet / deviations from the design:**
- Leaderboards are a live query; no precomputed table, no periods.
- The 10 Hz rate limit (§4.2) and the OpenAPI contract tests (§2).
- Real machines and heart-rate straps go through devicelib (its FTMS and
  Heart Rate drivers), tested against devicelib's simulated machines and a
  mock strap, but have never run against hardware. HTTPS for a phone bridge, iOS.
- The treadmill actual-speed smoothing filter (decided in §16, not built).
- Showing remote devices and allowing "continue without a local device"
  in the bridge (decided in §16, not built).
- A timeout for long pauses (§16). A game-initiated pause was built on 2026-09-13.

**Known limitations:**
- Bridge ownership and pause state live in server memory; a server
  restart finalizes live sessions (by design) and forgets ownership.
- A bridge that owns the device but sends nulls pauses the session even if
  a standby bridge has good data; the standby's "Take control here" fixes
  it.
- Chrome throttles timers in hidden tabs; test with two windows side by
  side, not two tabs. The in-app test browser does not fire `pagehide`
  when a tab is closed, so that path falls back to the 5 s timeout.

**Game development.** `libs/gamekit` and `docs/GAME_DEVELOPER_GUIDE.md`
(2026-09-11) are the supported way to write a game; the mock game uses
them. Every session can carry a picture from the game (§6.7).

**Usability.** The bridge was redesigned on 2026-09-11 (§9.6: one screen
per situation, setup wizard, prominent game choices and d-pad, themes,
developer tools behind ⋯). The console is still the developer-style UI;
its big-screen rework with arrow-key/d-pad control (§10) is the next
usability item, followed by real hardware (Phase 4, where HTTPS is now a
prerequisite for the mounted-phone bridge).

---

## 1. Vision and scope

- A people-free, multi-game alternative to Zwift for treadmills and bike
  trainers, later other devices (rower, elliptical, ...).
- 20+ games, written by different people in different frameworks, each in its
  own folder with a `metadata.json`. The platform never imports game code; it
  only serves the folder and answers API calls.
- A user has **exactly one** active session at a time. Starting a new one
  discards the old one.
- The typical setup: the game runs full-screen on a laptop or TV; the bridge
  runs on a phone next to the treadmill; both talk only to the server.
- Robust, professional, multiuser from day one: real auth tokens, per-user
  data isolation, SI units everywhere, UTC everywhere, soft deletes, and
  crash-safe session logs.

Out of scope for the platform milestone: real games (only `mockgame`), OIDC
(stub login), native bridge app, social features. The existing `bikebike` and
`bikeplane` prototypes (0–100 pedal-effort BabylonJS games) are future port
candidates and nothing more.

---

## 2. Repository layout

There will be many games, several consoles (web, TV, mobile), several bridge
implementations (web, native), and eventually more than one API server
implementation. Every one of those is a peer folder under a plural
top-level directory, discovered by name, never hard-coded.

```
dandyhorse/
  PLAN.md
  README.md
  Makefile                    dev/build/test shortcuts across all components
  servers/
    api-flask/                Python/Flask reference API server
      dandyhorse/
        __init__.py           create_app()
        config.py             paths, limits, defaults (env DANDYHORSE_*)
        db.py                 sqlite connection, schema, migrations
        auth.py               token cookie / bearer handling, login stub
        catalog.py            scans games/, consoles/, bridges/ metadata.json
        sessions/
          store.py            in-memory live sessions (state + seq + log buffer)
          log.py              JSONL writer, gzip finalize, recovery on boot
          lifecycle.py        create / activate / end / discard / supersede / reaper
          merge.py            multi-bridge merge policy
          metrics.py          distance, energy, timeline derivation, summary
        api/
          gameapi.py          /gameapi/*
          bridgeapi.py        /bridgeapi/*
          consoleapi.py       /api/*
        static.py             serves consoles/, bridges/, games/
        units.py              SI helpers, FTMS conversions
      tests/                  pytest; fake game + fake bridge drivers
      pyproject.toml
    (future) api-go/, api-rust/ ... must pass the same HTTP contract tests
  libs/
    gamekit/                  @dandyhorse/gamekit: the game client library (TypeScript source,
                              linked with a file: dependency): /gameapi types and wrappers,
                              SessionClient (poll, tick, pauses, inputs, ending, session image),
                              units, prompt/d-pad builders. docs/GAME_DEVELOPER_GUIDE.md.
  devicelib/                  @bikebike/devicelib, the owner's Bluetooth device library (TypeScript,
                              built to dist/, linked into the bridge with a file: dependency):
                              registry of models and quirks, FTMS and sensor drivers, Web Bluetooth
                              and mock transports, simulators. Own README and docs/hardware/.
  consoles/
    web/                      Vue 3 + TypeScript + Vite; metadata.json; dist/
    (future) tv/, mobile/ ...
  bridges/
    web/                      Vue 3 + TypeScript + Vite; metadata.json; dist/
    (future) native-ios/, native-android/, cli/ ...
  games/
    mockgame/                 metadata.json, screenshot.png, dist/
    rollinghills/             ported from ../bikebike: public/js (engine), src/ (platform adapter), dist/
    (future) rollinghills/, skyrings/ ... one folder per game
  contract/
    openapi.yaml              the HTTP contract every server must implement (Phase 5)
    contract-tests/           black-box tests runnable against any server URL
  data/                       gitignored runtime data
    dandyhorse.db
    sessions/YYYY/MM/<sessionId>.jsonl(.gz)
  docs/
    GAME_AUTHORING.md
    BRIDGE_PROTOCOL.md
```

URL layout, identical for every server implementation:

| URL | Serves |
|---|---|
| `/` | redirect to the default console (`/consoles/web/`) |
| `/bridge/` | redirect to the default bridge (`/bridges/web/`) |
| `/consoles/<name>/<path>` | `consoles/<name>/dist/<path>` if it exists, else `consoles/<name>/<path>` |
| `/bridges/<name>/<path>` | same dist-first rule |
| `/games/<id>/<path>` | same dist-first rule |
| `/api/*`, `/gameapi/*`, `/bridgeapi/*` | the APIs |

- Consoles and bridges carry a `metadata.json` at the folder root (`id`,
  `name`, `version`, `entry`, `default: true|false`) just like games, so a
  server can list them and a user can pick a different console or bridge.
- **Dist-first resolution**: `metadata.json` and `screenshot.png` live at
  the folder root; the built app lives in `dist/`. A request for
  `/<kind>/<name>/<path>` is answered from `dist/<path>` when that file
  exists, otherwise from `<path>`. So `entry` is `"index.html"` and Vite's
  `base: '/games/<id>/'` asset URLs resolve. Paths containing `..` are
  rejected.
- Consoles and bridges use hash routing (`createWebHashHistory`), so static
  serving needs no SPA fallback and `/bridges/web/#/session/<id>` works.
- All frontends are served same-origin by the API server, so iframes share
  the auth cookie. Every frontend builds with `base: '/<kind>/<name>/'` and
  calls APIs by absolute path (`/gameapi/...`), never relative.
- Dev: `vite dev` for a console/bridge with a proxy for `/api`, `/gameapi`,
  `/bridgeapi`, `/games`, `/consoles`, `/bridges` to Flask on port 8080.
  Prod: Flask serves the built `dist/` folders behind nginx/caddy for HTTPS.
- The server root is configurable (`DANDYHORSE_ROOT`) so a server
  implementation can live anywhere and still find `games/`, `consoles/`,
  `bridges/`, `data/`.

---

## 3. Conventions

| Topic | Rule |
|---|---|
| Units | SI only in storage and APIs: meters, seconds, kilograms, m/s, joules, watts. Incline and grade in **percent**. Wind speed m/s. Crr dimensionless. Cw kg/m. Heart rate in bpm. Cadence in rpm. Display-layer converts to km/h, mph, kcal, ft, etc. based on the user's unit system. |
| Missing values | **`null`**, never `-1` and never `0`. The gameapi paragraph of the brief said `-1`; the conventions paragraph forbade it. `null` wins everywhere **(decision)**. |
| Time | UTC always. Metadata timestamps are ISO 8601 with `Z`. High-frequency tick data uses Unix epoch seconds as a float (`1757548800.123`). Clients send their own clock; the server stamps every record with its own clock, and the server clock is authoritative for ordering, elapsed time, and integration. Phones and laptops skew. |
| IDs | Session IDs are ULIDs (sortable, filename-safe). Users have integer `uid` plus a unique `username`. Bridges self-assign a UUID stored in localStorage. |
| JSON keys | camelCase in APIs. snake_case in SQL. |
| Errors | `{"error": {"code": "session_not_active", "message": "..."}}` with an appropriate HTTP status (400 validation, 401 no token, 403 not yours, 404, 409 state conflict such as `setstate` on a pending session, 410 session ended). |
| Naming | `sessionStatus` = lifecycle status of a session. `saveState` = the persistent per-game JSON blob (the brief called both "game state"). `state` in `getstate`/`setstate` = the live physical state. |

---

## 4. Architecture and the data loop

```
 ┌──────────┐  setstate (requested, x/y/z, custom, achievements, requestedInput)
 │   Game   │ ───────────────────────────────────────────────────────┐
 │ (iframe) │ ◄─────────────── getstate (merged live state) ─────────┤
 └──────────┘                                                        ▼
                                                            ┌────────────────┐
                                                            │     Server     │
                                                            │ live session   │
                                                            │ state + seq    │
                                                            │ JSONL log      │
                                                            └────────────────┘
 ┌──────────┐  putstate (commanded, actual, devices, hr)              ▲ │
 │  Bridge  │ ───────────────────────────────────────────────────────┘ │
 │ (phone / │ ◄────────── getstate (requested, limits, requestedInput) ─┘
 │  laptop) │   sendinput (user's button choice, out of band)
 └────┬─────┘
      │ Web Bluetooth (FTMS control point + data notifications, HRM)
      ▼
 ┌──────────┐
 │ Treadmill│ / Bike trainer / HR strap
 └──────────┘
```

Every field in the system has one origin:

| Field | Origin | Path |
|---|---|---|
| `requested.*` | Game | game `setstate` → server → bridge `getstate` |
| `commanded.*` | Bridge (after limits, scaling, feasibility) | bridge `putstate` → server → game `getstate` |
| `actual.*` | Device via bridge (or simulator) | bridge `putstate` → server → game `getstate` |
| `heartRate.actual` | HRM via bridge | same as actual |
| `position` (x,y,z) | Game | `setstate` → log → console minimap, ghosts |
| `requestedInput` | Game | `setstate` → bridge `getstate` → UI |
| `input` (answer) | Bridge user | `sendinput` → server → game `getstate` |
| `limits` | Device preferences (console/bridge settings) | server → bridge `getstate` |
| `achievements` | Game (game-scoped) + server (platform-scoped) | `setstate` → users.achievements |
| `distance`, `energy`, `duration` | Server, computed from the log | metrics.py |

Requested is what the game last asked for. Commanded is what the bridge sent
to the device after post-processing. Actual is measured. The game must treat
`commanded` and `actual` as the truth, not its own requests: on a treadmill
the user can override speed and incline on the machine's own buttons.

### 4.1 Processes and concurrency

Live session state lives in the memory of a **single Flask process**
**(decision)**. Run it as `gunicorn -w 1 --threads 32` (or `flask run
--with-threads` in dev). Multiple worker processes would fragment the live
state. If the platform ever needs horizontal scale, the upgrade path is to
move `sessions/store.py` onto Redis (state hash + stream per session); the
API surface does not change. Polling at 1 Hz per client with a few dozen
concurrent users is trivial for one process.

### 4.2 Polling and urgency

**No WebSockets** (decision, per the brief): every channel is plain HTTP
request/response, which is far easier to debug with curl and the browser
network tab. Long-polling gives the low latency we need. WebSockets may be
added later behind the same state model if polling ever proves inadequate.

- Game and bridge each poll `getstate` at 1 Hz nominally and push
  `setstate`/`putstate` at 1 Hz.
- Every mutation of a session's live state increments an integer `seq`.
  `getstate?since=<seq>&wait=1` long-polls: it returns immediately if `seq`
  advanced, otherwise waits up to `wait` seconds (max 2) then returns the
  current state anyway. Bridges use this so a sudden hill reaches the
  treadmill within tens of milliseconds while idle load stays at 1 Hz.
- `setstate`/`putstate` accept `"urgent": true`, which is purely a hint
  logged for diagnostics; long-polling already delivers changes immediately.
- Clients may call faster than 1 Hz. A 10 Hz per-session rate limit
  returning 429 is planned but **not yet implemented** (deferred to Phase 6
  hardening).

---

## 5. Session lifecycle

Statuses **(decision: `pending` added to the four in the brief)**:

| Status | Meaning |
|---|---|
| `pending` | Created by a launch; no game has called `startsession` yet. Bridges may already be connected. |
| `active` | Game called `startsession`. Ticks are being logged. |
| `paused` | Running but waiting: no exercise-device data for 5 s, or the user pressed Pause on a bridge (§5.3). The game freezes and keeps polling. Lives only in server memory; the database row says `active`. Not an end state. |
| `complete` | Ended normally (game said complete, or recovered after server restart with ≥ 60 s of data). Counts for history, achievements, leaderboards. |
| `discarded` | Will never complete: game said discarded, user superseded it with a new session, reaper timed it out, or too little data after a crash. Kept in history (greyed) but excluded from leaderboards and totals. |
| `deleted` | User soft-deleted a `complete` or `discarded` session. Hidden everywhere; log file retained on disk. Hard purge is an admin CLI task. |

Transitions:

```
launch ─► pending ─► active ⇄ paused ─► complete / discarded
             │          │
             │          ├─► discarded   (game endsession{discarded}, reaper, superseded, restart with <60 s)
             └─► discarded              (no startsession within 10 min, or superseded)
complete / discarded ─► deleted         (user)
```

Rules:
- **One active session per user.** Any launch or ad-hoc `startsession` first
  marks the user's existing `pending`/`active` session `discarded` with
  `endReason: "superseded"`. A game polling `getstate` on the old session
  gets `sessionStatus: "discarded"` and must stop.
- **Reaper** (background thread, every 30 s): `active` or `paused` sessions with no game
  `setstate` for 5 minutes end with `endReason: "timeout"`: **`complete`** if
  the session had at least 60 s of active time (a closed tab or a crash must
  not throw a workout away; 2026-09-11), `discarded` otherwise. `pending`
  sessions older than 10 minutes → `discarded`, `endReason: "never_started"`.
- **Server restart recovery**: on boot, every session in `pending`/`active`
  in the DB is finalized from its partial log file: `complete` with
  `endReason: "server_restart"` if the log holds ≥ 60 s of ticks, otherwise
  `discarded`. Nothing stays `active` across a restart.
- `endReason` values: `completed`, `discarded_by_game`, `superseded`,
  `timeout`, `never_started`, `server_restart`.
- `debug: true` sessions are fully logged and visible in history but are
  excluded from leaderboards, achievements, and lifetime totals **(decision)**.

### 5.1 Launch handshake

1. Console: user picks game + variant (+ duration, optional seed, debug).
   `POST /api/sessions/launch` → server discards the user's current session,
   creates a `pending` session with a fresh seed if none given, records game
   version from `metadata.json`, returns `{sessionId, bridgeUrl}` where
   `bridgeUrl` is the full default-bridge path
   `/bridges/web/#/session/<sessionId>` (never the `/bridge/` redirect;
   fragments across a 302 are browser-dependent).
2. Console navigates the tab to `bridgeUrl`.
3. Bridge (top-level page) shows device connection UI. Web Bluetooth requires
   a user gesture, so it cannot auto-connect; it shows "Connect treadmill",
   "Connect HRM", "Use simulator" buttons and remembers previously paired
   devices to make reconnect one tap. It starts polling `bridgeapi/getstate`.
4. User taps **Start game**. Bridge collapses its UI to a thin strip and
   creates a full-screen iframe:
   `/games/<gameId>/<entry>?session=<id>&variant=<v>&seed=<n>&debug=<0|1>`.
5. Game calls `POST /gameapi/startsession {sessionId}`. Server flips the
   session to `active`, responds with the start payload (§6.1).
6. Loop runs (§4). A second bridge on a phone opens `/bridge/`, sees the
   user's current session, connects its devices, and joins.
7. Game calls `POST /gameapi/endsession {sessionId, status}`. Server
   finalizes the log, computes summary, updates achievements/leaderboards.
   Bridge notices `session.status != active` and shows the summary with a
   link back to the console.

**Why the bridge is the parent and the game the iframe (decision):** Web
Bluetooth connections belong to the page that opened them and are dropped
when that page is unloaded or backgrounded in some browsers. Keeping the
bridge as the always-alive top-level page and putting the game inside an
iframe keeps the connection alive while the game is what the user sees. The
bridge and the game never communicate through `postMessage`; the server is
the only channel, which is what lets the phone bridge be interchangeable
with the laptop bridge.

### 5.2 Ad-hoc start (developer convenience)

`POST /gameapi/startsession` without `sessionId` but with
`{gameId, variant, deviceType, duration?, seed?, debug?}` creates and
activates a session directly. This lets a game author open their game URL
without going through the console. It still supersedes any existing session.


### 5.3 Pausing (built 2026-09-11)

**Device-loss pause.** The server pauses a running session when the bridge
that owns the exercise device has sent no valid exercise data for 5 s
(`PAUSE_AFTER`). Valid means a non-null belt speed on a treadmill, or
non-null power or cadence on a bike; zero counts as data. Heart rate never
pauses a session and never keeps one running. The check runs on every
request that resolves bridge ownership and on a 1 s watchdog thread, so it
fires even when nobody calls. Activation gives the device 5 s of grace.

| `pause.reason` | Cause | Example `pause.message` |
|---|---|---|
| `bridge_silent` | The owning bridge stopped reporting (tab asleep or closed, phone locked, network) | "Chrome on Mac stopped reporting. Is its tab asleep or closed, or the phone locked?" |
| `device_unavailable` | The bridge reports, but its device is disconnected, removed, or unusable here | "Simulated treadmill on Chrome on Mac is disconnected." |
| `no_data` | The device is connected but its readings are null | "Simulated treadmill on Chrome on Mac is connected but not sending data." |
| `no_device` | No usable device has appeared since the session started | "No treadmill is connected. Open the bridge and connect one." |
| `user` | The user pressed Pause on a bridge | "Paused from Chrome on Mac. Press Play to continue." |

The message is written for end users and updates as the situation
changes (for example from `device_unavailable` to `bridge_silent`).

**Resume** is automatic once valid data has flowed without a gap for 0.9 s
(`RESUME_STREAK`), which stops a device that reports every few seconds from
flapping between states.

**User pause.** `POST /bridgeapi/pause {bridgeId}` pauses a running session
immediately; `POST /bridgeapi/resume {bridgeId}` clears it. A user pause
wins over device loss: nothing resumes the game until Play. If the device
is gone when Play is pressed, the session stays paused with the device
reason. Both actions are logged as `userPause` records.

**The game's own pause (built 2026-09-13).** `POST /gameapi/pause
{sessionId, paused}` is a user pause from the game: the same as the
bridge's buttons, with `bridgeId: null` and the message "Paused in the
game. Resume there, or press Play." Either side lifts the other's pause.
Logged as `userPause` with `by: "game"`.

**Opting out (built 2026-09-13).** A game whose metadata says
`"capabilities": {"autoPause": false}` is never paused for missing data;
only a user pause holds it, and Play resumes it at once. The session
brief carries `autoPause`, so bridges let such a session start without a
machine: a heart-rate strap alone, or nothing. Kingdom Trek uses it,
because stopping to read is part of play.

**What the game does while paused** (the mock game is the reference):
keep polling `getstate` and calling `setstate` at 1 Hz; freeze its
simulation, position and countdown; request treadmill `speed: 0` if the
game controls the belt (most do not, §7.3, and then leave `speed` out as
always; bikes request `grade: 0`) so a reconnecting device starts still
and ramps up only after `active` returns; show `pause.message` as-is (it already names the fix,
including "Press Play" for a user pause, so games add no hint of their
own). Only `complete`, `discarded` and `deleted` end the game. A game page
reloaded mid-pause calls `startsession` again and simply rejoins.
`getstate.elapsed` is wall-clock time; `activeSeconds` excludes pauses and
is what a countdown should use. `pause.since` and `pausedSeconds` are null
in the view of an ended or pre-pause-era session. Open prompts keep their
own timeouts while paused.

**Accounting.** Status records `active → paused → active` go in the log;
the timeline marks paused rows; no distance, work, calories or averages
accrue while paused; `pausedSeconds` is in `getstate`, the session brief,
the summary and the `sessions.paused_seconds` column.

**Bridge.** Every bridge shows a paused banner with the message; for a
user pause it offers ▶ Play. ⏸ Pause / ▶ Play sit in the Session tab and
the in-game strip. Device drivers clear their readings when a data stream
stalls (FTMS 4 s, HRM 5 s) so a stalled stream becomes the nulls the
server detects; detection time is then about 9 s. The simulator can
switch the device off, stop sending data, and stop reporting to the
server, which covers every cause.

---

## 6. Game API (`/gameapi/*`)

All calls require the auth cookie (or bearer token). The game is a
same-origin iframe, so the cookie is present automatically. Every session
endpoint checks that the session belongs to the caller.

### 6.1 `POST /gameapi/startsession`

Request: `{"sessionId": "01J..."}` (or ad-hoc form, §5.2). Optional
`"route": "Rolling Hills Loop"` if the game already knows it.

Response:
```json
{
  "sessionId": "01J...",
  "gameId": "rollinghills",
  "variant": "bike",
  "gameVersion": "1.2.0",
  "seed": 8675309,
  "requestedDuration": 1800,
  "username": "dan",
  "uid": 7,
  "achievements": {"rollinghills:speed_40kmh": {"t": "2026-09-01T12:00:00Z", "sessionId": "01J..."}},
  "debug": false,
  "deviceType": "bike",
  "unitSystem": "metric",
  "timeZone": "America/Chicago",
  "bodyData": {"height": 1.80, "weight": 80.0, "sex": "m", "age": 40},
  "options": {"route": "hilly"},        // launch options (§7.1), defaults filled in; {} for games without
  "preferences": {
    "global": {...},
    "device": {...},
    "game": {...}
  },
  "saveState": {...} | null,
  "serverTime": 1757548800.0
}
```

`requestedDuration` is advisory: a countdown hint. Sessions run until
`endsession`. The session row's `duration` is the measured active time.
`preferences.device` is the merged preferences of the device the session's
bridge currently reports (may be `{}` until a bridge connects; the game gets
the live copy again through `getstate.devicePreferences` if it cares).

### 6.2 `GET /gameapi/getstate?session=<id>&since=<seq>&wait=<0..2>`

Response (identical shape for every device type; inapplicable fields null):
```json
{
  "sessionId": "01J...",
  "sessionStatus": "active",
  "endReason": null,
  "seq": 1202,
  "serverTime": 1757549412.5,
  "elapsed": 612.4,
  "requestedDuration": 1800,
  "speed":     {"requested": 9.1,  "commanded": null, "actual": null},
  "incline":   {"requested": null, "commanded": null, "actual": null},
  "cadence":   {"requested": null, "commanded": null, "actual": 88},
  "power":     {"requested": null, "commanded": null, "actual": 212},
  "grade":     {"requested": 4.5,  "commanded": 4.5,  "actual": 4.5},
  "wind":      {"requested": null, "commanded": 0,    "actual": 0},
  "crr":       {"requested": null, "commanded": 0.004,"actual": 0.004},
  "cw":        {"requested": null, "commanded": 0.51, "actual": 0.51},
  "heartRate": {"requested": null, "commanded": null, "actual": 141},
  "position":  {"x": 1204.2, "y": 31.0, "z": -88.7},
  "distance": 5210.7,
  "energy": 520000,
  "work": 124800,
  "input": {"promptId": "p7", "choice": "Left", "t": 1757549410.1, "source": "bridge:b-phone"} | null,
  "inputs": [ {...same fields..., "n": 812}, ... ],   // last 32 answers, n ascending; handle those with n > last handled
  "requestedInput": {...the open prompt, echoed...} | null,
  "bridges": [
    {"bridgeId": "b-...", "label": "Dan's iPhone", "lastSeen": 1757549412.1,
     "devices": [{"role": "fitness", "type": "bike", "name": "KICKR CORE",
                  "address": "…", "status": "connected", "protocol": "ftms"},
                 {"role": "hrm", "name": "Polar H10", "address": "…", "status": "connected"}]}
  ],
  "owner": {"fitness": "b-...", "hrm": "b-..."},
  "devicePreferences": {"difficulty": 1.0, "gradeCap": 20},
  "custom": {...}
}
```

- The example is a bike session: `speed.requested` is the game's virtual
  speed, `grade` drives the trainer, cadence/power are measured.
- `crr` is the FTMS rolling-resistance coefficient (the brief called it
  `crrc`); `cw` is the wind-resistance coefficient. Grade, wind, crr, cw are
  the FTMS *Set Indoor Bike Simulation Parameters* fields. Most trainers only
  honour grade meaningfully.
- The game stops only when `sessionStatus` is `complete`, `discarded` or
  `deleted`. When it is `paused`, the game freezes and shows
  `pause.message` (§5.3); `getstate` then also carries
  `pause: {reason, message, since, seconds, bridgeId, bridgeLabel,
  deviceName, deviceStatus}` and every response carries `pausedSeconds`. For a
  session that is no longer live the server answers from the database with
  the same shape: every metric null, `seq: 0`, `elapsed: null`, plus the
  stored `distance`/`energy`/`work`.
- `input.source` is `"game"` when answered by the game's own buttons or
  `"bridge:<bridgeId>"` when answered from a bridge.
- `input` holds the most recent answered prompt. It stays until a new prompt
  is answered (the game correlates by `promptId`).
- `custom` echoes the last `custom` blob the game sent (useful for a second
  window or a debugging console).

### 6.3 `POST /gameapi/setstate`

Called ~1 Hz, faster on urgent changes. Appended to the session log.

```json
{
  "sessionId": "01J...",
  "timestamp": 1757549412.4,
  "speed": 2.8, "incline": 3.0,
  "cadence": null, "power": null,
  "grade": null, "wind": null, "crr": null, "cw": null,
  "heartRate": null,
  "x": 1204.2, "y": 31.0, "z": -88.7,
  "achievements": [],
  "requestedInput": null,
  "route": "Rolling Hills Loop",
  "score": 1200,
  "custom": {"lap": 2, "segment": "KOM"},
  "urgent": false
}
```

Rules **(decisions)**:
- Any physical field omitted or `null` means "no request". A treadmill game
  sends speed/incline; a bike game sends grade (sim) or power (ERG); sending
  both power and a non-null grade selects ERG (§9.4).
- For **bike** sessions the game also sends `speed`: its computed virtual
  speed. The bridge ignores it for bikes; the server integrates it into
  `distance`. Treadmill games may omit it (distance comes from actual belt
  speed).
- `x`, `y`, `z` are fictional route coordinates in meters, `y` up. Games
  should send them every tick; the console draws the profile (distance vs y)
  and 2-D map (x vs z) from them, and ghosts replay them.
- `achievements` is a list of game-scoped ids (`"speed_40kmh"`). The server
  stores `"<gameId>:<id>"` on the user with first-earned time and session id;
  repeats are idempotent. Ignored in debug sessions.
- `requestedInput` is **level-triggered**: the game includes the same prompt
  object on every tick while it is open, and stops when it has received the
  answer (or gives up). `{"promptId": "p7", "prompt": "Which way?",
  "choices": ["Left", "Right"], "timeout": 10}`; 1–10 choices, each ≤ 40
  chars. Only the newest `promptId` is shown by bridges.
- A prompt may be `"persistent": true`. A one-shot prompt ("use the red
  shell", "go left") disappears everywhere as soon as it is answered, and
  the first answer wins. A persistent prompt ("upshift" / "downshift") stays
  on screen and can be tapped repeatedly; every tap is delivered as a new
  `input` and logged, and the prompt only disappears when the game stops
  including it in `setstate`.
- Prompts are **discrete taps**: one-shot choices ("go left", "turbo
  boost", "red shell"), persistent buttons ("upshift"), or a d-pad
  (`"layout": "dpad"`, §9.7: up/down/left/right and optionally select/back as
  the `choices`). Never held keys, continuous input, or typed text; nothing
  that is hard to do while exercising. Each d-pad tap is one `input`; the
  game reads `inputs` (§6.2) so rapid taps between polls are not lost. The game **always renders the same buttons
  itself** on the primary device, so a phone bridge is a convenience, not a
  requirement. When the user taps a button in the game, the game calls
  `POST /gameapi/answerinput {sessionId, promptId, choice}` so the answer is
  logged exactly like a bridge answer and every bridge sees the prompt
  close. First answer for a `promptId` wins, from whichever side.
- `route` and `score` are optional; the server keeps the last non-null value
  in the session row. `score` is a game-defined number used by leaderboards.
- `custom` is any JSON ≤ 8 KB, logged verbatim, never interpreted.
- **Menu prompts** (`"layout": "menu"`, built 2026-09-13) carry a game's whole choice list, so a phone can mirror it.
  - Fields: `items` (1–100 of `{id, label ≤ 40, hint?, disabled?}`), `highlight`, `back`, `countdown`, `rev`, and
    the d-pad buttons in `choices`.
  - A tap answers with an item id or a button name, plus the `rev` it was aimed at; the game drops stale ones.
  - Item ids may not be button names.
  - The log keeps the menu in full only when its `rev` changes.
  - Details in GAME_AUTHORING.md.
- Response: `{"seq": 1203, "sessionStatus": "active"}`.

### 6.4 `POST /gameapi/endsession`

`{"sessionId": "...", "status": "complete" | "discarded", "reason": "..."}`.
Idempotent. Response: session summary (§8.4). Discarded = user wandered off
or a fatal error occurred.

### 6.5 Preferences and save state

| Endpoint | Purpose |
|---|---|
| `GET /gameapi/preferences?game=<id>` | Per-game preferences JSON (`{}` if none). |
| `PUT /gameapi/putpreferences` `{game, preferences}` | Replace per-game preferences. Full-replace, ≤ 64 KB. |
| `GET /gameapi/getsave?game=<id>&variant=<v>` | Persistent save state for game+variant. |
| `PUT /gameapi/putsave` `{game, variant, saveState}` | Replace it. ≤ 256 KB. |
| `POST /gameapi/answerinput` `{sessionId, promptId, choice}` | The game's own on-screen buttons answer a prompt (§6.3). Returns `{accepted}`. |

Keying **(decision)**: per-game **preferences** are keyed by `gameId` and
shared across variants (a "show minimap" toggle applies to both the bike and
run variants of one codebase). **Save state** is keyed by `gameId + variant`
(progress on the run variant is not progress on the bike variant). A game
may read either for any game/variant, which lets a sequel import progress.

### 6.6 History and ghosts

| Endpoint | Purpose |
|---|---|
| `GET /gameapi/sessions?game=&variant=&route=&status=complete&scope=me\|public&limit=&before=` | Session summaries (§8.4). `scope=public` returns other users' sessions only if their profile is public. |
| `GET /gameapi/sessions/<id>/timeline?hz=1` | Derived 1 Hz timeline (§8.3). Own sessions, or public users' complete sessions. |
| `GET /gameapi/sessions/<id>/log` | Raw JSONL events (own sessions only). |
| `GET /gameapi/me` | `{uid, username, unitSystem, timeZone, achievements}` |

A ghost is just another session's timeline replayed by the game at matching
elapsed time.

---

### 6.7 Session image (built 2026-09-11)

Every game leaves **one picture to remember the session by**: a map of
the route, the inventory at the end of an adventure, a final screenshot.
History shows it as the session's thumbnail.

`PUT /gameapi/sessions/<id>/image` with either a raw `image/png` /
`image/jpeg` body or JSON `{"image": "data:image/png;base64,..."}`, at
most 1 MB, PNG or JPEG only (magic bytes checked). Allowed while the
session runs and for 10 minutes after it ends, so a game may send it just
before or just after `endsession`. Stored next to the session log
(`data/sessions/YYYY/MM/<id>.png`), recorded in `sessions.image_file`,
served to the owner at `GET /api/sessions/<id>/image`; `imageUrl` on
session summaries prefers it over the variant screenshot. Games should
render 640×360 or 16:9; the mock game draws its route map with the final
position and a caption. Later: public sessions expose the image on the
public profile; a game may replace the image while the session runs
(progress snapshots).

## 7. Game package contract

Each game is a folder under `games/<gameId>/`. `gameId` is
`^[a-z0-9_-]{2,32}$` and must equal the folder name.

### 7.1 `metadata.json`

```json
{
  "schemaVersion": 1,
  "id": "rollinghills",
  "name": "Rolling Hills",
  "version": "1.2.0",
  "author": "Dan",
  "description": "A loop through hills, forests and villages.",
  "entry": "index.html",
  "screenshot": "screenshot.png",
  "minPlatformVersion": "1.0",
  "capabilities": {
    "seed": true,
    "ghosts": true,
    "input": true,
    "saveState": false,
    "routes": ["Rolling Hills Loop", "Flat Loop", "Alpine"]
  },
  "variants": [
    {
      "id": "bike",
      "name": "Rolling Hills (Bike)",
      "description": "Ride the loop on a trainer. Grade drives resistance.",
      "deviceTypes": ["bike"],
      "screenshot": "screenshot-bike.png",
      "defaultDuration": 1800,
      "controls": {"bike": "grade"}
    },
    {
      "id": "run",
      "name": "Rolling Hills (Run)",
      "deviceTypes": ["treadmill"],
      "controls": {"treadmill": "incline"}
    }
  ],
  "preferencesSchema": {
    "type": "object",
    "properties": {"showMinimap": {"type": "boolean", "default": true}}
  }
}
```

- `version` is semver and is copied into each session row.
- `entry` and screenshots are paths relative to the served root (dist-first,
  §2), so `entry` is normally `"index.html"` and `screenshot.png` sits at
  the folder root.
- `deviceTypes` per variant: any of `treadmill`, `bike` (future: `rower`,
  `elliptical`). A variant may support several.
- `controls` declares what the game drives per device type:
  `speed`, `incline`, `speed+incline`, `grade`, `power`, `none` (spectator
  / free-ride). Informational; the bridge uses it to know which target
  commands to expect.
- `preferencesSchema` is optional JSON Schema for the per-game preferences,
  used by the console to render a generic editor.
- The catalog validates every `metadata.json` at boot and on
  `POST /api/admin/rescan`; invalid games are listed with errors in the
  console's admin view and hidden from users.
- `capabilities.autoPause: false` (2026-09-13): no automatic pauses (§5.3).
- An option may carry `controls` (2026-09-13): `{"on": {"treadmill": "incline", "bike": "grade"}}`. Choosing that
  value changes what the game drives on those machines, and the session brief's `controls` follow.


**Game options** (owner, 2026-09-11): choices a player makes **at launch, in
the console**, so the game needs no menu of its own and can start playing
at once. Declared at game level:

```json
"options": {
  "route": {"label": "Route", "enum": ["flat", "rolling", "hilly"],
            "labels": ["Flat", "Rolling", "Hilly"], "default": "rolling",
            "description": "How much relief the loop has."}
}
```

Only enums (a row of chunky buttons, gamepad Left/Right). The console
sends `options: {route: "hilly"}` with the launch; the server validates
every key and value against the schema (400 `option_unknown` /
`option_invalid`), fills in defaults, stores them in the session's
`options.game`, and hands them to the game as `options` in the start
payload. Ad-hoc `startsession` accepts `options` too. Preferences
(`preferencesSchema`) remain for things that are about the player or the
screen (units, shadows), not about this ride.

**Duration** is chosen the same way: **15 / 30 / 45 / 60 minutes** as four
buttons (default: the variant's `defaultDuration`, rounded to the nearest),
so the console works without a keyboard. A custom number lives under
Advanced. Games may rely on the duration when they build a route.

### 7.2 Launch URL parameters

`?session=<id>&variant=<id>&seed=<int>&debug=<0|1>`. The game must call
`startsession` with that `sessionId`; everything else is in the response.
`seed` is a 32-bit unsigned integer; the game must be deterministic given
seed + variant (so ghosts and leaderboards on a seed are comparable).

### 7.3 Game responsibilities

1. Poll `getstate` at ~1 Hz (long-poll allowed); stop on complete/discarded/deleted; freeze on paused (§5.3).
2. Push `setstate` at ~1 Hz with requested values, x/y/z, custom.
3. Drive simulation off `actual` values (speed, power, cadence), not
   requests.
4. Handle `input` answers and `requestedInput` prompts (§6.3).
5. Call `endsession` on finish or when abandoning.
6. Never talk to the bridge; never assume which page hosts it.
7. Render nothing that depends on unit preferences without reading
   `unitSystem`.

**Treadmill games usually drive only the incline** (owner, 2026-09-11).
The user picks the belt speed on the machine: easier, safer (nobody is
run faster than they chose) and fairer (fit people go faster). So most
treadmill games declare `controls: {"treadmill": "incline"}`, send no
`speed`, and read `speed.actual` up. Some are **read-only**
(`"none"`): they only watch. Game-controlled speed (`"speed+incline"`)
stays possible for the few games that need it. Consequences: the bridge
never commands speed unless requested (null → no command), never ramps
a belt it never took over when a game goes silent (only the incline
freezes), and the session brief carries `controls` so the bridge can say
"this game only reads your treadmill" and skip requesting FTMS control for
`none`. Limits apply to **commanded** values only: a user who sets the
machine above their own speed limit is doing what they chose, and nothing
clamps, warns about, or pauses on actual values.

**Use the library.** `libs/gamekit` (`@dandyhorse/gamekit`, linked with a
`file:` dependency) holds everything that is the same for every game: the
API types and one function per endpoint, `SessionClient` (long-poll, 1 Hz
ticks, pause tracking, every prompt answer once and in order via the
`inputs` ring, one-shot timeouts, ending with the session image), unit
conversion, prompt and d-pad builders. The mock game is built on it.
`docs/GAME_DEVELOPER_GUIDE.md` is the tutorial; `docs/GAME_AUTHORING.md`
is the wire reference.

---

## 8. Data model

### 8.1 SQLite schema

```sql
CREATE TABLE users (
  uid           INTEGER PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  profile       TEXT NOT NULL DEFAULT '{}',   -- JSON: bio, avatar, etc.
  public        INTEGER NOT NULL DEFAULT 0,
  achievements  TEXT NOT NULL DEFAULT '{}',   -- JSON {"<game>:<id>": {"t": iso, "sessionId": ...}}
  body_data     TEXT NOT NULL DEFAULT '{}',   -- JSON {height m, weight kg, sex, age}
  unit_system   TEXT NOT NULL DEFAULT 'metric',  -- 'metric' | 'us'
  time_zone     TEXT NOT NULL DEFAULT 'UTC',
  preferences   TEXT NOT NULL DEFAULT '{}',   -- JSON global prefs (§8.5)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE tokens (
  token         TEXT PRIMARY KEY,             -- random 256-bit, url-safe
  uid           INTEGER NOT NULL REFERENCES users(uid),
  label         TEXT,                         -- user agent summary
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  session_id    TEXT PRIMARY KEY,             -- ULID
  uid           INTEGER NOT NULL REFERENCES users(uid),
  game_id       TEXT NOT NULL,
  variant       TEXT NOT NULL,
  game_version  TEXT NOT NULL,
  device_type   TEXT NOT NULL,                -- treadmill | bike
  seed          INTEGER NOT NULL,
  debug         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,                -- pending|active|complete|discarded|deleted
  end_reason    TEXT,
  route         TEXT,
  score         REAL,
  requested_duration REAL,                    -- s, advisory
  started_at    TEXT,                         -- ISO, when status became active
  ended_at      TEXT,
  duration      REAL,                         -- s, active time (ended - started)
  distance      REAL,                         -- m
  energy        REAL,                         -- J, metabolic estimate
  work          REAL,                         -- J, mechanical (bike only)
  avg_power     REAL, max_power REAL,         -- W
  avg_speed     REAL, max_speed REAL,         -- m/s
  avg_hr        REAL, max_hr REAL,            -- bpm
  avg_cadence   REAL,
  elevation_gain REAL,                        -- m, from y
  body_data     TEXT NOT NULL,                -- JSON snapshot at launch
  options       TEXT NOT NULL DEFAULT '{}',   -- JSON launch options
  log_file      TEXT,                         -- relative to data/sessions
  log_finalized INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX sessions_user_time ON sessions(uid, started_at DESC);
CREATE INDEX sessions_leader ON sessions(game_id, variant, route, status);

CREATE TABLE devices (
  device_id     INTEGER PRIMARY KEY,
  uid           INTEGER NOT NULL REFERENCES users(uid),
  type          TEXT NOT NULL,                -- treadmill | bike | hrm
  address       TEXT NOT NULL,                -- MAC (native) or Web Bluetooth device id (browser)
  name          TEXT NOT NULL,
  protocol      TEXT NOT NULL DEFAULT 'ftms', -- ftms | hrs | simulator
  preferences   TEXT NOT NULL DEFAULT '{}',   -- JSON (§8.5)
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(uid, address)
);

CREATE TABLE game_preferences (
  uid INTEGER NOT NULL, game_id TEXT NOT NULL,
  preferences TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, game_id)
);

CREATE TABLE save_states (
  uid INTEGER NOT NULL, game_id TEXT NOT NULL, variant TEXT NOT NULL,
  save_state TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, game_id, variant)
);

CREATE TABLE leaderboards (
  game_id TEXT NOT NULL, variant TEXT NOT NULL, route TEXT NOT NULL DEFAULT '',
  metric  TEXT NOT NULL,        -- distance | energy | score | avg_power | duration
  period  TEXT NOT NULL,        -- day | week | month | all
  period_key TEXT NOT NULL,     -- '2026-09-10', '2026-W37', '2026-09', ''
  uid INTEGER NOT NULL, session_id TEXT NOT NULL,
  value REAL NOT NULL, rank INTEGER NOT NULL, computed_at TEXT NOT NULL,
  PRIMARY KEY (game_id, variant, route, metric, period, period_key, uid)
);

CREATE TABLE schema_version (version INTEGER NOT NULL);
```

Notes:
- `body_data` is snapshotted into the session at launch so later profile
  edits never change past calorie numbers.
- Web Bluetooth does not expose MAC addresses; it gives an opaque
  per-origin-per-browser `device.id`. `address` stores whatever the bridge
  has. The same treadmill paired from two browsers appears as two device
  rows; the console lets the user merge rows (preferences copied, old row
  deleted) **(decision)**. Native bridges will report real MACs.
- Timestamps in SQL are ISO 8601 UTC text.

### 8.2 Session log (JSONL)

Path: `data/sessions/YYYY/MM/<sessionId>.jsonl`, gzipped to `.jsonl.gz` on
finalize. Lines are appended as events arrive and flushed at least every
second, so a crash loses ≤ 1 s. Record kinds:

```jsonl
{"k":"header","v":1,"sessionId":"01J...","uid":7,"gameId":"rollinghills","variant":"bike","gameVersion":"1.2.0","deviceType":"bike","seed":8675309,"debug":false,"bodyData":{...},"createdAt":"2026-09-10T22:00:00Z"}
{"k":"status","t":1757548800.1,"from":"pending","to":"active"}
{"k":"game","t":1757548801.2,"tc":1757548801.0,"seq":12,"req":{"speed":9.1,"incline":null,"cadence":null,"power":null,"grade":4.5,"wind":null,"crr":null,"cw":null,"heartRate":null},"pos":{"x":..,"y":..,"z":..},"ach":[],"prompt":null,"route":"...","score":null,"custom":{...}}
{"k":"bridge","t":1757548801.4,"tc":1757548801.3,"seq":13,"bridgeId":"b-..","devices":[...],"cmd":{"speed":null,"incline":null,"power":null,"grade":4.5,"wind":0,"crr":0.004,"cw":0.51},"act":{"speed":null,"incline":null,"cadence":88,"power":212,"grade":4.5,"wind":0,"crr":0.004,"cw":0.51,"heartRate":141}}
{"k":"input","t":..,"bridgeId":"b-..","promptId":"p7","choice":"Left"}
{"k":"achievement","t":..,"id":"rollinghills:speed_40kmh"}
{"k":"owner","t":..,"from":{"fitness":null,"hrm":null},"to":{"fitness":"b-laptop","hrm":"b-laptop"}}
{"k":"end","t":..,"status":"complete","endReason":"completed","summary":{...}}
```

`t` = server receive time (authoritative), `tc` = client timestamp. The raw
log preserves everything from every bridge; nothing is merged at write time.

### 8.3 Derived timeline

Computed from the raw log on finalize (and cached beside it as
`<id>.timeline.json.gz`): one row per second of elapsed time with the
merged state at that instant, in the same shape as `getstate` minus
`bridges`/`input`. Used by the console minimap/graphs, ghosts, and leaderboard
metrics. Missing seconds (client hiccup) are filled by carrying the last
value forward for ≤ 5 s, otherwise null.

### 8.4 Session summary and metrics

Computed at finalize by `metrics.py` from the timeline and written into the
session row:

- `duration` = `ended_at − started_at` (active time only).
- `distance` (m): treadmill = ∫ `speed.actual` dt; bike = ∫ `speed.requested`
  (virtual speed from the game) dt. Falls back to path length of x/z if
  speed is absent.
- `work` (J, bike only) = ∫ `power.actual` dt.
- `energy` (J, metabolic estimate):
  - Bike: `work / 0.24` (24 % gross mechanical efficiency; overridable by a
    global preference `efficiency`).
  - Treadmill: ACSM metabolic equations per second, using the session's
    `body_data.weight`:
    - walking (`v < 1.8 m/s`): VO₂ = 3.5 + 0.1·v′ + 1.8·v′·g
    - running: VO₂ = 3.5 + 0.2·v′ + 0.9·v′·g
    - where v′ is speed in m/min, g is grade as a fraction, VO₂ in
      ml·kg⁻¹·min⁻¹; kcal/min = VO₂ · weight / 200; ×4184 → J/min.
  - If neither power nor speed exists but heart rate does, the Keytel HR
    formula is used and the summary is flagged `energySource: "hr"`.
- `elevation_gain` = Σ positive Δy.
- Averages ignore null samples; max is over non-null.
- Summary JSON returned by APIs mirrors these columns plus
  `energySource` and `sampleCount`.

### 8.5 Preferences (three levels)

| Level | Storage | Contents |
|---|---|---|
| Global | `users.preferences` | `unitSystem` (mirrored column), `timeZone`, `defaultDuration`, `ownedDeviceTypes: ["treadmill"]`, `ftp`, `maxHr`, `hrZones`, `efficiency`, `allowSimulatorInRealSessions`, `theme`; for effort-paced games (2026-09-13): `steadyWatts` (W), `steadyPace` `{speed (m/s), incline (%)}`, `restingHr`, `steadyHr`. |
| Device | `devices.preferences` | `maxSpeed` (m/s), `minSpeed`, `maxIncline` (%), `minIncline`, `maxSpeedChangePerSecond` (m/s²), `maxInclineChangePerSecond`, `speedScale`, `inclineScale`, `difficulty` (0–2, scales grade for bikes), `powerOffset` (W), `gradeCap` (%), `label`; `steadyWatts` and, on a treadmill, `steadyPace` override the global ones on that machine. |
| Per-game | `game_preferences` | Whatever the game defines; validated against `preferencesSchema` if present. |

Platform defaults for device limits (used when a device row has none):
treadmill `maxSpeed 4.5 m/s`, `maxIncline 15`, `minIncline 0`,
`maxSpeedChangePerSecond 0.5`; bike `gradeCap 20`, `difficulty 1.0`.

---

## 9. Bridge

The bridge is the only path between the server and physical devices. It is
a Vue + TypeScript app using Web Bluetooth, later also a native app speaking
the same `bridgeapi`.

### 9.1 Responsibilities

1. Discover, pair, connect FTMS treadmills/bikes and BLE heart-rate monitors.
2. Poll `bridgeapi/getstate`; apply limits/scaling; write targets to the
   device; read actuals; push `bridgeapi/putstate` at 1 Hz (faster when a
   target changes).
3. Register connected devices with the server and edit their preferences.
4. Host the game iframe on the launching device (§5.1) and collapse to a
   metrics strip.
5. Show input prompts as big buttons and answer via `sendinput`.
6. Debug simulator: a fake treadmill/bike whose actual values follow the
   commanded ones with lag, plus sliders to override them manually and an
   HR slider.
7. Always-visible **emergency stop** (sends FTMS Stop, sets speed 0).
8. Show key metrics when visible: requested/commanded/actual speed, incline,
   grade, power, cadence, HR, elapsed, distance, connection states.

### 9.2 Bridge API (`/bridgeapi/*`)

The bridge is keyed by **user**, not session: it always serves the user's
current session, whatever it is. That is what lets a phone bridge be opened
before or after the console launch.

**Bridge identity.** `bridgeId` is a fresh UUID per page load, held only in
memory. It must not be persisted: two tabs of one browser share cookies and
localStorage, and a shared id made their reports overwrite each other at the
server (a real bug found in testing, 2026-09-11). `browserId` is persisted
in localStorage and sent alongside so UIs can say "another tab in this
browser". Simulator restore after a reload uses sessionStorage (this tab
only). On `pagehide` the bridge sends `navigator.sendBeacon('/bridgeapi/leave',
{bridgeId})` so its ownership is released at once instead of after the 5 s
freshness window.

**Standing.** Every `putstate` response and bridge `getstate` carries this
bridge's standing:

```json
"roles": {"fitness": "owner" | "standby" | "ignored" | null, "hrm": ...},
"ignoredReasons": {"fitness": "wrong_device_type" | "simulator_not_allowed"},
"conflicts": [{"role": "fitness", "ownerBridgeId": "...", "ownerLabel": "Chrome on Mac",
               "ownerBrowserId": "...", "ownerDevice": {"name": "...", "type": "treadmill", "status": "simulated"}}]
```

A bridge drives its fitness machine **only** while the server has confirmed
`roles.fitness == "owner"`; until the first confirmation after connecting a
device, and whenever it is standby or ignored, it sends no targets at all.
A standby bridge shows a red banner naming the owner and a **Take control
here** button (`POST /bridgeapi/claim {bridgeId, role}`), which moves the
role if this bridge offers a usable device. Game `getstate.bridges[]` and
console `/api/sessions/current` list every bridge with its `roles`.

`GET /bridgeapi/getstate?bridgeId=<uuid>&since=<seq>&wait=<0..2>`
```json
{
  "serverTime": 1757549412.5,
  "session": {"sessionId": "01J...", "status": "active", "gameId": "rollinghills",
              "variant": "bike", "deviceType": "bike", "seq": 1202,
              "elapsed": 612.4, "requestedDuration": 1800, "debug": false,
              "gameEntryUrl": "/games/rollinghills/index.html?session=…&variant=bike&seed=8675309&debug=0"} | null,
  "requested": {"speed": null, "incline": null, "cadence": null, "power": null,
                "grade": 4.5, "wind": null, "crr": null, "cw": null, "heartRate": null},
  "limits": {"maxSpeed": 4.5, "minSpeed": 0, "maxIncline": 15, "minIncline": 0,
             "maxSpeedChangePerSecond": 0.5, "maxInclineChangePerSecond": 1.0,
             "gradeCap": 20, "difficulty": 1.0, "speedScale": 1.0, "inclineScale": 1.0, "powerOffset": 0},
  "devicePreferences": {"<address>": {...}},
  "requestedInput": {"promptId": "p7", "prompt": "Which way?", "choices": ["Left","Right"], "timeout": 10, "persistent": false} | null,
  "input": {"promptId": "p6", "choice": "Right", "t": 1757549400.2, "source": "game"} | null,
  "merged": {"speed": {"requested": ..., "commanded": ..., "actual": ...}, ...},
  "position": {"x": ..., "y": ..., "z": ...} | null,
  "distance": 5210.7, "energy": 520000, "work": 124800,
  "ignored": [],
  "owner": {"fitness": "b-laptop", "hrm": "b-phone"},
  "otherBridges": [{"bridgeId": "b-phone", "label": "Dan's iPhone", "lastSeen": ...}]
}
```
`limits` is the platform defaults merged with the preferences of the fitness
device this bridge most recently reported, so a change made in the console
takes effect on the next poll.

`POST /bridgeapi/putstate`
```json
{
  "bridgeId": "b-laptop", "label": "MacBook", "timestamp": 1757549412.4,
  "devices": [
    {"role": "fitness", "type": "bike", "name": "KICKR CORE", "address": "…", "protocol": "ftms",
     "status": "connected", "features": {"grade": true, "power": true, "speedRange": null}},
    {"role": "hrm", "name": "Polar H10", "address": "…", "protocol": "hrs", "status": "connected"}
  ],
  "commanded": {"speed": null, "incline": null, "power": null, "grade": 4.5, "wind": 0, "crr": 0.004, "cw": 0.51},
  "actual":    {"speed": null, "incline": null, "cadence": 88, "power": 212, "grade": 4.5, "wind": 0,
                "crr": 0.004, "cw": 0.51, "heartRate": 141},
  "urgent": false
}
```
Response: `{"seq": 1203, "session": {...same as getstate.session...},
"ignored": []}` (`ignored` lists roles the server discarded, §9.3).
If the bridge is only an HRM source, it sends `commanded: null` and only
`actual.heartRate`. A bridge with no session still calls `putstate` (the
server ignores metrics, records presence so the console can show "bridge
connected"). `status` values: `connected`, `connecting`, `disconnected`,
`simulated`, `readonly` (device streams data but rejects control).

`POST /bridgeapi/pause` and `POST /bridgeapi/resume` `{"bridgeId"}`: the
user's Pause/Play buttons (§5.3). 409 when no session is running.

`POST /bridgeapi/sendinput` `{"bridgeId", "promptId", "choice"}` →
`{"accepted": true}`. First answer for a `promptId` wins; later ones return
`accepted: false`.

`POST /bridgeapi/remote` `{"bridgeId", "button"}` → `{"ok": true, "n"}`:
a d-pad press for the console when no session wants it (§9.7); `button`
is one of up/down/left/right/select/back. Not logged.

`POST /bridgeapi/devices` upsert `{type, address, name, protocol}` →
device row including preferences. `PUT /bridgeapi/devices/<id>/preferences`
replaces preferences (same handler as the console's).


**`POST /bridgeapi/end`** (2026-09-11) `{bridgeId, status: "complete"|"discarded"}`.
The user ends the session from any bridge. `complete` finalizes it like the
game's own `endsession` (saved to History, `endReason: bridge:<id>`), and
the game may still attach its session image for 10 minutes; gamekit's
`SessionClient` does that by itself when it sees a completion it did not
initiate. `discarded` drops it. A pending session is always discarded
(nothing was ridden). 409 when there is no session; ending twice is a 409.

### 9.3 Multi-bridge merge policy (decision)

- Each bridge report is stored per `bridgeId` with its server receive time.
- A report is **fresh** for 5 s.
- Ownership is tracked **per user**, not per session, so the bridge in
  control keeps control when a new session is launched. Without a session,
  any fitness device is a candidate (two bridges still conflict before
  launch); with one, candidates must match its device type and simulator
  policy.
- For each role (`fitness`, `hrm`) the **owner** is a bridge with a fresh
  report that lists a device of that role with status
  `connected`/`simulated`/`readonly`, and for `fitness` whose device type
  matches the session's `deviceType`. Ownership is **sticky**: the current
  owner keeps the role while its reports stay fresh; only when it goes
  stale (or drops the device) does the freshest other candidate take over.
  Without stickiness two live bridges would alternate every report. The
  first bridge to offer a usable device wins; every later one is standby
  until it claims the role or the owner goes stale, leaves, or drops its
  device. Every change is logged as an `owner` record (claims carry
  `"claim"`), and activation writes an `owner` snapshot. Timeline replay
  follows the logged owner records verbatim, so claims are replayed
  faithfully.
- `commanded.*` and `actual.*` (except heart rate) in the merged state come
  only from the fitness owner. `heartRate.actual` comes from the HRM owner
  (which may be the same bridge, or a fitness bike reporting HR passthrough
  when no dedicated HRM bridge exists).
- When no fresh owner exists the merged values become `null`; the game sees
  the loss immediately.
- A debug simulator counts as a fitness device (`status: "simulated"`).
  Non-debug sessions ignore simulated devices unless the global preference
  `allowSimulatorInRealSessions` is set (for users without hardware). When
  the server ignores a bridge's device for this reason, the `putstate`
  response carries `"ignored": ["fitness"]` and the bridge shows a visible
  "simulator ignored: session is not in debug mode" warning, so the failure
  never looks like a merge bug.

### 9.4 Device control pipeline (per poll)

```
requested (from server)
  → scale:     speed × speedScale, incline × inclineScale, grade × difficulty, power + powerOffset
  → clamp:     speed ∈ [minSpeed, maxSpeed], incline ∈ [minIncline, maxIncline], |grade| ≤ gradeCap
  → slew:      |Δspeed| ≤ maxSpeedChangePerSecond·dt, same for incline   (treadmill only)
  → feasibility: clamp to the device's ranges; land on its resolution once the slew reaches the target
               (values on the way stay off the grid and the driver rounds them when it writes: rounding each
               tick to a grid coarser than one tick's slew stalled a descending Horizon incline at 0.5 % steps
               and doubled the rate going up; fixed 2026-09-13)
  → commanded  (reported back in putstate, even if the write fails)
  → device write via devicelib (only what changed; nothing replayed after a reconnect)
```

Null requested → null commanded → nothing written: the usual treadmill
game requests no speed at all (§7.3) and the belt stays the user's.
Limits and slew apply to commanded values only, never to reported actuals.
**E-STOP always sets speed 0 and sends Stop**, whether or not the game
controls speed; if the bridge lacks control it requests it first. The
E-STOP button is shown only when a treadmill is involved (owner: it makes
no sense on a bike).

- **Treadmill**: Set Target Speed (0x02, uint16, 0.01 km/h) and Set Target
  Inclination (0x03, sint16, 0.1 %). Bridge converts m/s ↔ km/h; devicelib
  converts to the machine's units (the Horizon 7-series reads tenths of a
  km/h, §9.5). devicelib sends Request Control and Start before each speed
  change and Request Control before each incline change (QZ's sequence; the
  `skip_control_refresh` quirk turns it off), and a target of 0 as Pause
  (08 02). Many treadmills only stream data and refuse control; then
  `status: "readonly"`, `commanded = null`, and the game runs off actual
  values (user drives the buttons). The bridge reads a refusal from the
  machine's own answers (`80 00 xx` not success, any `80 op 05`, status
  0xFF) and returns to `connected` when a later Request Control succeeds.
  Safety filter applies on treadmills only, as the brief says.
- **Bike**: if `requested.power` is non-null → ERG: Set Target Power (0x05).
  Else if any of grade/wind/crr/cw is non-null → Set Indoor Bike Simulation
  Parameters (0x11: wind sint16 0.001 m/s, grade sint16 0.01 %, crr uint8
  0.0001, cw uint8 0.01 kg/m); nulls default to wind 0, crr 0.004, cw 0.51.
  Else no command. Bike actuals: cadence and power from Indoor Bike Data
  (0x2AD2); grade/wind/crr/cw actual = commanded (trainers don't measure
  them); speed actual = trainer-reported wheel speed if present, else null.
- **Loss of server** (no successful `getstate` for 10 s): hold last
  commanded; after 30 s on a treadmill ramp speed down to 0 at
  `maxSpeedChangePerSecond` and show a banner **(decision)**. Bikes: hold.
- **Loss of device**: `status: "disconnected"`, actuals null. devicelib
  reconnects for about 40 s (0.5 to 10 s apart), then the bridge tries every
  5 s for as long as the device stays in the bridge. A reconnect replays
  nothing: targets go out again only when the bridge next commands.
- **Emergency stop**: Request Control, target speed 0 (`02 00 00`, 0 in any
  units), Request Control, Stop (`08 01`), banner, and `putstate` with
  `commanded.speed = 0`.
- **The user's hands win.** Targets go out only when they change, so a
  speed or incline the user sets with the machine's own buttons stands until
  the game's request changes, whether or not the machine reports it (Machine
  Status 0x05/0x06; the Horizon reports nothing). Until 2026-09-13 the
  bridge re-sent targets every 5 s as a keep-alive; devicelib does not. When the user stops the machine or pulls the safety key
  (0x02/0x03), the bridge latches `userStopped`: it never sends Start/Resume
  or targets again until the user restarts the machine (0x04) or presses
  **Resume control** in the bridge. The device report carries
  `userStopped: true` meanwhile. The simulator models both cases ("User
  pressed STOP/START", "User pressed ±0.5 km/h").
- **Regaining control** of a treadmill (new owner, resume) slews from the
  belt's actual speed, not from 0.
- **Silent game** (frozen, crashed, or throttled in a hidden tab): the
  server does not age the game's last request, so the bridge must. Bridge
  `getstate.session.gameAge` is the seconds since the game's last
  `setstate`. After 10 s the bridge holds the last target and shows a
  banner; after 30 s it ramps a treadmill to 0 at
  `maxSpeedChangePerSecond`, exactly as for a lost server. Bikes only
  hold. When the game speaks again, control resumes and slews from the
  belt's actual speed. (Found 2026-09-11: a 38 s game stall kept a belt
  at the last requested speed.)

**Speed control is opt-in per treadmill** (2026-09-12). The bridge commands
belt speed only for simulators and for real treadmills whose saved device
preferences have `speedControl: true` (console, Preferences, Devices, "Let
games set the belt speed"). Otherwise the pipeline drops `speed` requests
(incline still flows) and the device card says "Speed is yours: speed control
is off for this treadmill". Reason: the Horizon (§9.5), where speed targets
came out 10x (firmware V9.001) or ran the belt to maximum (V3.001) before
devicelib sent that model's units. The switch stays as a per-machine safety
gate for models nobody has measured.
E-STOP is unaffected: it sends target 0 and Stop directly. The switch is the
only opt-in: once it is on, every speed change goes through without asking
(owner, 2026-09-12: no confirmation per change). The Exercise device console
sends ops as typed (a speed in the machine's units, or a raw frame) and only
shows a one-line warning while the belt moves.

### 9.5 Bluetooth details

- Services: FTMS `0x1826` (Feature `0x2ACC`, Treadmill Data `0x2ACD`, Indoor
  Bike Data `0x2AD2`, Supported Speed Range `0x2AD4`, Supported Inclination
  Range `0x2AD5`, Supported Power Range `0x2AD8`, Control Point `0x2AD9`,
  Machine Status `0x2ADA`). Heart Rate `0x180D` (Measurement `0x2A37`).
- Control sequence: Request Control (0x00) → Start/Resume (0x07) → targets;
  handle the indication responses and Machine Status changes (user pressed
  the physical buttons → new actual speed, no new command from us).
- Web Bluetooth constraints: secure context (HTTPS, or `localhost` in
  dev); user gesture to open the chooser; Chrome/Edge desktop and Android
  Chrome only; iOS Safari lacks it (use the Bluefy browser or wait for the
  native app). Documented in the bridge's "unsupported browser" screen.
- Proprietary services (Wahoo, Tacx) are out of scope; FTMS is the baseline.
  The device layer is an interface (`FitnessDevice`) with two
  implementations: the bridge's `SimulatorDevice`/`SimulatorHrm` (UI test
  doubles with sliders and "user pressed" buttons) and `DevicelibDevice`,
  which wraps a devicelib `DeviceSession` for every real machine and strap
  (2026-09-13; it replaced the bridge's own FTMS and heart-rate drivers).
  devicelib identifies the model against its registry and applies that
  model's quirks. The bridge asks for FTMS even where devicelib also speaks
  the machine's own protocol (owner: just use FTMS). The bridge keeps its
  own rules on top (§9.4): writes only inside the control tick, the
  user-stop latch, read-only on refusal, E-STOP, readings null after 4 s
  (straps 5 s) of silence. The chooser asks for every service devicelib's
  registry knows, because Web Bluetooth hides the rest and the Horizon is
  recognised by its vendor service 0xFFF0. Control-point replies get 1.5 s
  from the acknowledged write. Device rows keep their `ble:<id>` address and
  `ftms`/`hrs` protocol, so saved preferences still apply.
  Heart-rate monitors are all Bluetooth (Heart Rate `0x180D`) today, but
  the HRM role does not depend on it: the server keys a device by its
  opaque address and stores the protocol as text, and the bridge only sees
  a `FitnessDevice`. A non-Bluetooth strap later is one more
  implementation with its own address scheme and protocol name. A strap
  reading of 0 bpm means no contact and reports null; a strap's value wins
  over a machine's own heart rate, in the bridge and in the server merge.
  The Exercise device console builds frames with devicelib (a typed speed
  goes out in the machine's units), shows every byte both ways, the
  registry entry and quirks in force, and the machine's raw Supported Range
  bytes, and can run devicelib's simulated FTMS treadmill or Horizon 7.0AT
  without hardware. The device card's technical details show the registry
  entry and quirks too.

**Known firmware quirks** (2026-09-12)

- **Horizon 7.0AT (`HORIZON_7.0AT ####`).** Two firmware versions tested,
  both with the display in mph.
  - **V3.001 (as shipped).** Speed writes while the belt moved ran it to its
    maximum, 19.3 km/h (12 mph, 5:00/mi). `02 c8 00` (2.00 km/h) twice: the
    first gave 2 km/h, the second gave Treadmill Data `8a 07` = 19.30 km/h.
    `02 64 00` (1 km/h) while moving gave 10 km/h. Both fit a machine that
    reads targets in tenths of km/h and caps at its maximum.
  - **V9.001 (updated 2026-09-12).** The runaway is gone, but targets still
    come out 10x. Exercise device console: `02 0a 00` (0.10 km/h per spec)
    gave Treadmill Data raw 100 = 1.00 km/h, display 0.6 mph; `02 14 00`
    (0.20 km/h) gave raw 200 = 2.00 km/h. Checked on the bridge side: the
    logged write is the exact buffer passed to Web Bluetooth, the served
    build matches the source, and the typed decimal survives (0.1 became 10
    hundredths; a lost decimal would have sent `02 64 00`). Treadmill Data
    and the machine's own display agree, so decoding is right.
  - **Handled in devicelib (2026-09-13).** The owner's device library
    confirmed the quirk on this treadmill with its own tools (firmware 3.001
    and the latest) and carries it as the `speed_sent_in_tenth_kmh` flag on
    its `horizon_7_series` registry entry, so the bridge has no Horizon code
    of its own. A game's 1 km/h now goes out as `02 0a 00`. devicelib uses
    the registry's speed limits, 0.8 to 19.3 km/h, instead of the mph
    numbers the firmware reports. Speed control stays opt-in (§9.4): check
    for `horizon_7_series · speed_sent_in_tenth_kmh` in the device card's
    technical details or the Exercise device console before switching it on.
  - Both versions: Stop, Start and E-STOP (target 0, then Stop) behave.
    Feature bits advertise no incline, yet incline targets work; Treadmill
    Data carries no incline. On V3.001 the Supported Speed Range read
    50..1200 step 10, its **mph** limits (0.5 to 12 mph) in a field the spec
    defines as km/h; not yet re-read on V9.001.

### 9.6 Bridge UI (redesigned 2026-09-11)

**Who it is for.** The typical bridge is an old phone mounted permanently
on the treadmill. It connects the exercise device and is where the user
taps game choices, and not much else. So: phone-first (360–375 px),
large touch targets, a light DOM, screen wake lock while a session runs,
and nothing on the normal screens that a person exercising would not
understand.

Routes: `#/session/<id>` = launching bridge (hosts the game iframe on
"Start game"); `#/join` (or bare `/bridges/web/`) = joining bridge, which
can still "Show game here". Session switching (supersede, launch from the
console) is silent: the bridge simply follows; the session id appears only
in developer tools.

**Tabs:** Home, Devices, and a ⋯ menu with Developer tools (Debug
Dandyhorse, Exercise device console = Debug FTMS), Theme (System / Light /
Dark, persisted in `localStorage` as `dh.theme`, applied as `data-theme`
on the root element), "Show technical details" (tab id, browser id,
roles, seq, device addresses) and "Rename this bridge". An open developer
tool appears as a closable third tab.

**Home shows exactly one screen**, decided in this order:
1. not logged in → login;
2. hosting the game and not expanded → game iframe + strip;
3. session ended → short summary, "Open console";
4. no session → "Waiting for a game. Start one from the console." with the
   devices connected to this bridge and "Set up a device" (device setup
   never waits for a session);
5. session, no local exercise device, nobody else owns one → the setup
   wizard;
6. session, no local exercise device, another bridge owns one → "Your
   treadmill is connected through <label>" and Start / Show game, with
   "Connect a device here instead" (decision §16.1);
7. session with a local exercise device → **Ready / Remote**: prompt
   choices first, then one card per local device with its key values,
   then Start game / Show game here, Pause / Play.

**Prompt choices are the main thing** while a game runs: full-width
buttons (≥ 64 px), a short title, a press flash; persistent buttons stay,
one-shot choices disappear after a tap. On the strip they open as a sheet
over the game.

**Key values per device** (actual only, never commanded/target):
treadmill = speed and incline, watts smaller if reported; bike = watts,
cadence smaller; heart rate monitor = bpm. No duration, distance or energy
(the game shows those, and two slightly different numbers would confuse).
Limits are not editable in the bridge (console only); a note says so.

**Banners:** one at a time, most urgent first: E-stop > user pause (▶
Play) > device pause (server message) > another bridge in control ("Take
control here") > stopped on the machine (Resume control) > server
unreachable > silent game > ignored device.

**Setup wizard:** (a) Connect your exercise device: one Bluetooth button
(must call `requestDevice` from the tap), a sentence about the browser's
device picker, or the unsupported-browser message when Web Bluetooth is
missing; (b) connecting; (c) result: name and live value, or type mismatch
("This is a bike trainer; this game needs a treadmill") with retry, or the
read-only notice; (d) optional heart rate monitor, Skip; (e) done. "Use a
simulator" is offered only for `debug` sessions; otherwise simulators live
in Developer tools and are never added to the saved-device list (the
server skips `sim:` addresses in `_touch_device`).

**Terminology:** FTMS → exercise device (treadmill / bike trainer when
known); HRM → heart rate monitor; simulated → simulator; owner/standby →
"in control" / "another device is controlling". Hidden from normal
screens: commanded, requested, putstate, seq, ids, roles, limits, seed,
merged tables.

**As built (2026-09-11, verified in the browser).** `ui.ts` holds the
pure `decideScreen`/`pickBanner` and the terminology helpers, unit-tested
(17 UI tests, 67 bridge tests in all). The ended card has a **Done**
action that turns the page into a joining bridge (remote + device setup)
so a big-screen user can start the next game from the phone. Persistent
prompts and d-pads send every tap even while a request is in flight; only
one-shot prompts block a second tap. The Screen Wake Lock is requested
while a session runs. Not verifiable without hardware: the real Web
Bluetooth chooser (wizard steps b–d were exercised with simulators) and
the wake lock on a phone.

**Deployment caveat for the phone bridge.** Web Bluetooth needs a secure
context and Chrome/Edge on Android or desktop (no iOS Safari). A phone on
the LAN opening `http://<host>:8080` gets no Bluetooth; Phase 4 adds the
HTTPS dev setup (mkcert). Chrome's `getDevices()` permission persistence
could let the mounted phone reconnect after a reload without the picker;
to be evaluated with real hardware.

**Ending a ride from the bridge** (owner, 2026-09-11): every bridge that
shows a running session (hosting, ready, or connected through another
bridge) has **■ End** (not "End ride": it may be a treadmill game) under Pause/Play and a ghost **Discard**
under it. Both are two taps (the first arms the button for 5 s, the second
confirms) so a knock on a phone on the treadmill cannot end a workout. End
completes the session through `/bridgeapi/end`; the tail sees the end on
its next poll and shows the ended card, the hosted game stays mounted
(hidden) long enough to upload its picture. "Close game" is gone: it only
unloaded the iframe and let the server discard the session for silence,
which looked like a discard without saying so. Games can still end
themselves (`endsession`), as Rolling Hills does when its countdown runs
out. The compact strip under a hosted game keeps only Pause and E-STOP;
End is one tap away behind ▲. The ended card leads with **▶ Play again**
(same game, variant, duration and options, through the console's launch
API; the tail follows the new session), then Open console and Done. End
reasons from a bridge read "Ended here" / "Ended from another bridge",
never a bridge id.

### 9.8 Bridge state machines: invariants (2026-09-11)

These conditions are hard to reproduce by hand, so the rules are written
down and the pure parts (`ui.ts`: `decideScreen`, `pickBanner`;
`pipeline.ts`) are unit-tested against them.

- **Silent game.** `session.gameAge` is server time since the game's
  last `setstate`; it exists only while the session is active or paused
  (only `startsession` activates a session, so a silent game is always one
  that ran and stopped: closed tab, navigated away, crashed). After 10 s
  the bridge holds its last commands, after 30 s it ramps a belt it had
  commanded to 0; a belt it never commanded (§7.3) is left alone and
  `ramping` stays false. The banner is a calm warning ("the game is not
  running; open it with Show game here") unless this bridge is *driving*
  (confirmed owner of a live local exercise device), in which case it is
  the red safety banner with the real countdown.
- **Silent bridge.** A pause reason is recomputed on every check while
  paused, but a bridge that stopped reporting stays "stopped reporting"
  until its presence record expires (60 s), because it may come back; a
  reload in a browser that does not fire `pagehide` (the in-app test
  browser) therefore names the dead tab for up to a minute. The wizard
  hides every device-pause banner because it *is* the fix.
- **Simulators.** Never saved as the user's devices (neither by the bridge
  nor by the server). Restored on reload only within the same tab
  (sessionStorage). A simulator whose type does not match the session's
  device type is dropped silently when the session is first seen, so the
  wizard offers the right one; a real device of the wrong type keeps the
  "not being used" banner. Only one local exercise device exists per
  bridge: turning on a second simulator replaces the first.
- **Standing.** `roles`/`ignoredReasons`/`conflicts` come only from
  server responses computed for the current device set (`deviceEpoch`);
  a response that started before a device change is discarded. A bridge
  commands its machine only while the server says `owner`.
- **Banners.** Exactly one, in this precedence: E-stop > logged out (game
  mode) > user pause > device pause (hidden while the wizard shows the
  same message) > another bridge in control > stopped on the machine >
  server unreachable > silent game > ignored device > developer mute.
- **Screens.** One of login / game / ended / idle / wizard / remote /
  ready, decided in that order (§9.6); the wizard, once opened by the
  user or by a connection attempt, stays until finished or cancelled.

### 9.7 Remote control and d-pad (2026-09-11)

The bridge doubles as a **remote control**: a phone on the treadmill with
up/down/left/right, a centre Select and a Back. Two paths, kept separate so
each is easy to debug:

- **In a session:** no new server concept. A game that wants steering or
  menu input sets a prompt with `"layout": "dpad"` and names the buttons
  it wants in `choices` (any of up/down/left/right/select/back). The bridge
  renders it as a cross instead of a button list; every tap goes through
  `sendinput` like any other answer. Because `input` holds only the latest
  answer, `getstate` also returns `inputs`, a ring of the last 32 answers
  with a monotonically increasing `n`; a game processes entries with `n`
  greater than the last one it handled and never misses a double tap.
- **No session:** the bridge shows the d-pad on its Home screen ("Remote
  control") and posts each press to `POST /bridgeapi/remote`. The server
  keeps a per-user ring of 64 events with a counter `n`; the console
  long-polls `GET /api/remote?since=<n>&wait=<s>` and gets every event
  after `since`. Any of the user's bridges may press; no ownership. Nothing
  is written to a session log.

Latency is two long-poll hops (bridge → server → console), fine for menu
and steering-choice taps, not for continuous control; the no-websockets
decision (§16) already accepts this. The console side of this is deferred
to the big-screen rework (§10).

---

## 10. Console

**Remote control (built 2026-09-11).** The console is driven by the
bridge d-pad (§9.7) or a keyboard through one normalized press stream:
`remote.ts` long-polls `GET /api/remote` (cursor starts at the current
`n`, so presses buffered before the page loaded are dropped; a smaller
`n` means the server restarted) and maps ArrowUp/Down/Left/Right, Enter
and Escape to the same presses, leaving keys alone when they have a native
meaning on the focused control. `focus.ts` is spatial navigation: the
nearest visible control in the pressed direction, sideways offset
penalised so columns stay columns (pure geometry, unit-tested). Dialogs
mark their root `data-focus-layer` (navigation stays inside, a new layer
takes the cursor) and their close control `data-back`. Select clicks the
focused control; Back closes the layer or goes back in history; left/right
change a `<select>` or number input so up/down always leave the field. The
cursor is painted explicitly (`body[data-remote] :focus`) because Chrome
hides `:focus-visible` after programmatic focus. The **launching bridge**
(the big screen after "Launch and open bridge") consumes the same stream
with the same rules, ignoring its own d-pad and doing nothing while the
game iframe has the screen, so the couch user can walk the setup wizard
and press Start game. Verified end to end: Games → dialog → Launch →
bridge wizard → simulator → Start game, all by remote presses.

**Redesign (built 2026-09-11): a game-console-like app.** Constraints
from the owner: works on a big screen driven by the bridge d-pad or
arrow keys, and on a phone (some users run the whole stack on one phone,
plugged into a TV or not), so buttons are big and chunky either way; far
less developer data per screen. As built:

- **Active-session modal** (on load while a game runs): literally "A
  Game is Already Running" with **Open Bridge** (join as device + remote)
  and **Open Main Screen** (continue to the console; a new launch
  replaces the running game). There is no "open with game": games are
  stateful and cannot move between screens (moving a live game is a
  possible future feature, not planned). If the game has been silent for
  more than 10 s the modal says so.
- **Top bar**: brand, tab pills **Games · History · Leaderboards ·
  Achievements · Preferences** (+ **Admin** for admins, `ADMIN_UIDS`
  config, default `[1]`), and the **connection indicator** ("Connected
  treadmill" / "Connected bike trainer", or a neutral "Devices" when
  nothing is connected yet, since the device normally connects on the
  game screen or a phone and "No device" read as an alarm, from the fresh
  bridges in `GET /api/sessions/current`, polled every 4 s; a red dot
  for a heart rate monitor; the session status pill when one exists).
  Selecting the indicator opens the live-status layer (session, pause
  message, elapsed, Open Bridge, the devices on each bridge, and the
  instructions for using a phone as a bridge with the join URL; QR + code
  pairing is Phase 5), which replaced the Status tab; `/status` stays as an unlinked developer
  route. No uid is shown anywhere.
- **Games**: large variant cards; the launch dialog is a single column
  (device type when several, duration, debug switch, Advanced → seed,
  Play, Cancel) so Down always means next.
- **History** (`/sessions`): a gallery of image cards (`imageUrl`, the
  variant screenshot until games attach per-session images in Phase 5),
  variant name, relative time ("1 h ago"), and only **Duration** and
  **Energy**; discarded sessions hidden unless "Show discarded"; Load
  more is a big button. The detail page keeps every metric and the
  charts, with a big Back.
- **Leaderboards** and **Achievements** are skeleton screens (one line
  and greyed placeholder rows) until Phase 5.
- **Preferences** absorbed Devices (rename, forget, limits, merge) and
  holds the theme picker (System / Light / Dark, `dh.theme`) and Log out;
  it is a plain form, not d-pad optimised (owner's call).
- **Scrollbars**: a chunky custom scrollbar (16 px, accent thumb on a
  panel track, 10 px on phones) in both console and bridge.
- **Look**: dark-first palette (navy ground, electric blue, magenta,
  lime, amber, cyan, violet per tab), light theme too; 1/2/3/4 columns
  from phone to TV; ≥ 56 px targets; the cursor is a thick white outline
  with a glow and a slight scale, visible from the couch.
- **Gamepad**: the whole app is the focus root; Up from the first row
  lands on the active tab, Left/Right move along the tabs, Select opens.
  Verified by remote presses: Games → card → Up → History → Select → card
  → detail → Back, admin tab for uid 1 only, indicator following a curl
  phone bridge. USB gamepads (the Gamepad API) are a later addition to
  the same press stream.

Vue + TypeScript SPA served at `/`.

Pages:
- **Login**: asks `GET /api/auth` which login this server has. Development:
  a user number (`/login?uid=<n>` works too). Online: "Sign in with Google",
  a full-page trip through `/login?next=` (§11); a new account then gets a
  one-field username page before anything else (`needsHandle`).
- **Active-session modal**: on load, if `GET /api/sessions/current` returns
  a pending/active session, the console shows a modal first, because the
  usual reason to open the console while a session exists is to start a
  bridge on a second device. Three choices: **Open bridge with game** (this
  is the primary device: `bridgeUrl` with `?game=1`, the bridge hosts the
  game iframe), **Open bridge without game** (this is a secondary device:
  `/bridges/web/#/join`, devices only), or **Pick a new game** (dismisses
  the modal; launching later supersedes the old session).
- **Games**: grid of every variant of every valid game regardless of the
  user's devices, with screenshot, name, description, device badges, and a
  "you don't have a <treadmill> configured" hint (from
  `ownedDeviceTypes`). Launch dialog: duration, seed (random by default),
  debug toggle, then navigates to the bridge (§5.1).
- **Sessions**: list with filters (game, status, date), infinite scroll;
  detail page with summary, minimap (2-D x/z path) and profile (distance vs
  y) drawn from the timeline, graphs (speed/power/HR/incline vs time),
  achievements earned, delete (soft), "download log".
- **Devices**: list, rename, merge, edit preferences (limits, difficulty),
  delete; plus `ownedDeviceTypes` checkboxes.
- **Preferences**: global prefs, body data, unit system, time zone, public
  profile toggle, per-game preference editor (rendered from
  `preferencesSchema` or a raw JSON editor).
- **Leaderboards**: filters game/variant/route/metric/period; only public
  users appear; own row highlighted even if private.
- **Achievements**: earned list grouped by game.
- **Status**: current session (if any), connected bridges, quick link to the
  bridge.
- **Admin** (uid 1 for now): catalog rescan, invalid games, purge.

### 10.1 Console API (`/api/*`)

| Method & path | Purpose |
|---|---|
| `GET /api/auth` | No login needed: `{mode: "stub" or "oidc", loginUrl}`, for the login screens (§11). |
| `POST /api/login` `{uid}` | Development login (stub mode only, never through a tunnel); sets `dh_token` cookie (HttpOnly, SameSite=Lax, Secure over https). |
| `GET /login?next=` | Google sign-in (oidc mode): to Google and back through `/oidc/authorize` and `/auth/complete`, then to `next`. Stub mode: `?uid=` logs in. |
| `POST /api/logout` | Revoke token. |
| `GET /api/me` / `PUT /api/me` | Profile, body data, unit system, time zone, public flag, global preferences. `needsHandle` until a new Google user picks a username (2–24 letters, digits, `_ . -`, unique ignoring case). |
| `GET /api/games` | Catalog: games with variants, screenshots (as URLs under `/games/<id>/`), validation status. |
| `POST /api/sessions/launch` `{gameId, variant, deviceType, duration?, seed?, debug?}` | Creates pending session, supersedes old; returns `{sessionId, bridgeUrl}`. |
| `GET /api/sessions?status=&game=&limit=&before=&includeDiscarded=` | Own sessions, summaries with `imageUrl`. Discarded sessions are omitted unless `status=discarded` or `includeDiscarded=1` (they pile up by the thousands). |
| `GET /api/sessions/current` | Own pending/active session or null, with bridges. |
| `GET /api/remote?since=<n>&wait=<s>` | Long-poll for bridge d-pad presses (§9.7): `{n, events:[{n, button, bridgeId, t}]}`. |
| `GET /api/sessions/<id>` | Summary + achievements earned. |
| `GET /api/sessions/<id>/timeline` | Derived timeline (§8.3). |
| `GET /api/sessions/<id>/log` | Raw JSONL (gzip) download. |
| `DELETE /api/sessions/<id>` | Soft delete. Active sessions must be ended first (409). |
| `POST /api/sessions/<id>/end` `{status}` | Console-side end/discard of a stuck session. |
| `GET/POST /api/devices`, `PUT/DELETE /api/devices/<id>`, `POST /api/devices/<id>/merge` `{into}` | Device CRUD. |
| `GET /api/game-preferences/<gameId>` / `PUT` | Same table as `gameapi/putpreferences`. |
| `GET /api/leaderboards?game=&variant=&route=&metric=&period=&periodKey=` | Precomputed rows + own rank. |
| `GET /api/users/<username>` | Public profile if `public`. |
| `POST /api/admin/rescan`, `POST /api/admin/purge` | Admin. |

---

## 11. Auth

Two ways in, one login token (built 2026-09-14; setup in README "Put it online"):
- **Development (`stub`)**: `POST /api/login {uid}` (or the `GET /login?uid=`
  landing page) creates the user row if missing and logs in as that user. It
  is off whenever Google sign-in is on, and it refuses any request that came
  through a Cloudflare tunnel (`Cf-Connecting-Ip`), so a forgotten setting
  cannot put it online.
- **Google (`oidc`)**, through Flask-OIDC (on Authlib), which does discovery,
  state, nonce, the code exchange and the ID-token checks. `GET /login?next=`
  → `/oidc/login` → Google → `/oidc/authorize` (the redirect URI:
  `DANDYHORSE_PUBLIC_URL` + `/oidc/authorize`) → `/auth/complete`, which maps
  the account's `(issuer, sub)` to a uid in `oidc_identities`, creates the
  user on the first sign-in, sets the login token, and empties the sign-in
  cookie (`dh_oidc`, Flask's session), so no Google token is kept. The email
  is stored for people to read and for the optional allow-list
  (`DANDYHORSE_ALLOWED_EMAILS`), never to match accounts. A new user has a
  placeholder username (`rider-1a2b3c4d`) and `handle_set = 0`: `/api/me`
  says `needsHandle`, and the console asks for a username before anything
  else.
- **Which one**: `DANDYHORSE_AUTH`, else `oidc` when Google's client id and
  secret are configured (`client_secrets.json` in the data folder, or the
  environment), else `stub`. `GET /api/auth` tells the login screens.
- **The login token** is an encrypted JWT (JWE, `dir` + `A256GCM`) holding
  `{uid, jti, iat, exp}`, set as the HttpOnly cookie `dh_token` (Secure when
  the public URL is https). Every API route reads the cookie, or
  `Authorization: Bearer <token>` for non-browser clients (tests, a future
  native bridge). Each token's `jti` has a row in `tokens`, so logging out
  revokes it. Its key is derived (HKDF) from the master secret,
  `DANDYHORSE_SECRET_KEY` or `<data>/secret.key` (made on first start, mode
  600); the sign-in cookie is signed with a second derived key. No
  device-to-device login flow: each browser logs in on its own.
- Same-origin iframes inherit the cookie, so games and the bridge need no
  auth code at all.
- Every session/device/preference query is scoped by `uid` from the token;
  cross-user reads exist only through `public` profiles.
- CSRF: cookie is SameSite=Lax and all mutating routes require
  `Content-Type: application/json`, which blocks cross-site form posts. After
  logging in, the browser only goes on to a path on this server (`next` must
  start with a single `/`).

Decisions to revisit:
- Tokens last a year, as the cookie always did, with no refresh or sliding
  expiry. Logging out, or a new secret, ends them sooner.
- Logging out ends the Dandyhorse login only, not the Google one.
- The first Google user on a fresh data folder is uid 1, the admin. A
  development database moved online keeps its users, who have no Google
  identity; to take over an old uid, point your identity at it
  (`UPDATE oidc_identities SET uid=1 WHERE email='you@example.com'`); the
  placeholder user the first sign-in made stays, unused.
- New users get their first name from Google as the display name.
- Usernames: 2–24 of `A-Z a-z 0-9 _ . -`, starting with a letter or digit,
  unique ignoring case. Checked only when a username changes, so older names
  still save.
- The server is Flask's threaded development server: fine for a handful of
  people, not for more.

---

## 12. Achievements and leaderboards

**Achievements**
- Game-scoped: `"<gameId>:<achievementId>"`, set by `setstate.achievements`.
  First-earned time and session id stored; repeats idempotent; logged as an
  `achievement` line; returned to the game in the `startsession` payload and
  from `/gameapi/me`.
- Platform-scoped (computed at finalize): `first_session`,
  `total_distance_100km`, `total_distance_1000km`, `longest_session_1h`,
  `sessions_10`, `sessions_100`, `every_device_type`. Extendable list in
  `metrics.py`.
- Debug and discarded sessions earn nothing.

**Leaderboards**
- Recomputed incrementally on every `complete` non-debug session:
  for each metric in `distance`, `energy`, `duration`, `avg_power`, and
  `score` (if the game reported one), and each period `day`, `week`,
  `month`, `all`, upsert the user's best value into `leaderboards` and
  re-rank the affected group. Groups: `(game, variant, route)`; `route=''`
  means all routes for that variant.
- Only `public` users are ranked; a private user's own row is computed but
  served only to them.
- Deleting a session recomputes the affected groups.

---

## 13. Mock game (`games/mockgame`)

Plain HTML + TypeScript (built with Vite to `dist/`, `base: '/games/mockgame/'`), two
variants: `treadmill` and `bike`. It:
- reads the launch URL params, calls `startsession`, shows the payload;
- runs a deterministic route from `seed`: a loop of hills with x/z laid out
  as a rounded rectangle and y from a seeded noise function;
- every second: `setstate` with requested incline/speed (treadmill) or grade
  (bike) from the route, virtual speed from actual power (bike: simple
  physics against grade), x/y/z, and a `custom` blob;
- shows all `getstate` fields in a table, a countdown from `duration`, a
  "prompt user" button (`requestedInput` with three choices), an "earn
  achievement" button, "complete" and "discard" buttons;
- reads and writes per-game preferences and save state (lap counter).

Together with the bridge's simulator this exercises every endpoint without
hardware.

As built it also handles `paused` (§5.3): a dimmed page with a band
showing "Paused", the server's message and a live counter; frozen
simulation, position and countdown (driven by active time); treadmill
speed 0 or bike grade 0 requested while paused; prompts, Complete and
Discard still usable.

### 13.1 Rolling Hills (`games/rollinghills`, ported 2026-09-11)

The first real game: `bikebike` (a BabylonJS cartoon bike rolling around a
generated loop of hills, forests, villages and lakes) copied into the
platform, renamed, and wired to the game API. The original project is
untouched; the copy lives entirely under `games/rollinghills`.

**Variants.** `bike` (`controls: {"bike": "grade"}`) and `treadmill`
(`controls: {"treadmill": "incline"}`), 30 min by default. Both drive the
hill and read the effort: on a bike the measured power moves the bike
through the original force model (gravity, rolling, drag) and the tick
carries `grade` plus the virtual `speed` so the server integrates distance
from the world; on a treadmill the belt speed the user chose IS the speed
and the tick carries `incline` only. **The game never commands belt speed**;
`src/drive.ts` builds the tick, a unit test asserts the treadmill body has
no `speed` key, and `guardTreadmill` strips one at runtime if it ever
appears. The true trail grade is sent for both; the bridge pipeline scales
it (bike difficulty, treadmill incline scale) and clamps it to the machine
(a downhill on a treadmill becomes 0 %). `null` measurements stay `null`
(the bike coasts, the belt reads 0) and the old "creep so the rider never
stalls" is gone: no data means no distance.

**How the port works.** The engine files are served verbatim as classic
scripts from `public/js/` (Vite copies them); only the integration files
changed: `config.js` (reads `window.RH_START`), `ride.js` (measured
values in, grade request out), `hud.js` (units from the platform, heart
rate, the machine panel, pause/end overlays), `segments.js` (bests via a
hook), `main.js` (no longer self-running: `window.RollingHills.boot(
platform)` returns a handle). The TypeScript adapter in `src/` uses
gamekit: `main.ts` calls `startsession` **first**, publishes seed, route,
device type and preferences on `window.RH_START`, then injects the classic
scripts in order (`script.async = false`) because `Loop`, `Biome`,
`Terrain` and `Track` generate the world at load time from the seed and
route. `platform.ts` owns the `SessionClient` and implements the small
per-frame contract (`measured()`, `paused()`, `pauseMessage()`,
`activeSeconds()`, `ended()`, `saveBest`, `achievement`, `finish`).
`input.js` (pedal slider, arrow keys) is gone; the weather / time-of-day
keys work only in debug sessions.

**Platform features used.** Route (`flat|rolling|hilly`) and time of day
are **launch options** (§7.1) chosen in the console's launch dialog;
shadows stays a per-game preference. The game applies defaults itself for
sessions that predate the options (`src/drive.ts`), and the route goes out
in every tick so History records it. KOM and
sprint bests live in save state per variant (`{bests: {"<seed>:<route>:
<kind>": seconds}}`), loaded from the start payload and written with
`putsave` on a new best. Achievements `first-lap`, `kom`, `sprint`,
`full-ride`. The rider's weight from `bodyData` sets the physics mass
(+10 kg bike). The countdown runs on `activeSeconds`; at zero the game
ends the session itself (`complete`) after the finish banner, with a
session image: the last frame plus the profile strip and the numbers. The
ride simulation runs in wall-clock substeps (≤ 50 ms, catching up ≤ 2 s
per frame) so a throttled tab or a weak GPU does not slow the world down
relative to the machine.

**Known limits.** The countdown runs on the platform's active clock from
Start game, not from the first pedal stroke as the original did. A page
reload mid-ride resumes the session but puts the rider back at the start
line (position is not restored from `getstate`). `capabilities.routes` is
informational (the route is a launch option). Babylon.js comes from `cdn.babylonjs.com` (pinned
v9.26.0, ~8 MB): the game needs internet on the screen that runs it;
vendoring it is a to-do. The HUD is the original's, restyled only where the
platform required it. No prompts or d-pad use yet (nothing to choose).
Physics is tuned for fun (`GRAVITY_SCALE` 0.55), not for calorie truth;
the server's own energy estimate is what History shows.

**On the Horizon 7.0AT** (rehearsed 2026-09-13 against devicelib's
simulated 7.0AT with the measured firmware behaviour, through console,
bridge, game and server; not yet on the real treadmill). The treadmill
variant sends only incline; the bridge turns it into `00` + `03 xx xx`
and never into a speed target or a Start, so the belt stays the user's.
The belt speed set on the machine moves the bike, and the server
integrates distance from it. The machine reports no incline, so the HUD's
"machine" line stays blank and History's elevation and energy use the
commanded incline (the metrics fall back to it). It reports the selected
speed, not the belt's, so the bike takes a new speed while the real belt
is still ramping. It reports none of its button presses, so a stop on its
console shows up only as speed 0. Incline follows the hill both ways at the
configured 1 %/s on its 0.5 % grid, after the pipeline fix of 2026-09-13
(§9.4); before it, a downhill never flattened a 0.5 % machine.

---

### 13.2 Kingdom Trek (`games/kingdomtrek`, integrated 2026-09-13)

A role-playing adventure: the workout earns Energy, Energy walks the hero between towns, and fights are won by
pushing harder. Its `INTEGRATION.md` is the design, and its §13 lists the decisions to revisit. How it uses the
platform:
- **One variant for both machines**, so one hero (save state per game + variant).
- **Effort, not raw watts.** gamekit's `EffortMeter` measures the workout against the player's own steady pace, so
  a level takes everyone about the same time.
- **Controls.** `controls: none` unless Hills is on, which drives incline or grade.
- **No automatic pauses.** Its own ⏸ pauses the session, and a bridge's ⏸ opens its pause menu.
- **Its whole choice list is a menu prompt**, so a phone plays it. On the big screen: keyboard, gamepad, mouse, and
  taps on places in town.
- **Each tick** sends the hero's place on the kingdom map (x/z) and the ground's height (y), so the session viewer
  draws the trek and its profile.
- **Standalone** (no `?session=`): a localStorage save and developer keys.
- **Tests:** 104 vitest tests, including the phone mirror, Hills and the map, and taps in town.

## 14. Testing

- **Server** (pytest): unit tests for lifecycle, merge policy, metrics
  formulas, log recovery; API tests using Flask's test client with a scripted
  fake game and two fake bridges (ownership switching, staleness, prompts,
  supersede, reaper, restart recovery with a partial log).
- **Frontends** (vitest): bridge pipeline (scale/clamp/slew, landing on
  coarse device grids), the devicelib adapter against devicelib's simulated
  machines (Horizon speed units, E-STOP, user-stop latch, read-only,
  reconnect, Rolling Hills' incline-only bytes on a simulated 7.0AT), merge
  display; console unit conversions. FTMS encoding and parsing are tested in
  devicelib (node:test).
- **End-to-end** (Playwright, later): console launch → bridge simulator →
  mockgame iframe → complete → session appears with a timeline.
- CI: lint (ruff, eslint), type-check (mypy strict on server, `vue-tsc`),
  tests, build all three frontends, validate every `games/*/metadata.json`.

---

## 15. Implementation phases

**Status (2026-09-11):** see §0. Phases 0–3 are built and integration-tested with
the mock game and the bridge simulator (console launch → bridge → game
iframe, prompts both ways, multi-bridge ownership, E-stop, server-restart
recovery, session detail with minimap/profile/graphs). Since 2026-09-13
the bridge's machines and straps go through devicelib, verified against
devicelib's simulated machines and a mock strap; no real hardware has been
connected yet.

Each phase ends with something demoable.

**Phase 0 — Skeleton**
Repo layout, `pyproject`, Flask `create_app`, SQLite schema + migrations,
stub login + tokens, static serving of three placeholder frontends, catalog
scanning `games/*/metadata.json`, `mockgame` metadata only.
*Done when:* `GET /api/games` lists mockgame after logging in with `?uid=1`.

**Phase 1 — Session core + game API**
Lifecycle, in-memory store with `seq` and long-poll, JSONL writer with
flush, reaper, restart recovery, full `gameapi` (start/get/set/end, prefs,
save state, sessions, timeline), metrics. Mockgame runs against it via
ad-hoc start (no bridge yet: actuals null).
*Done when:* pytest suite passes; mockgame completes a session and the
timeline file exists.

**Phase 2 — Bridge API + bridge app with simulator**
`bridgeapi` (getstate/putstate/sendinput/devices), merge policy, ownership,
prompts. Bridge app: session view, simulator device, pipeline
(scale/clamp/slew), strip view hosting the game iframe, E-stop, prompts,
Debug Dandyhorse tab, Debug FTMS tab with a basic Web Bluetooth FTMS
driver (untested against hardware until Phase 4).
*Done when:* console-less launch (ad-hoc) + bridge simulator + mockgame run
end to end; two bridges (two browser tabs) show ownership handoff.

**Phase 3 — Console**
Login, games grid, launch flow into the bridge, sessions list/detail with
minimap/profile/graphs, devices, preferences, status page, soft delete.
*Done when:* the full flow of §5.1 works from the console with the simulator.

**Phase 3.5 — Usability (done 2026-09-11)**
The bridge redesign (§9.6), the d-pad remote (§9.7) and the game-console
style console (§10) are built and verified. Open follow-ups: a console
first-run flow, USB gamepad input, per-session images (Phase 5).
The biggest gap was: The bridge UI is hard to understand and exposes things
most users don't care about. Redesign it around three questions a user has
while exercising: *is my machine connected, is the game running, what do
I do next?*
- One primary screen per situation: connect a device, ready to start,
  running (big metrics, Pause/Play, E-STOP), paused (the reason in plain
  words and the one action that fixes it), finished.
- Show every device of the session, including ones connected through
  other bridges, so the user can pair on whichever device works; allow
  continuing with no local device when another bridge supplies one
  (decision §16.1).
- Move roles, limits, raw metrics, round-trip logs, fake putstate and the
  FTMS console behind a "Developer" switch (off by default).
- Replace jargon (owner, standby, commanded, putstate) with plain words;
  one banner at a time, most urgent first; phone-first layout with large
  touch targets.
- Console: first-run flow (profile, devices), clearer launch dialog, and a
  status page that explains a paused or stuck session.
*Done when:* a new user can connect a simulator or treadmill, start the
mock game, recover from a paused session, and finish, without reading any
documentation or seeing a developer control.

**Phase 4 — Real hardware**
FTMS treadmill and bike drivers, HRM driver, treadmill actual-speed
smoothing (EMA, 1 s; decision §16.5), device registration and
preferences, reconnect, read-only detection, loss-of-server handling, HTTPS
dev setup (mkcert) so a phone can run the bridge. The HTTPS step is a
**prerequisite** for the mounted-phone bridge (§9.6): Web Bluetooth needs a
secure context, so `http://<host>:8080` on the LAN gets no Bluetooth; and
only Chrome/Edge on Android or desktop qualify, never iOS Safari. Also
evaluate Chrome's `navigator.bluetooth.getDevices()` so the mounted phone
reconnects after a reload without the picker, skip FTMS control
requests for `controls: "none"` games, and add a cross-bridge E-stop
relayed through the server (§16.12).
*Done when:* a real treadmill and a real trainer each complete a mockgame
session with a phone bridge and a laptop game.

**Phase 5 — Achievements, leaderboards, ghosts, polish**
Public session images on profiles (the upload itself is built, §6.7),
**phone pairing** for the bridge (the console shows a QR code and a
short one-time code; the phone opens the URL, enters the code, and gets a
session cookie for the same user; needs the LAN/HTTPS address from Phase
4), platform achievements, leaderboard recompute, public profiles, ghost
timeline API verified by a mockgame ghost overlay, per-game preference
editor from schema, admin page, `docs/GAME_AUTHORING.md`.

**Phase 6 — Hardening**
OIDC, rate limits, log rotation/purge CLI, backups of `data/`, Playwright
e2e, packaging (Dockerfile, systemd unit), native bridge design.

---

## 17. What a new user expects and does not find (review 2026-09-11)

Walked end to end as a first-time user (console on a TV, phone as the
bridge, one game). Not features; the obviously missing pieces. **Fixed
today** and **still open** are marked.

| Expectation | State |
|---|---|
| End a workout early and keep it | **Fixed**: ■ End on every bridge (two taps), `/bridgeapi/end`; the game still attaches its picture. Discard is separate and says it won't be saved. |
| Pick the route / difficulty and how long before starting, without a keyboard | **Fixed**: launch options from `metadata.json` and 15/30/45/60 min as buttons in the launch dialog. |
| Play the same thing again | **Fixed**: ▶ Play again on the bridge's ended card. |
| A crash or a closed tab must not throw the ride away | **Fixed**: a session that goes silent after at least 60 s of activity is completed (`endReason: timeout`), not discarded. |
| A name and a password, or "who am I" | **Fixed (2026-09-14)**: Google sign-in; the first sign-in makes the account and asks for a username (§11). The `?uid=` login stays for development. |
| Leaderboards and Achievements tabs with something in them | **Open**: skeletons; achievements are stored but not shown per game with names and pictures. |
| First-run guidance on the TV ("connect your treadmill on your phone: open this address") | **Half**: the status layer has the instructions and the join URL; nothing shows them unprompted on first run. QR pairing is Phase 5. |
| Pause or end from the console screen itself | **Open**: only bridges can pause and end. The console's status layer could carry Pause / End for a TV with a remote but no phone at hand. |
| Pick up a ride where it stopped after a reload | **Open**: the session resumes, the game restarts from its own start (Rolling Hills goes back to the start line). Games could restore from `getstate.position`. |
| Debug off by default for real riding | **Open**: the launch dialog defaults to Debug on (simulators need it). Once real hardware is the norm this must default off, or follow whether a real device was ever saved. |
| Sound, music, a mute button | **Open**: nothing plays anything yet; when a game does, the console needs a global mute that games read. |
| The game on the big screen when the phone launched it | **By design**: the game runs where Start game / Show game here was pressed; the TV bridge hosts it and the phone supplies the device. Worth one line of on-screen wording on the phone ("the game is on your other screen"). |
| Delete a session, log out, set weight and units | Present (History detail, Preferences). |

---

## 16. Open questions and decisions

The project owner answered items 1–7 on 2026-09-11; each answer follows
its question in the owner's own words. Items 8–10 are new and still open.

1. Should a bridge be allowed to launch a session by itself (phone-only
   setups with the game on a TV browser that cannot pair)? Current answer:
   no, the console should always start the bridge, even if the bridge ends
   up not doing anything.
  If the bridge can't connect to any device, that is fine IF some other
   device is connected through a different bridge. Actually the
   bridge should be able to display the connection status of all devices (including
   remote devices) so the user has the opportunity to pair through a different device.
   The bridge should allow continuing with no device connected as long as a different
   one is connected elsewhere.
2. Which proprietary trainer protocols matter enough to add after FTMS?
FTMS only for now. THe logical addition is more device types, not more protocols.
3. Should `score`-based leaderboards be per seed (comparable routes) rather
   than per route name? Probably both; the schema's `route` column could
   hold `"seed:8675309"`.
   NOt sure. This likely depends on game. 
4. Calorie models are estimates; do we want a per-user calibration factor
   beyond `efficiency`?
   No. In the future we will support retrieving a user's more accurately 
   estimated calories from a fitness watch, but for now, don't worry about it. 
5. Should treadmill "actual speed" be filtered (some treadmills report in
   0.1 km/h steps with jitter)? Bridge-side EMA with a 1 s constant is the
   proposed default.
   Yes.
6. Resolved 2026-09-11: first bridge wins, later ones are standby with a
   visible error and a "Take control here" button (see §9.2–9.3).
   No, I don't think so. The user can figure that one out.
7. Retention: keep raw logs forever, or compact to timeline after N months?
   Keep forever.

8. **Long pauses.** Should a session paused for, say, 30 minutes be
   discarded automatically (the user wandered away)? Not built; today only
   the 5-minute game-silence reaper ends a session.
9. **Game-initiated pause.** Games may want their own Pause button
   (`POST /gameapi/pause`), mirroring the bridge's. Built 2026-09-13 for
   Kingdom Trek (§5.3).
11. **D-pad Back button.** The owner asked for four directions and then
    a **Select**; the build also has a **Back** (six buttons; games pick the
    subset they want in `choices`). Does Back stay, or is Select alone
    enough for the console? Answer: Let's remove Back for now. 

12. **Cross-bridge E-stop.** E-STOP appears only on a bridge that can act
    (a local treadmill, or the owner of the session's treadmill). A phone
    used purely as a remote while a laptop owns the belt shows none. Should
    the server relay a stop to the owner bridge so any of the user's
    bridges can halt the belt? (Planned for Phase 4.) Answer:
    No

10. **Ownership and bad data.** Should a standby bridge with good data take
    over automatically from an owner that sends nulls? Today the user
    presses "Take control here". AnswerL
    No. 
