# Lane One on Dandyhorse

What it takes to run Lane One on the exercise platform (Dandyhorse, `~/dandyhorse`). It covers only the
points where the two meet; the console's own rules are in [README.md](README.md). The platform's contract for
games is `dandyhorse/docs/GAME_AUTHORING.md` and the tutorial is `docs/GAME_DEVELOPER_GUIDE.md`.

**Built 2026-10-17.** The platform side is [src/platform.ts](src/platform.ts) (`DandyhorseMachine`), used by
[src/main.ts](src/main.ts) when `?session=` is in the URL (or `?dh=treadmill|bike` for an ad-hoc debug session);
without either the simulator runs as before. `npm run e2e` ([tools/platform-e2e.ts](tools/platform-e2e.ts)) is the
end-to-end check against a local `make serve`: launch, a simulated bridge, the phone's ± buttons, the bridge's
Pause/Play/End, the History picture, and "never a belt speed in `you` mode". Where the build differs from the
plan below: a distance or calorie goal takes the setup screen's middle chip (5 km or 5 mi, or the middle calorie
figure) instead of asking, since a launched session starts hands-free; bests are `{bests: {<device>: …}}` in the
save state; the duplicated `units.ts` and `treadmillWatts` were left in place.

As with Night Racer and Night Watch, the platform work came down to **one new file**, because everything that
touches a machine already goes through one interface:

- every reading and every command goes through `Machine` in [src/machine.ts](src/machine.ts);
- everything the platform would want to send is in `Workout.state()` and `Workout.summary()`
  ([src/workout.ts](src/workout.ts)).

Lane One is the platform's plainest game and its best hardware test: it is the only one that drives every
dial a machine has — belt speed, incline, grade and ERG watts — and shows requested against actual for each.
If a bridge or a device is wrong, this is where you will see it.

## 1. The shape of it

```
machine ─► bridge ─► server ─► getstate (1 Hz) ─► DandyhorseMachine.read()   speed, incline, grade,
                                                                              power, cadence, heartRate
console ─► Workout ─► DandyhorseMachine.command() ─► setstate (1 Hz) ─► bridge ─► machine
phone taps ─► server ─► getstate.inputs ─► the ± buttons
```

- **Location:** the game becomes `games/laneone`, a static Vite build with `base: '/games/laneone/'` and the
  dev proxy from `games/mockgame/vite.config.ts`. There is nothing to bundle but the game itself: no engine,
  no assets, no fonts. The built site is about 60 kB.
- **Screenshot:** `screenshot.png` (gitignored, in the asset bucket like the other games') is the track view at
  1280×720 with a hills programme under way.
- **The adapter:** one new file, `src/platform.ts`, implements `Machine` on top of gamekit's `SessionClient`.
  `main.ts` uses it when `?session=` is in the URL and keeps `SimMachine` otherwise, so the simulator stays
  as the way to develop without hardware.
- **Delete on arrival:** [src/units.ts](src/units.ts) and the `treadmillWatts` half of
  [src/physics.ts](src/physics.ts) are copies of gamekit's; the imports become
  `import { units, treadmillWatts } from '@dandyhorse/gamekit'` and the copies go. The calorie half of
  `physics.ts` stays as a fallback (§6).

### The adapter, in full

```ts
class DandyhorseMachine implements Machine {
  readonly device: DeviceType
  readonly harness = false
  private latest: GameState | null = null
  private asked: Dials = NO_DIALS

  read(): Readings {
    const s = this.latest
    return {
      speed: s?.speed.actual ?? null,
      incline: s?.incline.actual ?? null,
      grade: s?.grade.actual ?? null,
      power: s?.power.actual ?? null,
      cadence: s?.cadence.actual ?? null,
      heartRate: s?.heartRate.actual ?? null,
    }
  }
  command(d: Dials): void { this.asked = d }          // sent on the next buildTick
  paused(): boolean { return this.client.paused }
  setPaused(p: boolean): void { void this.client.setPaused(p) }
  pauseMessage(): string | null { return this.latest?.pause?.message ?? null }
  update(): void {}                                    // the SessionClient has its own clock
  steadyWatts(): number { return steadyWatts(this.start.preferences, this.device, this.weight).watts }
  body(): Body { return bodyFrom(this.start.bodyData) }
  unitSystem(): UnitSystem { return this.start.unitSystem }
  heartRateRange(): { resting: number; max: number } { /* steadyHeartRate() + maxHr, §5 */ }
}
```

The field names in `Readings` and `Dials` were chosen to match the platform's metric names exactly, so this
is a copy rather than a translation. `null` already means "the machine is not saying" on both sides.

**Read `actual`, never `requested`.** The console already does: `Workout.integrate` moves the world by
`read().speed`, and the tiles put the reading beside the request so a machine that is not following is
obvious on screen. That is not decoration — it is the one screen on the platform where you can watch a
bridge's clamping happen.

## 2. Starting

`main.ts` calls `startSession` before building anything, and the start payload supplies what the setup
screen asks for standalone:

| Setup screen | Comes from |
|---|---|
| Machine | `start.deviceType` |
| Programme, level, goal, who drives | `start.options` (§3) |
| Length | `start.requestedDuration` |
| Random's shape | `start.seed` |
| Units | `start.unitSystem` |
| Weight, age, sex (calories) | `start.bodyData` |
| Steady watts (the bike's starting base) | `steadyWatts(start.preferences, …)` from gamekit's `effort.ts` |
| Personal bests | `start.saveState` (§8) |

So the setup screen does not appear at all in a launched session: the console's launch dialog has already
asked everything, and the workout starts as the page loads. It stays for the ad-hoc form
(`startSession({gameId, variant, debug: true})`), which is how you develop, and the mid-workout **Programme…**
button still opens it with `showMachine: false, showLength: false`.

## 3. What the game asks of the machine

This is the part worth reading twice, because Lane One asks for more than any other game on the platform.

**The variant declares the safe thing; a launch option upgrades it.** `metadata.json`
([metadata.json](metadata.json)) uses the feature in GAME_AUTHORING.md where an option
value overrides the variant's `controls`:

```json
"variants": [
  {"id": "treadmill", "controls": {"treadmill": "incline"}},
  {"id": "bike",      "controls": {"bike": "grade"}}
],
"options": {
  "drive": {"label": "Who follows the programme", "enum": ["you", "the machine"], "default": "you",
            "controls": {"the machine": {"treadmill": "speed+incline", "bike": "power"}}}
}
```

| `drive` | Treadmill | Bike |
|---|---|---|
| **you** (default) | `incline` only. The programme's pace is shown as a target you match on the machine; `speed` is never sent. | `grade` only. The programme's watts are shown as a target you hold. |
| **the machine** | `speed` and `incline`. The programme runs itself. | `power` — ERG. The trainer holds the watts. |

- **The default is the platform's own rule** (GAME_AUTHORING.md, "What to drive"): nobody is run faster than
  they chose, and a fit person can go faster than the programme asks. `drive: "you"` is what the console
  should offer first.
- **`targetsFor()` in [src/drive.ts](src/drive.ts) is the whole mapping**, pure and tested
  ([tests/drive.test.ts](tests/drive.test.ts)). The tests that matter on real hardware:
  "never sends a belt speed" in `you` mode, and "stays inside the console's range" in both.
- **ERG turns a hill into watts.** Power wins over grade on the wire, so on a bike in ERG the programme's
  grade becomes `× (1 + grade × 0.06)` on the watts (`Config.GRADE_TO_POWER`). Otherwise the Hills programme
  would do nothing in ERG.
- **A machine with no incline** simply will not follow a hill. Nothing breaks: the incline tile shows the
  request against an actual that does not move, which is the honest thing to show. Worth a line in the
  console's device notes for flat walking pads.
- **The player's limits** (device preferences) apply to what we request; the bridge clamps. The console's own
  `Config.SPEED_RANGE` and friends are good manners on top, not safety.
- **Paused:** `pausedCommand()` already does what the contract asks — a driven belt is asked for `speed: 0`
  with its incline kept, a belt we do not drive is told nothing, and a bike goes to `grade: 0`.

## 4. The launch options

| Option | Values | Notes |
|---|---|---|
| `programme` | manual, steady, hills, intervals, pyramid, random, heartrate | `PROGRAM_IDS`. |
| `level` | easy, normal, hard, very hard | 3, 5, 7, 9 on the console's 1–10. The on-screen **Level ±** still moves it mid-workout. |
| `goal` | the clock runs out, a distance is done, the calories are burnt | With "the clock", the goal is `start.requestedDuration` and nothing else is asked. The other two need a number, which the game asks for on one screen of chips before it starts — the enum cannot carry a distance, and the answer depends on `unitSystem`. |
| `drive` | you, the machine | §3. |

`heartrate` needs a strap. The console should say so; the game falls back to holding the base where it is and
says "no heart-rate strap" in the zone strip, which is the right behaviour but a poor surprise.

## 5. The phone is the console

The bridge draws a persistent prompt's `choices` as big buttons, and the platform rule is that the same
buttons exist on screen. Lane One's on-screen cluster was designed around that set from the start:

```ts
client.openPrompt(persistentPrompt('console', 'Console', ['Speed −', 'Speed +', 'Incline −', 'Incline +']))
// bike:                                                 ['Power −', 'Power +', 'Grade −', 'Grade +']
// bike in ERG:                                          ['Power −', 'Power +']
```

- Each tap is one step, exactly as pressing the on-screen button is: `adjustTarget(dial, ±step)`. The step is
  in the player's display units (0.1 km/h or 0.1 mph, 0.5 %, 5 W), so what the phone does and what the screen
  says agree.
- **Taps arrive in bursts.** `getstate.inputs` carries the last 32 with a rising `n` and `SessionClient`
  hands them over in order, so holding a finger on **Speed +** gives a run of steps rather than one.
- Pause and End are the bridge's own buttons, not ours.
- The one-touch keys (3.0, 5.0, 7.0 …) stay on the screen only: twelve choices is too many for a phone.

Heart rate on the phone: nothing to do. The strap reports through the bridge and arrives as
`heartRate.actual` like any other metric.

## 6. Numbers, clocks and the end

- **Calories.** [src/physics.ts](src/physics.ts) `energyRate()` is a field-for-field copy of the server's
  `_energy_rate` (`servers/api-flask/dandyhorse/sessions/metrics.py`), so the number on screen already
  matches History. On the platform, prefer `getstate.energy` — it is the same formula on better data — and
  keep `energyRate()` for the seconds between polls and for a calorie **goal**, which needs a live number.
- **Distance.** The console integrates `read().speed`, and the server integrates the same thing; a bike sends
  its computed virtual speed so the two agree.
- **Clocks run on active seconds.** `Workout.tick` only advances while the machine says it is not paused, so
  the countdown, the programme, the distance and the calories all stop together. Nothing in the console reads
  wall-clock `elapsed`.
- **Pauses.** `Machine.paused()` is the authority and the game follows it: the server's automatic pause
  freezes the workout and lifting it starts it again, with no state of our own to get stuck in
  ([tests/workout.test.ts](tests/workout.test.ts), "follows a pause the machine reports"). The game's own
  Pause button calls `setPaused(true)` so a break is not counted as exercise, and a **Play** pressed on a
  bridge lifts it, as the contract asks.
- **The end.** `client.end('complete')` when the goal is met, `'discarded'` if the player presses End in the
  first minute and nothing has happened. A completion from a bridge's End arrives through `onEnded` and the
  summary screen shows what there is.
- **The recovery test** (§7) happens *after* the workout but *before* `endsession`, because it is part of the
  session's story and its result belongs in the summary and the picture. It takes a minute of standing still,
  which the server will pause the session for — that is fine and correct; the test has its own clock.

## 7. What it sends each second

From `Workout.state()`:

- **Metrics:** whatever `targetsFor()` returned for this variant and option (§3), and nothing else. Never a
  `speed` in `you` mode; never a `grade` alongside a `power`.
- **`route`:** the programme id (`hills`, `intervals`, …), so History and any leaderboard compare like with
  like. `metadata.json` lists all seven under `capabilities.routes`.
- **`score`:** metres covered. A console has no points and should not invent any.
- **`x`, `y`, `z`:** the position on the track, so the console's map draws the oval:
  `{x: point.x, y: elevation, z: -point.y}` — the track's 2-D `y` is the platform's `z`, and the platform's
  `y` is up, so it carries the metres climbed. A 30-minute workout then draws as an oval with a rising
  elevation profile, which is exactly right.
- **`custom`:** `{programme, level, segment, laps, lapDistance, zone, timeInZone, base, goal, onTarget}` —
  enough to replay the console's own screen from the session log.
- **Achievements:** `Workout.takeAchievements()` returns the ids earned since the last call, each exactly
  once — hand it straight to a tick's `achievements`. The two that can only be known at the end
  (`programme-done`, `good-recovery`) come from `earnAtEnd()`, which the adapter calls before `endsession`.
  All eight ids and their words are in [src/achievements.ts](src/achievements.ts), the same as
  `metadata.json`, so the console's Achievements page lists them as goals before they are earned. Debug
  sessions earn nothing — the server already drops them, so the game need do nothing.
- **The session image:** `sessionImage()` in [src/ui/summary.ts](src/ui/summary.ts) already renders 640×360 —
  the oval, the headline numbers and the programme's name. Hand it to `SessionClient`'s `sessionImage`
  callback and the client uploads it before `endsession`.

## 8. Save state and preferences

- **Save state** (per game + variant) replaces `localStorage` in [src/bests.ts](src/bests.ts) exactly:
  `{lap, distance, calories, climb, workouts, totalDistance}`. The module already has one `load`/`save` pair
  and no other code touches storage, so the change is two function bodies.
  - Keyed by variant means treadmill bests and bike bests stay apart, which is what you want: a lap time on a
    bike is not a lap time on a treadmill.
  - Debug sessions should not write bests. `start.debug` gates the `record()` call.
- **Preferences** (per game, shared by variants): `sound`, `bigNumbers`, `trackLane`. A `preferencesSchema`
  is in the metadata draft, so the console renders the editor. `trackLane` is a small joke that turns out to
  be useful — lane 8 is 407 m and some people will want that.

## 9. What is deliberately not here

- **Ghosts.** A console racing you against your last session would be a different game, and a good one, but
  it is not this one. `capabilities.ghosts` is false.
- **Effort.** Lane One does not use gamekit's `EffortMeter`: it works in the machine's own units because a
  console's whole job is to show you the machine's own units. It does borrow `treadmillWatts` for the METs
  readout and to model the simulator's heart rate. `steadyWatts` is used once, to pick where the bike's base
  starts.
- **`autoPause`.** Left on. A console with a stopped belt has nothing to show.

## 10. Suggested platform changes

- **A stepper prompt style.** Four buttons named "Speed −/+" work, but a bridge that knew it was showing a
  *stepper* could draw a big ± pair with the current value between them, driven from `setstate`. Every
  machine-facing game wants this, and it is the difference between a phone that is a remote and a phone that
  is a console. Night Racer and Night Watch have each asked for a richer button (their notes suggest a charge
  ring and a "hot" state); a small set of prompt layouts — `stepper`, `button`, `dpad`, `menu` — would cover
  all three.
- **A "what the machine can do" block in `getstate`.** The bridge knows whether the treadmill has an incline
  motor, its speed range, and whether the trainer does ERG. Today a game finds out by asking and watching
  what comes back. `getstate.deviceLimits: {speed: [0, 5.5], incline: [0, 12], erg: true}` would let this
  console grey out what a machine cannot do rather than asking for it and showing a target that never
  arrives.
- **Heart-rate zones in preferences.** `hrZones` is already read by `effort.ts`; the zone strip here uses
  50/60/70/80/90 % of maximum because that is the convention, but if the player has set zones the console
  should use theirs. A `maxHr` and `restingHr` in global preferences is all this game needs, and both are
  already defined.
