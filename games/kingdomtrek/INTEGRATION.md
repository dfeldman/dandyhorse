# Kingdom Trek on Dandyhorse

What it takes to run Kingdom Trek on the exercise platform (Dandyhorse, `~/dandyhorse`). This covers only the
points where the two meet. The game's own rules are in [docs/DESIGN.md](docs/DESIGN.md), and the platform's
contract for games is `dandyhorse/docs/GAME_AUTHORING.md`.

**Built on 2026-09-13** (git branch `kingdomtrek-integration`). What follows is the design as agreed. Notes marked
*As built* say where the build differs, §10 and §11 are ticked, §12's open questions are answered, and §13 lists the
decisions made while building it that may need revisiting.

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

  The engine doesn't change. *As built*, it gained three small things: `openMenu({ timeUp })`, `sessionDeeds()`
  (shared by the farewell and the session picture), and the panel's `pick(id)` for phone taps.
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

*As built:* `capabilities` also has `"autoPause": false` (§5), and a second option, `hills` (§3.3), carries a
`controls` map.

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

*As built:* the menu prompt (§4.2) was built at the same time, so the game uses it from the start and never sends
the d-pad-only prompt.

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
  - *As built:* a debug session writes the hero back until a developer tool is used (`[` `]`, `F`, or
    `window.kingdomTrek.setEffort`, `feed`, `setTarget`, `setTimeScale` or `step`). From then on it checkpoints to
    localStorage only (`kingdomtrek.save.debug`), and a toast says so. The console launches in debug by default and
    simulators need it, so "never" would have meant nobody testing today ever kept a hero (§13).

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

## 10. Suggested platform changes (built 2026-09-13)

Inputs:
- [x] **Menu prompt** (`layout: "menu"`): items with ids, disabled flags and hints, up to 100 of them, plus
  `highlight`, `back`, `countdown`, the d-pad buttons, and `rev` echoed in every answer. The server logs the
  prompt in full only when `rev` changes; otherwise `{promptId, rev, highlight}` (§4.2).
  - Server: `lifecycle._validate_menu()`. gamekit: `menuPrompt()`, `readMenuAnswer()`, `isStaleAnswer()`. Bridge:
    the menu panel.
  - *As built:* item ids may not be d-pad button names; gamekit sends them as `item:<id>` (§13).
- [x] **Game iframe:** `allow="fullscreen; gamepad"`, and focus on load and after overlays (§4.3).
- [x] **Phone d-pad:** hold to repeat, 0.4 s then every 0.13 s (§4.3).

Effort:
- [x] **`steadyWatts`** global preference, with a device-level override. The console's Fitness panel has the four
  levels, shows what the game will use (0.65 × `ftp` when only FTP is set, else 130 W), and takes a treadmill pace
  (§3.1, §3.3).
  - *As built:* the pace is stored as its own preference, `steadyPace: {speed (m/s), incline (%)}`, globally or per
    treadmill. It is used before `steadyWatts` on a treadmill, so the weight cancels out.
- [x] **`restingHr` and `steadyHr`** preferences (`maxHr` exists) (§3.4), in the same panel.
- [x] **gamekit `effort.ts`:** `treadmillWatts()`, `steadyWatts()`, `steadyHeartRate()`, `heartRateEffort()`, and
  `EffortMeter` (holding readings, smoothing, the cap, 0 after 3 s, fallback between sources, the moving check).
  `describeEffort()` and `describeSteady()` give the HUD's words (§3.5).

Pausing:
- [x] **`capabilities.autoPause: false`** (§5). The server never pauses such a session by itself, and Play resumes
  it at once. The session brief carries `autoPause`, and the bridge lets such a session start without a machine.
- [x] **`POST /gameapi/pause {sessionId, paused}`**, the same as the bridge's ⏸ and ▶ (§5), and gamekit's
  `SessionClient.setPaused()`. Every bridge shows "Paused in the game. Resume there, or press Play."

Console:
- [x] **Launch dialog:** device buttons, defaulting to a machine the user has connected now, else owns, else saw
  last (`consoles/web/src/launch.ts`).

Nothing new is needed for hills: `controls: incline/grade` already exists (§3.3).
- *As built:* one small addition was made after all. A launch option can change `controls`: an option's
  `controls` maps one of its values to per-device controls. So with Hills off the session's `controls` are `none`,
  and the bridge says "This game only reads your treadmill"; with Hills on they are `incline` or `grade`.

## 11. Changes in Kingdom Trek (built 2026-09-13)

- [x] `metadata.json`, `screenshot.png`, and the Vite `base`.
- [x] `src/platform.ts`:
  - `SessionClient` wiring;
  - loading the save and writing it with `putsave`;
  - effort from `getstate`;
  - the prompts: the menu prompt, built by `src/mirror.ts`;
  - pause and end handling;
  - the session image (`src/ui/sessioncard.ts`);
  - the map position and the Hills grade (`src/road.ts`).
- [x] `src/effort.ts`:
  - the three sources and the conversion (from gamekit);
  - smoothing, the cap, and nulls;
  - the moving check for heart rate.
- [x] `src/main.ts`: boot from the start payload when `?session=` is present, with developer keys off unless
  the session is a debug one.
- [x] HUD: readings in the player's units, effort as a percentage of steady, the platform's pause message, and
  the duration countdown.
- [x] Tests:
  - the treadmill estimate: rising with speed and incline, 0 when stopped, no jump across the walk/run blend
    (gamekit `effort.test.ts`);
  - effort from each source, and the moving check (gamekit `effort.test.ts`);
  - stale taps dropped by `rev`, and a `ChoiceList` turned into a menu prompt and back (`tests/platform.test.ts`);
  - Hills and the map position (`tests/platform.test.ts`).

## 12. Open questions (answered 2026-09-13)

1. **Heart rate: only a fallback, or blended with the machine (say, the higher of the two)?**
   - **Answer: a fallback, plus an explicit choice.** Effort comes from heart rate only when the player picks
     *Effort from: Heart rate* at launch, or when the machine reads nothing for 3 s (the HUD then says so).
   - Why not "the higher of the two": heart rate lags 30–60 s and stays up after you stop. Blending would let a
     past sprint keep paying out, and it would make tug-of-war heaves feel unanswerable.
2. **Hills (§3.3): should the game set the treadmill's incline and a bike's grade from the road?**
   - **Answer: yes, as a launch option, Hills: Off / On, Off by default.**
   - On: the grade follows the road's terrain; flat in town and in the menus (§13). That is also the only honest way
     to count incline on a treadmill that doesn't report it (the Horizon 7.0AT).
   - Off: the game sends no targets, and the machine's own buttons stay the player's.
3. **A discarded session: keep the game progress, since the pedaling was real, or roll back to the last
   completed session's save?**
   - **Answer: keep it.** The save is written on every checkpoint whatever becomes of the session, and every end
     (complete, discarded, superseded, reaped) writes the last checkpoint.
   - Rolling back would need a save per session, and would throw away real exercise.
4. **A bike with no power reading and no strap: cadence as a last resort, or not supported?**
   - **Answer: cadence as a last resort:** cadence ÷ 80 rpm, capped at 1.5×.
   - The HUD says "No power reading: using cadence, a rough guess".
   - Cadence can't see resistance, hence the lower cap. Refusing would lock out budget bikes entirely.

## 13. Decisions to revisit

Made while building this. Each says what was decided, why, and what would change it.

**Effort**
- **Steady pace when nothing is set: 130 W ("Regular").**
  - Until they pick a level, a beginner earns Energy a little slowly and a fit rider a little fast. The HUD shows
    "Steady 130 W", and the console's Fitness panel says "the default: pick yours".
  - Revisit if new players get it wrong: the game could ask on its first session instead.
- **A treadmill steady can be a pace** (`steadyPace`), used before `steadyWatts` on a treadmill, so the weight
  cancels out. The console stores the pace as entered and never converts it to watts.
- **Heart rate is a fallback only (§12.1)**, plus the explicit option. Not blended.
- **Cadence as a last resort (§12.4)**: ÷ 80 rpm, capped at 1.5× where the machine cap is 3×.
- **Smoothing:**
  - time constants: 3 s for power, 1 s for a treadmill, 2 s for cadence, none for heart rate;
  - a reading holds for 3 s, then effort is 0;
  - the cap is 3×;
  - all in gamekit: `SMOOTHING`, `HOLD_SECONDS`, `EFFORT_CAP`.
- **`hrZones`** is read as an array of zones, zone 1 first, each its top bpm or `{max}`. Nothing writes it yet.
- **The console restates gamekit's rules.** `consoles/web/src/fitness.ts` mirrors `libs/gamekit/src/effort.ts`
  because the console doesn't depend on gamekit. Keep them in step, or give the console the dependency.
- **The game's words still say "pedal" on a treadmill** ("Well ridden! You pedaled for…", "Pedal!" in a fight).
  Only the session-over card was made neutral ("You played for…").

**Hills (§12.2)**
- **Off by default.** On:
  - the grade follows the road's terrain (plains 1%, hills 3.5%, mountain 6%, …);
  - it rolls ±60% around that, with a rise about every 3 minutes;
  - it eases to flat at both town gates, stays within 0–8%, and is never a decline;
  - it is flat in town, in the menus and while paused (`src/road.ts`).
- Revisit if the grade should follow real heights on the map. The game files would need them.

**Menus and the phone**
- **Item ids may not be d-pad button names** (the server rejects such a menu). Kingdom Trek uses `back` as an
  option id on five screens. gamekit's `menuPrompt()` sends those ids as `item:<id>`, and `readMenuAnswer()` undoes
  it.
- **`rev` follows the list's structure, not its labels.**
  - It changes with where the list is, its title, its Back option, and which option ids there are and which are
    disabled. It doesn't change with labels: the gate's minutes change with your pace every second.
  - A tap is judged against the list on screen when it arrives, not the last one sent.
  - `rev` starts from the clock, so it never repeats across a reload.
- **Taps without a `rev`** (an older bridge) are accepted.
- **The server doesn't drop stale taps**: it records `rev`, and the game drops them. It does reject unknown and
  disabled items.
- **Keys and gamepad presses at the big screen are not echoed** to `answerinput`, although GAME_AUTHORING asks a
  game to answer its own prompt from its own buttons. At 10 Hz key repeat that would flood the log, and the phone
  follows the highlight within a tick anyway.

**Pausing**
- **The game's pause menu and its farewell pause the session**, and leaving them resumes it.
- **Play on a bridge closes the game's menu**, and closes the farewell as if "Keep playing" was picked.
- **A bridge's ⏸ opens the game's menu**, with the bridge's message as a notice. The game's own pause shows no
  extra notice.
- Device pauses can't happen (`autoPause: false`). The game would still freeze its clock if one came.
- **The adapter runs on the game's own timer, not on animation frames.** A hidden bridge tab gets no frames, which
  at first stopped the pause from reaching the platform.

**Saving**
- **Debug sessions write the hero** until a developer tool is used (§6, as built). After that they write to
  localStorage only.
- **A discarded session keeps its progress (§12.3)**, and so does a superseded one.
- **A save whose adventure has left the game index** keeps the hero and starts the next adventure.
- **An unreadable save** is kept in this browser (`kingdomtrek.save.unreadable`), and a new hero starts. Neither case
  happens today.
- **putsave** runs on every checkpoint, every 30 s, at the end, and on page hide (a beacon, since putsave accepts
  POST).

**The session**
- **Time's up:**
  - a toast at the planned time;
  - at the next arrival in a town, the pause menu opens as "⏱ Time's up", with End session first;
  - never forced, and never in a fight.
- **Map position:** 1 map unit = 10 m, so the region is 10 × 6.4 km. `y` = 0. On the road the position moves in a
  straight line between the two towns.
- **Achievements:** `kingdom-saved`, `level-2`, `level-5`, `level-10`, `first-craft`. `flawless` would need a new
  save field, so it was left out.
- **The session picture** is the kingdom's map with the hero and the day's deeds (`src/ui/sessioncard.ts`): a PNG,
  or a JPEG if the PNG is over 1 MB.
- **A new hero's stats** are rolled from the session's seed. `seed: false` in the metadata: sessions aren't
  comparable by seed.

**The owner's requests while building (2026-09-13)**
- **Tap or click a place in town:** the hero walks there and goes in (`placeUnder()` in `src/render/town.ts`).
  - The list still works as before: keyboard, gamepad, the phone's menu.
  - The d-pad still moves through the list, not across the map.
  - Still open: hide the list on touch screens? Move between places spatially with the d-pad? Swipe? None of these
    is built.
- **Touch screens and short screens:**
  - list rows are bigger on touch screens;
  - the list keeps room for about three rows, and the item card scrolls instead of squeezing it;
  - ✕ hides the card and "Show details" brings it back, so a phone in landscape works in shops.
- **The console-launched bridge returns to the console** 10 s after the game ends, onto the finished session; phones
  joined as remotes still stay remotes.
- **The launch dialog defaults to the one machine type the user owns**, even over one connected right now. With
  nothing ticked under "I own", the kinds of machine they have saved count as owned.
- **Device pills side by side** on the Games screen; they used to overlap.
- **The session viewer's profile:** each tick's `y` is the height of the ground.
  - Towns stand at a height set by their terrain (coast 5 m … snow 650 m), and roads roll 3–60 m between them.
  - It is a picture of the land, not of Hills: Hills never descends, and a climb from the coast to the mountains
    would be too steep to ride.
  - The profile's x axis is the platform's distance (from the machine), so the shape is the game's and the length
    the player's.
- **Other machines (rowers, ellipticals).** gamekit counts effort by measured power on any machine but a treadmill,
  and the HUD has a rower icon.
  - The platform still needs the device type itself: the server's `DEVICE_TYPES`, bridge drivers, and the console.
    Then the game adds it to `deviceTypes`.
  - The cadence fallback assumes a bike's pedaling rate.

**Loose ends**
- **A tab hidden for more than five minutes** gets its timers slowed to about once a minute by Chrome. On Dandyhorse
  the game catches up gaps of up to 65 s so its clock keeps pace with the workout. The bridge in the same tab is
  throttled too; that is the platform's problem, not this game's.
- **Players see "pedal"** on a treadmill (above).
- **"This session" means this page load.** The farewell card and the session picture count the minutes, Energy and
  deeds since the page last loaded (`engine.session`), so after a reload mid-session they undercount. Seen in
  testing when Chrome reloaded a long-hidden tab. A fix would keep the totals at the session's start next to its id.
- **The phone's menu:**
  - hold-to-repeat on the d-pad was tested with synthetic pointer events only, and a real long press on some phones
    may cancel it;
  - on a short phone (667 px or less) the d-pad sits just below the fold on the bridge's Home screen;
  - the Back button shows the back item's own label ("‹ ⏸ Pause"), and that item also stays in the list.
- **A game-less heart-rate step.** With no machine, a heart rate monitor is connected from the bridge's Devices tab;
  the setup wizard reaches its heart-rate step only after a machine.

**Fixed on the way**
- **The tug of war drew its rope mirrored.** Winning dragged the knot toward "… wins here ▶", so a won fight looked
  lost until VICTORY. Fixed with `knotShare()` in `src/render/battle.ts`, and tested against a real won and lost
  fight.
