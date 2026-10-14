# FTMS ellipticals and cross trainers

How QZ handles ellipticals that speak FTMS (`0x1826`) with Cross Trainer Data
(`0x2ACE`), plus the two non-standard variants that live in the same driver.
Brand-specific proprietary ellipticals are in `brands.md`.

QZ's generic FTMS elliptical driver is called `ypooelliptical`
(`src/devices/ypooelliptical/ypooelliptical.cpp`), after the first device it
supported.

## Routing: an elliptical is only an elliptical by name

QZ never decides "elliptical" from the characteristics
(`bluetooth.cpp:1256-1290`). A device reaches the FTMS elliptical driver if its
upper-cased name starts with one of:

`YPOO-U3-`, `SCH_590E`, `SCH411/510E`, `KETTLER `, `MRK-E`, `FEIER-EM-`,
`MX-AS `, `MYELLIPTICAL `, `CARDIOPOWER EEGO`, `SF-` followed by digits

or it is `TRUE ELLIPTICAL` + 3 or more digits, or `E25`/`E35` advertising
FTMS (Sole), or `Domyos-EL` after the Domyos driver switched it to FTMS, or
the name equals the user's `ftms_elliptical` setting.

An unknown FTMS elliptical falls through to QZ's FTMS **bike** driver, which
also parses `0x2ACE` but treats the machine as a bike (resistance through
simulation grade). A library should instead look for `0x2ACE` after
connecting (see `../identification.md`).

Two QZ pitfalls to avoid:

* Setting QZ's `ftms_bike` to any name disables every elliptical branch for
  every device.
* `KETTLER ` (with a space) also catches `KETTLER TREADMILL`.

## Cross Trainer Data (`0x2ACE`)

Flags are **3 bytes** (uint24 LE), unlike Indoor Bike Data's 2. Fields in
order (`ypooelliptical.cpp:294-615`):

| bit | field | bytes | QZ's use |
|---|---|---|---|
| 0 | more data (0 = instantaneous speed present) | 2 | speed, 0.01 km/h |
| 1 | average speed | 2 | used as speed on True ellipticals and the plain YPOO-U3 |
| 2 | total distance | 3 | ignored except on YPOO-U3; QZ integrates |
| 3 | step rate + average step rate | 2 + 2 | **cadence = step rate ÷ 2** on most models (steps to strides) |
| 4 | stride count | 2 | step count; cadence fallback from its rate of change |
| 5 | elevation gain | 4 | skipped |
| 6 | inclination + ramp angle | 2 + 2 | incline, 0.1 % (QZ reads it unsigned) |
| 7 | resistance level | 2 | resistance (True: ÷ 10) |
| 8 | instantaneous power | 2 | watts (plain YPOO-U3: ÷ 100) |
| 9 | average power | 2 | skipped |
| 10 | expended energy | 5 | skipped |
| 11 | heart rate | 1 | heart rate; `FF` = unavailable |
| 12 | metabolic equivalent | 1 | METs ÷ 10 |
| 13, 14 | elapsed, remaining time | 2 each | not parsed |

Implementation notes:

* Build the flags from unsigned bytes. QZ's elliptical parser sign-extends a
  flag byte of `0x80` or more.
* If resistance is absent, QZ back-computes a "Peloton resistance" from
  cadence and watts (formula in `../qz-base-behavior.md`).
* QZ forces power to 0 whenever cadence is 0.
* Some ellipticals send Indoor Bike Data (`0x2AD2`) instead; QZ parses that
  too, with bike semantics (cadence ÷ 2).

## Control

Init, once after subscribing: `00` (request control). `07` (start) only on
`FEIER-EM-` and user-named `ftms_elliptical` devices.

| action | bytes QZ sends |
|---|---|
| resistance | `04 <level × 10>`, **one byte** |
| incline | `03 <uint16 LE, whole percent × 10>` |

Both bugs are worth avoiding. The resistance write omits the high byte, so
level 26 or above wraps (26 × 10 = 260 → 0x04); the FTMS spec field is sint16,
so send two bytes. The incline value is truncated to a whole percent before
× 10.

QZ sends resistance only when it changes, clamps it to 1..72, and floors
incline at 1 % (a Sole E35 minimum). It does not send simulation (`0x11`),
target power (`0x05`) or stop on ellipticals.

**Grade to resistance.** A game on an elliptical usually wants "grade", but
the machine takes a resistance level. QZ maps grade to level through a
user-set gain and offset. An elliptical went to level 14 of 15 at −1 % grade
until the offset for 0 % grade was set properly (issue #3472).

## Per-model notes

| name | quirk |
|---|---|
| `TRUE ELLIPTICAL nnn` | speed from the average-speed field; resistance ÷ 10; stride diff ÷ 10 |
| `SCH411/510E` (Schwinn 411/510E) | heart rate read from byte 23 |
| `E35`, `E25` with FTMS (Sole) | incline is separate from resistance; minimum incline 1 % |
| `SCH_590E`, `MYELLIPTICAL`, `SF-nn` (Skandika), Domyos EL (FTMS), `FEIER`, `MX-AS`, True, user-named | QZ subscribes to the FTMS service only |
| `YPOO-U3-` (plain) | not FTMS; see below |
| `FS-` with `iconsole_elliptical` or `gymstick_gx6_0_elliptical` | not FTMS; see below |

## BH `B01_` ellipticals: resistance through simulation grade

Source: `src/devices/bhfitnesselliptical/bhfitnesselliptical.cpp`. BH
ellipticals with the `B01_` module speak FTMS but report **Indoor Bike Data**
(`0x2AD2`) and take resistance as a simulated grade:

```
11 00 00 <grade LE> 21 22          grade (0.01 %) = (level − 6) × 33      Crr 0.0033, Cw 0.34
```

Level 6 is flat; each level adds 0.33 %. There is no init and no request
control. The machine sends no speed; QZ sets speed = cadence ÷ 10 km/h.

## The non-FTMS variants in the same driver

**YPOO-U3 (plain), iConsole+ `FS-`, Gymstick GX6.0** speak a small custom
protocol on `0xFFF0` (write `0xFFF2`, notify `0xFFF1`):

```
02 <command> [payload] <XOR of everything between 02 and 03> 03
```

| action | frames |
|---|---|
| init | `02 42 42 03`, `02 41 02 43 03`, `02 43 01 42 03`, `02 42 42 03`, `02 44 01 45 03`, then `02 43 01 42 03`, `02 44 05 01 00 40 03`, `02 42 42 03`, `02 44 05 01 00 40 03` (Gymstick uses its own three frames here) |
| poll | alternate `02 42 42 03` and `02 43 01 42 03` every 200 ms. **Telemetry stops without it**; the `0x2ACE` frames are replies |
| resistance | `02 44 05 <level> 00 <check> 03`; QZ uses `0x39 + level` as the check byte, which does not match the XOR rule of the other frames. Gymstick: byte 4 = signed change from the current level, byte 5 = proper XOR |

The YPOO-U3 splits one 35-byte Cross Trainer Data frame into 18 + 17 bytes;
reassemble. The iConsole/Gymstick variants send a 15-byte frame instead:
speed = bytes 9..10 (little-endian) ÷ 100, cadence = byte 6. The machine never
reports resistance, so QZ assumes the last value it sent.

## Practical recipe for a game

1. After connecting, `0x2ACE` present means cross trainer.
2. Send `00`, subscribe, parse `0x2ACE` with 3-byte flags; cadence = step
   rate ÷ 2.
3. Map game grade to a resistance level with a per-machine table or a gain
   and offset, and send `04` with a 2-byte value.
4. Treat power as reported, but offer a computed fallback: many consoles
   report implausible watts (see `brands.md`).
