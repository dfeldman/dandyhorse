# Dandyhorse Game Developer Guide

A Dandyhorse game is a **static web app** that runs on the user's main
screen while they walk, run or ride. The platform gives you a logged-in
user, a live exercise device (treadmill or bike trainer), a heart-rate
monitor if they have one, a phone-sized remote with a d-pad, session
history with a picture per session, preferences, save state, achievements
and leaderboards. You give the platform a folder with `metadata.json` and
an `index.html`, and you talk to one HTTP API.

This guide is the tutorial. The exact wire contract is in
[GAME_AUTHORING.md](GAME_AUTHORING.md) and PLAN.md §6–7; the reference
game is [`games/mockgame`](../games/mockgame), which uses everything below.

## 1. How a game runs

```
console (big screen)  ──launch──▶  server  ◀──putstate/getstate──  bridge (phone on the treadmill)
        │                            ▲
        └── opens the bridge page ───┘   the bridge hosts YOUR GAME in an iframe
                                          and shows the user's prompt buttons / d-pad
```

- The user picks your game in the console. The console opens the **bridge**
  page, which connects the device and then loads your `index.html` inside
  an iframe with `?session=<id>&variant=<id>&seed=<n>&debug=<0|1>`.
- Your game calls `startsession`, then once a second sends `setstate` (what
  you want the machine to do, where the player is, score, prompts) and
  long-polls `getstate` (what the machine actually measures, answers to
  prompts, pauses, the end).
- You never talk to Bluetooth or to the bridge. Everything goes through
  `/gameapi/*` on the same origin; the auth cookie rides along.
- **Games are stateful and live on one screen.** A running game cannot move
  to another device. If the user starts another game, yours is superseded
  and `getstate` reports the end.

## 2. Set up a game in five minutes

```bash
cp -r games/mockgame games/mygame          # or start from scratch: any static site works
cd games/mygame && npm install             # gets @dandyhorse/gamekit (linked from libs/gamekit)
```

Edit `metadata.json`:

```json
{
  "id": "mygame",
  "name": "My Game",
  "version": "0.1.0",
  "entry": "index.html",
  "screenshot": "screenshot.png",
  "capabilities": {"seed": true, "input": true, "saveState": false, "ghosts": false},
  "variants": [
    {"id": "run", "name": "My Game (Run)", "deviceTypes": ["treadmill"],
     "defaultDuration": 1800, "controls": {"treadmill": "incline"}}
  ]
}
```

`id` must equal the folder name. `controls` says what you drive (§5).
Choices the player should make before a ride (a route, a difficulty, a
time of day) go in a top-level `"options"` map of enums; the console
renders them as rows of buttons in its launch dialog and the server hands
you the result, defaults filled in, as `start.options`. Duration is chosen
there too (15/30/45/60 minutes, in `start.requestedDuration`), so a game
can start playing the moment it loads, without a menu of its own:

```json
"options": {"route": {"label": "Route", "enum": ["flat", "rolling", "hilly"], "default": "rolling"}}
```
Build to `dist/` (Vite with `base: '/games/mygame/'`), or ship plain
files; the server serves `games/mygame/dist/` if it exists, else the folder.
Restart the server or press **Rescan games** in the console's Admin tab.
Open `http://localhost:8080/consoles/web/`, log in, and your game is in
the Games tab. While developing, `npm run dev` in your game folder
proxies `/gameapi` to the server (see `vite.config.ts` in the mock game).

## 3. The library: `@dandyhorse/gamekit`

Lives in `libs/gamekit`, TypeScript source, linked with
`"@dandyhorse/gamekit": "file:../../libs/gamekit"` in your `package.json`.
It contains everything that is the same for every game:

| Module | What |
|---|---|
| types | Every API type: `StartPayload`, `GameState`, `Prompt`, `InputAnswer`, `SessionSummary`, … |
| api | One typed function per endpoint: `startSession`, `getState`, `setState`, `answerInput`, `endSession`, `pauseSession`, `putSessionImage`, `getPreferences`, `putPreferences`, `getSave`, `putSave`, `listSessions`, `sessionTimeline`, `me` |
| `SessionClient` | The whole conversation with the server for one session (§4), including your own Pause (`setPaused`) |
| `units` | SI → display: `speed`, `distance`, `pace`, `length`, `mass`, `energy`, `power`, `heartRate`, `clock`, and back |
| inputs | `choicePrompt`, `persistentPrompt`, `dpadPrompt`, `menuPrompt`, `readMenuAnswer`, `isStaleAnswer`, `newInputs` |
| effort | `EffortMeter`, `treadmillWatts`, `steadyWatts`, `steadyHeartRate`, `describeEffort`: effort against the player's steady pace (GAME_AUTHORING.md "Effort") |
| image | `uploadCanvasAsSessionImage` (§8) |

```ts
import { SessionClient, choicePrompt, dpadPrompt, units, uploadCanvasAsSessionImage, startSession } from '@dandyhorse/gamekit'
```

## 4. The session loop with `SessionClient`

```ts
import { SessionClient, startSession, isEnded, type GameState } from '@dandyhorse/gamekit'

const params = new URLSearchParams(location.search)
const sessionId = params.get('session')
// Launched from the console: the id is in the URL. Developing? Make an ad-hoc debug session instead.
const start = await startSession(sessionId
  ? { sessionId, route: 'Loop' }
  : { gameId: 'mygame', variant: 'run', debug: true, route: 'Loop' })

const world = new World(start.seed, start.deviceType)   // your simulation

const client = new SessionClient({
  sessionId: start.sessionId,

  // Called about once a second. Return what to send; the client adds sessionId and timestamp.
  buildTick: () => {
    if (client.paused) world.freeze()
    else world.advance(client.latest)             // drive the world from ACTUAL values (§5)
    return {
      incline: world.inclinePercent,              // what you want from the machine (§5)
      x: world.x, y: world.y, z: world.z,          // where the player is (for the timeline and ghosts)
      score: world.score,
      custom: { lap: world.lap },                 // anything JSON you want logged
      achievements: world.takeNewAchievements(),  // game-scoped ids, each at most once
    }
  },

  onState: (s: GameState) => hud.update(s),      // every getstate: s.speed.actual, s.heartRate.actual, s.distance, …
  onInput: (a) => world.onButton(a.choice),      // every prompt answer, once, in order (bridge or your own buttons)
  onPause: (p) => hud.showPaused(p.message),     // the message is written for the user: show it as-is
  onResume: () => hud.hidePaused(),
  onEnded: (e) => hud.showEnded(e),              // complete | discarded | deleted, from any side
  onError: (ctx, err) => console.warn(ctx, err), // the client keeps going; you just get told
  sessionImage: () => world.renderSessionImage(), // a data URL for History (§8)
})
client.start()

// Your own on-screen buttons answer the open prompt the same way a bridge does:
button.onclick = () => client.answer('Left')

// When the ride is over:
await client.end('complete')       // uploads the session image, then endsession → onEnded
```

What the client does so you do not have to: long-polls with `since`/`wait`,
never sends two `setstate`s at once, re-sends right away after a pause
change or a new prompt (`client.requestTick()`), delivers every answer
exactly once even when the phone taps faster than you poll (the `inputs`
ring with a rising `n`), skips answers that predate a page reload, expires
one-shot prompts by their `timeout`, and detects the end from either side.

**Pauses.** The server pauses the session after ~5 s without exercise-device
data (bridge asleep, device off, wrong device) or when the user presses
Pause on a bridge, and resumes it by itself when data flows again (or the
user presses Play). While paused: freeze your world, do not integrate the
gap, keep calling ticks (the client does), and show `pause.message`. Drive
countdowns from `activeSeconds`, not wall-clock `elapsed`.

A game with its own Pause screen calls `client.setPaused(true)` when it
opens and `client.setPaused(false)` when it closes, so a break isn't counted
as exercise. A Play pressed on a bridge ends that pause too: treat it as the
player choosing Resume. A game where standing still is part of play declares
`"capabilities": {"autoPause": false}` and is never paused for missing
device data (GAME_AUTHORING.md).

## 5. What to drive, and what to read

**Read `actual`, never what you requested.** `getstate` gives every
metric as `{requested, commanded, actual}`. The belt speed the user chose,
the watts the trainer measured, the heart rate: those are `actual`. A
treadmill user may run faster or slower than any plan; that is theirs.

**Treadmill games usually drive only the incline.** Send `incline`
(percent) and nothing for `speed`; declare `controls: {"treadmill":
"incline"}`. The user sets the belt speed on the machine, which is safer
(nobody is run faster than they chose) and fairer (fit people go faster).
Read `speed.actual` and move your world by it. Only declare
`"speed+incline"` and send `speed` (m/s) if the game truly needs to command
the belt. A read-only game declares `"none"` and sends no targets.

**Bike games drive the grade** (simulation mode: `grade` in percent, the
trainer sets resistance so the rider feels the hill) or `power` (ERG: the
trainer holds the watts). Send `speed` too if your world computes a
virtual speed from measured power; the server integrates distance from it.

Units are **SI everywhere** in the API: m, s, m/s, W, J, kg, percent.
Convert only at the screen with `units.*` and the user's `unitSystem`
(`metric` or `us`) from the start payload:

```ts
units.speed(s.speed.actual, start.unitSystem).text   // "9.0 km/h" or "5.6 mph", "—" when null
units.pace(s.speed.actual, start.unitSystem).text    // "5:30 /km"
units.clock(s.activeSeconds)                          // "12:34"
```

`null` means unknown; never treat it as 0.

## 6. Prompts and the d-pad

The phone bridge is the player's controller; it shows your prompt as big
buttons, and the same buttons must exist on your own screen.

```ts
// one-shot: the first answer wins and the prompt closes
client.openPrompt(choicePrompt('p7', 'Which way?', ['Left', 'Right'], 10))
// persistent: stays up, every tap arrives
client.openPrompt(persistentPrompt('gears', 'Gear', ['Downshift', 'Upshift']))
// d-pad: the bridge draws a cross with just these buttons; every tap arrives
client.openPrompt(dpadPrompt('steer', 'Steer', ['left', 'right', 'select']))
client.closePrompt()
```

Answers arrive in `onInput` with `promptId`, `choice`, `t`, `source`
(`game` or `bridge:<id>`). Prompts are for discrete taps while
exercising: no held keys, no text.

A game driven by menus can hand the phone its whole list instead:

```ts
client.prompt = menuPrompt('menu', rev, { title: 'Oakvale', items, highlight, back: 'pause' })
// in onInput:
const a = readMenuAnswer(answer)
if (isStaleAnswer(a, rev)) return            // aimed at a list that has since changed
if (a.kind === 'button') press(a.button)     // the phone's small d-pad
else choose(a.id)                            // a tap on an item
```

- Bump `rev` whenever the list changes, and push a tick when the highlight moves (`client.requestTick()`), so the
  phone follows.
- Kingdom Trek's `src/mirror.ts` is the worked example.

## 7. Preferences, save state, achievements, history

- **Preferences** (`getPreferences` / `putPreferences`, ≤ 64 KB JSON) are
  per game, shared by its variants; declare a `preferencesSchema` in
  `metadata.json` and the console renders an editor. Use them for things
  about the player or the screen (shadows, HUD density); choices about
  *this ride* are launch options (§2). The start payload
  also carries the user's global preferences and body data (weight for
  physics).
- **Save state** (`getSave` / `putSave`, ≤ 256 KB) is per game + variant:
  laps completed, unlocked levels.
- **Achievements**: send game-scoped ids in a tick's `achievements`; the
  server stores `<gameId>:<id>` once per user. Debug sessions never earn.
- **History and ghosts**: `listSessions` and `sessionTimeline` give past
  sessions and their 1 Hz timelines (position, speed, power) for ghosts
  and personal bests. Sessions on the same seed and variant are comparable.
- **Debug sessions** (`debug=1`) are logged and visible in History but
  never count for leaderboards, achievements or totals, and simulators are
  only accepted in them.

## 7a. What your game counted, and somebody to ride against

Two things turn a session into part of a social platform
(PLAN.md §18.2–18.3), and gamekit makes each of them a couple of lines.

**Count what only your game knows**, declare it in `metadata.json`
(`stats` for the end-of-session totals, `progress` for the counters you
send every tick), and leave a line on the player's timeline:

```ts
client.countStats({ deliveries, crashes })       // every tick; merged, sent with the tick and at the end
await client.end('complete', undefined, {
  message: `${deliveries} parcels delivered — and ${crashes} cars found the hard way.`,
})
```

A stat marked `"leaderboard": true` gets a board of its own with no server
code at all. A game that sends no message gets a plain one.

**Ride against somebody** — a real past session by a player a little
stronger than this one:

```ts
const rival = await rivalHud(start.sessionId, {
  imperial: start.unitSystem === 'us',
  plannedSeconds: start.requestedDuration,
  labels: { deliveries: 'Parcels' },
  words: { deliveries: 'delivery' },
  corner: 'top-right',
})
// about once a second:
rival.update(elapsed, { distance, progress: { deliveries } })
// at the end:
const theirs = rival.theirs()   // where they had got to, for your own closing line
rival.remove()
```

`rivalHud` puts a small box on the HUD (who you are racing, their distance
and speed, their counters beside yours, and whether you are in front) and
a voice that calls out the kilometres, the milestones and the moment you
pass them or they pass you. **Nobody is guaranteed**: with no suitable
session it quietly returns the voice alone, and with no `document` at all
(a test, a worker) it returns a no-op. Pass `voiceOnly: true` for a game
with no room for a box.

The pieces are there separately too — `loadCompetitor`,
`CompetitorTracker`, `competitorBox`, `Encouragement`, `banner`,
`getStanding`, `flagOrCode` — if you want to draw it yourself.

## 8. The session image

Every session gets **one picture to remember it by**, shown in History: a
map of the route with the player's path, the inventory at the end of an
adventure, a final screenshot. Render it on a canvas (640×360 is plenty)
and either return a data URL from `sessionImage` (the client uploads it
before `endsession`, and also when the user ends the ride from a bridge or
the session completes from elsewhere) or call
`uploadCanvasAsSessionImage(sessionId, canvas)` yourself, within 10
minutes of the end. PNG or JPEG, ≤ 1 MB.
Without it History shows your variant's screenshot.

## 9. Testing without hardware

- Launch a **debug** session from the console (the checkbox in the launch
  dialog). The bridge then offers a **simulated treadmill / bike / heart
  rate monitor** in its setup wizard, and Developer tools (⋯ menu) give
  sliders for speed, incline, power and heart rate, "device sends no
  data", "user pressed STOP on the machine" and so on.
- Open your game directly (no `?session=`) and call `startSession` in the
  ad-hoc form to get a session without the console.
- Pause conditions worth trying: stop the simulator's data (the session
  pauses after 5 s and your `onPause` fires), press Pause on the bridge,
  close the bridge tab.
- The d-pad: open a `dpadPrompt` and tap the cross on a second bridge tab
  (`/bridges/web/#/join`); rapid taps must all arrive.

## 10. Porting an existing plain-JS game

You do not have to rewrite a game as modules to bring it in. Rolling Hills
(`games/rollinghills`, ported from a BabylonJS prototype of ~2,800 lines of
classic `<script>` globals) is the worked example:

1. **Keep the engine files verbatim** under `public/js/` (Vite copies them
   unprocessed) and reference them as classic scripts. Only the files that
   touch input, output or lifecycle change.
2. **Start the session before the world.** Many games generate their world
   at script-evaluation time from a seed; the seed, route and preferences
   only come back from `startsession`. So the module entry (`src/main.ts`)
   calls `startSession` first, publishes what the scripts need on a global
   (`window.RH_START`), then injects the classic scripts in order with
   `script.async = false`. Never inject twice: a restart is a page reload,
   and `startsession` on a running session is idempotent.
3. **One handle each way.** Top-level `const` in a classic script is not a
   `window` property, so give the game one explicit entry point
   (`window.RollingHills.boot(platform)`) and have it return one handle.
   `platform` is what the game reads every frame: `measured()` (actual
   speed, power, heart rate), `paused()`, `pauseMessage()`,
   `activeSeconds()`, `ended()`, plus `saveBest`, `achievement`, `finish`.
   The handle is what the adapter reads once a second: what to ask the
   machine for, position, distance, and a `sessionImage()`.
4. **Replace the input harness with measured values.** A pedal slider
   becomes `power.actual` (bike) or `speed.actual` (treadmill); `null`
   stays unknown. Delete "creep so the player never stalls": on a platform
   that records distance, that is fabricated mileage.
5. **Output becomes a request.** A 0–100 "resistance" becomes the trail
   grade in percent, sent as `grade` (bike) or `incline` (treadmill). Send
   the true value; the bridge scales and clamps it for the machine. Put the
   treadmill rule in a pure, tested function (`src/drive.ts`).
6. **Clocks.** Countdowns run on `activeSeconds`, not on frame time. Run
   the simulation in wall-clock substeps (≤ 50 ms, catching up ≤ 2 s per
   frame): a throttled tab must not slow the world down relative to the
   machine, or the game and History disagree on distance.
7. **Units, bests, images.** Format speed and distance through
   `units.*` with the user's `unitSystem`; move `localStorage` bests into
   save state (per user, per variant); draw the session image from the last
   frame (`preserveDrawingBuffer: true` on the engine) with your own
   overlay.

## 11. Checklist before you ship

- [ ] `metadata.json` valid (the console's Admin tab lists invalid games)
- [ ] the world moves from `actual` values; `null` never becomes 0
- [ ] treadmill: incline only unless you truly need speed control
- [ ] freezes while paused, shows `pause.message`, countdown from `activeSeconds`
- [ ] stops only on `complete` / `discarded` / `deleted`; a completion from a bridge's End ride shows your finish screen too
- [ ] every prompt has the same buttons on screen
- [ ] units converted with the user's `unitSystem`
- [ ] a session image at the end
- [ ] `endsession` on finish or when the player gives up
