# Every line the platform says about a competitor

For proofreading. Gathered 2026-10-20 from the code rather than written from memory, so this is what a
player actually sees. `{braces}` are the variable parts; an example rendering follows each group.

Three places text about a competitor appears: the **rival box** (always on screen while you ride), the
**encouragement banner** (occasional, one line at a time), and the **timeline message** each game writes
when the session ends.

---

## 1. The rival box — `libs/gamekit/src/competitor.ts`

Always on screen when you have somebody to ride against. Four fixed labels and one verdict line.

| Where | Text |
|---|---|
| Heading | `{Their first name} {flag}` |
| Row 1 label | `Their distance` — a game may override it (Night Racer uses the same) |
| Row 2 label | `Speed` |
| Row 2 value, once they have stopped | `finished` |
| Progress rows | labelled from the game's own `progress` metadata — `Deliveries`, `Earned`, `Laps`, `Rings`, `Points`, `Races`, `Ships home`, `Stars`, `Climbed`, `Along the route` |
| Progress value | `{yours} v {theirs}` |
| Verdict, in front | `{distance} ahead` |
| Verdict, behind | `{distance} behind` |
| Verdict, level | `Level` |

> Priya 🇮🇳 · Their distance 0.4 km · Speed 27.4 km/h · Deliveries 0 v 0 · **0.1 km ahead**

---

## 2. The encouragement banner — `libs/gamekit/src/encouragement.ts`

One line at a time, with a cooldown between them. Grouped by what prompts it.

**The lead changing hands** (these interrupt the cooldown — they are the most interesting thing that
can happen):

- `You have passed {name}!`
- `{name} is back in front — dig in.`

**Their ride ending:**

- `{name} is done — and you are still going. You win this one.`
- `{name} has finished. Ride it out your way.`

**A counter going up:**

- `{value} — that is {difference} more than {name}.` *(when you are now ahead on it; `your rival` if they have no name)*
- `{Counter} {value}. Good.`

**Distance, calories and climbing:**

- `{n} km down.` *(every kilometre to ten, then every five)*
- `{n} calories burned.`
- `{n} m of climbing. That is real hill.`

**Where you are in the session:**

- `Halfway. The hard half is behind you.`
- `Last stretch — everything you have left.`

**Idle lines**, when nothing else has happened for a while:

- `Still going. Nice work.`
- `Settle in — this is the good part.`
- `Breathing, legs, rhythm. You have all three.`
- `That is a solid pace. Hold it.`
- `Everything after this is a bonus.`

**Idle lines while ahead:**

- `You are clear. Keep the pressure on.`
- `Gap is growing. Do not look back.`
- `That is how it is done.`

**Idle lines while behind:**

- `Close the gap — a few watts will do it.`
- `Within reach. Lift it a little.`
- `Still in this. Keep turning.`

---

## 3. The timeline message, per game

Written by each game when the session ends, and the line that appears on your profile and in Activity.
Each game has a comparative version (when it had a rival) and a plain one.

### Cycle Dash — `cityengine/src/rival.ts`

- `{n} parcels to {name}'s {theirs}, {money} earned.{bumps}`
- `{n} parcels across town — {name} managed {theirs}.{bumps}`
- `Level with {name} on {n} parcels, but {distance} further.{bumps}`
- `{n} parcels each with {name}. Too close to call.{bumps}`

`{bumps}` is ` {n} cars found the hard way.` or ` Not a scratch.`

> 7 parcels across town — Priya managed 5. 2 cars found the hard way.

### Night Racer — `games/nightracer/src/platform.ts`

- `{n} points {over}, beating {name}'s {theirs}.{won}`
- `{n} points {over}; {name} took {theirs}.{won}`
- `{n} points each with {name}, {over}.{won}`
- plain: `{n} championship points over {n} races.{won}`

`{over}` is `over one race` / `over {n} races`; `{won}` is ` {n} wins.` or nothing.

> 28 points over 5 races, beating Kenji's 8. 2 wins.

### Trail Trainer — `games/trailtrainer/src/platform.ts`

- `{distance} up {route}{hill} — {gap} further than {name}.`
- `{distance} up {route}{hill}; {name} got {gap} further.`
- plain: `Finished {route}{hill}.` / `{distance} up {route}{hill}.`

### Rolling Hills — `games/rollinghills/src/platform.ts`

- `{distance} {over} — {gap} further than {name}.`
- `{distance} {over}, {gap} behind {name}. Next time.`
- plain: `{n} laps of {where}, {distance}.{timed}` / `{distance} around {where}.{timed}`

`{over}` is `over {n} laps` or `round the loop`.

### Flight Cycle — `games/bikeplane/src/platform.ts`

- `{rings}{clean} — {name} managed {theirs}.`
- `{rings}{clean}. {name} flew through {theirs}.`
- `{rings}{clean}, level with {name}.`
- plain: `{rings}{clean}, {n} of them in a row.` / `{rings}{clean}.`

`{rings}` is `{n} rings flown through`; `{clean}` is `, not one missed` / `, {n} missed` / nothing.

### Night Watch — `games/nightwatch/src/platform.ts`

- `{ships}{aground} — {theirs} was all {name} managed.`
- `{ships}{aground}. {name} got {theirs} home.`
- `{ships}{aground}, the same as {name}.`
- plain: `{ships}{aground}. {n} stars on the night.` / `A night at the lamp.`

`{ships}` is `{n} ships brought home`; `{aground}` is `, {n} aground` / ` and not one aground`.

### Lane One and Kingdom Trek — no comparative line

Deliberately (PLAN.md §18.10): Lane One is a console of dials and Kingdom Trek a world to walk through,
so neither races anybody.

- Lane One: `{programme}: {n} minutes held on target`
- Kingdom Trek: `Level {n}, {where} — {n} kingdoms saved so far.` / `Level {n}, {where}.`

---

## 4. Ghost name tags — `libs/gamekit/src/ghosts.ts`

No sentence, just the person: `{Their first name}` floating over their head, in Trail Trainer.

---

## Notes a proofreader might want

- **No contractions anywhere.** `do not look back`, `that is how it is done`, `{name}'s` only as a
  possessive. Consistent, and deliberate, but it reads formally in the shouty moments.
- **Names** are the first name where somebody has one, else their handle — so a player who has filled
  in no name appears as `user21` mid-sentence.
- **"Next time."** appears only in Rolling Hills' losing line; no other game commiserates.
- **Night Racer's `{won}`** can leave a bare ` 2 wins.` after a full stop, which reads as a fragment.
- Numbers are never spelled out: `1 car found the hard way`, not `one car`.
