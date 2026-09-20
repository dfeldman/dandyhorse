# Night Watch

You are a lighthouse keeper, and your effort keeps the lamp lit. Pedalling or walking spins the lamp's clockwork.
**Below the target pace the lamp dims**, and ships come in on a schedule all night. Each ship needs a certain
brightness to find the channel between the rocks. A dim lamp lets a ship wander toward the rocks; a bright one
brings it home. One workout is one night, from dusk to dawn.

BabylonJS + TypeScript + Vite, no sound yet. It runs on its own today. [INTEGRATION.md](INTEGRATION.md) is the
plan for the Dandyhorse platform.

## Run

```bash
npm install
npm run dev        # http://localhost:5192
npm test           # the timetable, the lamp, drift, the horn, hails, moorings (vitest)
npm run balance    # play many nights headless with bot keepers: how effort turns into stars
npm run build      # static site in dist/
```

URL options:

| | |
|---|---|
| `?seed=123` | the same night every time |
| `?minutes=30` | workout length (the timetable fits any length; 10–90 tested) |
| `?difficulty=easy\|normal\|hard` | how bright ships need the lamp (hard also sends convoys) |
| `?weather=calm\|mixed\|wild` | how rough the night is |
| `?pedal=55` | hold the pedal and hide the slider (screenshots) |
| `?at=600` | start this many seconds in, with a keeper who followed the board (screenshots) |

## Controls (standalone)

| | |
|---|---|
| ↑ / ↓ (W / S), the slider, or 1–9 | pedal (50 = your steady pace) |
| Space or H, or tap 📯 | Horn |
| P or Esc | pause |

`window.setPedalInput(v)` sets the pedal from the console, as in the other games.

## How a night plays

- **The workout is the timetable.** The **harbour board** (top right) lists the next ships. Each shows its
  kind, name, level (●–●●●●), the weather it will meet, its **need** (the pace the lamp must reach) and when it
  arrives. Harder ships have shorter watches. The night warms up with a gentle ship, peaks in the middle
  (with one **ocean liner** in workouts of 15 minutes or more), and eases off toward dawn. In a 30-minute
  night about 13 ships come in. About two-thirds of the night is spent on watch, and about a third above
  steady pace.
- **The lamp gauge** (bottom left) shows your power against the white target line.
  - Green means the ship can see the way, amber means it's wandering, red means it's heading for the rocks.
  - A dashed line shows the next ship's need 12 s before its watch starts, so you can ramp up in time.
  - The lamp has a flywheel, so a short stop is forgiven.
  - The beams also turn faster the brighter the lamp.
- **A ship on watch** gets a card on the board, with a channel bar (rocks at both ends) and its progress.
  - It first crosses open water (the approach), then threads the channel between the island's spurs and the
    reef.
  - With the lamp at its need, a ship holds the leading line. Below the need, it settles further off the line:
    about 3 below, it wobbles; 7 below, it wanders but gets by; 10 below, it scrapes; 14 below, it's pinned on
    the rocks.
  - On the rocks a ship loses hull (hearts on the card). With no hull left it runs **aground**: a distress
    flare goes up, and a tug tows it in later.
  - **Stars:** 3 if it never strayed past two-fifths of the way to the rocks, 2 if it never touched them, 1 if
    it scraped, 0 if it went aground. Three-star ships in a row build a streak bonus.
- **📯 Horn:** you start with one charge of steam and can hold three.
  - **Building steam:** steam builds only while your power is above both the target and 46. Pushing harder
    than a ship needs builds it, and so does keeping a steady pace between ships instead of resting. That
    choice is yours.
  - **A blast** pulls every ship on watch half-way back to the line and holds it steady for 3 s. It only
    spends steam when some ship has actually drifted.
  - **Hails:** ships sometimes flash a signal lamp (· — ·) and a 📡❓ bubble. Tap the horn within 7 s to
    answer, for +50 points. Answering is free, and a missed hail costs nothing.
- **The harbour:** ships berth bow-in along the quay. The town lights more windows as ships come home. When
  all six berths are taken, the ship that has been in longest backs out and sails away.
- **Weather** comes in spells: sea mist, rain, fog and storms.
  - It raises a ship's need: +1 mist, +2 rain, +4 fog, +3 storm. The board shows it in advance.
  - Fog turns the beams into glowing cones.
  - Storms bring big waves, lightning, and gusts that push ships about.
  - Some nights have the northern lights. You may also see whales, shooting stars, and gulls at dawn.
- **At dawn** the lamp goes out and the **logbook** lists every ship's stars, your hails, horn blasts, best
  streak and points, plus your best score for that workout length and difficulty. The best score is kept in
  localStorage.
- **Tutorial:** one-time hints appear the first time each thing happens. They are remembered in
  localStorage; remove `nightwatch.hints` to see them again.

## Balance

`npm run balance` (30 nights of 30 minutes, normal, mixed weather) prints this table. The bots react like a
person on a treadmill: they change pace slowly, their pace wobbles, and phone taps land 0.9 s late.

| keeper | ★ per ship | aground | horn blasts |
|---|---|---|---|
| follows the board, +2 over, ramps early | 3.00 | 0% | 0 |
| follows the board, on the line, ramps late | 2.99 | 0% | 0.7 |
| follows the board, 3 under | 2.74 | 0% | 0 |
| steady 55, uses the horn | 2.77 | 0% | 7 |
| steady 50, uses the horn | 2.31 | 4% | 9 |
| steady 50, ignores the board | 2.20 | 10% | 0 |
| steady 40 (tired), uses the horn | 0.90 | 58% | 1 |

The FUN KNOBs are all in [src/config.ts](src/config.ts):
- `LEVELS`: each level's need;
- `DRIFT_LINE`: shortfall → how far off the line a ship settles;
- `DRIFT_TIME_OUT`/`BACK`;
- `SCRAPE_RATE`;
- `STEAM_RATE`/`FLOOR`;
- `LEVEL_WEIGHTS`: the shape of the night.

`KNOBS="SCRAPE_RATE=0.12" npm run balance` tries a number without editing anything.

## Code map

| | |
|---|---|
| `src/sim/` | headless and tested: `night.ts` (the whole night, events, horn, moorings), `schedule.ts` (the timetable), `ship.ts` (drift, stars), `lamp.ts` (flywheel, steam), `weather.ts`, `fleet.ts` (ship kinds and names) |
| `src/render/` | Babylon: `coast.ts` (layout and ship routes), `world.ts` (land, rocks and surf, buoys, harbour, town), `lighthouse.ts`, `shipModels.ts` + `fleetView.ts`, `seaSky.ts` + `shaders.ts`, `palette.ts` (dusk → night → dawn), `weatherView.ts`, `effects.ts` (horn rings, sparks, fireworks, whale, gulls), `camera.ts` |
| `src/ui/hud.ts` | the DOM HUD, hints, name tags, logbook |
| `src/controls.ts` | the input seam (`Controls`) and the keyboard/slider stand-in |

**Debug handle:** `window.__game`.
- `step(dt, n)` fast-forwards with the current pedal.
- `jump(t)` jumps with a keeper who follows the board.
- `hold(true)` freezes time, and `settle(n)` draws frames while held.
- `press('horn')` taps the horn, and `setPedal(v)` sets the pedal.
- `snapshot()` returns the state the platform would read.
- `cam.basePos` / `cam.baseTarget` move the camera.

The in-app browser pane only draws about one frame a second, so use `hold` + `step` + `settle`, and call
`engine.resize()` after changing the viewport.

## Not done yet

- Sound: the foghorn, surf, rain and bells. The horn is only visual for now.
- The platform adapter (INTEGRATION.md).
- Upgrades between nights (a bigger boiler, a brighter lens) and named nights or seasons.
