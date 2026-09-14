# Sky Rings — Bike Plane

A browser 3D prototype (BabylonJS) for a bike-trainer-driven game. A propeller
biplane flies on rails in a circle over a procedurally generated island city.
The only input is pedaling effort 0–100:

- **50 = level flight.** Faster pedaling pitches the nose up and climbs;
  slower pitches down and descends. There is no steering.
- Fly through rings for points: gold = 100, rare small red = 300, plus a
  growing streak bonus. 25 rings per lap (~3.5 minutes at cruise); each ring
  regenerates at a new altitude after you pass it, so laps never repeat.
- Between rings: **stars** bank a pass (max 3) that forgives a missed ring
  and keeps your streak; **balloons** give 10 s of extra lift; **tailwind
  swirls** ease trainer resistance 10% for 20 s (stackable). During races a
  little cloud marshal waves a checkered flag ahead of the plane.
- A workout lasts **30 minutes** (Config.WORKOUT_SECONDS); an end screen
  shows score, rings, laps, and distance. R restarts.
- The plane takes off from a runway when you start pedaling (> 20).
- Scenery: a warped polar street network (wobbly ring boulevards, curving
  radial avenues, sidewalks, crosswalks, streetlamps), buildings aligned to face the streets
  in four district bands (downtown core with setback/L-shaped/cylinder
  towers and roof clutter; midtown with awnings; mixed; suburbs with houses,
  gardens, sheds), muted realistic palette, urban pavement ground,
  streetlamps, crosswalks, curbside and lot parking with parked cars, six
  moving vehicle types, kiosk/fountain plazas; an elevated monorail loop
  plus a park train; a fairground (Ferris wheel, spinning carousel, drop
  tower, mini coaster, flags); landmarks — snow-capped volcano headland,
  stadium, clock tower, lighthouse, smoking factory port, coastal wind farm,
  marina, farmland; ocean life — translucent water with sandy shallows,
  palm islets, a surfacing whale, cargo ship, ferry, motorboats with wakes,
  cruising sailboats, buoys, blimp, hot-air balloons, bird flocks, AI planes.
  Also: one clustered downtown skyline (CBD at bearing ~2.4), rolling city
  ground, city parks with ponds, a scenic railway loop with stations, an
  industrial harbor with crane and containers, a beach cove with umbrellas,
  and gable-roofed suburbs. Window textures are 4x4 atlases sampled at
  random offsets per building so facades vary.

Design note: the chase camera looks along the track tangent (plus a small
inward bias), so anything near the island center is always ~80° off-screen.
Scenery meant to be SEEN must sit near or outside the flight circle.

## Run

```bash
python3 -m http.server 8123
```

Then open http://localhost:8123. Any static file server works — there is no
build step.

## Controls (test harness, stands in for the bike trainer)

- Drag the **PEDAL** slider, or hold **↑/↓** (or W/S).
- **M** toggles sound.

## Bike trainer integration points

Input — the trainer calls, at any rate:

```js
window.setPedalInput(v);   // v = 0..100
```

Output — the game computes a target resistance (0–100) every frame and the
trainer subscribes with:

```js
window.onResistanceChange = (r) => { /* set trainer resistance */ };
```

Resistance is a steady base level (`RESIST_BASE`, 45) whose ONLY in-game
modifier is the stackable **Tailwind** pickup: each one eases resistance by
10% for 20 s, and lucky riders can stack several. The current value is always
shown in the bottom-left HUD, and flight instruments (knots / feet / miles)
sit bottom-right. Smoothing (`RESIST_TAU`) keeps trainer commands gentle.
`NEUTRAL_INPUT` (50 = level flight) still needs calibration against the real
trainer.

## Mechanics

- **Turbo**: ring hits fill a 6-segment meter (red rings +2, stars +1; a
  clean miss halves it). Full meter → 15 s of Turbo: 2× points, +35% ground
  speed, wider FOV, and a flame trail. Ring hits also give small decaying
  speed pulses. (Resistance is untouched by Turbo — only Tailwinds ease it.)
- **Pylon races**: on lap 2 (then every few laps), three
  named rivals — Baron von Turnip, Goldie Gears, Captain Cumulus — spawn for
  a 1-lap race on the same rail. They chase the ring line with personal
  sloppiness and rubber-band to the player's pace so finishes stay close.
  Placement pays 1000/500/250/100. A position chip shows P#, gap, and lap.
- **Levels**: `js/levels.js` registers level definitions (Config overrides +
  mechanic toggles + hooks like a custom resistance profile or ring-altitude
  pattern). The game boots `Config.DEFAULT_LEVEL`; future islands plug in
  there.

## Layout

- `js/config.js` — every tunable + derived speed/lap constants
- `js/input.js` — pedal input, filtering, keyboard/slider harness
- `js/track.js` — the rail: runway segment + circle, `poseAt(s)`
- `js/plane.js` — procedural biplane mesh + flight model (pitch drives climb)
- `js/world.js` — island terrain, city, water, clouds, sky, runway
- `js/rings.js` — ring slots, hit detection (track-parameter crossing), regeneration
- `js/hud.js` — DOM overlay: score, altitude bar with next-ring marker, cues
- `js/sfx.js` — WebAudio engine drone + ring chime
- `js/main.js` — engine, chase camera, game loop

Debug hooks in the console: `window.setPedalInput(v)`, `window.__debug`
(`.state`, `.score`, `.timeScale`, `.fps()`).

Note: the page pauses when its tab is hidden (requestAnimationFrame), which
is normal for browser games.
