# Effort: making a game fit its rider

A game paced by raw watts or belt speed is a different game for every player. Tune the hills for 200 W and a
beginner walks them; tune them for 100 W and a fit rider never notices they are there. Effort is how Dandyhorse
avoids that: one number, the same on every machine, where **1.0 is the pace that player can hold all day**.

The library is [`libs/gamekit/src/effort.ts`](../libs/gamekit/src/effort.ts). The short reference for game
authors is the **Effort** section of [GAME_AUTHORING.md](GAME_AUTHORING.md); this is the long version — what the
numbers mean, what the meter does behind your back, and how each game uses it.

---

## 1. The contract

```
effort = live ÷ steady
```

`live` is what the player is doing right now; `steady` is what that person can hold all day. Both are in watts,
so the ratio is dimensionless: a beginner at 100 W and a fit rider at 200 W both read **1.0** when they are
riding comfortably. A game that paces itself by effort is equally hard for both, and a game that pays out by
effort pays them the same.

### Where `live` comes from

| Source | How | Notes |
|---|---|---|
| `power` | measured watts | any machine but a treadmill |
| `treadmill` | belt speed + incline as bike-equivalent watts | see below |
| `heartRate` | heart-rate reserve, `(hr − resting) ÷ (steadyHr − resting)` | lags by up to a minute |
| `cadence` | `rpm ÷ 80`, capped at 1.5 | a last resort: cadence cannot see the resistance |

A treadmill reading becomes watts with the ACSM oxygen cost, so that one `steady` number works on both machines:

```
walking   W = m · v · (0.50 + 9.0 · g)
running   W = m · v · (1.00 + 4.5 · g)
```

`m` is the rider in kg (75 if unknown), `v` the belt in m/s, `g` the incline as a fraction; a decline counts as
flat. ACSM switches formula at 1.8 m/s, which would nearly double effort across a tenth of a metre per second,
so `treadmillWatts()` blends the two over **1.6–2.2 m/s**. The constants are derived in `effort.ts`; don't
re-derive them.

### Where `steady` comes from

Most specific first (`steadyWatts()` in `effort.ts`). On a **bike** the pace entries are skipped:

| # | Source | |
|---|---|---|
| 1 | `device.steadyPace` | treadmill only — this machine's `{speed, incline}` |
| 2 | `device.steadyWatts` | this machine's watts |
| 3 | `global.steadyPace` | treadmill only |
| 4 | `global.steadyWatts` | **what the console's Fitness buttons write** |
| 5 | `0.65 × global.ftp` | the middle of the endurance zone |
| 6 | `DEFAULT_STEADY_WATTS` = 130 W | nothing set |

The player sets this in the console under **Preferences → Fitness**
([`consoles/web/src/fitness.ts`](../consoles/web/src/fitness.ts)), four buttons backed by gamekit's
`FITNESS_LEVELS`:

| | Starting out | Regular | Fit | Very fit |
|---|---|---|---|---|
| steady watts | 100 | **130** | 160 | 200 |

Heart rate has its own chain (`steadyHeartRate()`): `steadyHr` if set, else the top of zone 2 from `hrZones`,
else `resting + 0.6 × (max − resting)`, where max is `maxHr`, or `208 − 0.7 × age`, or 180. Resting defaults to
60 bpm. Resting 60 and max 180 give a steady of 132 bpm.

---

## 2. What the meter does for you

`new EffortMeter({deviceType, prefer, bodyData, preferences, smoothing})`, then `meter.update(state, seconds)`
on every getstate and `meter.value(seconds)` whenever you need a number. It applies the rules every game should
apply alike, so they do not drift apart game by game:

- **Holds a reading between polls**, then **drops to 0 after 3 s** (`HOLD_SECONDS`). It never reports a stale
  number — the whole platform, auto-pause included, depends on that.
- **Smooths per source** (seconds): power 3, treadmill 1, cadence 2, heart rate 0. Override with
  `smoothing: {power: 0}` when your game supplies its own inertia and cannot afford the lag.
- **Caps at 3.0** (`EFFORT_CAP`), so a 1000 W spike or a bad packet cannot win a fight in one second.
- **Falls back** when the chosen source reads nothing — see below. `readout().note` explains it in words
  ("No power reading: using heart rate") and `describeEffort()` / `describeSteady()` give a HUD its text.
- **Vetoes heart rate when the machine says you stopped** — but only while the machine is *still reporting* and
  reporting zero. If the machine goes **silent**, nothing is vetoed, and a strap keeps earning for as long as
  your pulse stays up.
- **Follows the machine you are actually on**: `getstate.devicePreferences` refreshes the device block, so a
  per-machine steady arrives even when the start payload had none.

### The fallback is a decision, not a default

`pick()` tries the machine first, then heart rate, then (on a bike) cadence. **That is a feature in a game paced
by how hard you are working and a bug in a game with physics underneath it.** A heart-rate strap reads high for
a minute after you stop pedalling, so a bike driven straight from `value()` will roll on your pulse.

If your game must not do that, gate on the source and treat anything else as "not pedalling":

```ts
// games/rollinghills/src/drive.ts
export function machineEffort(readout: EffortReadout, deviceType: DeviceType): number | null {
  const want = deviceType === 'treadmill' ? 'treadmill' : 'power'
  return readout.source === want ? readout.effort : null
}
```

Auto-pause bounds the damage but does not remove it: the server pauses after 5 s (`PAUSE_AFTER`) without
*exercise-device* data — "heart rate never pauses a session" — so a silent machine freezes the game. The case
the gate is really for is a trainer that keeps reporting but drops power: no pause, and heart rate quietly
takes over.

---

## 3. Choosing a mapping for a new game

Effort is a ratio. Your game needs a quantity. There are three conventions in the tree; pick by asking **what
your game's input physically is**.

### `50 × effort` → a pedal of 0–100

For a world with its own inertia and a target the player aims at. **50 is steady pace** — that convention is
load-bearing, not decoration: Night Watch's ship needs are written as `LEVELS: [0, 40, 50, 57, 64]`, and "level
3 asks for 14 % over steady" is only true because 50 means steady. Clamp at 100 (`PEDAL_MAX`).

```ts
pedal = () => this.latest ? Math.min(100, 50 * this.meter.value(seconds())) : null
```

Used by Flight Cycle, Night Racer, Night Watch.

### `effort × DEFAULT_STEADY_WATTS` → watts into a force model

For a game with real physics, where the input has to be watts. Multiplying by the platform default means a
rider whose steady pace *is* the default rides exactly as they did before effort existed — a free
backwards-compatibility property. Import the constant; don't write 130.

```ts
power = m.effort == null ? 0 : m.effort * Config.REFERENCE_WATTS   // REFERENCE_WATTS = DEFAULT_STEADY_WATTS
```

Used by Rolling Hills.

### `effort × rate` → a resource

For anything that accumulates. Kingdom Trek earns `effort × 1` Energy per second, so a level takes everyone
about the same time.

---

## 4. How each game uses it

| Game | Machines | Source gate | Effort becomes | Smoothing |
|---|---|---|---|---|
| **Rolling Hills** | bike, treadmill | **machine only** (`machineEffort`) | `effort × 130 W` into `bikeAccel` | power 0 |
| **Flight Cycle** | bike | none (power → HR → cadence) | `50 × effort` → pedal | power 0, cadence 0 |
| **Kingdom Trek** | bike, treadmill | none — **by design** | `effort × 1` Energy/s | default |
| **Night Racer** | bike, treadmill | none | `50 × effort` → pedal | default |
| **Night Watch** | bike, treadmill | none | `50 × effort` → pedal | default |
| **Mock Game** | bike, treadmill | — | does not use effort | — |

**Rolling Hills** is the only game that gates. Both variants pedal one virtual bike: on a treadmill, belt speed
and incline become watts, so the game asks the machine for incline and that same incline raises effort — a climb
costs the rider more *and* carries the bike up the hill. Its mass still comes from body weight, so a heavier
rider climbs slower at equal effort (§5).

**Flight Cycle** turns power off for smoothing because every second of lag costs rings, and zeroes cadence
smoothing too — so on a trainer that drops power, cadence flies the plane. It does not gate, so a heart-rate
strap can also fly it; worth revisiting if anyone reports a plane that will not descend.

**Kingdom Trek** is the reason the fallback exists. It offers `effortFrom: machine | heartRate` as a launch
option and will *prefer* heart rate when the player has a target, because Energy from a strap is a legitimate
way to play. Its `hills` option separately drives incline or grade.

**Night Racer** and **Night Watch** take the meter ungated with default smoothing; both add their own inertia on
top (the car's accel/decel; the lamp's flywheel and the ships' 2.2 s drift). Night Watch is the purest use of
the scale — a ship's "need" is a pedal number, so the platform's per-user steady watts is the only thing that
sets how hard the night is.

**Mock Game** exercises the raw wire API and deliberately does not use effort.

---

## 5. What effort does not do

- **It does not cancel body weight everywhere.** Effort is weight-neutral only when `steady` came from a *pace*
  (chain entries 1 and 3): the pace converts to watts at the same weight `treadmillWatts()` uses, so weight
  cancels. If steady came from **watts** — which is what the Fitness buttons write — a heavier walker reads
  *higher* effort at the same belt speed. Games with a force model reintroduce weight too: Rolling Hills climbs
  with `MASS = weight + 10`.
- **It does not learn.** Steady is whatever the player declared, for as long as they leave it alone; nothing
  calibrates it from session history. Deferred deliberately (2026-09-20).
- **It does not replace per-game difficulty, and can double-count with it.** Night Watch scales every need by
  `DIFFICULTY` (0.88 / 1.0 / 1.08) and Kingdom Trek has `hills`, both on top of effort. Scale how far targets
  sit *above* steady, never steady itself.
- **It does not normalise time.** Thirty minutes is thirty minutes for everyone. Effort makes the *rate* fair,
  not the total.

---

## 6. Testing it

[`games/rollinghills/src/effort.test.ts`](../games/rollinghills/src/effort.test.ts) is the template. Three
assertions are worth copying into any game that adopts effort:

1. **Every fitness level gets the same result at its own steady pace.** Build a meter per entry in
   `FITNESS_LEVELS`, feed `{power: level.watts}`, and assert the game's output is equal across all four.
2. **The platform default is unchanged.** A rider at `DEFAULT_STEADY_WATTS` should match what the game did
   before effort, exactly.
3. **The gate refuses heart rate and cadence** — if your game gates.

Add a treadmill case: a meter with `steadyPace {speed: 1.4, incline: 0}` fed `{speed: 1.4, incline: 0}` must
read effort ≈ 1.0. The meter's own behaviour (hold, cap, fallback order, the HR veto) is covered by
[`libs/gamekit/src/__tests__/effort.test.ts`](../libs/gamekit/src/__tests__/effort.test.ts); don't retest it.

Game modules under `src/game/` read the page URL as they load, so a test importing them needs a stubbed
`location` and `window` before a dynamic import — see the top of `effort.test.ts`.
