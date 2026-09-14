# Kingdom Trek

A role-playing adventure for exercise equipment, played in the browser. Pedal to
earn Energy, spend it walking between towns, fight by pedaling in real time, and
save the kingdom: once per level, forever.

The design is in [docs/DESIGN.md](docs/DESIGN.md); what comes next is in [PLAN.md](PLAN.md); how it plugs
into the exercise platform (Dandyhorse) is in [INTEGRATION.md](INTEGRATION.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5188
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

Number keys 1–9 and 0 pick an option directly; the mouse works too. In the journal,
← → scroll a long page (or pick the page again). Back in a town or on the road
pauses the game (⏸ Pause: Resume · End session); nothing counts while paused.
Every town has a workshop (⚒️ The Royal Workshop, The Warm Hearth, ...) where
pedaling makes things.

Developer keys: `[` `]` change pedal effort (steady pace is 100%; steps up to 2000%),
`F` cycles time speed 1× / 10× / 60× (the quickest way to test: at 60× an 8-minute
road takes 8 seconds and a fight a second or two), `` ` `` shows the save JSON.

## Hooks for the exercise platform

`window.kingdomTrek` exposes `getSave()` (the checkpoint blob), `loadSave(blob)`,
`reset()` (forget the save), `setEffort(x)` (1.0 = steady pace), `setTarget(reading)`
and `feed(reading)` (the player's target and live device values, `{ speed, cadence,
power, heartRate }`, shown in the HUD), `setTimeScale(x)`, `step(seconds)` and the
`engine` itself. When the player picks End session → Save and exit, the game calls
`kingdomTrek.onExit(save)` if the host set it and dispatches a `kingdomtrek:exit`
event on `window` with the save as `detail`. The save also lives in `localStorage`
under `kingdomtrek.save.v1`.

## Layout

- `public/data/items.json`: every item any game can use.
- `public/data/games/`: `game-0000.json` ("The Dragon of Emberpeak", written by hand) and `game-0001` to
  `game-0009` (made by the generator, one for each other threat). `index.json` lists them in play order, with
  how long each usually takes.
- `src/config.ts`: every balance number.
- `src/engine/`: the rules, headless (modes, battle, travel, shops, quests, save).
- `src/render/`: canvas scenes. `src/ui/`: HUD, choice panel, dialog, journal.
- `src/sim/`: a bot that plays through the choice list, and the solver that wins any
  game file from the file alone and times it.
- `src/gen/`: the game generator: the map (`map.ts`), the ten threats (`threats.ts`), who walks the roads
  (`bestiary.ts`), the medieval theme's words (`medieval.ts`), and the builder (`generate.ts`).
- `tools/validate.ts`: `npm run validate` checks every game in the index (add
  `--write` to record the measured minutes, `--steps` to see the route).
- `tools/generate.ts`: `npm run generate` adds new games to the index (`-- --count 5`, `-- --threat pirates`,
  `-- --seed 42 --dry`), keeping only games the bot wins with every class in 70–120 minutes.
- `tests/`: unit tests, content validation, town layouts, and the playthrough.
