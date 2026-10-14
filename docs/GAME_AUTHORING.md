# Dandyhorse game API reference

The wire contract for games. New here? Read the tutorial first:
[GAME_DEVELOPER_GUIDE.md](GAME_DEVELOPER_GUIDE.md); it uses the
`@dandyhorse/gamekit` library (`libs/gamekit`), which wraps everything
below. A game is a static web app in `games/<gameId>/` that talks to the
server over `/gameapi/*`. It never talks to the bridge or to hardware. The
`games/mockgame` folder is the reference implementation; copy it.

## Package

```
games/<gameId>/
  metadata.json      required, at the folder root
  screenshot.png     shown in the console
  dist/index.html    your built app (or index.html at the root if unbuilt)
```

Requests for `/games/<gameId>/<path>` are answered from `dist/<path>`
first, then `<path>`. With Vite set `base: '/games/<gameId>/'`.

`metadata.json` (see PLAN.md §7.1 for every field):

```json
{
  "schemaVersion": 1,
  "id": "rollinghills",
  "name": "Rolling Hills",
  "version": "1.0.0",
  "entry": "index.html",
  "screenshot": "screenshot.png",
  "capabilities": {"seed": true, "input": true, "saveState": false, "ghosts": false},
  "options": {"route": {"label": "Route", "enum": ["flat", "rolling", "hilly"], "default": "rolling"}},
  "variants": [
    {"id": "bike", "name": "Rolling Hills (Bike)", "deviceTypes": ["bike"],
     "defaultDuration": 1800, "controls": {"bike": "grade"}},
    {"id": "run", "name": "Rolling Hills (Run)", "deviceTypes": ["treadmill"],
     "defaultDuration": 1800, "controls": {"treadmill": "incline"}}
  ]
}
```

`id` must equal the folder name and match `^[a-z0-9_-]{2,32}$`.

Two optional extras, both used by Kingdom Trek:
- **`"capabilities": {"autoPause": false}`.** The server never pauses the session for missing device data: for a
  game where standing still is part of play, or one that works from a heart-rate strap alone.
  - Only the user pauses, and Play resumes at once.
  - The session brief carries `autoPause`, so bridges let such a session start without a machine.
- **An option can change what the game drives:**
  `"options": {"hills": {"enum": ["off", "on"], "controls": {"on": {"treadmill": "incline", "bike": "grade"}}}}`.
  The session's `controls`, which bridges read, are then the variant's, overridden by the chosen value's.

And one for any game: **names for your achievements**, shown on the console's Achievements page:
`"achievements": {"turbo": {"name": "Turbo!", "description": "Filled the Turbo meter."}}`. The page lists the
named ones before they are earned, as goals. An id you send without a name still shows, spelled out from the id
(`level-5` → "Level 5").

## Lifecycle

1. The bridge loads your entry as an iframe with
   `?session=<id>&variant=<id>&seed=<uint32>&debug=<0|1>`.
2. `POST /gameapi/startsession {"sessionId": ...}`. The response tells you
   the device type, username, unit system, body data, requested duration
   (advisory countdown only; the console offers 15/30/45/60 min), the launch
   `options` the player chose in the console (every key of your `options`
   map, defaults filled in, validated against the enums), your per-game
   preferences, global and device preferences, your save state, and the
   user's achievements.
3. Every ~1 s: `POST /gameapi/setstate` with what you want the machine to
   do, your fictional x/y/z, and any custom JSON. Then
   `GET /gameapi/getstate?session=<id>&since=<seq>&wait=1` (long-poll) to
   read the merged live state.
4. Drive your simulation from **actual** values (`speed.actual`,
   `power.actual`), never from what you requested: the user can override a
   treadmill from its own buttons.
5. Stop only when `sessionStatus` is `complete`, `discarded` or `deleted`.
   When it is `paused`, freeze (see below) and keep polling.
6. `POST /gameapi/endsession {"sessionId": ..., "status": "complete"}`
   (or `"discarded"` if the user wandered off).

No session parameter? Call `startsession` with
`{"gameId", "variant", "debug": true}` to create an ad-hoc session while
developing.

## setstate body

```json
{"sessionId": "...", "timestamp": 1757549412.4,
 "speed": 2.8, "incline": 3.0,
 "cadence": null, "power": null, "grade": null, "wind": null, "crr": null, "cw": null,
 "heartRate": null,
 "x": 1204.2, "y": 31.0, "z": -88.7,
 "achievements": [], "requestedInput": null,
 "route": "Loop", "score": 1200, "custom": {"lap": 2}}
```

- Units: m/s, percent, rpm, W, bpm. Missing = `null`, never `-1`.
- Treadmill games request `speed` and `incline`. Bike games request `grade`
  (simulation mode) or `power` (ERG mode; wins if both are set). Bike games
  also send `speed` = their computed virtual speed so the server can
  integrate distance.
- `x`, `y`, `z` are fictional meters, `y` up. The console draws a map and a
  profile from them.
- `achievements` is a list of your own ids; the server prefixes them with
  your game id, stores first-earned time, and ignores repeats and debug
  sessions.

## What to drive

Most treadmill games should declare `"controls": {"treadmill": "incline"}`
and **never send `speed`**: the user picks the belt speed on the machine
(easier, safer, and fit people can go faster). Read `speed.actual` and drive
your world from it. A read-only game declares `"none"` and sends no targets
at all. Only declare `"speed+incline"` if the game truly needs to command
the belt (intervals, a pace-setter). Bike games normally drive `grade`
(simulation) or `power` (ERG). The user's limits apply to what you request,
never to what the machine reports: an actual speed above their limit is
their choice.

## Prompts (user input)

Prompts are one-shot choices ("Left", "Right", "Use turbo") or persistent
buttons ("Upshift", "Downshift"); never text or continuous input.

- Include `requestedInput: {"promptId": "p7", "prompt": "Which way?",
  "choices": ["Left", "Right"], "timeout": 10, "persistent": false}` in
  every `setstate` while the prompt is open (level-triggered).
- Always render the same buttons yourself. When the user taps one in your
  UI, `POST /gameapi/answerinput {"sessionId", "promptId", "choice"}`.
- A phone bridge shows the same buttons; its answers arrive in
  `getstate.input` as `{"promptId", "choice", "t", "source"}`. Treat a new
  `t` as a new answer.
- One-shot prompts close on the first answer from either side. Persistent
  prompts stay until you stop sending them; every tap is delivered.
- **D-pad:** add `"layout": "dpad"` and name the buttons you want in
  `choices` (any of `up`, `down`, `left`, `right`, `select`, `back`); the
  bridge draws a cross. Because taps can arrive faster than you poll, read
  `getstate.inputs` (the last 32 answers, each with a rising `n`) and
  handle every entry with `n` greater than the last one you processed.
- **Menu:** `"layout": "menu"` sends your whole choice list, so a phone can show it as big buttons. Menus are
  always persistent. The fields:
  - `items`: 1–100 of `{id, label (≤ 40 chars), hint?, disabled?}`;
  - `highlight`: the item your screen has highlighted;
  - `back`: the item Back picks;
  - `countdown`: seconds until the list picks by itself, or null;
  - `rev`: bump it whenever the list changes, not when only the highlight moves;
  - `choices`: the d-pad buttons to show beside the list (any of the six, or none).

  Answers:
  - A tap on an item answers with its id, and a d-pad button with the button name.
  - Every answer carries the `rev` the phone was showing. Drop an item tap, Select or Back aimed at an older `rev`;
    directions always pass.
  - Item ids may not be d-pad button names: the server rejects such a menu.
  - The server logs a menu in full only when its `rev` changes.

  gamekit's `menuPrompt()` builds a menu (sending an id like `back` as `item:back`), and `readMenuAnswer()` and
  `isStaleAnswer()` read the answers. When the highlight moves, push a tick (`client.requestTick()`, bursts up to
  10 Hz) so the phone follows.

## Paused

The server pauses a running session when no exercise-device data has
arrived for 5 s (bridge tab asleep, device off, device sending nothing)
or when the user presses Pause on a bridge. `getstate` then returns
`sessionStatus: "paused"` and `pause: {reason, message, seconds, ...}`.
While paused:

- keep calling `getstate` and `setstate` at 1 Hz (setstate returns
  `sessionStatus: "paused"`, not an error);
- freeze your simulation, position and countdown; do not integrate the gap;
- if you control the belt, request treadmill `speed: 0` (otherwise leave
  `speed` out as always); bikes request `grade: 0`, so a reconnecting device
  starts still and ramps up after the session is `active` again;
- show `pause.message` as-is; it is written for the user and already names
  the fix (including "Press Play" for a user pause), so add no hint of your own;
- drive any countdown from `activeSeconds` (wall-clock `elapsed` includes pauses).

If the page is reloaded while paused, call `startsession` with the same
`sessionId` again; it rejoins.

The session resumes by itself; just continue when `sessionStatus` is
`active` again. `pausedSeconds` tells you how long it was paused in total.

**Your own Pause.** `POST /gameapi/pause {"sessionId", "paused": true | false}` (gamekit
`SessionClient.setPaused()`) is the same as a bridge's ⏸ and ▶, so a break in your menus isn't counted as exercise.
- The session becomes `paused` with `pause.reason: "user"`, `bridgeId: null`, and the message "Paused in the game.
  Resume there, or press Play."
- Either side can lift the other's pause, so treat a Play from a bridge as the player choosing Resume.
- On a game with automatic pauses, resuming still waits for device data.

## Effort

Some games pace their world by how hard the player works against their own fitness, rather than by raw watts or
belt speed. Kingdom Trek does. gamekit's `effort.ts` gives every such game the same numbers:
`effort = live ÷ steady`, which is 1.0 at the player's comfortable steady pace on any machine.

What follows is the reference. **[EFFORT.md](EFFORT.md) is the long version**: what the numbers mean, how to
map effort onto your own game, what every game on the platform does with it, and the fallback that will drive
your game from a heart-rate strap if you let it.

**What it reads:**
- measured power, on any machine but a treadmill;
- on a treadmill, speed and incline as bike-equivalent watts (`treadmillWatts()`): the ACSM oxygen cost × 20.9 J/ml
  × 0.24, with walking and running blended over 1.6–2.2 m/s;
- heart-rate reserve;
- cadence ÷ 80, as a last resort.

**The preferences it uses.**
- Global preferences (`start.preferences.global`):
  - `steadyWatts` (W);
  - `steadyPace` `{speed (m/s), incline (%)}` for treadmills;
  - `ftp`: steady defaults to 0.65 × FTP;
  - `restingHr`, `steadyHr`, `maxHr` and `hrZones`.
- Device preferences (`start.preferences.device`, kept current in `getstate.devicePreferences`) may override
  `steadyWatts` and `steadyPace` for one machine.
- With nothing set, steady is 130 W.

**The meter.** Create it with `new EffortMeter({deviceType, prefer, bodyData, preferences})`, call
`meter.update(getstate, seconds)` on every poll, and read `meter.value(seconds)`. It:
- holds a reading between polls and smooths it;
- caps it at 3×;
- drops to 0 after 3 s without data;
- falls back to another source when the chosen one reads nothing, and says so in `readout().note`;
- ignores heart rate while the machine says the player has stopped.

`describeEffort()` and `describeSteady()` give a HUD its words, such as "140 W · 108%".

## Preferences and save state

| Call | Keyed by |
|---|---|
| `GET /gameapi/preferences?game=` / `PUT /gameapi/putpreferences` | game (shared across variants) |
| `GET /gameapi/getsave?game=&variant=` / `PUT /gameapi/putsave` | game + variant |

## History and ghosts

The console's History screen shows one picture per session: **send one**.
At the end of a session (just before or after `endsession`, within 10
minutes) call `PUT /gameapi/sessions/<id>/image` with
`{"image": "<PNG or JPEG data URL>"}` (or a raw `image/png` body), at most
1 MB, ideally 640×360. A route map, the player's inventory, a final
screenshot: anything the user will recognise. Without it History falls
back to your variant's `screenshot`. The mock game renders its route map
on a canvas and uploads `canvas.toDataURL('image/png')`.

`GET /gameapi/sessions?game=&variant=&route=&scope=me|public` lists past
sessions; `GET /gameapi/sessions/<id>/timeline` returns 1 Hz merged rows
(`elapsed`, all nine metrics, `position`, `distance`) to replay as a ghost.

## Rules of thumb

- Deterministic from `seed` + variant so ghosts and leaderboards compare.
- Read `unitSystem` before displaying speeds or distances.
- Poll at 1 Hz; you may push faster briefly (max 10 Hz).
- Never assume which page hosts you; never use `postMessage` to the parent.
