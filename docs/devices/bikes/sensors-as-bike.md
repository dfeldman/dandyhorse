# Power meters, cadence sensors and bridges used as "the bike"

Many riders have a dumb bike or trainer plus a sensor: a pedal or crank
power meter, a cadence sensor, or a commercial-gym bridge. These are
**read-only**. The game reads power and cadence and shows grade as a target
the rider follows by hand.

**Recommendation: support.** It is cheap to build on the standard Cycling
Power (`0x1818`, measurement `0x2A63`) and CSC (`0x1816`, measurement
`0x2A5B`) services, and it covers every budget spin bike with a clip-on
sensor. Parsing is in `ftms-common.md`; QZ's crank-rollover bugs are noted
there.

## Routing in QZ

| device | QZ driver | how it is chosen |
|---|---|---|
| any power meter | Stages/power-meter driver | setting `power_sensor_as_bike` plus the sensor's name |
| Stages, Tacx Satori, Racer S, Elite trainers (read-only), Misuro B+, Tour 600, Smart+, ThinkRider A (18-char name), Favero Assioma | Stages/power-meter driver | names `STAGES `, `TACX SATORI`, `RACER S`, `ELITETRAINER`, `MISURO B+`, `TOUR 600`, `SMART+ #`, `THINK A`; two-letter `KU`, `QD`, `RM`, `DR`; three-letter `DFC`; `ASSIOMA` only when no separate power sensor is set |
| any cadence sensor | CSC driver | setting `csc_as_bike` plus the sensor's name |
| Joroto bikes | CSC driver | `JOROTO-BK-` |
| BGYM bikes | CSC driver | `BGYM` with an 8-character name |
| NPE CABLE bridge (commercial bikes) | NPE driver | `>CABLE`, `MD` + 5 chars, or `BIKE` + 2 chars when no Life Fitness or Technogym setting is on |

Short names like `KU`, `QD`, `RM` and `DR` are real power-meter names. They
also collide easily with other devices, so match them only on exact length.

## Power meter as the bike

* Power from `0x2A63` bytes 2..3.
* Cadence from the crank revolution fields in `0x2A63`; QZ zeroes it when the
  crank data stops.
* If an Elite service (`347b0001-…`) is present, the device is an Elite
  trainer and can be controlled; see `smart-trainers-other.md`. If FTMS is
  present, QZ switches to FTMS.

## Cadence sensor as the bike

Cadence comes from CSC crank data (or Cycling Power crank data when present).
**There is no measured power.** QZ estimates it:

* **Default**: the heart-rate model. A line through two user-set
  (heart rate, watts) points, floored at 50 W. Without heart rate,
  `cadence × 1.2`. Zero at 0 rpm.
* **Rogue Echo bike** (setting `rogue_echo_bike`):
  `W = 0.000602337 · rpm^3.11762 + 32.6404`.
* **Custom table**: two user points (resistance level, watts at 80 rpm),
  interpolated in level and scaled by `cadence / 80`. The rider tells the
  game which knob level they are on.

For a game, prefer asking the rider for their FTP and using a level-based
estimate over the heart-rate model. Label the power as estimated.

## NPE CABLE bridge

North Pole Engineering's CABLE box (and similar gym bridges) re-broadcasts a
commercial bike as Cycling Power, CSC and sometimes FTMS Indoor Bike Data. It
also exposes service `4b480001-6e6f-7274-6870-6f6c65656e67`. On `BIKE n`
devices, QZ reads the resistance level from byte 15 of notifications on
Nordic UART `6e400003-b5a3-f393-e0a9-e50e24dcca9e`. It is read-only.

## Practical recipe for a game

1. Offer "power meter" and "cadence sensor" as explicit device types; do not
   try to guess from short names.
2. Read power and crank cadence; zero cadence after about 2 s without new
   crank events.
3. With only cadence, show estimated power and say so in the UI.
4. Show grade changes as a suggested knob or gear change.
