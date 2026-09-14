# Kingdom Trek

A role-playing adventure for exercise equipment, played in the browser. Pedal to
earn Energy, spend it walking between towns, fight by pedaling in real time, and
save the kingdom: once per level, forever.

The design is in [docs/DESIGN.md](docs/DESIGN.md); what comes next is in [PLAN.md](PLAN.md); how it plugs
into the exercise platform (Dandyhorse) is in [INTEGRATION.md](INTEGRATION.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5188/games/kingdomtrek/ (standalone; `make serve` for ?session=)
npm test           # rules, content, town layouts, the generator, and the solver bot winning every game
npm run typecheck
npm run validate   # every game: valid, winnable by the solver bot, and how long it takes
npm run generate   # new game files, each validated and played by the bot before it is kept
```

## Controls

| Button | Keyboard | Gamepad |
|---|---|---|
| Move the highlight | ↑ ↓ (← → jump a page) | d-pad, left stick |
| Select | Enter or Space | A |
| Back | Esc or Backspace | B |

Number keys 1–9 and 0 pick an option directly; the mouse works too, and a tap or click on a
place in a town walks the hero there and goes in. In the journal,
← → scroll a long page (or pick the page again). Back in a town or on the road
pauses the game (⏸ Pause: Resume · End session); nothing counts while paused.
Every town has a workshop (⚒️ The Royal Workshop, The Warm Hearth, ...) where
pedaling makes things.

Developer keys: `[` `]` change pedal effort (steady pace is 100%; steps up to 2000%),
`F` cycles time speed 1× / 10× / 60× (the quickest way to test: at 60× an 8-minute
road takes 8 seconds and a fight a second or two), `` ` `` shows the save JSON.

## On Dandyhorse

Launch it from the Dandyhorse console (Games → Kingdom Trek). The bridge opens the game with `?session=`, and
`src/platform.ts` takes over; [INTEGRATION.md](INTEGRATION.md) has the whole story.

- **Effort** comes from the machine, or a heart-rate strap, measured against your steady pace. Set the steady pace
  in the console under Preferences → Fitness. The HUD shows the reading and your effort as a share of steady:
  "140 W · 108%".
- **The phone** shows the current list as big buttons with a small d-pad. The big screen keeps its keyboard,
  gamepad and mouse.
- **Your hero** is saved on the server at every checkpoint, so it follows you between sessions and machines.
- **⏸ Pause** pauses the session too. A bridge's Pause opens this pause menu, and its Play closes it.
- **Hills**, a launch option, sets your treadmill's incline or your bike's grade from the road.

Developer keys work standalone and in debug sessions. Using them, or `window.kingdomTrek`, in a session stops that
session saving your hero.

## Hooks for developers

`window.kingdomTrek` exposes:
- `engine`, and `platform` on Dandyhorse;
- `getSave()` (the checkpoint blob), and `loadSave(blob)` and `reset()` (standalone only);
- `setEffort(x)`, where 1.0 is steady pace;
- `feed(reading)`: live readings in SI units, `{ speed, incline, cadence, power, heartRate }`, about once a second;
- `setTarget(reading)`: the steady pace to measure against;
- `setTimeScale(x)`, `step(seconds)` and `press(button)`.

Standalone, when the player picks End session → Save and exit, the game:
- calls `kingdomTrek.onExit(save)` if the host set it;
- dispatches a `kingdomtrek:exit` event on `window`, with the save as `detail`.

The save lives in `localStorage` under `kingdomtrek.save.v1`.

## Layout

- `public/data/items.json`: every item any game can use.
- `public/data/games/`: `game-0000.json` ("The Dragon of Emberpeak", written by hand) and `game-0001` to
  `game-0009` (made by the generator, one for each other threat). `index.json` lists them in play order, with
  how long each usually takes.
- `src/config.ts`: every balance number.
- `src/engine/`: the rules, headless (modes, battle, travel, shops, quests, save).
- `src/render/`: canvas scenes. `src/ui/`: HUD, choice panel, dialog, journal, the session picture.
- `src/platform.ts`: the game on Dandyhorse. `src/mirror.ts`: the choice list as the phone's menu. `src/road.ts`:
  Hills and the hero's place on the map. `src/effort.ts`: effort from the platform, or the developer keys.
- `src/sim/`: a bot that plays through the choice list, and the solver that wins any
  game file from the file alone and times it.
- `src/gen/`: the game generator: the map (`map.ts`), the ten threats (`threats.ts`), who walks the roads
  (`bestiary.ts`), the medieval theme's words (`medieval.ts`), and the builder (`generate.ts`).
- `tools/validate.ts`: `npm run validate` checks every game in the index (add
  `--write` to record the measured minutes, `--steps` to see the route).
- `tools/generate.ts`: `npm run generate` adds new games to the index (`-- --count 5`, `-- --threat pirates`,
  `-- --seed 42 --dry`), keeping only games the bot wins with every class in 70–120 minutes.
- `tests/`: unit tests, content validation, town layouts, and the playthrough.
