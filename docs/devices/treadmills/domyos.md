# Domyos (Decathlon) treadmills

Two generations, two protocols:

| generation | example names | protocol | QZ driver |
|---|---|---|---|
| pre-FTMS, about 2015-2021 | `Domyos-...` on T900A/B/C, Intense Run, RUN100E | proprietary `F0` frames over the Microchip UART service | `domyostreadmill` |
| FTMS, about 2021 onward | `Domyos-TC-2273` (Run 500), TS100 | FTMS `0x1826` | `horizontreadmill` (QZ's generic FTMS treadmill driver) |

Source: `src/devices/domyostreadmill/domyostreadmill.cpp` (QZ). The FTMS
generation's quirks are in `ftms-treadmill-quirks.md` under `DOMYOS-TC`.

## Routing (`bluetooth.cpp:1424-1431`)

* Name `startsWith("Domyos")`, **case-sensitive**.
* Excluded: `DomyosBr...` (Domyos bridge), `DOMYOS-BIKE-`, `DOMYOS-BIKING-`,
  and `DOMYOS-ROW` (caught earlier by the rower driver).
* Goes to the proprietary driver only if the advertisement does **not** list
  `0x1826`, or the setting `domyostreadmill_notfmts` is on.
* `DOMYOS-TC` names that advertise `0x1826` go to the FTMS driver instead.

**Self-correction**: some Domyos units advertise FTMS but also carry the
proprietary UART service, and their FTMS side does not work. When the FTMS
driver finds that UART service (`49535343-fe7d-...`) it sets
`domyostreadmill_notfmts`, asks the user to restart, and the next scan uses
the proprietary driver (`horizontreadmill.cpp:2366-2371`). A game should do
the same check in-process: **if the UART service is present, use the
proprietary protocol even when FTMS is advertised.**

## GATT

Same Microchip transparent-UART service as Sole and iConsole:

| UUID | role |
|---|---|
| `49535343-fe7d-4ae5-8fa9-9fafd205e455` | service |
| `49535343-8841-43f4-a8d4-ecbe34729bb3` | write, **with response** |
| `49535343-1e4d-4bd9-ba61-23c647249616` | notify, CCCD `01 00` |

On iOS characteristic and descriptor discovery must be enabled for this board.

## Frame format

```
F0 <opcode> [args...] <checksum>
checksum = (sum of every preceding byte) mod 256
```

There is no length byte. Frames longer than 20 bytes are written as a 20-byte
write followed by the remainder. QZ queues writes and releases the next one
when the previous is acknowledged (a reply notification, or the write
callback), with a 300 ms timeout (`domyostreadmill.cpp:102-168`).

| opcode | QZ's use |
|---|---|
| `C8 01` | reset speed and incline to 0 (init step 1) |
| `C8 00` | stop the belt |
| `C9` | init step 2 |
| `A3`, `A4`, `A5`, `AB` | startup queries |
| `C4 03` | startup |
| `AC` | no-op poll |
| `AD` | set speed and incline (23 bytes) |
| `CB` | console display contents (27 bytes) |
| `CA <0..5>` | fan speed |
| `BC` / `DB` | status frame from the treadmill |

Opcode meanings other than `AD`, `C8`, `CA`, `CB` are not documented in QZ.

## Init (`btinit`, `domyostreadmill.cpp:813-853`)

Each frame waits for a reply (at most 300 ms):

```
F0 C8 01 B9
F0 C9 B9
F0 A3 93
F0 A4 94
F0 A5 95
F0 AB 9B
F0 C4 03 B7
```

On start (and on every init if `domyos_treadmill_sync_start` is set), QZ then
sends a 27-byte "Bluetooth on" display frame, a start-belt frame, and a
second display frame:

```
F0 CB 02 00 08 FF FF FF FF FF FF FF FF FF FF FF FF FF 01 00 | 00 01 FF FF FF FF B6
F0 AD FF FF 00 05 FF FF FF FF FF FF FF 00 00 FF FF FF 01 FF | FF FF 94     (speed 0.5 km/h, incline 0)
F0 CB FF FF FF FF FF FF FF FF FF FF FF FF 01 00 14 01 FF FF | FF FF FF FF FF FF BD
```
(`|` marks the 20-byte split.)

## Poll and display

The tick is 200 ms. Four ticks out of five QZ sends the no-op `F0 AC 9C`. The
fifth sends a 27-byte display frame that fills the console with elapsed time,
distance, heart rate, incline, speed and calories (layout in
`domyostreadmill.cpp:170-245`). The display frame is optional; the belt runs
without it, but the console display stops updating.

All writes are held while a status frame is only half received.

## Telemetry

Status frames are 26 bytes, header `F0 BC` or `F0 DB`. The T900 splits them
20+6 (`BC`) or 20+7 (`DB`); reassemble before parsing
(`domyostreadmill.cpp:480-507`). Frames of other lengths are replies to
commands.

| offset | size | meaning |
|---|---|---|
| 2..3 | uint16 BE | incline, encoded (see below) |
| 7 | uint8 | speed in 0.1 km/h (so at most 25.5 km/h) |
| 10..11 | uint16 BE | calories from the console (QZ only logs it) |
| 12..13 | uint16 BE | distance in 0.1 km (QZ only logs it) |
| 18 | uint8 | heart rate |
| 22 | uint8 | console button just pressed (see below) |
| 23 | uint8 | fan speed |

Incline decoding, verbatim from `GetInclinationFromPacket`
(`domyostreadmill.cpp:797-811`):

```
raw = bytes[2] << 8 | bytes[3]
incline = raw > 10000 ? (raw - 65512) / 10 : (raw - 1000) / 10
if incline < 0: incline = 0
```

The read side has a 1000 offset that the write side does not. That is what
QZ does and it works on the units reported. Negative inclines are always
reported as 0.

The calorie and distance parsers in QZ sign-extend the high byte, so they
break above 255 kcal (issue #178). QZ does not use those values; if you do,
mask both bytes as unsigned.

There is no power. QZ computes it from speed, incline and weight.

### Console button echo (byte 22)

| code | button |
|---|---|
| `06` / `07` | start / stop |
| `08` / `09` | speed +0.2 / -0.2 km/h |
| `0C` / `0D` | incline +0.5 / -0.5 % |
| `0A` / `0B` | fan - / + |
| `0E`..`11` | speed presets (QZ maps to 5/10/16/22 km/h; T900A: 4/6/8/10) |
| `12`..`15` | incline presets (0/5/10/15 %; T900A: 0/1/2/3) |
| `16`..`19`, `1A`..`1D` | T900A only: speed 12/14/16/18, incline 4/6/8/10 |

The console reports presses but QZ only acts on the speed and incline ones
when `domyos_treadmill_buttons` is on. That lets an app take over the
console's buttons.

## Control

**Speed and incline are always set together** in one 23-byte frame
(`forceSpeedOrIncline`, `domyostreadmill.cpp:247-273`):

```
byte  0..1   F0 AD
      2..3   FF FF
      4..5   speed * 10, uint16 BE (km/h)
      6..12  FF x7
      13..14 incline * 10, uint16 BE (%)
      15..21 FF x7
      22     checksum
```
Written as 20 bytes then 3. To change only speed, send the current incline,
and the reverse. The `FF` bytes presumably mean "unchanged"; QZ never puts
anything else there.

Limits QZ enforces (`domyostreadmill.cpp:370-400`): speed 0..22 km/h;
incline 0..20 % in 0.5 steps; negatives become 0; only sent when different
from the current value. `inclination_delay_seconds` (default 0) sets a
minimum gap between incline changes.

**Start**: the full init plus the start-belt frames above, with speed at
least 0.5 km/h. **Stop**: `F0 C8 00 B8`. **Fan**: `F0 CA <0..5> <checksum>`.

## Model-specific settings

| setting | default | effect |
|---|---|---|
| `domyostreadmill_notfmts` | false | force proprietary even when FTMS is advertised; set automatically, see above |
| `domyos_treadmill_buttons` | false | act on console speed/incline buttons |
| `domyos_treadmill_t900a` | false | T900A preset button layout |
| `domyos_treadmill_run100e` | false | RUN100E reports a stale incline; QZ shows the last requested incline instead |
| `domyos_treadmill_sync_start` | false | send the "Bluetooth on" and speed frames on every init, the pre-2023 behaviour |
| `domyos_treadmill_distance_display`, `_display_invert` | true, false | what the display frame shows |
| `domyos_treadmill_ts100` | false | FTMS TS100: report a fixed 15 % incline |
| `inclination_delay_seconds` | 0 | minimum seconds between incline writes |

## Field reports

* **FTMS Domyos, belt stops on some incline values**: with QZ controlling
  incline, one unit dropped to 0 speed and the odometer jumped to 100 km;
  Kinomap on the same treadmill worked. Unresolved as of late 2025
  (issue #3843). Log what Kinomap sends if you hit this.
* **Domyos Run 500 (`Domyos-TC-2273`) connects to any advertised FTMS
  peripheral.** When QZ also advertised its virtual treadmill on the same
  iPhone, the treadmill connected to it and dropped the real link
  (issue #4867). If a game advertises a BLE peripheral, stop advertising
  while connecting to a Domyos.

## Practical recipe for a game

1. If the UART service `49535343-fe7d-...` is present, use this protocol;
   otherwise FTMS.
2. Subscribe, run the init, poll `F0 AC 9C` every 200 ms.
3. Set speed and incline together with the `AD` frame, only on change.
4. Parse the 26-byte status frame after reassembly.
