# Fitness device protocol reference

Folk knowledge about treadmills, ellipticals, bikes and rowers, extracted
from QZ (qdomyos-zwift, <https://github.com/cagnulein/qdomyos-zwift>) and its
issue tracker. It is written so a shared exergaming library, in JS and a
native language, can be built from it.

## How the set fits together

| file | what it is |
|---|---|
| `identification.md` | how to decide which device you are talking to |
| `quirks.md` | the vocabulary of boolean quirk flags and the per-class baselines |
| `quirks.yaml` | machine-readable registry: match rules, protocol id, flags, params, sources |
| `ftms-common.md` | FTMS as real devices implement it |
| `qz-base-behavior.md` | values QZ computes instead of reading (treadmill watts, cadence, resistance ↔ watts) |
| `zwift-protocol.md` | the Zwift BLE protocol (Hub, Cog, Click, Play, Ride) |
| `treadmills/`, `bikes/`, `ellipticals/`, `rowers/`, `other/` | one page per product range |
| `appendix-qz-routing.md` | QZ's complete 117-branch name-routing ladder, verbatim, for exact reproduction |

Suggested library shape: a data layer that loads `quirks.yaml`, an FTMS core,
and one protocol adapter per `protocol` id in the registry (`ftms`,
`horizon`, `sole_dyaco_uart`, `domyos_f0`, ...). Game code only sees
"set speed / set incline / set grade / read metrics" plus the flags.

## Support recommendations

**Audience.** The expected user is a hobbyist with inexpensive equipment: a
walking pad under a desk, a budget spin bike, a basic smart trainer. Owners
of premium equipment tend to use commercial apps. Coverage of cheap devices
matters more than completeness at the high end.

Most equipment sold since about 2019 speaks FTMS, and many older ranges
gained it in firmware updates. **Check the GATT table for FTMS `0x1826`
first; use a vendor protocol only when FTMS is missing.** There are two
exceptions. Domyos bikes carry no power over FTMS, and their resistance
commands misbehave, so prefer their UART. Some Sole treadmill firmware
ignores FTMS speed or incline commands, so probe FTMS and fall back to the
UART when commands have no effect.

The registry records this as `recommend` on each entry: `support` (default),
`prefer_ftms` (vendor protocol is legacy) or `skip`.

**Tier 1, build first.**

* The FTMS core for treadmills, bikes, ellipticals and rowers, plus the quirk
  flags (`ftms-common.md`, `bikes/ftms-bike.md`, `treadmills/ftms-treadmill-quirks.md`,
  `ellipticals/ftms-elliptical.md`). Most budget walking pads and bikes from
  Urevo, Mobvoi, Merach, Yesoul, Renpho and similar brands are FTMS with small
  quirks.
* **Walking pads without FTMS**: Kingsmith / Xiaomi WalkingPad
  (`treadmills/kingsmith.md`), FitShow-board pads (`treadmills/fitshow.md`),
  and the PitPat/DeerRun, Sperax and esLinker pads (`treadmills/other.md`).
  These are cheap, common, and mostly speed-only.
* Cycling Power and CSC, which cover power meters, cadence sensors and many
  trainers in read-only mode.
* The Zwift protocol, if the game wants Zwift Click/Play/Ride buttons or Zwift
  Hub virtual gears.

**Tier 2, vendor protocols worth writing** (large installed base, no FTMS
on common firmware):

* Toorx App Gate, which covers many European budget brands (bikes,
  treadmills, ellipticals).
* Domyos `F0` treadmills and bikes (Decathlon).
* Horizon/Johnson and Sole/Spirit (Dyaco) treadmills, older units.
* Echelon bikes on pre-2026 firmware (read-only power estimate).
* Sportstech and Yesoul proprietary bikes.

**Tier 3, skip or do last.**

| range | why |
|---|---|
| Peloton Bike, Bike+, Tread | no Bluetooth data without software on the Peloton tablet |
| Keiser M3i | advertisement-only; needs a continuous scanner, which browsers lack |
| Echelon on 2026 firmware | locked to Echelon's app; unlocking needs a live relay through it |
| iFit consoles over ADB or per-model BLE replay | per-model work and tablet access; newer iFit units should be checked for FTMS |
| Kinetic Smart Control | obfuscated commands |
| Life Fitness, Bowflex/Nautilus proprietary, Octane, Technogym | premium equipment; read-only or start/stop only |
| Wahoo and Tacx vendor protocols | only for old firmware; current units are FTMS |

## Master table

Years are approximate. QZ does not record model years; they come from
product launch dates and QZ issue dates, and should be checked before relying
on them. Pre-2015 and obscure devices are left out on purpose.

"Read" and "Control" describe what a game can do. Treadmill power is always
computed by the host from speed, incline and weight.

Status: **done** = page written and checked against source; **pending** =
not yet written.

### Treadmills

| range | years (approx.) | protocol | read | control | doc | status |
|---|---|---|---|---|---|---|
| Horizon 7.0AT / 7.4AT / 7.8AT, T101, T202, Paragon X, Omega Z (also AFG, Matrix TF50) | ~2017-now; FTMS on recent firmware | FTMS, or proprietary `55 AA` framing with CRC-16 | speed, incline | speed, incline (prefer FTMS) | `treadmills/horizon.md` | done |
| Sole F63, F65, F80, F85, F89, S77, TT8, ST90; Xterra TRX7.5 | ~2016-now; FTMS on ~2021+ firmware | FTMS, or proprietary `5B..5D` UART | speed (mph), incline (1 %) | FTMS varies by firmware (2023 F85: incline only); proprietary: button presses for both | `treadmills/sole.md` | done |
| Domyos T900A/B/C, Intense Run, RUN100E | ~2015-2021 | proprietary `F0` frames with additive checksum | speed, incline | speed and incline together, 0.5 % steps | `treadmills/domyos.md` | done |
| Domyos TC series (Run 500, TS100) | ~2021-now | FTMS | speed, incline | speed, incline (one incline bug report) | `treadmills/domyos.md` | done |
| Generic FTMS treadmills: Kingsmith WalkingPad (FTMS models), Urevo, Mobvoi, Merach, Tunturi, NoblePro, Assault, Xterra, True, Bowflex T9, Kettler, 3G Cardio, Wahoo KICKR Run and ~60 more prefixes | ~2019-now | FTMS with per-name quirks | speed, incline | speed, incline | `treadmills/ftms-treadmill-quirks.md` | done |
| FitShow-board treadmills (`FS-`, `SW...`, Winfita, Tunturi T80, NoblePro older, AnyRun) | ~2016-now | proprietary `02..03` XOR framing; many newer boards switch to FTMS | speed, incline, steps, some cadence | speed and incline together, whole-percent steps | `treadmills/fitshow.md` | done |
| Kingsmith / Xiaomi WalkingPad (R1 Pro, A1, S1, R2, X21, X23, G1, K12) | ~2018-now; newer models (Z1, R3 Hybrid+) are FTMS | two proprietary protocols: `F7..FD` binary frames, or base64 text with a substitution cipher | speed, steps | speed only (no incline motor) | `treadmills/kingsmith.md` | done |
| Technogym MyRun (also Merach U3); Technogym Run / Skillrun on FTMS | ~2016-now | FTMS after a Technogym handshake (coded Request Control, ASCII `@...#` commands); or Bluetooth Classic text | speed, incline, cadence | speed, incline (some firmware read-only) | `treadmills/technogym.md` | done |
| ProForm / NordicTrack / FreeMotion (iFit) treadmills | BLE ~2015-2020; Android tablet consoles ~2018-now | iFit BLE (per-model replayed traffic), ADB into the console (log reading + touch injection), or WiFi WebSocket JSON | speed, incline | speed, incline; the model must be chosen by the user | `treadmills/ifit.md` | done |
| Bowflex BXT116 / BXT216 / BXT326 / T22 / T6 / T8J / T128; Nautilus T616 / T618 / T628 | ~2014-2021 | Nautilus Inc. vendor frames (length, sequence, zero-sum checksum) | speed (mph), incline | **none** (start/stop only on Bowflex) | `treadmills/bowflex-nautilus.md` | done |
| Life Fitness T3 / T5 / Track Connect (`LF...`); commercial treadmills with an NPE GEM retrofit (`TREADMILL`) | ~2015-now | vendor handshake then FTMS telemetry, or T5 vendor frames; GEM = plain FTMS | speed, incline | **none** on Life Fitness consoles; GEM retrofits depend on the treadmill | `treadmills/lifefitness.md` | done |
| Spirit XT385 / XT485 / XT685 / XT800 / XT900; SynchronAction XT900 (Dyaco) | ~2017-now | Dyaco `5B..5D` UART like Sole, or FTMS on newer units | speed, incline | incline only; **speed blocked by Spirit** | `treadmills/spirit.md` | done |
| Echelon Stride, Stride 4 / 6 / 6S / 8S, Sport | ~2020-now | Echelon `F0` frames with sum checksum; device frames must be echoed | speed (mph or km/h, per unit), incline, HR | start/stop only; newer firmware may be vendor-locked | `treadmills/echelon-stride.md` | done |
| Octane Zero Runner ZR7 / ZR8 / ZR8000 | ~2016-now | Octane `A5` frames carrying message-ID/value pairs | pace, cadence | **none: non-motorized**, the runner sets the speed | `treadmills/octane-zero-runner.md` | done |
| True / Assault, Lifespan, Focus, Sperax, PitPat/DeerRun, esLinker, Zipro, Pafers, Activio, ShuaA5 | ~2017-now | assorted proprietary, one minimal FTMS | speed; incline on some | True, Zipro: none; Lifespan, Sperax: speed only; the rest: speed and incline | `treadmills/other.md` | done |
| Toorx / iConsole+ / JTX / Reebok / Adidas / DKN treadmills | ~2014-now | App Gate BLE `F0` frames (values sent +1), Bluetooth Classic `55` frames, or FTMS | speed, incline, HR | App Gate: incline only; Classic and FTMS: speed and incline | `treadmills/toorx.md` | done |
| Peloton Tread / Tread+ | 2018-now | no QZ driver | none | none | `treadmills/run-sensors.md` | done |
| Run sensors: Stryd, Zwift RunPod, NOHRD Sprintbok, NPE RUNN belt clip, Garmin watches as RSC | ~2016-now | RSC, Cycling Power, FTMS (RUNN), Stryd vendor data | speed, cadence, power, ground contact | none (Stryd 5 needs an indoor-mode write) | `treadmills/run-sensors.md` | done |

### Ellipticals

| range | years (approx.) | protocol | read | control | doc | status |
|---|---|---|---|---|---|---|
| Generic FTMS cross trainers: Schwinn 411/510E/590E, Kettler, Merach, Sole E25/E35 (FTMS), True, Skandika, Feier, Cardiopower | ~2019-now | FTMS Cross Trainer Data `0x2ACE` (3-byte flags) | cadence (step rate ÷ 2), power, resistance, speed | resistance level, incline on some | `ellipticals/ftms-elliptical.md` | done |
| BH `B01_` | ~2019-now | FTMS with Indoor Bike Data; resistance as simulated grade | cadence, power | resistance (via grade) | `ellipticals/ftms-elliptical.md` | done |
| YPOO-U3, iConsole+ `FS-`, Gymstick GX6.0 | ~2020-now | small `02..03` XOR protocol on `FFF0` | cadence, speed, power | resistance | `ellipticals/ftms-elliptical.md` | done |
| Sole E-series (E25/E35 without FTMS, E55, E95, E98, XG400) | ~2016-now | Dyaco `5B..5D` UART, like Sole treadmills | cadence, speed, power, resistance | resistance and incline by button presses | `ellipticals/brands.md` | done |
| Domyos EL | ~2016-now | Domyos `F0` frames; newer units FTMS | cadence, speed, resistance, incline | resistance, incline | `ellipticals/brands.md` | done |
| NordicTrack / ProForm ellipticals (iFit) | ~2015-now | iFit BLE replayed tables; Android consoles via ADB (read-only) | cadence, speed, power | resistance, incline per model | `ellipticals/brands.md` | done |
| Nautilus E / M series | ~2016-now | Nautilus Inc. frames | cadence, speed, resistance | none | `ellipticals/brands.md` | done |
| Toorx / iConsole+ / JTX / Taurus; BH iConcept | ~2014-now | App Gate `F0` frames; Bluetooth Classic `55` frames | cadence, speed | resistance | `ellipticals/brands.md` | done |
| Octane Q37, Sportstech | ~2016-now | Octane `A5` messages; vendor `F0` frames | cadence, speed | none | `ellipticals/brands.md` | done |

### Bikes and trainers

| range | years (approx.) | protocol | read | control | doc | status |
|---|---|---|---|---|---|---|
| Generic FTMS bikes and trainers (Elite, Saris, Yesoul, JetBlack, Merach, Stages SB20, Wattbike Atom, ~150 prefixes) | ~2019-now | FTMS with per-name quirks | cadence, power, speed | sim grade `0x11` or resistance level `0x04`; ERG on most | `bikes/ftms-bike.md` | done |
| Zwift Hub, Zwift Cog (Hub One, KICKR Core Zwift One), Zwift Click / Play / Ride | 2022-now | FTMS plus Zwift ZAP protobuf service | cadence, power, buttons | grade and virtual gear ratio over ZAP; FTMS otherwise | `zwift-protocol.md` | done |
| Wahoo KICKR, CORE, SNAP, BIKE, MOVE, ROLLR (and Saris Hammer in Wahoo mode) | ~2014-now; FTMS on recent firmware | Wahoo extension on Cycling Power (`20 EE FC` unlock, opcodes `40`-`48`) | cadence, power | grade, ERG, resistance level, wheel circumference; KICKR BIKE tilts | `bikes/wahoo.md` | done |
| Tacx NEO / Flux / Flow / Smart Bike; ThinkRider, Xplova Noza, Van Rysel HT | ~2015-now | ANT FE-C pages over BLE (`6e40fec3`), or FTMS on newer firmware | cadence (CSC or FTMS), power | grade (page 0x33), ERG (page 0x31) | `bikes/tacx.md` | done |
| Echelon Connect EX-1..EX-8S, GT+, Connect Sport | ~2018-now; 2026 firmware locks to the Echelon app | Echelon `F0` frames, service `0bf669f1` | cadence, resistance level; power only estimated from a table | resistance level 1-32 | `bikes/echelon.md` | done |
| Peloton Bike / Bike+ | ~2014-now (Bike+ 2020-) | none over BLE/ANT+; tablet bridge only (Grupetto-style service, or UDP text on port 8003) | power, cadence, Peloton resistance, speed via bridge | none | `bikes/peloton.md` | done |
| ProForm / NordicTrack iFit bikes (TDF, S22i, Studio; names `I_EB`, `I_SB`) | ~2015-now | iFit BLE family (per-model captured frames), ADB into tablet consoles, or WiFi | cadence, power, level/incline per model | per model only | `treadmills/ifit.md` (shared iFit protocol; not documented per bike model: Tier 3) | done |
| Schwinn IC4 / IC8, Bowflex C6 / C7 / C9-C10; Schwinn 170 / 270 | ~2018-now (IC4); ~2016-now (170/270) | IC4 family: read-only FTMS; 170/270: Nautilus frames | cadence, power, speed; 170/270 also resistance level | none (manual knob; SmartSpin2k add-on for auto) | `bikes/schwinn-bowflex.md` | done |
| Domyos bikes (EB 500 / 520 B / 900, Training 900, Bike 500) | ~2016-now | Domyos `F0` frames over Microchip UART service; newer consoles also FTMS (no power) | cadence, resistance level 1-15, speed; power only estimated | resistance level | `bikes/domyos.md` | done |
| Toorx / iConsole+ / JLL / Reebok / Adidas / DKN / Tunturi / Taurus / Enerfit and clone bikes | ~2014-now | App Gate BLE `F0` frames (values sent +1), Bluetooth Classic `F0` frames, or FTMS | cadence, speed, power, resistance level | resistance level 1-32 | `bikes/toorx.md` | done |
| Keiser M3i / M3 Plus | ~2014-now | advertisement broadcast only (manufacturer data, version 6); never connects | cadence, power, gear, HR | none (manual lever) | `bikes/keiser.md` | done |
| Sole LCB/LCR/R92, Horizon GR7, Sportstech, Yesoul (proprietary), Nautilus bikes, Kettler C12, Flywheel / Life Fitness IC5-IC8 | ~2015-now | Dyaco `5B`, FTMS or `55 AA`, `F2`, `F5`, Nautilus, Kettler, ICG frames | cadence, power (most), level | Sole: buttons; GR7: FTMS sim; Sportstech: level in poll; Kettler: target power; others none | `bikes/console-brands.md` | done |
| Elite (pre-FTMS), Bkool, Technogym bikes, CycleOps Phantom/Magnus, Kinetic Smart Control, Renpho | ~2014-now | vendor services (Elite `347b`, Bkool FE-C pages, Technogym `F8`/`F9`, CycleOps, Kinetic obfuscated); Renpho FTMS | cadence, power | grade and ERG on most; CycleOps grade as power | `bikes/smart-trainers-other.md` | done |
| Power meters and cadence sensors used as the bike; Joroto, BGYM; NPE CABLE gym bridges | ~2014-now | Cycling Power `0x1818`, CSC `0x1816` | power and cadence (power meter); cadence only, power estimated (CSC) | none | `bikes/sensors-as-bike.md` | done |

### Rowers and other equipment (lower priority)

| range | years (approx.) | protocol | read | control | doc | status |
|---|---|---|---|---|---|---|
| Generic FTMS rowers (Merach, Kingsmith, WaterRower S4 Comms, Whipr, KayakPro, Nordlys, Rogue, Yoroto, Chaoke) | ~2019-now | FTMS Rower Data `0x2AD1` | stroke rate, power or pace, distance | resistance level on some | `rowers/ftms-rower.md` | done |
| Concept2 PM5 (RowErg, SkiErg; BikeErg is an FTMS bike) | 2014-now | FTMS plus Concept2 `ce0600xx` characteristics (SkiErg: multiplexed) | stroke rate, power, pace | none | `rowers/ftms-rower.md` | done |
| Echelon, Domyos, Merach R28/R11S, iConsole+, Sportstech, SmartRow, Care/VMAX, ProForm I_RW rowers | ~2018-now | Echelon/Domyos/App Gate `F0`, FitShow-style `02..03`, `F2`, SmartRow ASCII, iFit BLE | stroke rate, pace; power measured or estimated | level on Echelon, Domyos, Merach | `rowers/brands.md` | done |
| Echelon stair climber, SunnyFit stepper, Crossrope jump rope, Moxy, CORE temperature | ~2018-now | vendor services (Echelon `F0`, SunnyFit `5A..A5`, Crossrope, Moxy, CORE) | steps or jumps and rate; SmO2; body temperature | none in practice | `other/odd-equipment.md` | done |
