# Night Racer on Dandyhorse

What it takes to run Night Racer on the exercise platform (Dandyhorse, `~/dandyhorse`). This covers only the
points where the two meet. The game's own rules are in [README.md](README.md), and the platform's contract for
games is `dandyhorse/docs/GAME_AUTHORING.md` (the tutorial is `docs/GAME_DEVELOPER_GUIDE.md`).

This is built. The game lives at `dandyhorse/games/nightracer`, and the platform side is `src/platform.ts`: it
implements the `Controls` interface from `src/controls.ts` on top of gamekit's `SessionClient`, and everything it
sends comes from `__game.snapshot()` (`src/main.ts`). What follows describes what was built; §4's treadmill
choice and §9's suggestions are still open.

## 1. The shape of it

```
machine ─► bridge ─► server ─► getstate (1 Hz) ─► DandyhorseControls.pedal()  = 50 × EffortMeter
phone taps ─► server ─► getstate.inputs ─► DandyhorseControls.takePresses() ─► Turbo / Oil
game ─► setstate (1 Hz): grade or incline, position, score, custom ─► History, the trainer, the treadmill
```

- The game becomes `games/nightracer`: a static Vite build with `base: '/games/nightracer/'` and the dev proxy
  from `games/bikeplane/vite.config.ts`. Babylon is already bundled from npm, so it needs no internet (Rolling
  Hills and Flight Cycle still load it from the CDN).
- One new file, `src/platform.ts`, implements `Controls` on top of gamekit's `SessionClient`. `main.ts` picks
  it when `?session=` is in the URL and keeps `LocalControls` otherwise (standalone, keyboard, slider).
- `main.ts` starts the session before building anything: the seed, duration and difficulty come from
  `startsession`.
- The game plays the same on a bike and on a treadmill. The machine only changes how effort is worked out,
  and what the game asks the machine to do (§4).

## 2. metadata.json

A draft is in [platform/metadata.json](platform/metadata.json):
- **Variants:** a bike variant (`controls: {bike: "grade"}`) and a treadmill variant
  (`controls: {treadmill: "none"}`; see §4 for why not incline).
- **Launch options:**
  - `difficulty` (easy / normal / hard, `Config.DIFFICULTY`);
  - `hills` (whether the trainer feels the road).
- **Capabilities:** `seed: true`, so the same seed gives the same run of tracks, and those sessions are
  comparable. `input: true` for the buttons. `saveState: true` for wins and best points. `autoPause` stays on:
  a racing game should freeze when the machine stops.
- **Achievements:** listed in §7.

## 3. Effort → pedal

`Controls.pedal()` is 0–100, where 50 is the player's steady pace, the same scale Flight Cycle uses:

```ts
pedal = () => this.latest ? Math.min(100, 50 * this.meter.value(seconds())) : null
```

- `EffortMeter` from gamekit handles both machines: bike power ÷ steady watts, or treadmill speed and incline as
  watts ÷ steady. It also handles holds, smoothing, the 3 s drop to zero, and the heart-rate fallback.
- Keep its default smoothing. The car already has inertia (`Config.ACCEL`/`DECEL`), and unlike Flight Cycle
  there are no rings that punish lag.
- `null` (no reading yet) makes the game hold the last pedal. It never becomes 0.
- The car's speed is `CRUISE × effort^0.55` (`speedFor` in `src/sim/car.ts`). A walker at their steady pace and a
  runner at theirs both drive at 150 km/h, so both can win. `npm run balance` shows how pace and buttons turn
  into places.

## 4. What the game asks of the machine

The road has real hills: 25–45 m of relief per lap and grades up to 10%. At race speed, though, a hill passes in
5–15 s.
- **Bike (sim mode):** send `grade` = the road grade under the car × 0.5, smoothed over ~2 s, clamped to
  0–6%. Trainers follow that fast enough to feel each climb. Don't mirror descents below 0; freewheeling on a
  trainer feels wrong. `track.poseAt(dist).grade` gives the raw value, and `snapshot().grade` exposes it.
- **Treadmill:** an incline motor needs 10–30 s to move a few percent, so it can't follow these hills. Two
  options, and the choice is yours:
  1. `controls: {treadmill: "none"}` (the draft): the treadmill is read-only and the hills are only on screen.
  2. `incline` from `track.gradeAhead(dist, 400)`, the average over the next ~10 s of road, × 0.6, clamped to
     0–5%. The treadmill then roughly follows each lap's big climbs.
  - Either way the game never sends `speed` to a treadmill. The belt is the player's.
- Because `EffortMeter` counts incline, a treadmill uphill at the same belt speed reads as more effort. That
  cancels the game's own uphill slowdown (`Config.HILL_EFFECT`), which is fine.

## 5. Buttons on the phone

- **While racing and during the countdown:** a persistent prompt
  `persistentPrompt('items', 'Items', ['🚀 Turbo', '🛢 Oil'])`. Every tap arrives in `onInput`, and
  `takePresses()` hands them out in order. The on-screen buttons call `client.answer(...)`, so they behave
  exactly like a phone tap. This is the platform rule that every prompt has the same buttons on screen.
- **Phone lag:** a tap reaches the game 0.3–1 s after the finger. The timing windows are sized for that:
  - the rocket start accepts a tap from 1.6 s before GO to 0.8 s after;
  - the Oil button lights up while a rival is 5–45 m behind on your line. At race speed that's about a second
    of margin, and a rival closer than 13 m can't dodge.

  `InputAnswer.t` could later move a tap back to when it was made.
- **Between races and after the flag:** close the prompt. The buttons have nothing to do then.
- **Paused:** a menu like Flight Cycle's, with ▶ Keep racing and 🏁 End workout.
  - `Controls.paused()` = `client.paused`;
  - `togglePause()` = `client.setPaused(...)`.
- A future third button could go in the same prompt; the phone has room for three.

## 6. Clock, pauses, the end

- **Clock:** call `series.useClock(() => platform.activeSeconds())`, which already exists, so races fit the
  active time and pauses don't count. The workout length is `start.requestedDuration`.
- **Pauses:** the world freezes while `paused()` is true. `main.ts` already skips the simulation and holds
  the camera.
- **The end:** when `series.phase === 'over'`, show the final standings for a few seconds, then
  `client.end('complete')`.
  - If the session ends from a bridge (`onEnded`), call `series.finishNow()`, which shows the standings, and
    stop.
  - "End workout" from the pause menu does the same.

## 7. What the game sends each second

From `snapshot()`:
- **`x, y, z`:** the car's position, for the session map. y is the road height, so the profile shows the
  hills.
- **`score`:** championship points.
- **`route`:** `nightracer-<seed>`. Sessions with the same seed raced the same tracks.
- **`custom`:** `{race, track, lap, laps, place, turbo, oil, spinOuts}`.
- **Not `speed`:** the car's 150 km/h would put 75 km into History for a 30-minute ride. Leave `speed` out so
  the server integrates the machine's own speed (treadmill), or send the bike's usual virtual speed (bike).
- **Achievements** (game-scoped ids, none in debug sessions):
  - `first-win`: won a race;
  - `champion`: led the standings at the end of a workout;
  - `rocket`: got a rocket start;
  - `oil-slick`: spun out two rivals in one race;
  - `hat-trick`: won three races in a row;
  - `full-workout`: raced to the end of the chosen time.
- **Save state:** total wins, best championship points per workout length, and the last seed.
- **Session image:** the final standings card drawn over the last frame. The engine already has
  `preserveDrawingBuffer: true`.

## 8. Units

The HUD speed is km/h today. On the platform, format it with `units.speed(ms, start.unitSystem)`. The car's
speed is not a real speed, but mph readers still expect mph.

## 9. Suggested platform changes

- A **`buttons` prompt style**: two or three big coloured buttons with an icon and a charge ring, driven by
  `setstate` (e.g. `{id, label, icon, charge: 0..1, hot: bool}`). The phone could then show the same "ready" and
  "NOW!" states the screen shows. Today a persistent prompt shows plain labels.
- **Tap timestamps adjusted for clock skew** in `InputAnswer.t`, so a game can undo the phone's lag.
