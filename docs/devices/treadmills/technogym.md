# Technogym MyRun (and Technogym Run on FTMS)

Technogym's home treadmill, the MyRun (about 2016 onward), speaks FTMS for
control and telemetry, but only after a Technogym-specific handshake. An
older Bluetooth Classic text protocol also exists. Gym models (Run,
Skillrun, Excite) that advertise plain `TREADMILL` with FTMS go through the
generic FTMS driver with no special handling.

Sources: `src/devices/technogymmyruntreadmill/technogymmyruntreadmill.cpp` and
`src/devices/technogymmyruntreadmillrfcomm/technogymmyruntreadmillrfcomm.cpp` (QZ).

## Routing (`bluetooth.cpp:1771-1815`)

| name | driver |
|---|---|
| `MYRUN ` (note the trailing space), `MERACH-U3` | BLE MyRun driver |
| same, with `technogym_myrun_treadmill_experimental` on (not on iOS) | Bluetooth Classic RFCOMM driver |
| `TREADMILL` advertising `0x1826` | generic FTMS treadmill driver (flag `technogymrun`, no behaviour change) |

The Merach U3 is routed here, so it presumably shares the MyRun firmware.

## BLE protocol

### GATT

The MyRun exposes several services. QZ subscribes to every notify and
indicate characteristic on all of them.

| UUID | role |
|---|---|
| `0x1826` / `0x2AD9` | FTMS control point (write, indicate) |
| `0x2ACD` | FTMS Treadmill Data (notify) |
| `0x1814` / `0x2A53` | Running Speed and Cadence (cadence) |
| `df1eb8e4-1753-4bb9-a6a6-e018040af0a3` | Technogym text command characteristic (write) |
| `0x2A98` | Weight characteristic (write) |

### Handshake (`btinit`, `technogymmyruntreadmill.cpp`)

Runs once the descriptors are written. Each step waits up to 3 s.

1. **Request control with a code**, on the FTMS control point:
   ```
   00 93 F0 51 E8 1B 42 92 8E
   ```
   Standard FTMS Request Control is the single byte `00`. The MyRun expects
   eight more bytes, which look like a fixed authentication code. QZ sends the
   same bytes to every unit.
2. **Text commands** on `df1eb8e4-...`. Each is ASCII framed as `@...#`, and
   QZ writes them **one byte per write**:
   ```
   @DISABLE_PACE#
   @SSIUNITS#                      (SI units)
   @RJSK_EN 1#                     (probably "right joystick enable": the speed paddle)
   @LJSK_EN 1#                     (probably the incline paddle)
   ```
3. **Weight**: `30 43` to `0x2A98`. As a standard weight value
   (uint16 LE, 0.005 kg units) that is 86 kg; QZ hard-codes it.
4. **Date**: `@SETDATE 13 01 2022 19 31 45#`, also one byte per write and
   hard-coded.

The meanings of the text commands are inferred from their names. The same
`@...#` command family appears in Technogym's SkillMill Go manual
(QZ issue #515).

### Control

After the handshake, control is plain FTMS **without** re-sending `00`/`07`
before each write:

| action | bytes |
|---|---|
| set speed | `02 <uint16 LE, 0.01 km/h>` |
| set incline | `03 <sint16 LE, 0.1 %>` |
| start | `07` |
| stop | `08 01` |

QZ waits for the control point indication after each speed and incline
write. Ranges in QZ: 0..22 km/h, 0..15 %; negative inclines become 0.

### Telemetry

* `0x2ACD` with the standard layout. QZ reads incline as unsigned, so
  negative inclines would read wrong. Expended energy from the frame is used
  for calories when present.
* Cadence from RSC Measurement byte 3. It is steps per minute per foot or
  total depending on firmware; QZ has a doubling setting
  (`powr_sensor_running_cadence_double`). A user saw cadence doubled in FIT
  exports until that setting was set correctly (issue #1261).
* No power; QZ computes it.

QZ suppresses auto-pause for 10 s after start and auto-start for 25 s after
stop.

## Bluetooth Classic (RFCOMM) protocol

Used only with `technogym_myrun_treadmill_experimental` (default off, never on
iOS, because iOS does not allow third-party apps to use Serial Port Profile).
The treadmill offers a Serial Port service (`0x1101`); commands are ASCII.

Init, each waiting up to 3 s for a reply:

```
@FWVER#
!DEV,027#
!DEV,060#
!DEV,101,1,21,4#@rtg_id#
!DEV,073#
!DEV,102#
!DEV,104#
!DEV,073#
!DEV,053,0.0,0#@SSIUNITS#@DISABLE_PACE#
!DEV,032,0#
```

| action | text |
|---|---|
| set speed | `!DEV,024,<km/h>,1.8#` (the `1.8` is unexplained, possibly acceleration) |
| set incline | `!DEV,025,<percent>#` |

QZ limits speed to 0..20 km/h and incline to 0..12 % on this path.

Telemetry lines longer than 60 characters are comma-separated; field 2 is
speed and field 3 is incline.

## Field reports

* **Some MyRun firmware exposes no control point**, so the treadmill is
  read-only over Bluetooth. The QZ author attributes it to a locked firmware
  version and suggests asking Technogym for an update (issue #1737).
* **Console paddles**: there is no Bluetooth command to lock the MyRun's
  speed and incline paddles. QZ instead puts the treadmill into standby
  (speed and incline to 0) when the app pauses, which also disables the
  paddles (issue #620).
* **Zwift grade vs treadmill incline**: a long investigation found QZ was
  applying exactly what Zwift sent; Zwift's on-screen gradient is smoothed
  and lags the raw value (issue #610).

## Practical recipe for a game

1. Connect, subscribe to everything, send the 9-byte Request Control, then
   the text commands one byte per write, then the weight and date.
2. Control with FTMS `02`/`03`, waiting for each indication. Do not resend
   `00`: it would be the plain one-byte form without the code.
3. Read `0x2ACD` and RSC cadence. If there is no control point, treat the
   treadmill as read-only.
