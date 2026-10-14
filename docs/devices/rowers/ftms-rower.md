# FTMS rowers and Concept2 PM5

**Recommendation: Tier 1.** Most rowers sold since about 2019 are FTMS:
Merach, Kingsmith, WaterRower (S4 Comms), Whipr, KayakPro, Nordlys, Rogue,
Yoroto, Chaoke and the Concept2 PM5. Build this first.

Rowers report stroke rate, stroke count, pace, distance and usually power.
Control is limited to resistance level on some machines; FTMS rowers take no
ERG or simulation commands. For a game the useful inputs are **stroke rate
and power** (or pace, from which power can be derived).

Source: `src/devices/ftmsrower/ftmsrower.cpp`, `src/devices/concept2skierg/`
(QZ). General FTMS rules are in `../ftms-common.md`.

## Routing (`bluetooth.cpp:2199`)

Upper-cased names starting with `CR 00`, `KAYAKPRO`, `WHIPR`, `H-181-`,
`S4 COMMS` (WaterRower), `KS-WLT` (Kingsmith), `I-ROWER`, `MRK-CRYDN-`,
`MRK-R06-`, `MRK-R15-`, `MRK-R11S-` (unless the user picks iConsole mode),
`YOROTO-RW-`, `SF-RW`, `SMARTROWER` (Chaoke), `NORDLYS`, `ROWER `, `COACH 2`,
`ROGUE CONSOLE `, `DFIT-L-R`, and `PM5…ROW` (Concept2 RowErg). The user can
also force any name with the `ftms_rower` setting.

## GATT and start

Service `0x1826`: Rower Data `0x2AD1` (notify), Control Point `0x2AD9`
(write + indicate).

QZ writes only Start/Resume `07` to most rowers and ignores the "control not
permitted" reply. It writes Request Control `00` before `07` only for
`I-ROWER`, `SF-RW`, `IROWER `, `MRK-R06-` and iConsole+ consoles. **Follow the
spec instead: send `00`, then `07`, for every rower.**

On `I-ROWER`, `SF-RW`, `IROWER `, `MRK-R06-`, Domyos and `TC`-digit rowers,
subscribing to any characteristic outside `0x1826` stops the FTMS data.
Subscribe only to `0x2AD1` and `0x2AD9`.

## Rower Data `0x2AD1`

Flags are uint16 LE at bytes 0..1. Fields follow in bit order; each is
present only when its bit is set, except the first:

| bit | field | encoding |
|---|---|---|
| 0 clear | stroke rate + stroke count | uint8 in 0.5 spm units, then uint16 count |
| 1 | average stroke rate | uint8 |
| 2 | total distance | uint24 LE, metres |
| 3 | instantaneous pace | uint16 LE, seconds per 500 m; 0 or 65535 = none |
| 4 | average pace | uint16 |
| 5 | instantaneous power | sint16 LE, W |
| 6 | average power | sint16 |
| 7 | resistance level | sint16 LE |
| 8 | energy | uint16 total kcal, uint16 kcal/h, uint8 kcal/min |
| 9 | heart rate | uint8 |
| 10-12 | metabolic equivalent, elapsed, remaining | QZ does not parse |

Conversions:

```
speed km/h = 1800 / pace_s            (2:00 /500 m = 120 s → 15 km/h)
power W    = 2.8 × (500 / pace_s)³    (Concept2 formula, when no power field)
```

**Idle watchdog.** Rowers keep repeating the last pace and power after the
rower stops. QZ zeroes stroke rate, power and speed when the stroke count has
not changed for 3 s. Do the same.

## Per-name quirks

| names | quirk |
|---|---|
| `WHIPR` | stroke rate in whole spm (not 0.5); ignore isolated 0 W samples |
| `KS-WLT` (Kingsmith) | stroke rate in whole spm |
| iConsole+, FitShow (`FS-`), `MRK-R11S-` | distance field wrong; integrate speed |
| FitShow (`FS-`) | energy reported ×10 |
| `DFIT-L-R` | pace and power valid only while stroke rate > 0 |
| `NORDLYS` | never reports resistance; show the last value sent |
| `MRK-R26-` | resistance is manual (1..18, default 9); no power; QZ estimates `max(0, 9·spm − 85) · (1 + 0.05·(level − 9))` |
| `WDK` + 4 digits | power field unusable; compute from pace |
| `PM5…ROW` | Concept2; see below |

## Control

Set resistance: `04 <level × 10>` as one byte (the FTMS field is uint8 with
0.1 resolution). QZ clamps to 1..100, so levels above 25 overflow; clamp to
the machine's range. No ERG, simulation or stop commands are sent.

## Concept2 PM5

| machine | name | QZ path |
|---|---|---|
| RowErg | `PM5 …ROW` | FTMS rower driver plus the Concept2 characteristics |
| SkiErg | `PM5 …SKI` | Concept2 multiplexed characteristic only |
| BikeErg | `PM5 …` (neither) | generic FTMS bike |

The PM5 is **read-only** for third-party apps in QZ. Concept2 publishes the
"PM5 Bluetooth Smart Interface Definition"; use it for anything beyond this.

### RowErg: Concept2 rowing characteristics

Services `ce060010-…`, `ce060020-…`, `ce060030-43e5-11e4-916c-0800200c9a66`.

| characteristic | bytes QZ uses |
|---|---|
| `ce060031` general status | byte 9 = rowing state (0 = idle) |
| `ce060032` additional status 1 | bytes 3..4 LE speed in 0.001 m/s; byte 5 stroke rate |
| `ce060035` stroke data | byte 6 drive length in 0.01 m |
| `ce060036` additional stroke data | bytes 3..4 LE stroke power W; bytes 7..8 LE stroke count |

While the rowing state is 0, QZ discards both Concept2 and FTMS data and
reports zeros.

### SkiErg: multiplexed characteristic `ce060080-43e5-11e4-916c-0800200c9a66`

Byte 0 is the sub-characteristic id; data follows, so offsets are the
Concept2 offsets plus 1.

| id | bytes |
|---|---|
| `31` | 4..6 distance, uint24 LE, 0.1 m; 10 rowing state; 19 drag factor |
| `32` | 4..5 LE speed 0.001 m/s; 6 stroke rate; 7 heart rate (`FF` = none) |
| `33` | 5..6 LE calories |
| `35` | 17..18 LE stroke count |
| `36` | 4..5 LE stroke power W |

QZ reads multi-byte values through signed chars, which corrupts bytes ≥
`0x80`; read them unsigned. QZ presents the SkiErg to other apps as a
treadmill.

## Practical recipe for a game

1. Subscribe to `0x2AD1` (and `0x2AD9` indications); send `00` then `07`.
2. Read stroke rate (÷ 2 unless flagged), power, pace; derive power from pace
   when absent.
3. Zero everything after 3 s without a new stroke.
4. If the name is `PM5…`, prefer the Concept2 characteristics for power and
   stroke rate, and gate on the rowing state.
