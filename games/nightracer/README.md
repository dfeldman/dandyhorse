# Night Racer

A cartoon car race through a neon city at night, for exercise equipment. There is **no steering**. Your pace
(pedalling or walking) is the throttle, and you have two buttons, **Turbo** and **Oil**, meant for the phone that
sits on the machine. Three rivals race you over swoopy, hilly city circuits, race after race, for championship
points until the workout is over.

BabylonJS + TypeScript + Vite, no sound yet. It runs on its own today. [INTEGRATION.md](INTEGRATION.md) is the
plan for the Dandyhorse platform.

## Run

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # track rules, speed, lanes, Turbo, Oil, the series (vitest)
npm run balance    # race many seeds headless: how pace and buttons turn into places
npm run build      # static site in dist/
```

URL options: `?seed=123` (the same tracks every time), `?minutes=30`, `?laps=1`, `?difficulty=easy|normal|hard`,
`?pedal=55` (hold the pedal and hide the slider, for screenshots).

## Controls (standalone)

| | |
|---|---|
| ↑ / ↓ (W / S), the slider, or 1–9 | pedal (50 = your steady pace) |
| Space or T, or tap 🚀 | Turbo |
| O or X, or tap 🛢️ | Oil |
| P or Esc | pause |

`window.setPedalInput(v)` sets the pedal from the console, as in the other games.

## How a race plays

- **Speed:** your pedal sets the car's speed, `150 km/h × (pedal/50)^0.55`.
  - Pedalling harder always helps, but a sprint can't leave everyone behind in seconds, and easing off doesn't
    stall you.
  - Every car slows a little uphill and in tight bends, and gains downhill.
- **Lanes:** the cars choose their own lanes, yours included.
  - A car catching another tucks in behind it to **slipstream**: a little extra speed, and your Turbo fills
    faster.
  - It pulls out to pass when it gets close, and goes back to its own lane when the road is clear.
  - Rivals try to dodge oil they see in time.
- **🚀 Turbo:** a meter of three segments that fills as you pedal (faster when you push, faster in a
  slipstream).
  - Each tap spends one segment for 1.6 s of +40% speed. Taps stack, so you can save three for the run to the
    flag.
  - A boosting car shoves a car in its way aside.
  - **Rocket start:** tap between the last lights and just after GO.
- **🛢️ Oil:** you start with one can and get another every 40 s (two at most).
  - A tap drops a slick behind you. A rival that drives through it spins out and loses a lot of ground.
  - The button turns pink and shows **NOW!** while a rival is 5–45 m behind on your line.
  - A **rear-view window** opens at the top so you can see them coming, and a replay shows the spin when it
    works.
  - Rivals closer than 13 m can't dodge; further back, they might.
- **Rivals:**
  - Blue Comet (#7): fast, and good at dodging.
  - Goldie (#3): steady.
  - Lime Rocket (#9): a bit slower.

  Each has a random form each race, a slow pace wobble, and uses Turbo to chase you or hold you off. A soft
  rubber band keeps the pack close. It fades over the last half-lap, so the finish is a real fight.
- **The workout** is a series of races on new tracks, each with its own name and colours:
  - races are 1–3 laps (about a minute a lap), chosen to fit the time left;
  - points go 10 / 7 / 5 / 3, and the leader starts at the back;
  - the last card shows the final standings.

### Balance (from `npm run balance`, 40 three-lap races each)

In the table, *casual* taps Turbo whenever a segment is full and Oil when it's lit. *Smart* also saves Turbo for
passes and the finish. Both taps land 0.9 s late, like a phone's.

| pedal | buttons | avg place | 1st / 2nd / 3rd / 4th | place changes per race |
|---|---|---|---|---|
| 40 | none | 4.0 | 0 / 0 / 0 / 40 | 1 |
| 40 | smart | 4.0 | 0 / 0 / 0 / 40 | 8 |
| 50 | none | 3.6 | 0 / 0 / 17 / 23 | 6 |
| 50 | casual | 1.9 | 11 / 24 / 5 / 0 | 15 |
| 50 | smart | 1.6 | 18 / 21 / 1 / 0 | 16 |
| 60 | none | 1.7 | 13 / 25 / 2 / 0 | 16 |
| 60 | casual | 1.0 | 40 / 0 / 0 / 0 | 5 |

- At your steady pace, the buttons make the difference between the back of the pack and a fight for the win.
- Pushing 20% harder wins, and the buttons make it comfortable.
- `?difficulty=easy` makes pedal 40 a 2nd–3rd place race; `hard` makes pedal 60 fight for the win.
- The knobs are marked FUN KNOB in [src/config.ts](src/config.ts), which holds every tunable.

## The look

- **City:**
  - dark buildings of random heights, with windows the shader draws (whole floors lit, some TV flicker);
  - setback towers in downtown clusters, with red beacons on the tallest;
  - neon signs facing the road;
  - a street grid with moving traffic lights, searchlights, a skyline ring, the moon and stars.
- **Road:**
  - banked in the bends, with lane dashes, kerbs and chevron boards;
  - neon barriers, street-lamp light pools, and headlight pools from every car;
  - a start gantry with countdown lights.
- **Cars:** one lofted, flat-shaded toy template dressed four ways: stripes, wing (GT, twin, ducktail, none),
  hubcaps (star, disc, spokes, ring), headlights (round, slit, quad, square), a roof number, and a scoop or
  pipes.
  - They lean, drift into bends, hop over crests and squash when they land.
  - Turbo flames, sparks, spin smoke and drift sparks.
- **Camera:** third person, above and to the side, toward the middle of the road so the other lanes are in view.
  - It swings to the outside of the coming bend and pulls back when someone is on your tail.
  - It sweeps the grid before a race and swings round your car after the flag.
- **Themes:** four colour themes (synthwave, midnight, amber, emerald), one per race in turn.

## Layout

- `src/config.ts`: every tunable.
- `src/controls.ts`: the input interface (`Controls`) and the keyboard/slider stand-in.
- `src/sim/`: the headless game, with no Babylon.
  - `track.ts`: the generated loop, hills, banking, the ground.
  - `car.ts`: car state, and pedal → speed.
  - `race.ts`: one race (lanes, slipstream, contacts, Turbo, Oil, crests, places, results).
  - `series.ts`: races back to back, laps that fit the time, standings.
- `src/render/`: Babylon.
  - `world.ts`: sky, ground, road, barriers, lamps, gantry.
  - `city.ts`: buildings, signs, beacons.
  - `shaders.ts`: the night shaders.
  - `carModel.ts` and `carView.ts`: the car template and its motion.
  - `camera.ts`, `pip.ts` (rear view and replays), `effects.ts`, `theme.ts`.
- `src/ui/hud.ts` and `index.html`: the DOM overlay.
- `src/main.ts`: boot and the frame loop.
  - The simulation runs in wall-clock substeps (at most 50 ms each, catching up at most 2 s per frame).
  - `window.__game` has `step(dt, n)`, `snapshot()`, `hold()`, `settle()` and `press()` for tests and
    screenshots.
  - Call `hold(true)` before the first frame, or the first frame catches up to 2 s of wall-clock time.
  - The in-app browser pane draws at about 1 fps, so fast-forward with `step` and let `settle` move the camera.
    After an emulated resize, call `__game.engine.resize()`.
- `tests/`: vitest. `tools/balance.ts`: the balance table above.
- `platform/metadata.json`: the Dandyhorse metadata draft ([INTEGRATION.md](INTEGRATION.md)).
