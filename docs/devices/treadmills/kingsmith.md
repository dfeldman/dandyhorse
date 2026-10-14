# Kingsmith / Xiaomi WalkingPad

Walking pads and folding treadmills sold as Kingsmith, WalkingPad and Xiaomi
WalkingPad. None of the proprietary models has an incline motor, so control
is speed only. There are three protocol generations:

| generation | example names | protocol | QZ driver |
|---|---|---|---|
| R1 Pro, A1, S1, older WalkingPads | `R1 PRO`, `KINGSMITH`, `WALKINGPAD`, `KS-ST-A1P`, `KS-H...`, `RE`, `KS-S1` | binary `F7 ... FD` frames, additive checksum | `kingsmithr1protreadmill` |
| R2, X21, X23, G1, K12 | `KS-ST-K12PRO`, `KS-X21`, `KS-NACH-MXG`, `KS-NGCH-G1C` ... | base64 text commands under a substitution cipher | `kingsmithr2treadmill` |
| Z1, R3 Hybrid+, newer | `KS-HD-Z1D`, `KS-AP-`, `KS-NG-`, `KS-ESP-`, `KS-MC` | FTMS | generic FTMS treadmill driver |

## Routing (`bluetooth.cpp:1448-1505`)

The R2 list is checked **before** the R1 Pro list, because `KS-H` in the R1
list would otherwise swallow `KS-HC-*` and `KS-HDSC-*`.

* **R2 family** (case-insensitive prefixes): `KS-ST-K12PRO`, `KS-R1AC`,
  `KS-HC-R1AA`, `KS-HC-R1AC`, `KS-X21`, `KS-HDSC-X21C`, `KS-HDSY-X21C`,
  `KS-NACH-X21C`, `KS-NGCH-X21C`, `KS-NACH-MXG`, `KS-NGCH-G1C`.
* **R1 Pro family**: `R1 PRO`, `KINGSMITH`, `DYNAMAX`, `WALKINGPAD`,
  `KS-ST-A1P`, `KS-SC-BLR2C`, `KS-H`, `KS-F0`, `KS-BLC`, `KS-BLR`, and the
  exact name `RE`. `KS-HD-Z1D` is excluded (it is FTMS).
* If the R1 Pro driver connects and finds no `0xFE00` service but does find
  FTMS, QZ stores the name as its FTMS treadmill and asks for a restart
  (`kingsmithr1protreadmill.cpp:488-495`).

## R1 Pro protocol (binary)

Source: `src/devices/kingsmithr1protreadmill/kingsmithr1protreadmill.cpp`.

### GATT

| UUID | role |
|---|---|
| `0xFE00` | service |
| `0xFE02` | write (with response if offered, else without) |
| `0xFE01` | notify, CCCD `01 00` |

### Frame format

```
F7 <bytes...> <checksum> FD
checksum = (sum of the bytes between F7 and the checksum) mod 256
```
Verified against every constant frame in the driver.

### Init (`btinit`)

Each write waits for a notification, up to 300 ms:

```
F7 A5 61 01 6A 23 1D BE 6F FD      (names RE and KS-S1: F7 A5 61 2B E9 19 C7 D2 CC FD)
F7 A2 00 00 A2 FD
F7 A6 00 00 00 00 00 A6 FD
F7 B1 05 07 15 16 08 18 08 FD
F7 B3 02 1D 00 D2 FD
```

The first notification after service discovery is ignored.

### Poll

Every 200 ms tick QZ writes the no-op `F7 A2 00 00 A2 FD` and waits for the
reply.

### Telemetry

20-byte notifications on `0xFE01`; other lengths are ignored.

| offset | size | meaning |
|---|---|---|
| 2 | uint8 | `05` means the pad is **locked** (child lock); send unlock |
| 3 | uint8 | current speed, 0.1 km/h |
| 12..13 | uint16 BE | step count |
| 14 | uint8 | target speed, 0.1 km/h |

QZ derives cadence from the change in step count over time (5 s average).
There is no incline and no power; QZ computes power from speed and weight.

The target speed at byte 14 is the speed the pad is accelerating toward. QZ
uses it to show the target while the belt ramps.

### Commands

| command | frame |
|---|---|
| set speed | `F7 A2 01 <speed*10> <checksum> FD` |
| start / pause (toggle) | `F7 A2 04 01 A7 FD` |
| unlock | `F7 A2 02 01 A5 FD` |

Start and pause are the same frame. QZ only sends it to stop if the belt is
moving. Speed range in QZ is 0..22 km/h, 0.1 steps; the pad's own maximum
is lower (6 km/h walking mode on most pads).

## R2 / X21 / X23 / G1 protocol (encrypted text)

Source: `src/devices/kingsmithr2treadmill/kingsmithr2treadmill.cpp` and `.h`.

### GATT

The UUIDs depend on the model, with fallbacks
(`kingsmithr2treadmill.cpp:serviceScanDone` and `stateChanged`):

| model (name prefix) | service | write | notify |
|---|---|---|---|
| default | `0x1234` | `0xFED7` | `0xFED8` |
| `KS-NACH-X21C` | `00021234-0000-1000-8000-00805f9b34fb`, else `00011234-...`, else `0x1234` | `0002FED7-...` or `0001FED7-...` to match | `0002FED8-...` / `0001FED8-...` |
| `KS-HDSY-X21C` | `0x1234`, else `00021234-...` | `0002FED7-...` on the fallback | `0002FED8-...` |
| `KS-NGCH-G1C` | `00011234-...`, else `00021234-...` | `0001FED7-...` / `0002FED7-...` | matching `FED8` |
| `KS-NACH-MXG` (X23) | `00011234-...` | `0001FED7-...` | `0001FED8-...` |

The practical rule: find a service whose UUID ends in `1234` and use the
`FED7`/`FED8` characteristics inside it.

### Encoding

Commands are ASCII text. To send one (`writeCharacteristic`):

1. Base64-encode the text.
2. Replace every character using a substitution table: find its index in the
   plain alphabet and take the character at that index in the cipher table.
3. Append `0D` (carriage return).
4. Write in 16-byte chunks, WriteWithoutResponse.

To receive: concatenate notifications until one ends with `0D`, drop the
`0D`, reverse the substitution, then base64-decode.

```
plain  ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
v1     SaCw4FGHIJqLhN+P9RVTU/WcY6ObDdefgEijklmnopQrsBuvMxXz1yA2t5078KZ3=   default
v2     ZaCw4FGHIJqLhN+P9RMTU/WcY6ObDdefgEijklmnopQrsBuvVxXz1yA2t5078KS3=   kingsmith_encrypt_v2
v3     0aCw4FGHIJqLhN+P9RVTU/WcY6ObDdefgEijklmnopQrsBuvMxXz1yA2t5Z78KS3=   kingsmith_encrypt_v3
v4     ZaCw4FGHIJqLhN9P+RVTU/WcY6ObDdefgEijklmnopQrsBuvMxXz1yA2t5078KS3=   kingsmith_encrypt_v4
v5     iaCw4FGHIJqLhN+P9RVTU/WcY6ObDdefgEZjklmnopQrsBuvMxXz1yA2t5078KS3=   kingsmith_encrypt_v5
v6     ZaCw4FGHIJqLhN+P8RVTU/WcY6ObDdefgEijklmnopQrsBuvMxXz1yA2t5079KS3=   kingsmith_encrypt_g1_walking_pad
v7     baCw4FGHIJqLhN+P9RVTU/WcY6OZDdefgEijklmnopQrsBuvMxXz1yA2t5078KS3=   always for KS-NACH-MXG (X23)
```

The tables are one base table with one or two characters swapped per
firmware. Which one a pad uses cannot be read from the advertisement. QZ
makes the user pick it. A contributor found v5 by encrypting a known
plaintext and diffing it against what the pad sent (issue #1473). A library
can do the same automatically: send `shake`, try each table on the reply,
and keep the one that decodes to text starting with `shake`.

### Handshake (`btinit`)

Each command waits for a reply, up to 300 ms. Typical replies are from
issue #1473:

| send | typical reply |
|---|---|
| (empty string) | format error |
| `shake` | `shake 00` |
| `net` | `net cloud` or `net unprov` |
| `get_dn` | `get_dn <device number>` |
| `get_pk` | `get_pk <product key>` |
| `time_posix <unix seconds>` | `time_posix 0` |
| `version` | `version 0014` (varies) |
| `servers getProp 1 2 7 12 23 24 31` | `servers 0`, then `props ...` lines |

Property requests only work after `get_pk` or `version`.

### Telemetry

Replies that start with `props` are space-separated key/value pairs, for
example:

```
props ControlMode 2 ChildLockSwitch 0 runState 0 handrail 0 MaxW 6.0 Max 12.0 StartSpeed 2.0 VelocitySensitivity 2 PanelDisplay 7
props netled 0 ControlMode 1 runState 0 CurrentSpeed 0.0 Max 12.0 unit 0
```

| key | meaning |
|---|---|
| `CurrentSpeed` | km/h |
| `spm` | steps per minute (QZ's cadence) |
| `ControlMode` | `0` automatic (the pad follows the walker's position), `1` manual, `2` standby |
| `runState` | `0` stopped, `1` running |
| `RunningDistance` | metres |
| `RunningSteps` | steps |
| `BurnCalories` | kcal × 1000 |
| `RunningTotalTime` | seconds |
| `Max`, `MaxW`, `StartSpeed` | maximum speed, walking-mode maximum, start speed |
| `Error` | followed by an error code; stop parsing the line |
| `mcu_version`, `goal` | string values; skip |

QZ treats the pad as ready once any `ControlMode` value arrives.

### Commands

| action | text |
|---|---|
| set speed | `props CurrentSpeed <km/h>` |
| manual mode | `props ControlMode 1` |
| start | `props runState 1` (after manual mode) |
| stop | `props runState 0` |

**Speed commands only work in manual mode.** In automatic mode the pad
speeds up and slows down by itself as the walker moves forward or back. QZ
switches to manual on start. It never switches back to standby on stop.

### Console buttons

With `kingsmith_r2_enable_hw_buttons` (default off), QZ treats a `runState`
change to `1` as the start button and to `0` as pause. It skips the first
`runState 0` with `ControlMode 1` at connection. It treats a pause followed
by zeroed time and steps as the stop button.

## Settings

| setting | default | effect |
|---|---|---|
| `kingsmith_encrypt_v2` ... `_v5`, `kingsmith_encrypt_g1_walking_pad` | false | choose the R2 cipher table |
| `kingsmith_r2_enable_hw_buttons` | false | follow the pad's physical start/pause/stop |

## Field reports

* **X23 (`KS-NACH-MXG`)**: start and stop needed the v7 table (issue #2645,
  from a 2024 community pull request).
* **Wrong speed on a K12**: caused by a leftover QZ speed-offset setting,
  not the pad (issue #1982). Check speed gain and offset before blaming
  the device.
* **Z1 (`KS-HD-Z1D`)**: FTMS; a 2026 report of it sending no data was a
  setup issue (issue #4623).

## Practical recipe for a game

1. If the pad advertises or exposes FTMS, use FTMS.
2. If it has service `0xFE00`: R1 Pro protocol. Init, no-op every 200 ms,
   set speed with `F7 A2 01`, unlock when byte 2 of a frame is `05`.
3. If it has a `...1234` service: R2 protocol. Detect the cipher table from
   the `shake` reply, run the handshake, send `props ControlMode 1` before any
   speed command.
4. Treat incline as absent. Estimate power from speed and weight, and
   cadence from steps.
