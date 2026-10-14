# Ellipticals by brand

Proprietary-protocol ellipticals in QZ. FTMS ellipticals, BH `B01_` and the
YPOO/iConsole `FFF0` variant are in `ftms-elliptical.md`. Many brands reuse the
protocol of their treadmill sibling; each section points to that page for
framing details.

| brand | names | protocol | control in QZ |
|---|---|---|---|
| Sole E-series | `E95S`, `E25`/`E35` without FTMS, `E55`, `E95`, `E98`, `E98S`, `XG400` | Dyaco `5B..5D` UART, as Sole treadmills | resistance and incline by button presses |
| Domyos EL | `Domyos-EL` (case-sensitive) | Domyos `F0` frames, as Domyos treadmills | resistance level, incline |
| NordicTrack / ProForm (iFit BLE) | `I_EL` (NordicTrack), `I_FS` (ProForm), `I_VE` (ProForm elliptical trainer) | iFit BLE packets, replayed per-level tables | resistance, incline (per model) |
| NordicTrack / ProForm (Android console) | via `proform_elliptical_ip` | ADB log reading | none |
| Nautilus E / M series | `NAUTILUS E`, `NAUTILUS M` (also `NAUTILUS 616`, a bike) | Nautilus Inc. frames | none |
| Toorx / iConsole+ / JTX / Taurus | `FAL-SPORTS`, or `I-CONSOLE+` with `iconsole_elliptical` | App Gate `F0` frames | resistance |
| BH iConcept | `BH DUALKIT` with `iconcept_elliptical` | Bluetooth Classic `55` frames | resistance |
| Octane Q37 | `Q37` | Octane `A5` messages, as the Zero Runner | none |
| Sportstech | `EW-EP-` | vendor `F0` frames | none (command commented out) |

## Sole E-series

Source: `src/devices/soleelliptical/soleelliptical.cpp`. Same Microchip UART
and `5B <len> ... 5D` framing as Sole treadmills (`../treadmills/sole.md`).

Init (default): `5B 01 F0 5D` x3, `5B 02 03 01 5D` x2,
`5B 06 07 01 <age> 00 <weight lb> 5D`, `5B 03 08 10 01 5D`,
`5B 05 04 FF 00 00 00 5D` (`FF` = workout duration), `5B 02 02 02 5D`,
`5B 02 03 04 5D`. The E55 (`sole_elliptical_e55`) uses the treadmill-style
sequence with `...9B 43...`.

Control is key presses, each followed or preceded by `5B 04 00 F1 4F 4B 5D`:

| action | frame |
|---|---|
| resistance up / down | `5B 02 F1 02 5D` / `5B 02 F1 03 5D` |
| incline up / down | `5B 02 F1 04 5D` / `5B 02 F1 05 5D` (models with a ramp; `sole_elliptical_inclination`) |

Telemetry:

| frame | content |
|---|---|
| 5 bytes, `xx 02 13 <v> xx` | resistance = v + 1 |
| 5 bytes, `xx 02 12 <v> xx` | incline = v + 1 |
| 20+ bytes | speed = bytes 11..12 (big-endian) ÷ 100 (× 1.609 with the miles setting); cadence = byte 10; watts = bytes 13..14 (big-endian); heart rate = byte 18 |

A Sole E95 user found QZ's computed watts far above the console's: about
100 W against 10 W at a slow walk (issue #1595). `watt_ignore_builtin` chooses
between machine and computed power.

## Domyos EL

Source: `src/devices/domyoselliptical/domyoselliptical.cpp`. Same service,
`F0` frames and additive checksum as Domyos treadmills
(`../treadmills/domyos.md`), and the same init (`F0 C8 01 B9`, `F0 C9 B9`,
`F0 A3 93`, `F0 A4 94`, `F0 A5 95`, `F0 AB 9B`, `F0 C4 03 B7`, then the
Bluetooth-icon display frames).

Poll `F0 AC 9C` every 300 ms, and once a second two display frames that show
QZ's values on the console.

| action | frame |
|---|---|
| resistance | 23-byte `F0 AD FF... ` frame with the level at byte 10 (1..15), sent 20 + 3 |
| incline | `F0 E3 <incline + 1> <checksum>` (0..15; motorized models only, `domyos_elliptical_inclination`) |
| stop | `F0 C8 00 B8` |

Telemetry: 26-byte frames. Speed = bytes 6..7 (big-endian) ÷ 10 km/h, scaled
by `domyos_elliptical_speed_ratio`; cadence = byte 9; resistance = byte 14;
heart rate = byte 18; incline = byte 21. Power is computed from speed and
incline, or from resistance and cadence on non-incline models.

If the vendor service is missing, QZ switches the name to its FTMS
elliptical driver on the next start. Field reports: Kinomap never sent
resistance requests to an EL520 through QZ (issue #2268); iOS showed absurd
speeds above 11 km/h on one unit while Android was fine (issue #3099).

## NordicTrack / ProForm ellipticals (iFit BLE)

Sources: `nordictrackelliptical.cpp` (`I_EL`), `proformelliptical.cpp`
(`I_FS`), `proformellipticaltrainer.cpp` (`I_VE`). Same service, packetization
and header as iFit treadmills (`../treadmills/ifit.md`).

Resistance and incline are **replayed tables**, one 20-byte frame per level,
each after the header `FE 02 0D 02`. The frames follow the treadmill layout
with field `04` (resistance) or `02` (incline) at byte 10, the value at
bytes 11..12, and the checksum at byte 14. For example NordicTrack C7.5
resistance level 1:

```
FF 0D 02 04 02 09 06 09 02 01 04 98 01 00 AF 00 00 00 00 00
```

Models are chosen by setting: `nordictrack_elliptical_c7_5`,
`nordictrack_se7i`, `nordictrack_elliptical_s700`, `proform_hybrid_trainer_xt`
and others. QZ maps a Peloton-style resistance to iFit levels as
`ceil((peloton − 10) / 3.33)`.

Telemetry is model-dependent; most send 20-byte `01 12 ...` packets with
speed at bytes 14..15 or 12..13 (little-endian, ÷ 100). ProForm `I_FS`: cadence
= byte 18, watts = bytes 12..13.

Field reports (2026): the SpaceSaver S700 got a new profile; cadence needed a
fix and reported watts looked too high (issue #4794). AirGlide LE control was
a "very raw implementation" that did not read incline (issue #4771, open).
FS10i resistance did not update through the Android console path
(issue #3369).

## Nautilus E and M series

Source: `src/devices/nautiluselliptical/nautiluselliptical.cpp`. Nautilus Inc.
UUID family (`../treadmills/bowflex-nautilus.md`), init `07 01 D3 00 1F 05 01`.
Read-only: a Sole-style button-press function exists but is commented out.

Telemetry has three variants (chosen by the service found): 14-byte frames
(speed and cadence at byte 5, or byte 1 on variant 2), 12-byte frames, and
20-byte frames carrying resistance at byte 18 and heart rate at byte 16. The
**Nautilus M7** splits data between packet type `31` (heart rate byte 17,
resistance byte 19) and type `5E` (speed, cadence byte 5, watts).

## Toorx / iConsole+ / JTX / Taurus

Source: `src/devices/trxappgateusbelliptical/trxappgateusbelliptical.cpp`.
App Gate framing (`../treadmills/toorx.md`). Resistance:

```
F0 A6 <id> 01 <level + 1> <checksum>
id 01 for DCT2000i, JTX Fitness, Taurus FX9.9 (checksum = byte 4 + 0x98);
id 35 otherwise (checksum = byte 4 + 0xCC)
```

A Taurus FX9.9 silently lost its connection in QZ (issue #3933).

## BH iConcept (Bluetooth Classic)

Source: `src/devices/iconceptelliptical/iconceptelliptical.cpp`. Serial Port
Profile with Toorx-style `55` frames: the same long `55 xx 01 FF` init block,
poll `55 17 01 01`, and resistance `55 11 01 <level>`. Not available to iOS
apps.

## Octane Q37 and Sportstech

Both read-only in QZ. The Q37 uses the Octane `A5` message protocol described
in `../treadmills/octane-zero-runner.md`. Sportstech's resistance command
(`F0 A6 01 01 <level + 1> <checksum>`) is commented out in the source.
