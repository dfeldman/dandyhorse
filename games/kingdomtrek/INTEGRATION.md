# Kingdom Trek on Dandyhorse

What it takes to run Kingdom Trek on the exercise platform (Dandyhorse, `~/dandyhorse`). This covers only the
points where the two meet. The game's own rules are in [docs/DESIGN.md](docs/DESIGN.md), and the platform's
contract for games is `dandyhorse/docs/GAME_AUTHORING.md`.

Nothing here is built yet. The game already has hooks for it: `window.kingdomTrek`, plus
`EffortSource.feed()` and `setTarget()` in `src/effort.ts`. We own both sides, so where a platform change makes
this simpler, the doc suggests one. The list is in §10.

## 1. The shape of it

```
machine ─► bridge ─► server ─► getstate (1 Hz) ─► platform.ts ─► effort ─► engine.step(dt, effort)
phone taps ─► server ─► getstate.inputs ─► platform.ts ─► panel.press(button) / engine.choose(id)
engine checkpoint ─► putsave     current choice list ─► setstate prompt     End session ─► endsession
```

- The game becomes `games/kingdomtrek`: a static Vite build with `base: '/games/kingdomtrek/'`. Data files
  already load through `import.meta.env.BASE_URL`.
- One new file, `src/platform.ts`, owns gamekit's `SessionClient` and talks to the game only through what
  exists today:
  - `engine.step(dt, effort)`, `panel.press(button)` and `engine.choose(id)`;
  - `engine.choices()` and `engine.snapshot()`;
  - the `checkpoint` and `exit` events.

  The engine doesn't change.
- Without `?session=` in the URL the game runs standalone as it does now: localStorage save, developer keys,
  and effort set with `[` `]`. The `window.kingdomTrek` hooks stay, as developer tools.
- **The machine only changes how effort is worked out** (§3). Everything else plays exactly the same on a
  bike or a treadmill.

## 2. metadata.json

```json
{
  "schemaVersion": 1,
  "id": "kingdomtrek",
  "name": "Kingdom Trek",
  "version": "0.1.0",
  "description": "Save the kingdom a ride at a time: pedal for Energy, walk between towns, fight by pedaling.",
  "entry": "index.html",
  "screenshot": "screenshot.png",
  "capabilities": { "seed": false, "input": true, "saveState": true, "ghosts": false },
  "variants": [
    {
      "id": "trek",
      "name": "Kingdom Trek",
      "deviceTypes": ["bike", "treadmill"],
      "defaultDuration": 2700,
      "controls": { "bike": "none", "treadmill": "none" }
    }
  ],
  "options": {
    "effortFrom": {
      "label": "Effort from",
      "enum": ["machine", "heartRate"],
      "labels": ["Machine", "Heart rate"],
      "default": "machine",
      "description": "What turns your workout into Energy."
    }
  }
}
```

- **One variant for both machines.** Save state is kept per game + variant, so two variants would mean two
  heroes. The server already accepts a variant with several device types. The console's launch dialog then
  asks which machine; it defaults to the first in the list (see §10).
- **`controls: none`.** The game reads the machine and never commands it. The one exception worth
  considering is hills (§3.3).
- **`seed: false`.** The session's seed is used only to start a brand-new save, in place of `Date.now()` in
  `newSave`. After that the random sequence lives in the save, so sessions can't be compared by seed.
- **45 minutes by default.** A level takes 90–120 minutes, so an adventure spans a few sessions and the save
  carries it over.

## 3. Effort: one number from the workout

The engine takes one input: **effort**, where 1.0 is the player's steady pace. Every balance number is set
against it: 1 ⚡ a second, a strike every 2.5 s, a Healing Draught in 60 s, 7–9 minutes between towns. The
integration's main job is to produce 1.0 when *this* player is going at *their* comfortable steady pace, on
whatever machine:

```
effort = live ÷ steady
```

Steady depends on fitness: 100 W for someone starting out, 200 W for a fit rider. Both earn the same Energy
for a steady minute, so a level takes everyone about the same time. The game rewards effort relative to the
player's own fitness, not raw watts.

### 3.1 The conversion factor: `steadyWatts` (from the platform)

`steadyWatts` is a new global preference: the power the player can hold comfortably for an hour, at a pace
where they can still talk in sentences.

- **Console:** a Fitness choice of four big buttons, with the exact number under Advanced:

  | Choice | Steady watts |
  |---|---|
  | Starting out | 100 W |
  | Regular | 130 W |
  | Fit | 160 W |
  | Very fit | 200 W |

- **From FTP:** if `ftp` is set (it's already a preference), the default is 0.65 × FTP, the middle of the
  endurance zone.
- **Per machine:** a device preference of the same name overrides it, for a runner who rarely cycles.
- **No server change:** the start payload already passes `preferences.global` and `preferences.device`
  through untouched, so a new key reaches the game once the console can set it.

### 3.2 Bike

`effort = power.actual ÷ steadyWatts`.

A bike that reports no power (some budget bikes send only cadence) falls back to heart rate if a strap is
paired (§3.4). Otherwise it uses cadence ÷ 80 rpm, which is a weak signal because it can't see the resistance.

### 3.3 Treadmill: estimated watts from speed and incline

The treadmill's reading becomes a single number in **bike-equivalent watts**, so the same `steadyWatts` works
on both machines. It is the energy cost of walking or running at that speed and grade, times 0.24:

- the energy cost uses the ACSM equations, the same ones the server uses for calories (platform PLAN §8.4);
- 0.24 is the pedaling efficiency the server assumes for bikes.

```
v = speed.actual (m/s)
g = max(0, incline ÷ 100)      incline.actual, else incline.commanded, else 0; a decline counts as flat
m = bodyData.weight (kg), 75 if unknown

walking (v ≤ 1.6 m/s):   W = m · v · (0.50 + 9.0 · g)
running (v ≥ 2.2 m/s):   W = m · v · (1.00 + 4.5 · g)
in between:              blend the two in proportion to v
```

Where the coefficients come from:
- ACSM oxygen cost, leaving out the resting term so a stopped belt reads 0:
  - walking: 0.1 per metre plus 1.8 × grade;
  - running: 0.2 per metre plus 0.9 × grade;
  - both in ml of O₂ per kg.
- × 20.9 J per ml of oxygen, then × 0.24.

The only change from ACSM is the blend. ACSM switches formulas at 1.8 m/s, so on the flat effort would double
between 6.4 and 6.5 km/h. Blending over 1.6–2.2 m/s keeps it smooth. The estimate is only a starting
point. What matters is that it rises steadily with both speed and incline and never jumps. A heavier player
reads more watts at the same pace, which is fair, because it is harder for them.

| 75 kg | Estimate |
|---|---|
| walk 5 km/h, flat | 52 W |
| walk 5 km/h, 5% | 99 W |
| walk 5 km/h, 10% | 146 W |
| walk 6 km/h, 3% | 101 W |
| jog 8 km/h, flat | 167 W |
| run 10 km/h, flat | 208 W |
| run 10 km/h, 3% | 236 W |
| belt stopped | 0 W |

So "Starting out" (100 W) is a 5 km/h walk up a 5% slope, and "Very fit" (200 W) is running at 10 km/h.

Treadmill users know their pace, not their watts. The console could let them enter their steady as a speed
and an incline ("6 km/h at 3%") and convert it with the same formula. Then the weight cancels out entirely.

**Incline has a catch.** The Horizon 7.0AT reports no incline, and a game that sets nothing has no commanded
incline to fall back on. So on that treadmill, incline set with the machine's buttons is invisible and counts
as flat. There are two ways out, and it's your call:
- **Hills (option A):** Kingdom Trek sets the incline itself. It declares `"treadmill": "incline"` (and
  `"bike": "grade"`) and raises the incline on roads toward mountain towns, flat along the coast. Players turn
  it on with a launch option, Hills: Off / On.
  - Because the game commanded the incline, the game knows it, and it counts.
  - Energy is conserved, so hills don't make trips longer: at the same belt speed an uphill stretch earns
    Energy faster, and the leg ends sooner.
  - The cost is that the machine's own incline buttons get overridden.
- **Assumed incline (option B):** a device preference, "this treadmill doesn't report incline: assume N%".
  It is simpler, but it goes wrong as soon as the player changes the incline mid-workout.

### 3.4 Heart rate

```
effort = (heartRate − restingHr) ÷ (steadyHr − restingHr)
```

- **Heart-rate reserve, not a plain ratio.** Sitting still reads 0, not 0.5.
- **`restingHr`** is a new preference, 60 by default.
- **`steadyHr`** is a new preference:
  - the top of zone 2 if `hrZones` is set;
  - otherwise `restingHr` + 0.6 × (`maxHr` − `restingHr`);
  - if `maxHr` is unset, it falls back to 208 − 0.7 × age, and then to 180.
  - Example: resting 60 and max 180 give a steady of 132.
- **The machine says whether you're moving.** If the bike reads 0 W and 0 rpm, or the belt is stopped, effort
  is 0 whatever the heart rate. Heart rate stays up for a minute after you stop, and a player reading a clue
  shouldn't keep earning. With no machine readings at all (a bike with no Bluetooth), heart rate decides alone.
- **It lags 30–60 s.** That is fine for travel and crafting, which last minutes. In a fight (30 s–3 min, with
  tug-of-war heaves every 10 s) a push shows up late, or after the fight. So the machine is the default and
  heart rate is an option. Heart rate also creeps up about 10% over an hour at the same power, and Energy
  creeps with it. That's acceptable.
- **Heart-rate-only sessions don't work today.** The server pauses them (`no_device`): a strap isn't a fitness
  device, and heart rate never keeps a session running. The opt-out in §5 would fix it.

### 3.5 Plumbing

- **Choosing the source:** at session start, from the `effortFrom` option and then `deviceType`. If the
  chosen source reads nothing but another does, fall back, and say so in the HUD.
- **Timing:** readings arrive about once a second and the engine steps ten times a second, so hold the last
  value between readings.
- **Smoothing:** an exponential average over about 3 s for power (a sprint still shows within 2–3 s), about
  1 s for a treadmill, and none for heart rate.
- **Cap:** effort is capped at 3×, so a 1000 W spike or a glitch can't win a boss fight in a second. The 20×
  developer ladder stays a developer tool.
- **Missing readings:** after 3 s of nulls effort is 0. Never hold a stale number.
- **HUD:** show the reading in the player's units (gamekit's `units.speed(ms, unitSystem)` and friends; the
  HUD prints km/h today) and effort as a percentage of steady: "140 W · 108%", "6.0 km/h · 3% · 98%",
  "132 bpm · 100%".
- **Where the maths lives:** in gamekit (`effort.ts`), so every game converts the same way. Kingdom Trek's
  `EffortSource.feed()` then calls it instead of being a stub.

## 4. Buttons and choices

The game needs exactly six buttons, and they are the platform's six d-pad buttons, one for one:

| Button | In Kingdom Trek |
|---|---|
| up / down | move the highlight |
| left / right | jump a page in a long list, or scroll a journal page |
| select | pick the highlighted option |
| back | the list's back option (Leave, Stop, Flee...) |

Every screen is one choice list (DESIGN §3):
- a title;
- up to 100 options, each with a stable id and a label of at most 40 characters (it may start with an emoji);
- optionally a hint, a disabled flag and an item card per option;
- the back option's id;
- a `key` that changes whenever the list does.

That list is what a phone should show.

- **The big screen:** keyboard and gamepad work as they do now, as long as the game's iframe has focus. Number
  keys and the mouse stay big-screen only.
- **The phone:** first a d-pad (§4.1), which works on today's platform. Then a menu prompt (§4.2), a
  suggested platform change that mirrors the list itself.
- **Developer keys** (`[` `]` `F` `` ` ``) work only in debug sessions and standalone.

### 4.1 The d-pad (works today; build first)

One persistent prompt stays open for the whole session. `dpadPrompt('kt', list.title)` in gamekit builds it:

```json
{ "promptId": "kt", "prompt": "Oakvale", "choices": ["up", "down", "left", "right", "select", "back"],
  "persistent": true, "layout": "dpad" }
```

- **Every tap counts.** Each tap arrives in `getstate.inputs`, and `SessionClient.onInput` delivers it once
  and in order. It goes to `panel.press(choice)`, exactly like a key.
- **The title follows the game.** `prompt` is the current list's title, so the phone shows where you are.
  The id stays the same, so the cross never flickers.
- **It works, but it's steering blind.** The player has to look at the TV to see the highlight, and every
  tap is a round trip. The risk is a Select aimed at one list landing on the next (you tap Journal on the
  road just as a fight starts). Until §4.2 exists, guard against it: drop a Select or Back whose tap time `t`
  is earlier than the moment the current list appeared, on the server's clock.

### 4.2 Suggested platform change: a menu prompt

Today's prompts are text buttons: at most 10, and the answer is the label text. Mirroring Kingdom Trek's
lists with them means a stack of workarounds:
- paging at 8 plus "More";
- mapping label text back to ids;
- telling duplicate labels apart;
- a new prompt id after every answer;
- dropping disabled options;
- guessing at stale taps from clocks.

A prompt that carries the list itself removes all of them:

```json
{
  "promptId": "kt",
  "persistent": true,
  "layout": "menu",
  "prompt": "Oakvale",
  "rev": 17,
  "items": [
    { "id": "place:mayor", "label": "🏰 Mayor's hall" },
    { "id": "place:shop", "label": "🛒 The Copper Kettle", "hint": "Buy and sell" },
    { "id": "craft", "label": "⚒️ The Royal Workshop" },
    { "id": "gate", "label": "🚪 The Gate", "disabled": true, "hint": "Finish your business first" },
    { "id": "pause", "label": "⏸ Pause" }
  ],
  "highlight": "place:shop",
  "back": "pause",
  "choices": ["up", "down", "left", "right", "select", "back"],
  "countdown": null
}
```

- **What the phone shows:**
  - the title;
  - a scrolling list of big buttons (disabled ones greyed, the highlighted one marked with its hint below);
  - a Back button bound to `back`;
  - a small d-pad for the buttons named in `choices`;
  - a bar for `countdown` (results screens that continue by themselves).
- **What a tap sends:** tapping an item sends its **id**; the d-pad sends its button name. Every answer
  carries the `rev` the phone was showing: `{ promptId, choice: "place:shop", rev: 17, t, n, source }`.
- **`rev` makes stale taps exact.** The game bumps `rev` whenever the list changes, and drops an item tap,
  Select or Back whose `rev` isn't current. Directions always pass. No clock guessing.
- **`highlight` keeps the phone and the TV in step.** A d-pad tap moves the game's highlight, and the game
  pushes a tick right away (gamekit's `requestTick()`; bursts up to 10 Hz are allowed), so the phone follows
  within a round trip.
  - An item tap sets the highlight first and then selects, so the town scene still walks the hero there.
- **What the server checks:**
  - up to 100 items, labels of at most 40 characters, ids of at most 64;
  - an answer is valid if it names an item id or a button in `choices`;
  - it records the `rev` the bridge sent;
  - it writes the prompt to the session log only when `rev` changes. A 100-item list every second would
    otherwise add megabytes an hour.
- **General, not special.** The same shape serves any game with a menu: a quiz, a shop in a racing game, a
  level picker. Kingdom Trek's `ChoiceList` maps onto it field for field.

Once it exists, the phone mirrors the list and the game drops the d-pad-only prompt.

### 4.3 Smaller input changes on the platform

- **Focus and gamepads in the iframe.** The bridge's game iframe has only `allow="fullscreen"`. Make it
  `allow="fullscreen; gamepad"` and give the iframe focus when the game loads and whenever a bridge overlay
  closes. Then a keyboard or gamepad at the big screen goes straight to the game with no round trip.
- **Hold to repeat.** Holding an arrow on the phone's d-pad should send repeated taps after 0.4 s, every
  0.13 s (the game's own gamepad timings). These are still discrete taps, so the platform's "no held keys"
  rule stands.
- **Latency is already good.** An answer bumps the session's sequence number, which wakes the game's
  `getstate` long-poll at once (`answer_input` → `LiveSession.bump()`). A phone tap therefore costs about one
  round trip, a few hundred ms on home wifi. Nothing to change.

## 5. Pausing

Kingdom Trek is unusual: stopping to read a clue, browse the journal or shop is part of playing. The game
already handles standing still. Effort 0 means no Energy and the hero waits on the road, and nothing is lost
in a town. **So the platform's automatic pause is the wrong thing for this game.**

- **When the platform pauses today.** The server pauses on *missing* readings; a zero counts as data. A bike
  that keeps reporting 0 W while the player reads won't pause. But:
  - machines that go quiet when idle do pause (the drivers turn a stalled stream into nulls, and the pause
    follows about 9 s later);
  - so does a bridge whose tab sleeps or whose phone locks.
- **Suggested change: an opt-out.** A per-game flag, for example `"capabilities": { "autoPause": false }`.
  The server then never pauses the session by itself (`no_data`, `device_unavailable`, `no_device`,
  `bridge_silent`), and only the user pauses. The game counts missing readings as effort 0. The game-silence
  reaper still ends abandoned sessions.
- **What the game does on any platform pause.** Game time stops: fights hold, the road stops, the workshop
  stops. The choice list keeps working, so the player can read, talk and shop, and `pause.message` shows in
  the HUD. That freezes the simulation as the platform asks without locking the menus. It also means a
  dropped signal never loses a fight.
  - **User pause** (the bridge's ⏸): show the game's own ⏸ Paused screen with the platform's message.
- **Suggested change: a game-side pause.** The in-game ⏸ Pause should pause the platform session too, so
  History doesn't count a coffee break and the bridge shows ▶ Play. Add `POST /gameapi/pause {sessionId,
  paused}`, doing what the bridge's Pause and Play do. Until then the in-game pause is local and the
  platform's clock runs on.
- **Keep ticking:** the game sends `setstate` every second even while its own pause screen is up, so the
  game-silence reaper never ends a session where the player is just reading.

## 6. Saving

- **One save:** the same `SaveState` JSON as today (a few KB; the limit is 256 KB). It goes to the platform's
  save state under game + variant: one variant, so one hero on both machines.
- **Loading:** `startsession` returns `saveState`, and boot builds the engine from it instead of localStorage
  (no page reload, unlike `loadSave`). If it's null, start a new save seeded with the session's `seed`.
- **Writing:** `putsave` on every `checkpoint` event (arriving, leaving a town, levelling up), every 30 s
  otherwise, and at the end. A fight in progress isn't saved, as now.
- **Reloads:** reloading the page mid-session calls `startsession` again with the same id and rejoins; the save
  comes back from the last `putsave`. localStorage is for standalone play only.
- **Debug sessions** read the real save but never write it back (they checkpoint to localStorage). 60× time
  and 20× effort shouldn't touch a real hero.

## 7. Starting and ending a session

- **Start:**
  - The console launches it, and the bridge loads `index.html?session=…`.
  - `startsession` provides:
    - `deviceType` (§3);
    - `bodyData.weight` (§3.3);
    - `unitSystem`;
    - `preferences` (global, device, game);
    - `options.effortFrom`;
    - `saveState`, `seed`, `requestedDuration`, `debug`.
  - With a save, skip the title screen and go straight to the town or the road. A new player still meets the
    hero creator.
- **Duration** (15/30/45/60 minutes, chosen in the console) is advisory:
  - The HUD counts it down from `activeSeconds`.
  - At zero a toast asks "Time's up: end at the next town?", and on the next arrival End session is
    highlighted.
  - It is never forced, and never in the middle of a fight.
- **Ending in the game:** ⏸ Pause → End session → farewell → Save and exit. That runs `putsave`, then
  `SessionClient.end('complete')`, which uploads the session image first. It replaces today's `onExit` and
  `kingdomtrek:exit`.
- **Ending from outside** (the bridge's ■ End, the console, the reaper): `onEnded` writes the last checkpoint
  and shows the farewell screen without its buttons. Checkpoints are frequent, so a few seconds at most are
  lost.
- **Session image** for History: the farewell card drawn on a 640×360 canvas. It shows the hero, where they
  are, and the day's deeds ("walked 3 roads, won 4 fights, made 2 things at the workshop").

## 8. What the game sends each tick

| Field | Value |
|---|---|
| machine targets | none (`controls: none`), unless hills are on (§3.3) |
| `x`, `z` | the hero's position on the kingdom map, scaled to metres, so the console's session map draws the day's trek; `y` = 0 |
| `route` | the adventure's title ("The Dragon of Emberpeak"), so History says which one |
| `speed` | bike only: the bike's own reported speed, if any; the server works out a bike's distance from it |
| `score` | kingdoms saved, for leaderboards (optional) |
| `achievements` | e.g. `kingdom-saved`, `first-craft`, `level-5`, `flawless` (a level with no fights lost), optional |
| `requestedInput` | the d-pad or menu prompt (§4) |
| `custom` | `{ gameId, level, where, mode }` for debugging, well under 8 KB |

## 9. Later: level series

Eventually there may be several series, such as medieval and steampunk, each about 10 game files. On the
platform there are two ways to model them, depending on the design:
- **Each series has its own hero:** one variant per series (Kingdom Trek: Medieval, Kingdom Trek: Steampunk).
  Each lists both machines. Saves are then kept per series and shared across machines at no cost, and the
  console shows each series as its own entry.
- **One hero travels through every series:** a launch option `series` on the single variant, with the save
  holding progress per series.

Not needed yet.

## 10. Suggested platform changes

Inputs:
- [ ] **Menu prompt** (`layout: "menu"`): items with ids, disabled flags and hints, up to 100 of them, plus
  `highlight`, `back`, `countdown`, the d-pad buttons, and `rev` echoed in every answer. The server logs the
  prompt only when `rev` changes (§4.2).
- [ ] **Game iframe:** add `allow="gamepad"` and give it focus on load and after overlays (§4.3).
- [ ] **Phone d-pad:** hold to repeat (§4.3).

Effort:
- [ ] **`steadyWatts`** global preference, with a device-level override. The console gets a Fitness picker
  (100/130/160/200 W), defaults it from `ftp`, and lets treadmill users enter it as a pace (§3.1, §3.3).
- [ ] **`restingHr` and `steadyHr`** preferences (`maxHr` exists) (§3.4).
- [ ] **gamekit `effort.ts`:** the treadmill estimate, heart-rate reserve, smoothing and the cap, shared by
  every game (§3.5).

Pausing:
- [ ] **`capabilities.autoPause: false`** (§5). This also makes heart-rate-only sessions possible; the bridge
  and console should then let a session start with only a strap.
- [ ] **`POST /gameapi/pause {sessionId, paused}`**, the same as the bridge's ⏸ and ▶ (§5).

Console:
- [ ] **Launch dialog:** for a variant with both machines, default to the one the user owns or has
  connected (today it is simply the first listed), and use buttons rather than a `<select>` so no keyboard is
  needed.

Nothing new is needed for hills: `controls: incline/grade` already exists (§3.3).

## 11. Changes in Kingdom Trek

- [ ] `metadata.json`, `screenshot.png`, and the Vite `base`.
- [ ] `src/platform.ts`:
  - `SessionClient` wiring;
  - loading the save and writing it with `putsave`;
  - effort from `getstate`;
  - the prompts: a d-pad now, the menu prompt when it exists;
  - pause and end handling;
  - the session image.
- [ ] `src/effort.ts`:
  - the three sources and the conversion (from gamekit once it's there);
  - smoothing, the cap, and nulls;
  - the moving check for heart rate.
- [ ] `src/main.ts`: boot from the start payload when `?session=` is present, with developer keys off unless
  the session is a debug one.
- [ ] HUD: readings in the player's units, effort as a percentage of steady, the platform's pause message, and
  the duration countdown.
- [ ] Tests:
  - the treadmill estimate: rising with speed and incline, 0 when stopped, no jump across the walk/run blend;
  - effort from each source;
  - the moving check;
  - stale taps dropped by `rev`;
  - a `ChoiceList` turned into a menu prompt and back.

## 12. Open questions

1. Heart rate: only a fallback, or blended with the machine (say, the higher of the two)?
2. Hills (§3.3): should the game set the treadmill's incline and a bike's grade from the road?
3. A discarded session: keep the game progress, since the pedaling was real (proposal), or roll back to the
   last completed session's save?
4. A bike with no power reading and no strap: cadence as a last resort, or not supported?
