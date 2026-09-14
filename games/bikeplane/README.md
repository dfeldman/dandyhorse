# Flight Cycle (codename bikeplane)

A 3D biplane game (BabylonJS) for a bike trainer. The plane flies on rails in a loop over a generated island city,
and your power is the only control: your steady pace holds it level, harder climbs, easier dives. There is no
steering. Fly through the rings for points.

The prototype was called Sky Rings. Its rings were too close together for anyone to fly through with the lag
between the pedals and the plane; [PLAYABILITY.md](PLAYABILITY.md) works out that lag and what changed.

## Play

- **Rings**: gold 100 points, red 300 (a smaller window), plus a growing streak bonus. There are 14 a lap, about
  15 s apart, and each moves to a new height after you pass it, so laps never repeat.
- **The cue** (▲ pedal faster, ● hold it, ▼ ease off) and the ghost plane on the altitude bar look 3 s ahead:
  follow them and you ease off in time.
- **Between rings**, on the line from one to the next:
  - **stars** bank a pass (up to 3) that forgives a missed ring;
  - **balloons** lift the plane toward the next ring for 10 s;
  - **Tailwinds** make the pedals lighter for 20 s (they stack), and your power counts for more while they
    last.
- **Turbo**: ring hits fill a 6-segment meter (red rings +2, stars +1, a miss halves it). A full meter gives 15 s
  of 2× points, +15% speed, a wider view and a flame trail. Each ring hit also adds a small speed pulse.
- **Pylon races** on lap 2 and every other lap after it: three rivals (Baron von Turnip, Goldie Gears, Captain
  Cumulus), one lap, 1000/500/250/100 points.
- The plane takes off when you start pedalling. The workout lasts as long as you chose in the console, 30
  minutes by default. The end screen shows score, rings, laps, distance and your best.

## On Dandyhorse

Launch it from the console (Games → Flight Cycle); it needs a bike. `src/` is the adapter:
- **Effort**: the pedal is 50 × power ÷ steady power (Preferences → Fitness; 130 W by default), from gamekit's
  EffortMeter with its smoothing off.
- **The trainer** is in sim mode (`controls: {bike: grade}`): 1% while cruising, less with each Tailwind, flat
  on the runway (`src/drive.ts`).
- **Pauses**: the world holds still while the session is paused, and the workout counts down on active time.
- **Each second** the game sends:
  - the plane's speed, so History's distance is the flight;
  - its position, with its height as y, for the session map and profile;
  - the score;
  - `custom`, with the rings hit and passed.
- **At the end**: a session picture, the best score in save state, and achievements (`turbo`, `race-win`,
  `streak-lap`, `workout-complete`; not in debug sessions).

## Run

```bash
npm install
npm run dev          # http://localhost:5177/games/bikeplane/ (sessions need `make serve` on :8080)
npm test             # the adapter's arithmetic, and a playability check
npm run playability  # the lag simulation behind PLAYABILITY.md: node tools/playability.ts [1|2|3|4]
```

Opened on its own, the game offers a debug session (it needs a bike, or the bridge's simulated one) or practice
with the keyboard, which records nothing. `?practice` goes straight to practice; `?practice&pedal=60` also holds
the pedal at 60, for screenshots.

## Controls in practice

- Drag the **PEDAL** slider, or hold **↑/↓** (or W/S). 50 is level flight.
- **M** toggles sound. **R** flies again after the end screen.

## Layout

- `public/js/`: the game, classic scripts loaded in order by `src/main.ts`:
  - `config.js`: every tunable; `levels.js`: level definitions (overrides, mechanics, hooks);
  - `input.js`: the pedal, from the platform's effort or the practice harness;
  - `track.js`: the rail, a runway and a waving loop, `poseAt(s)`;
  - `plane.js`: the biplane and its flight model (pitch drives climb);
  - `world.js`: island, city, water, sky; `rings.js`: rings and pickups; `rivals.js`: the race;
  - `hud.js`: the DOM overlay; `sfx.js`: WebAudio; `main.js`: engine, camera, loop, `FlightCycle.boot(platform)`.
- `src/`: the Dandyhorse adapter: `main.ts` (boot), `platform.ts` (session, effort, ticks), `drive.ts` (pure
  arithmetic), `globals.d.ts` (the contract with the scripts).
- `tools/playability.ts`: the simulation; `PLAYABILITY.md`: what it found.

Debug hooks in the console: `window.setPedalInput(v)`, `window.__debug` (`.state`, `.score`, `.timeScale`,
`.fps()`).

## Scenery

A warped polar street network (wobbly ring boulevards, curving radial avenues, sidewalks, crosswalks,
streetlamps), buildings aligned to face the streets in four district bands (downtown core with
setback/L-shaped/cylinder towers and roof clutter; midtown with awnings; mixed; suburbs with houses, gardens,
sheds), muted realistic palette, urban pavement ground, streetlamps, crosswalks, curbside and lot parking with
parked cars, six moving vehicle types, kiosk/fountain plazas; an elevated monorail loop plus a park train; a
fairground (Ferris wheel, spinning carousel, drop tower, mini coaster, flags); landmarks — snow-capped volcano
headland, stadium, clock tower, lighthouse, smoking factory port, coastal wind farm, marina, farmland; ocean life
— translucent water with sandy shallows, palm islets, a surfacing whale, cargo ship, ferry, motorboats with
wakes, cruising sailboats, buoys, blimp, hot-air balloons, bird flocks, AI planes. Also: one clustered downtown
skyline (CBD at bearing ~2.4), rolling city ground, city parks with ponds, a scenic railway loop with stations,
an industrial harbor with crane and containers, a beach cove with umbrellas, and gable-roofed suburbs. Window
textures are 4x4 atlases sampled at random offsets per building so facades vary.

Design note: the chase camera looks along the track tangent (plus a small inward bias), so anything near the
island center is always ~80° off-screen. Scenery meant to be SEEN must sit near or outside the flight circle.

The page pauses when its tab is hidden (requestAnimationFrame), which is normal for browser games; on Dandyhorse
the workout still counts down on the session's active time.
