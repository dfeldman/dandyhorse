# Lane One

The plain one. A treadmill and bike console on the big screen, with the programmes a good machine has —
**Manual, Steady, Hills, Intervals, Pyramid, Random and Heart rate** — every number a console shows, and a
400 m athletics track seen from above so each lap you run is a lap you can see.

There is no story and no score. It is the game for the days you do not want a game, and the one that
exercises every dial a machine has: belt speed, incline, trainer grade and ERG watts.

TypeScript + Vite, canvas 2-D, no engine and no assets — the built site is about 60 kB. It runs on its own
today; [INTEGRATION.md](INTEGRATION.md) is the plan for the Dandyhorse platform.

## Run

```bash
npm install
npm run dev        # http://localhost:5198
npm test           # programmes, the track, what gets sent to a machine, the clock (vitest)
npm run programs   # every programme's shape as a chart in the terminal
npm run build      # static site in dist/
```

URL options:

| | |
|---|---|
| `?program=hills` | manual, steady, hills, intervals, pyramid, random, heartrate |
| `?minutes=30` | how long the programme is laid out over |
| `?level=5` | 1–10; how far the programme swings from the pace you set |
| `?device=treadmill\|bike` | which machine to simulate |
| `?drive=you\|machine` | who follows the programme (see below) |
| `?goal=time\|distance\|calories` and `?target=5000` | what ends the workout (metres or kcal) |
| `?units=metric\|us` | km/h and km, or mph and miles |
| `?seed=123` | the same Random programme every time |
| `?steady=150` | the player's steady watts, which is where a bike's base starts |
| `?speed=2.2` / `?power=180` | hold the simulated player's own setting and hide the slider (screenshots) |
| `?nohr=1` | no heart-rate strap |
| `?at=600` | open on a workout already this many seconds in (screenshots) |
| `?auto=0` | the simulated player stops following the console's advice |
| `?start=1` | skip the setup screen |

## Controls

| | |
|---|---|
| ↑ / ↓ | speed (treadmill) or target watts (bike), one step |
| ← / → | incline or grade, one step |
| P or Esc | pause |
| V | big numbers, and back |
| S | sound on or off |

Everything is on screen too. The ± clusters and the one-touch keys are the console's; on the platform the
same ± buttons appear on the phone (INTEGRATION.md §5).

## Who follows the programme

The one choice that changes how a workout feels.

- **You** (the default). The console drives only the hill — the incline on a treadmill, the grade on a
  trainer — and shows you the pace or the watts to match. The belt stays yours, which is safer and lets a fit
  person run the same programme faster. This is also the platform's own rule for treadmill games.
- **The machine.** The console drives everything: belt speed and incline, or ERG watts. The programme runs
  itself and your job is to keep up. On a bike in ERG there is no hill to feel, so a programmed climb becomes
  watts instead.

Either way the rule is the same: **the ± buttons move the number you can see.** Press + during an interval
that is asking for 1.35 × your pace and the number on screen goes up by exactly one step — and the whole rest
of the programme shifts with it. That is what makes a programme that started too hard recoverable without
stopping.

## The programmes

`npm run programs` prints all of them with the figures that matter. At 30 minutes and level 5:

| | | |
|---|---|---|
| **Manual** | one segment, start to finish | Nothing changes but what you change. |
| **Steady** | warm up, hold, cool down | The plain half-hour. |
| **Hills** | 4 climbs to 6 %, 68 % of the time above your base | The pace is yours throughout; only the hill moves. |
| **Intervals** | 9 × (1 min hard, 1½ min easy) | 1.35 × your pace and a percent of hill on the hard bits. |
| **Pyramid** | 11 steps up to 1.35 × and back | Half the workout above your base. |
| **Random** | 45–90 s blocks, alternating | The same seed gives the same workout, so you can repeat one. |
| **Heart rate** | holds a zone | The console moves the pace itself to keep you there. Needs a strap. |

Every programme fits any length from five minutes to two hours: the warm-up and cool-down are a share of the
workout inside fixed bounds, and the middle takes a whole number of cycles stretched to land exactly on the
end. There is never a part-segment and never a gap — [tests/program.test.ts](tests/program.test.ts) pins both
for nine lengths across all seven.

**Level** (1–10) scales how far a programme swings from the base, and never touches the warm-up. On a
heart-rate programme the level *is* the zone: 1 holds 40 % of your heart-rate reserve and 10 holds 80 %.

## Finishing

Three goals, as a console offers: **time**, **distance** or **calories**. Whichever one you pick counts down,
takes the accent colour and carries a progress bar; the other two count up. The programme always runs on its
own clock — finish a 5 km early and you stop mid-programme; finish it late and the cool-down holds until you
are there.

## What is on the screen

- **The track.** A World Athletics standard 400 m oval, to scale: 84.39 m straights, a 36.5 m kerb and eight
  1.22 m lanes, which is what makes lane 1 exactly 400.00 m and lane 2 exactly 407.04 m
  ([tests/track.test.ts](tests/track.test.ts) checks both). You run in lane 1; the **pace marker** out in
  lane 3 is where the programme meant you to be by now, so the gap between you is the whole story. The ring
  around the outside fills as the goal is met.
- **Three headline numbers** — time, distance, calories — and six tiles. A tile shows what the machine reads
  in white and what the programme asked for underneath in blue, and its left edge turns green when the two
  agree.
- **The heart-rate zone strip**: the five zones as one bar with a needle at your heart rate, and the minutes
  you have spent in each underneath.
- **The programme chart**, with the segment you are in lit up and a playhead. A bar's height is how hard it
  is, where the line the bars sit on is the pace you dialled in.
- **The last six minutes** as a chart: what you did, dashed over it what was asked, and your heart rate in
  its zone's colour.
- **Callouts.** Ten seconds before a segment changes the console says so, and names the next one; each lap
  gets its time. There are three small beeps, and an **S** to turn them off.
- **Big numbers** (**V**): six figures the size of the screen, for when the track is not the point.

## After the workout

- **A recovery minute.** Stand still and the console watches how far your heart rate falls — one of the few
  things a machine can tell you that a stopwatch cannot. A drop of 30 or more is a strong recovery; under 12
  is the number sports medicine flags. Skippable, and never offered without a strap.
- **The summary**: the totals, time in each zone, every lap with its split (the fastest in green), anything
  you beat, and anything you earned — eight of those, from a first lap round the track to five laps within
  five seconds of each other. Personal bests per machine — fastest lap, furthest, most calories, biggest climb — live
  in `localStorage` standalone and become platform save state on integration.

## How it is put together

| | |
|---|---|
| [src/track.ts](src/track.ts) | the oval: pure geometry, no drawing |
| [src/program.ts](src/program.ts) | the seven programmes as relative segments; pure |
| [src/drive.ts](src/drive.ts) | what one particular machine is asked for; pure, and the part that touches somebody's treadmill |
| [src/machine.ts](src/machine.ts) | the seam: everything read from a machine and asked of it |
| [src/sim/machine.ts](src/sim/machine.ts) | a simulated treadmill and trainer — belts that take time to speed up, incline motors that take longer, heart rate that lags by half a minute |
| [src/workout.ts](src/workout.ts) | the clock, the programme cursor, the base the ± buttons hold, laps, splits, zones, the goal and the achievements |
| [src/physics.ts](src/physics.ts) | calories (the ACSM and power formulas the platform's server uses, so the numbers agree) and bike speed from watts |
| [src/config.ts](src/config.ts) | every tunable, the FUN KNOBS marked |
| [src/render/](src/render/) | the track, the programme chart and the trend chart, all canvas 2-D |
| [src/ui/](src/ui/) | the console, the setup screen, the recovery minute and the summary |

The simulator is not a stub. The belt ramps at 0.15 m/s², the incline motor at half a percent a second, an
ERG trainer settles over a couple of seconds and never lands exactly, and heart rate follows the workload
with a 25-second rise and a 45-second fall. Those four lags are why the console shows requested beside
actual, and you cannot judge the screen without them.
