# Night Watch on Dandyhorse

This is what it takes to run Night Watch on the exercise platform (Dandyhorse, `~/dandyhorse`). It covers only
the points where the two meet. The game's own rules are in [README.md](README.md). The platform's contract for
games is `dandyhorse/docs/GAME_AUTHORING.md`, and the tutorial is `docs/GAME_DEVELOPER_GUIDE.md`.

Nothing here is built yet. As with Night Racer, the platform work comes down to one new file:
- every input goes through the `Controls` interface in `src/controls.ts`;
- everything the platform would want to read is in `Night.snapshot()` (`src/sim/night.ts`), exposed as
  `__game.snapshot()`.

## 1. The shape of it

```
machine ─► bridge ─► server ─► getstate (1 Hz) ─► DandyhorseControls.pedal()  = 50 × EffortMeter
phone taps ─► server ─► getstate.inputs ─► DandyhorseControls.takePresses() ─► Horn
game ─► setstate (1 Hz): incline/grade (optional, §4), score, custom ─► History, the machine
```

- **Location:** the game becomes `games/nightwatch`, a static Vite build with `base: '/games/nightwatch/'`
  and the dev proxy from `games/bikeplane/vite.config.ts`. Babylon is bundled from npm, so it needs no
  internet.
- **The adapter:** one new file, `src/platform.ts`, implements `Controls` on top of gamekit's
  `SessionClient`. `main.ts` uses it when `?session=` is in the URL, and keeps `LocalControls` otherwise.
- **Start first:** `main.ts` starts the session before building the night. The seed, duration, difficulty and
  weather come from `startsession`. The timetable is generated from `(seed, duration)`, so a 20-minute and a
  45-minute session get different nights, and both end at dawn.

## 2. metadata.json

A draft is in [platform/metadata.json](platform/metadata.json).
- **Variants:** a bike variant and a treadmill variant. Both are read-only in the draft; see §4 for the choice.
- **Launch options:**
  - `difficulty`: easy / normal / hard, `Config.DIFFICULTY`. Hard also sends convoys late in the night.
  - `weather`: calm / mixed / wild.
- **Capabilities:**
  - `seed: true`: the same seed and length give the same timetable and weather, so those sessions are
    comparable.
  - `input: true` for the horn.
  - `saveState: true` for best scores and the tutorial hints already seen.
- **Auto-pause:** keep `autoPause` on. A lamp game has to freeze when the machine stops. The lamp holds its
  light while paused.

## 3. Effort → pedal

`Controls.pedal()` is 0–100, where 50 is the player's steady pace. This is the same scale Night Racer and
Flight Cycle use:

```ts
pedal = () => this.latest ? Math.min(100, 50 * this.meter.value(seconds())) : null
```

- **EffortMeter:** gamekit's `EffortMeter` covers bike power, treadmill speed + incline, holds, the 3 s drop to
  zero, and the heart-rate fallback.
- **Smoothing:** keep its default smoothing. The game adds its own inertia on top:
  - the lamp's flywheel (`FLY_UP` 0.9 s, `FLY_DOWN` 1.8 s);
  - a ship's drift follows the light with a 2.2 s lag (`DRIFT_TAU`).

  A test pins the rule "a two-second stop mid-channel doesn't cost a star"
  (`tests/night.test.ts`).
- **No reading yet:** `null` makes the lamp hold the last pedal. It never becomes 0.
- **What "need" means:** a ship's need is in the same units.
  - Level 2 is 50: the player's steady pace.
  - Level 3 is 57 and level 4 is 64, i.e. 14% and 28% over steady.
  - Level 1 is 40.
  - Weather adds 1–4.

  The platform's per-user steady watts (or steady treadmill effort) therefore sets how hard the night is. The
  game needs nothing else from the user's fitness.

## 4. What the game asks of the machine

**This is yours to decide.** The draft is read-only, and each option below is small once chosen.

The timetable is an interval workout: watches of 42–150 s at a known need, a rest after each, and a 12 s
warning before each watch starts.

- **Treadmill:**
  1. `controls: {treadmill: "none"}` (the draft). The player sets the pace on the machine, and the board tells
     them when.
  2. `incline` from the board.
     - **During a watch:** `clamp((need − 50) × 0.4, 0, 5)` %.
     - **At rest:** 0–1 %.
     - **Timing:** start 12 s before each watch (the ghost mark's warning), because an incline motor needs
       10–30 s to climb a few percent.
     - **Effect:** `EffortMeter` counts incline, so at a constant belt speed the player's effort rises with
       the hill and the lamp brightens. In effect the machine runs the intervals and the player's job is to
       keep the belt going. That suits walking pads with incline and fits the platform's rule that treadmill
       games drive incline only.
     - **Flat walking pads:** they can't follow, so they would stay on option 1.
  - Either way, the game never sends `speed`. The belt is the player's.
- **Bike:**
  1. `none` (the draft).
  2. `grade` during watches, e.g. `clamp(1 + (need − 50) / 7, 0, 4)` %, ramped over the ghost warning. The
     climb then feels like pulling the lamp's weight. Power still decides the lamp, so this stays fair.
  3. ERG at `need × steady watts` is *not* recommended. It pins power to the target, so the lamp would always
     be exactly right and there's no game left. It could be an "autopilot" option later.
- **What to send:** `snapshot()` has `target` (the current, ramped need) and `next` (the next ship's need and
  seconds until it arrives), which is everything either option needs.

## 5. The horn on the phone

- **While the night runs:** a persistent prompt, `persistentPrompt('horn', 'Horn', ['📯 Horn'])`.
  - Every tap arrives in `onInput`, and `takePresses()` hands them out.
  - The on-screen button calls `client.answer(...)`, so it behaves exactly like a phone tap. This is the
    platform rule that every prompt has the same buttons on screen.
- **Phone lag:** a tap arrives 0.3–1 s after the finger. The game is sized for that:
  - **Hails:** a hail stays open for 7 s.
  - **Blasts:** a blast only spends steam when a ship has drifted. An early or late tap wastes nothing.
  - **Double taps:** taps within 1.2 s of a blast are ignored (`HORN_COOLDOWN`).
  - The balance bots tap 0.9 s late.
- **At dawn:** close the prompt.
- **Paused:** the platform's pause menu. `Controls.paused()` = `client.paused`.
- **The phone could show more:** it would help if it showed the horn's state. See §9.

## 6. Clock, pauses, the end

- **Clock:** `Night.time` advances only while the game runs. Pauses already freeze it, because `main.ts` skips
  the simulation while `paused()`. The workout length is `start.requestedDuration`, which becomes
  `Night.duration`.
- **The end:** when `night.phase === 'done'`:
  - the lamp goes out;
  - fireworks go up if the night went well;
  - the logbook shows.

  After a few seconds, call `client.end('complete')`.
- **Ending early:** if the session ends from a bridge (`onEnded`) or from the pause menu's "End workout",
  show the logbook as it stands. That needs a `Night.finishNow()` that emits `done`; it doesn't exist yet
  and is a few lines.

## 7. What the game sends each second

From `snapshot()`:
- **`score`:** points. That is 100 per star, plus hail answers (50 each), plus the three-star streak bonus.
- **`route`:** `nightwatch-<seed>-<minutes>`. Sessions with the same route watched the same timetable.
- **`custom`:** `{clock, stars, starsMax, shipsHome, shipsAground, weather, target, watching}`.
- **Not `speed`:** leave it out, so the server integrates the machine's own speed.
- **Achievements** (game-scoped ids, none in debug sessions):
  - `safe-harbour`: brought a ship home with three stars;
  - `perfect-night`: every ship home with three stars;
  - `big-one`: the ocean liner home with three stars;
  - `storm-keeper`: three stars for a ship that met a storm;
  - `all-hands`: answered every hail in a night (at least three);
  - `steady-hand`: a whole night without the horn, and nothing aground;
  - `full-watch`: kept watch until dawn.
- **Save state:**
  - best points per workout length and difficulty (standalone uses localStorage
    `nightwatch.best.<minutes>.<difficulty>`);
  - the tutorial hints already seen (`nightwatch.hints`).
- **Session image:** the logbook's totals over the dawn harbour. The engine already has
  `preserveDrawingBuffer: true`.

## 8. Things that need no work

- **Units:** the game shows no speeds or distances, only pace against a target, so there is nothing to format.
- **Difficulty:** it scales how far needs sit above the rest pace, not the steady pace itself, so a platform
  fitness factor and the difficulty option don't fight.

## 9. Suggested platform changes

- **A `buttons` prompt style:** one big button with an icon, a charge ring (0–3 steam) and a "hot" state,
  driven by `setstate`. The phone could then show NOW! (a ship is drifting) and ANSWER! (a hail) the way the
  screen does. Night Racer wants the same thing.
- **A "next effort" hint in `setstate`:** for example `{nextTarget, inSeconds}`. A bridge on the machine could
  then show "get ready" even when the TV is out of sight. This is also what an incline or grade controller
  would schedule from.
