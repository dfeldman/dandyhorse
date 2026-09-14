# Flight Cycle: can anyone fly through the rings?

The whole game is one control: the harder you pedal, the more the plane climbs. Between the pedals and the plane
sit a person, a trainer, Bluetooth, the bridge, the server and two filters, and each adds lag. This file works out
how much. It asks whether a first-time rider can still fly through most rings, and what had to change so they can.
The simulation behind the numbers is `tools/playability.ts` (`node tools/playability.ts [1|2|3|4]`).

**The short answer.** As the prototype stands, no. A practised rider who has fully learnt the lag hits 38% of the
rings. A first-time rider following the on-screen arrows hits 22%. Chasing the rings also keeps the rider above
140% of their steady power for 16–29% of the time: sprints, not a workout anyone can do. With the changes below,
the same first-time rider hits 93–96%, and a practised one 100%. Riders spend about a fifth of the time above 120%
of steady and 2–4% above 140%.

| | Prototype | Flight Cycle |
|---|---|---|
| Rings a lap | 25 (98 m, 8 s apart) | 14 (176 m, 15 s apart) |
| Counts as through a gold ring | within ±6 m of its height | within ±9 m, and the ring is drawn bigger to match |
| Red rings | ±6 m, as gold | ±6 m, now the harder bonus |
| Height change from one ring to the next | up to 35 m | up to 20 m |
| Pedal, climb, ease off cue | the plane's height now | the plane's height 3 s from now |
| Speed boosts (Turbo plus ring pulses) | up to +59% | up to +25% |
| gamekit's smoothing of power | 3 s | none: the trainer and the game already smooth |

## 1. How the plane answers the pedals

Effort `e` is power over the rider's steady power (Preferences → Fitness), minus one. `e = 0` is level flight,
`+0.3` is 130% of steady, `-1` is not pedalling. The game (`public/js/plane.js`) turns effort into a nose angle, up
to 25° at `e = ±1`. The nose follows with a 1.2 s lag (`PITCH_TAU`), and the plane climbs at `speed × tan(pitch)`. At
the cruise speed of 12 m/s, `+0.3` climbs 1.6 m/s.

So effort sets the climb rate, not the height: the height is the running total of how far you have been above or
below steady. Holding a height means pedalling exactly at steady; changing height is a surge or an easy spell,
then a return to steady at the right moment. That return is where the lag bites. Anything the rider does shows up
in the plane seconds later, so they must ease off before the plane reaches the ring's height, and by an amount
they cannot see yet.

## 2. The lag, stage by stage

From the moment a rider decides to push harder to the moment the plane's climb changes:

| Stage | Typical | Range | Why |
|---|---|---|---|
| Seeing the plane and deciding | 0.5 s | 0.3–0.8 s | a choice reaction to something moving on screen |
| Legs and flywheel reaching the new power | ~1 s | 0.5–1.5 s | in a trainer's resistance or sim mode a rider changes power by spinning up the flywheel or shifting |
| The trainer's own averaging of power | ~1 s | 0.5–2 s | Riders measure 2–3 s from pushing to the number moving on a Tacx Neo and a KICKR Core, and about 5 s on an older Tacx Flux. Some of that is the other stages below. |
| The trainer's broadcast | 0.5 s on average | 0–1 s | FTMS and ANT+ trainers send power once a second (Wahoo: 10 times a second only in its Wi-Fi race mode) |
| The bridge forwarding it | 0.5 s on average | 0–1 s | the bridge sends the newest reading to the server once a second (`bridges/web/src/bridge.ts`, the putstate schedule), on its own clock |
| Server and the game's long-poll | 0.3 s | 0.1–0.5 s | `getstate` returns as soon as the bridge's report lands |
| gamekit's smoothing of power | 3 s | | `SMOOTHING.power` in `libs/gamekit/src/effort.ts`: a 3 s exponential filter |
| The game's pedal filter | 0.25 s | | `INPUT_TAU` |
| The nose following the pedal | 1.2 s | | `PITCH_TAU` |

The two once-a-second stages are independent clocks. A reading can wait up to a second at the trainer and up to
another second at the bridge: up to 2 s, 1 s on average.

Adding the delays and time constants gives the effective lag the rider has to fly through:
- **today: about 8 s**, of which gamekit's smoothing is 3 s;
- **without gamekit's smoothing: about 5 s** (the trainer's averaging and the game's two filters already smooth
  the reading, so gamekit's third filter only adds lag);
- **at worst: about 8 s even without it** (a sluggish trainer, both one-second clocks at their worst, a slow
  reaction).

## 3. How evenly people pedal

Holding a power is not exact. Dobiasch et al. (2022) had 31 recreational to well-trained cyclists hold a constant
target power for 3 minutes, with the target on screen.
- **The targets** were about 80% of each rider's peak power, a few hundred watts.
- **Once settled**, the error was about 14 W RMS, roughly 5% of those targets.
- **In the first 30 s** it was 21–27 W.

Newer riders at lower powers wobble more as a share: the same 14 W at 130 W is 11%.

The simulation's riders wander as much when they try to hold steady:
- **practised:** 7% RMS, reaction 0.5 s, legs 1 s, will surge to +60% and ease to -50%;
- **first ride:** 11% RMS, reaction 0.8 s, legs 1.5 s, will surge to +40% at most.

Both wobble more than the study's cyclists, so the numbers below lean cautious.

## 4. Why the prototype's rings were out of reach

**The steps were sprints.** Rings 8 s apart could differ by 35 m. Climbing 35 m in 8 s needs 4.4 m/s, a 20° nose,
or `e ≈ +0.8`: 180% of steady power for most of every such gap. With the lag, the rider has even less than 8 s.

**Easing off comes too late.** Suppose the rider eases off the moment the plane reaches the ring's height. The
plane keeps climbing for the lag: 2 m/s for 5 s is 10 m, beyond the ±6 m window. The rider has to ease off early,
by an amount set by a lag they cannot see.

**The loop is slow.** Flying a height through a lag is the classic manual-control problem. McRuer's crossover model
says people adapt until the whole loop behaves like `ωc·e^(-sτ)/s`. With a comfortable 45° of phase margin, the
fastest they can close the loop is `ωc ≈ (π/4)/τ`. At τ = 5 s that is 0.16 rad/s: a height change takes 15–20 s to
settle within a few metres. The prototype's rings came every 8 s.

**Effort as height is worse.** The obvious alternative makes effort set the height itself, so steady pedalling holds
any height. Then the rider's power wobble goes straight into the height. At 120 m of height per unit of effort,
±9 m is ±7.5% of power, tighter than the 7–11% people wobble. The simulation tops out at 86% for it, whatever the
spacing. Effort setting the climb rate integrates the wobble, which averages it out, and that is why the game's
own design wins once the rings are spaced for the lag.

## 5. The simulation

`tools/playability.ts` flies the whole loop at 10 Hz, stage by stage as in §2:
1. The rider sees the plane's height and climb as they were a reaction time ago, and the next ring's height.
2. They pick an effort, and their legs get there with the rider's lag and wobble.
3. The trainer averages it over its window and reports once a second, and the bridge forwards the newest report
   once a second on its own clock.
4. gamekit and the game smooth it, and the plane follows the game's equations.

Ring heights come from the game's random walk (`public/js/rings.js`).

Two kinds of rider:
- **Gains learnt:** the rider pushes in proportion to how far off the ring's height they are, and eases off in
  proportion to how fast the plane is climbing. A grid search finds the gains that hit the most rings, which is a
  rider who has fully learnt the lag. Those gains then fly fresh ring sequences.
- **Arrows:** the rider just follows the HUD: +30% on "▲ pedal faster", -30% on "▼ ease off", steady on
  "● hold it". This is the realistic first ride.

Each result is 24 runs of 40 rings. `hit` is the share of rings flown through. `>+20%` and `>+40%` are the shares of
the time above 120% and 140% of steady.

## 6. Results

**The prototype** (25 rings, ±6 m, steps up to 35 m):

| Rider | Hit | >+20% | >+40% |
|---|---|---|---|
| practised, gains learnt | 38% | 38% | 29% |
| practised, gains learnt, without gamekit's smoothing | 56% | 33% | 25% |
| practised, gains learnt, without smoothing, Turbo | 32% | 36% | 25% |
| first ride, gains learnt | 34% | 41% | 16% |
| first ride, arrows (and the prototype's boosts) | 22% | 30% | 5% |

**Spacing and window** (first ride, gains learnt, no gamekit smoothing, height steps up to 20 m):

| Ring spacing | ±6 m | ±9 m | ±12 m |
|---|---|---|---|
| 98 m (8 s) | 68% | 83% | 90% |
| 150 m (13 s) | 93% | 98% | 99% |
| 200 m (17 s) | 99% | 100% | 100% |
| 300 m (25 s) | 99% | 100% | 100% |
| *effort as height, 200 m* | *57%* | *75%* | *86%* |

Smaller steps and no gamekit smoothing alone take a learnt first ride at the prototype's 98 m and ±6 m from 34% to
68%. Spacing does the rest: from 150 m (13 s) on, the window hardly matters.

**Candidates** (first ride, gains learnt on the ordinary case, then the same gains in the harder ones):

| | 16 rings (154 m) | 14 rings (176 m) | 12 rings (206 m) |
|---|---|---|---|
| first ride | 98% | 99% | 100% |
| Turbo, at the prototype's +59% | 77% | 91% | 95% |
| with gamekit's 3 s smoothing | 92% | 94% | 97% |
| sluggish trainer (4 s) | 96% | 98% | 99% |
| timid (gains halved) | 97% | 96% | 98% |
| eager (gains doubled) | 97% | 99% | 99% |
| no anticipation (never eases off early) | 88% | 92% | 90% |

Fourteen rings keep the game lively and stay above 90% in every case on its own.

**Cases combined, and the cue.** Put the hard cases together: a first ride, no anticipation, Turbo at the
prototype's +59%. The rider then hits only 61%, 47% on a sluggish trainer, and 41% with gamekit's smoothing. The
rider who never eases off early is exactly the rider who follows the prototype's arrows. The arrows judge the
plane's height now, so they say "hold it" only once the plane is already at the ring's height, and the plane then
overshoots. Judging the height a few seconds ahead instead does the anticipation for the rider:

| First ride following the arrows, boosts capped at +25% | cue judges now | 1.5 s ahead | 2.5 s ahead | 3.5 s ahead | 5 s ahead |
|---|---|---|---|---|---|
| ±20% on the arrows | 75% | 77% | 79% | 80% | 80% |
| ±30% | 83% | 90% | 92% | 93% | 93% |
| ±40% | 79% | 93% | 97% | 97% | 97% |

**As built** (14 rings, gold ±9 m, red ±6 m, steps up to 20 m, the cue 3 s ahead, boosts up to +25%, no gamekit
smoothing):

| Rider | Hit | >+20% | >+40% |
|---|---|---|---|
| first ride, gains learnt | 99% | 21% | 4% |
| first ride, gains learnt, red rings | 97% | 21% | 4% |
| first ride, arrows | 96% | 18% | 2% |
| first ride, arrows, red rings | 90% | 22% | 3% |
| first ride, arrows, boosts at the cap | 93% | 20% | 3% |
| first ride, arrows, boosts as the prototype (+59%) | 84% | 23% | 2% |
| first ride, arrows, capped boosts, sluggish trainer | 87% | 23% | 3% |
| first ride, arrows, capped boosts, with gamekit's smoothing | 80% | 25% | 4% |
| practised, gains learnt, capped boosts | 100% | 19% | 8% |

(Arrows with the prototype's cue on the new course: 89%, and 70% with the prototype's boosts.)

## 7. Boosts

Speed does not change the plane's path, only the time the rider has to fly it. The climb is
`speed × tan(pitch)`, so the height gained per metre flown is `tan(pitch)` at any speed: at a given effort, the
plane draws the same line through the sky. What speed changes is the lag, counted in metres. The 5 s of lag at 12
m/s is 60 m of the 176 m between rings, and at +59% it is 95 m. Capping Turbo and the ring pulses together at +25%
(75 m) keeps a first ride following the arrows at 93%. The sense of speed comes from the rest of Turbo: the wider
field of view, the flame trail, and 2× points.

## 8. How hard it is

The goal is exercise that anyone can do, with some challenge. Over a ride, the average effort is steady, because
every climb is paid back by a descent. The challenge is in the surges:
- a first ride spends about a fifth of the time above 120% of steady, in climbs of 10–15 s;
- and 2–4% of the time above 140%.

The prototype's rings demanded 180% surges, which only a practised rider will do, and not for 30 minutes.

The steady power is the rider's own (Preferences → Fitness: steady watts, or 65% of FTP, or 130 W by default). A
rider whose steady is set too low climbs at their natural pace and learns to ease off; one set too high dives.

## 9. What to check on real bikes

Everything above is a model. What would change the numbers:
- **The lag.** Measure a trainer: pedal a sharp surge and watch how long the plane takes to pitch up. Past about 6 s,
  consider 12 rings a lap (`NUM_RINGS`).
- **Hit rates.** Each tick the game sends the rings hit and passed (setstate `custom`), so every session's log
  records real hit rates. Below about 85% for new riders, widen the window (`RING_HIT_TOL`) before spacing the
  rings further.
- **The cue's lead** (`CUE_LEAD`, 3 s) should match the real lag; 2.5–5 s all score within a few points.
- **An automatic trim** is an idea for later: nudge level flight toward the rider's own average power over the
  first minutes, so a wrong steady setting cannot make the game feel broken. The cost is a game that also gets
  easier as the rider tires.

## Sources

- Dobiasch, Krenn, Lamberts and Baca, *The Effects of Visual Feedback on Performance in Heart Rate- and
  Power-Based-Tasks during a Constant Load Cycling Test*, Journal of Sports Science & Medicine (2022):
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC8851120/>
- DC Rainmaker, *Wahoo KICKR MOVE vs Tacx NEO 3M*: Wahoo's "once/second" broadcast and its 10 Hz race mode:
  <https://www.dcrainmaker.com/2023/12/trainer-comparison-review.html>
- Zwift forums, *Trainer lag*: about 3 s from pushing to the power showing, KICKR Core over Bluetooth:
  <https://forums.zwift.com/t/trainer-lag/58169>
- Singletrack forum, *Smart trainer responsiveness and Zwift*: 2–3 s on a Tacx Neo, about 5 s on an older Flux:
  <https://singletrackworld.com/forum/topic/smart-trainer-responsiveness-and-zwift/>
- GPLama, *Indoor Trainer Guide*: Elite Drivo resistance changes in Zwift "can be delayed 2-3 seconds":
  <https://gplama.com/indoor-trainer-guide/>
- McRuer's crossover model of human manual control (McRuer & Jex, *A Review of Quasi-Linear Pilot Models*, 1967);
  lecture notes: <https://ocw.tudelft.nl/wp-content/uploads/PA1_Part_1_-_McRuer.pdf>
