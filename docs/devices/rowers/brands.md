# Rowers with vendor protocols

Budget rowers are mostly FTMS (`ftms-rower.md`). This page covers those that
are not, with a recommendation for each.

| range | names | protocol | reads | control | recommendation |
|---|---|---|---|---|---|
| Echelon Row, Row-S, Row-7s | `ECH-ROW`, `ROWSPORT`, `ROW-7S-`, `ROW-S` | Echelon `F0` frames | stroke rate, pace, level; power estimated | level 1..32 | support pre-2026 firmware |
| Domyos rowers | `DOMYOS-ROW` | Domyos `F0` frames; newer units FTMS | strokes, stroke rate, pace, level, HR | level 1..15 | support |
| Merach R28 | `MRK-R28-` | FitShow-style `02 … XOR 03` on `FFF0` | stroke rate, power, level | level | support (budget) |
| Merach R11S (NovaRow R50), iConsole+ rowers | `MRK-R11S-`, `I-CONSOLE+` with a setting | Toorx App Gate `F0`, values +1 | stroke rate, power, distance, level | level 1..15 | support (budget) |
| Sportstech WRX | `EW-ST-` | `F2` frames on `FFF0` | stroke rate, power, speed, level | none | support |
| SmartRow (WaterRower add-on) | `SMARTROW` (not `SMARTROWER`) | ASCII on `0x1234`, V3 key challenge | stroke rate, power, pace, distance | none | optional |
| Care Fitness, VMAX | `CARE` (12+ chars), `VMAX` | `20 01 …` on `FFF0` | stroke rate, HR; rest synthetic | level in the poll | low |
| ProForm / NordicTrack (iFit BLE) | `I_RW` | iFit BLE, captured per-model frames | stroke rate, pace, power, level | level 1..24 | skip |
| iFit tablet rowers | IP setting | UDP / ADB | varies | level | skip |
| Concept2 PM3/PM4 over USB | serial port setting | CSAFE | pace, power, stroke rate | none | skip |

## Echelon rowers

Source: `src/devices/echelonrower/echelonrower.cpp`. Same service, framing,
init and poll as Echelon bikes (`../bikes/echelon.md`), and the same **2026
firmware lock** (a Row-S stopped working after a May 2026 update, issue
#4750).

* **Init**: `F0 A1 00 91` ×4, `F0 A3 00 93`, `F0 A1 00 91`,
  `F0 B0 01 01 A2`. **Poll** `F0 A0 01 <n> <sum>` every 2 s.
* **Level**: set `F0 B1 01 <level> <sum>`, 1..32; reported in
  `F0 D2 ?? <level> <sum>`.
* **Telemetry**, 21 bytes (may arrive split; join when the parts add up to
  21): elapsed seconds 3..4 BE, stroke rate byte 11, pace 13..14 BE (s/500 m),
  distance 15..17 BE ÷ 1000 km (QZ ignores it and integrates speed). Stroke
  count is not sent.
* **Power is estimated** from level and stroke rate, interpolated in 5 spm
  steps; above 55 spm QZ scales the 55 spm value by `spm / 55`. 0 W at
  0 spm. Table (from issue #62):

| level | 0 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 55 spm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 30.0 | 62.0 | 88.0 | 108.0 | 119.0 | 128.0 | 141.0 | 153.0 | 162.0 | 174.0 |
| 1 | 0 | 0 | 30.0 | 62.0 | 88.0 | 108.0 | 119.0 | 128.0 | 141.0 | 153.0 | 162.0 | 174.0 |
| 2 | 0 | 0 | 31.0 | 64.0 | 90.0 | 113.0 | 123.0 | 133.0 | 144.0 | 155.0 | 164.0 | 176.0 |
| 3 | 0 | 0 | 31.5 | 65.0 | 93.0 | 117.0 | 129.0 | 137.0 | 148.0 | 158.0 | 167.0 | 180.0 |
| 4 | 0 | 0 | 32.0 | 66.0 | 96.0 | 122.0 | 134.0 | 143.0 | 153.0 | 161.0 | 169.0 | 182.0 |
| 5 | 0 | 0 | 32.5 | 67.0 | 98.0 | 127.0 | 138.0 | 151.0 | 161.0 | 168.0 | 170.0 | 184.0 |
| 6 | 0 | 0 | 33.0 | 68.0 | 103.0 | 133.0 | 145.0 | 157.0 | 167.0 | 172.0 | 174.0 | 188.0 |
| 7 | 0 | 0 | 33.5 | 69.0 | 105.0 | 136.0 | 151.0 | 160.0 | 174.0 | 179.0 | 180.0 | 193.0 |
| 8 | 0 | 0 | 34.0 | 70.0 | 107.0 | 140.0 | 159.0 | 164.0 | 177.0 | 184.0 | 186.0 | 198.0 |
| 9 | 0 | 0 | 34.5 | 71.0 | 110.0 | 144.0 | 164.0 | 168.0 | 182.0 | 188.0 | 190.0 | 205.0 |
| 10 | 0 | 0 | 35.0 | 72.0 | 113.0 | 148.0 | 169.0 | 178.0 | 194.0 | 202.0 | 209.0 | 220.0 |
| 11 | 0 | 0 | 35.5 | 73.5 | 117.0 | 155.0 | 174.0 | 185.0 | 199.0 | 209.0 | 217.0 | 227.0 |
| 12 | 0 | 0 | 36.0 | 75.0 | 120.0 | 158.0 | 179.0 | 188.0 | 205.0 | 217.0 | 225.0 | 234.0 |
| 13 | 0 | 0 | 37.0 | 76.5 | 122.0 | 162.0 | 186.0 | 202.0 | 216.0 | 225.0 | 231.0 | 243.0 |
| 14 | 0 | 0 | 38.0 | 77.0 | 124.0 | 165.0 | 189.0 | 217.0 | 224.0 | 232.0 | 240.0 | 254.0 |
| 15 | 0 | 0 | 38.5 | 78.0 | 128.0 | 168.0 | 201.0 | 221.0 | 231.0 | 243.0 | 249.0 | 262.0 |
| 16 | 0 | 0 | 39.5 | 79.0 | 132.0 | 175.0 | 208.0 | 228.0 | 239.0 | 251.0 | 261.0 | 272.0 |
| 17 | 0 | 0 | 40.5 | 80.5 | 138.0 | 180.0 | 219.0 | 234.0 | 246.0 | 259.0 | 271.0 | 281.0 |
| 18 | 0 | 0 | 41.0 | 82.0 | 145.0 | 187.0 | 229.0 | 246.0 | 252.0 | 264.0 | 278.0 | 291.0 |
| 19 | 0 | 0 | 41.5 | 85.0 | 148.0 | 202.0 | 239.0 | 253.0 | 261.0 | 270.0 | 284.0 | 299.0 |
| 20 | 0 | 0 | 42.0 | 87.0 | 153.0 | 205.0 | 249.0 | 259.0 | 266.0 | 278.0 | 291.0 | 310.0 |
| 21 | 0 | 0 | 47.0 | 92.0 | 160.0 | 208.0 | 255.0 | 266.0 | 272.0 | 283.0 | 296.0 | 315.0 |
| 22 | 0 | 0 | 48.0 | 95.0 | 168.0 | 215.0 | 269.0 | 276.0 | 282.0 | 298.0 | 307.0 | 325.0 |
| 23 | 0 | 0 | 51.0 | 100.0 | 173.0 | 218.0 | 279.0 | 283.0 | 290.0 | 305.0 | 320.0 | 341.0 |
| 24 | 0 | 0 | 56.0 | 102.0 | 177.0 | 228.0 | 289.0 | 294.0 | 301.0 | 317.0 | 330.0 | 351.0 |
| 25 | 0 | 0 | 59.0 | 108.0 | 184.0 | 236.0 | 298.0 | 303.0 | 312.0 | 323.0 | 337.0 | 367.0 |
| 26 | 0 | 0 | 61.0 | 115.0 | 188.0 | 238.0 | 309.0 | 317.0 | 325.0 | 339.0 | 353.0 | 380.0 |
| 27 | 0 | 0 | 63.0 | 125.0 | 193.0 | 248.0 | 319.0 | 329.0 | 338.0 | 347.0 | 364.0 | 389.0 |
| 28 | 0 | 0 | 70.0 | 132.0 | 196.0 | 256.0 | 324.0 | 340.0 | 351.0 | 375.0 | 389.0 | 408.0 |
| 29 | 0 | 0 | 75.0 | 136.0 | 208.0 | 258.0 | 329.0 | 350.0 | 360.0 | 382.0 | 402.0 | 421.0 |
| 30 | 0 | 0 | 82.0 | 142.0 | 213.0 | 262.0 | 335.0 | 357.0 | 367.0 | 396.0 | 414.0 | 431.0 |
| 31 | 0 | 0 | 86.0 | 152.0 | 216.0 | 266.0 | 339.0 | 362.0 | 372.0 | 415.0 | 430.0 | 445.0 |
| 32 | 0 | 0 | 90.0 | 158.0 | 223.0 | 268.0 | 344.0 | 368.0 | 399.0 | 430.0 | 444.0 | 460.0 |

## Domyos rowers

Source: `src/devices/domyosrower/domyosrower.cpp`. Same GATT (Microchip UART),
framing, init and poll as Domyos bikes (`../bikes/domyos.md`).

* **Routing**: `DOMYOS-ROW` (not `DomyosBridge`). If the Microchip service is
  missing and FTMS exists, QZ saves the rower as an FTMS rower and asks for a
  restart; after that, subscribe only to FTMS.
* **Telemetry**, 26 bytes: stroke count 2..3 BE, pace 6..7 BE (s/500 m),
  stroke rate 9, calories 10..11 BE, distance 12..13 BE ÷ 10 (unused), level
  14, heart rate 18, incline 21.
* **Power is not reported.** QZ computes it with its *running* formula from
  speed and body weight, which is not meaningful for rowing. Use
  `2.8 × (500 / pace)³` instead.
* **Level**: the 23-byte `F0 AD` frame with the level at byte 10, 1..15.
  **Incline** (some models): `F0 E3 <incline+1> <sum>`.

## Merach R28

Source: `src/devices/fitplusrower/fitplusrower.cpp`. The R28 also advertises
FTMS, but QZ found the `FFF0` protocol more reliable for it.

* **GATT**: service `FFF0`, write `FFF2`, notify `FFF1`.
* **Framing**: `02 <body> <XOR of body> 03`, as on FitShow treadmills
  (`../treadmills/fitshow.md`).
* **Init**: `AA 01 00 01 55`. **Poll** every 200 ms, alternating
  `02 42 42 03` and `02 43 01 42 03`.
* **Telemetry**, 15 bytes (ignore 13-byte frames): level byte 5, stroke rate
  byte 6, power 9..10 LE ÷ 10.
* **Set level**: `02 44 05 <level> <X> <XOR> 03`. The meaning of X is
  unknown; QZ sends captured values. For levels 1..24, X =
  `F9 F9 FA FB FC FD FE FF 00 00 01 03 03 05 05 06 07 08 09 0A 0B 0C 0D 0E`.

## Merach R11S (NovaRow R50) and iConsole+ rowers

Source: `src/devices/trxappgateusbrower/trxappgateusbrower.cpp`. Toorx App
Gate framing (`../bikes/toorx.md`). Chosen only when the user sets
`iconsole_rower`; otherwise `MRK-R11S-` goes to the FTMS rower driver.

* **GATT**: `FFF0`, write `FFF2`, notify `FFF1`.
* **Init, R11S**: `F0 A5 44 01 04 DE`, `F0 A0 44 01 D5`, `F0 A0 01 E8 79`,
  `F0 A5 01 E8 02 80`. **iConsole+**: `F0 A0 01 00 91` ×2, then
  `F0 A0 01 E7 78` / `F0 A1 01 E7 79` alternated, `F0 A3 01 E7 01 7C`,
  `F0 A4 01 E7` + ten `01` + `83`, `F0 A5 01 E7 02 7F`.
* **Poll** every 200 ms: R11S `F0 A2 01 E8 7B`; iConsole+ `F0 A2 01 E7 7A`.
* **Telemetry**, 23 bytes, every byte value + 1. R11S uses base 99 for its
  two-byte values: stroke rate `(b8−1)·99 + (b9−1)`, distance
  `((b10−1)·99 + (b11−1))` m, calories 12..13, heart rate 14..15, power
  `(b16−1)·99 + (b17−1)`, level `b20 − 1`. iConsole+: speed
  `((b6−1)·100 + (b7−1)) / 10`, stroke rate `b20 − 1`, power 17..18, level
  `b18 − 1`.
* **Set level**: `F0 A6 35 01 <level+1> <sum>`, 1..15.

## Sportstech WRX

Source: `src/devices/sportstechrower/sportstechrower.cpp`. Same `F2` framing,
init and poll as Sportstech bikes (`../bikes/console-brands.md`), with the
level in the poll fixed at 0. 20-byte frames: calories 7..8, power 9..10,
heart rate 11, speed 12..13 ÷ 10, level 15, stroke rate 17 (big-endian). No
control.

## SmartRow

Source: `src/devices/smartrowrower/smartrowrower.cpp`.

* **GATT**: service `0x1234`, write `0x1235`, notify `0x1236`.
* **Init**: send `$`, CR, `V`, `@`, CR **one byte per write**, 200 ms apart.
  **Poll**: `$` every 2 s.
* **V3 firmware challenge**: on a notification containing `V3.`, send `#`.
  On one containing `KEYLOCK=`, take the 16 characters after it. The first
  14 are the key; the last 2 are hex of the sum of the key bytes (check it).
  Seed = key characters 10..13 as hex. Reply CR + lowercase 4-digit hex of
  `(seed × 17923) / 256` (low 16 bits) + CR. On failure send `#` again.
* **Frames**: 17 ASCII bytes. Byte 0 is a type letter; bytes 1..5 distance in
  metres. V3 obfuscates bytes 1..5 of types a-f and x-z: decode each as
  `(b & 0x0F) | 0x30`. Type `c`: power W in 6..8. Type `d`: stroke rate × 10
  in 6..8, stroke count 9..12. Type `e`: pace = `[6]·60 + [7..8]` seconds per
  500 m. Type `b`: stroke length 11..13.

## Care Fitness / VMAX

Source: `src/devices/sportsplusrower/sportsplusrower.cpp`. Init
`40 00 9A 56 30` six times (or `40 00 D1 5F 70` once when the write
characteristic is `FFE2`). Every 200 ms QZ sends `20 01 <level> 00 <21+level>`,
which is both poll and level command (0..24). 12-byte frames with byte 1 =
`10`: stroke rate as BCD in byte 3, heart rate byte 8. QZ derives speed and
power from stroke rate alone, so treat these values as fake.

## ProForm / NordicTrack I_RW (skip)

Service `00001533-1412-efde-1523-785feabcd123` (iFit BLE, see
`../treadmills/ifit.md`). Each of three console variants needs its own
captured init (up to 40 frames) and a separate captured frame per resistance
level. Telemetry is readable (stroke rate byte 12 and pace 13..14 LE in
`FF 11` frames; power 12..13 LE in `00 12 01 04 02 …` frames), but control
requires the per-model tables. Not worth it for a game.

## Concept2 PM3/PM4 over USB (skip)

CSAFE frames over a serial port (`F1 … XOR F2`, with `F0`-`F3` byte-stuffed as
`F3 xx`). Browsers cannot reach it without WebSerial, and the PM5 is
Bluetooth. Not covered further.
