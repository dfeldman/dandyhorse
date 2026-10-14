# Sole (and Dyaco OEM) treadmills

Covers Sole F63, F65, F80, F85, F89, S77, TT8, ST90 and the Xterra TRX7.5
(same Dyaco control board). Among the most common US home treadmills.

Two protocols exist on the same hardware:

| path | QZ driver | when QZ uses it | control |
|---|---|---|---|
| FTMS (`0x1826`) | `horizontreadmill` (QZ's generic FTMS treadmill driver) | newer firmware, and the default for F80/F85/F89/S77 | depends on firmware; see below |
| Proprietary "Dyaco" UART over BLE | `solef80treadmill` | F63, F65, TRX7.5 always; F80/F85/F89/S77 only with `sole_treadmill_inclination`; TT8/ST90 only when they do not advertise FTMS | button-press emulation: speed up/down, incline up/down, start, stop |

### What Sole's FTMS actually accepts

This varies by model year and by country, because Sole ships region-specific
firmware. From QZ's issue tracker:

* **2023 F85 "ENT" firmware**: FTMS incline works, but only in whole-percent
  steps. FTMS speed commands are ignored; the firmware locks them, and the
  official Sole app has no speed control either (issue #2385). QZ's answer is
  "use FTMS, set the incline step to 1 %, speed is not controllable".
* **Some F85 units**: FTMS incline is refused entirely, which the QZ author
  attributes to a regional "safety" lock (issue #2607). The proprietary path
  is the fallback, and on some of those firmwares it does not work either.
* **Other F85 units**: FTMS with working auto-incline (issue #2552).
* **2014-2016 units** (for example F85 software `AC00490-02 D-V1.01`): no FTMS;
  proprietary only.

The only reliable approach is to probe: send an FTMS incline change and see
whether the reported incline follows, then do the same for speed.

Source: `src/devices/solef80treadmill/solef80treadmill.cpp` (QZ). The FTMS path
and its Sole-specific incline limits are in `ftms-treadmill-quirks.md`.

## Routing (`bluetooth.cpp:1571-1584`)

Case-insensitive `startsWith` on the advertised name. The whole branch also
requires that the user has not pinned a different device as `ftms_treadmill`.

| name | goes to proprietary driver when |
|---|---|
| `F80`, `F85`, `F89`, `S77` | `sole_treadmill_inclination` is on (else FTMS driver) |
| `F63`, `F65`, `TRX7.5` | always |
| `TT8`, `ST90` | the advertisement does not list service `0x1826` (else FTMS driver) |

Inside the driver a name starting `F63` selects the F63 stop sequence, and
`TRX7.5` forces `sole_treadmill_inclination` on (`solef80treadmill.cpp:892-899`).

## Settings that change the proprietary path

| setting | default | effect |
|---|---|---|
| `sole_treadmill_inclination` | false | routes F80/F85/F89/S77 here; also the master switch for **all writes** — with it off the driver never sends init or commands and just listens |
| `sole_treadmill_miles` | **true** | true means "frame speed is mph, convert to km/h" (multiply by 1.60934) |
| `sole_treadmill_f65` / `_f63` / `_tt8` | false | selects the model-specific init sequence and adds a second keepalive |
| `sole_treadmill_inclination_fast` | false | send several button presses per tick instead of one |

## GATT

Microchip "transparent UART" service (the RN4870 family used by many Dyaco,
iConsole and FitShow boards):

| UUID | role |
|---|---|
| `49535343-fe7d-4ae5-8fa9-9fafd205e455` | service |
| `49535343-8841-43f4-a8d4-ecbe34729bb3` | write (commands). WriteWithoutResponse if offered |
| `49535343-1e4d-4bd9-ba61-23c647249616` | notify (telemetry and replies). CCCD `01 00` |

When `sole_treadmill_inclination` is on, QZ enables notifications only on the
UART notify characteristic. When off, it enables every notify characteristic,
which is how FTMS `0x2ACD` frames reach the parser on read-only units
(`solef80treadmill.cpp:761-790`).

On iOS, QZ has to enable characteristic and descriptor discovery for this
board or the UART descriptors are not enumerated.

## Frame format

Every command and reply is framed:

```
5B <len> <payload: len bytes> 5D
```

`len` counts only the payload. There is no checksum. `4F 4B` inside a payload
is ASCII "OK". The meaning of individual opcodes below is inferred from how QZ
uses them; QZ does not document them.

| payload pattern | QZ's use |
|---|---|
| `F1 xx` | key press: `02` speed up, `03` speed down, `04` incline up, `05` incline down, `06` stop key |
| `03 xx` | mode/state: `01` part of init, `04` start, `06` stop, `07` end of stop |
| `00 xx 4F 4B` | "OK"-style query or keepalive: `10` noop, `06` noop2, `09`, `32`, `40`, `F1` |
| `F0` | hello (init step 1) |

## Init sequence (default F80/F85/F89/S77/TRX7.5)

Run after the notification descriptor is written (`btinit`,
`solef80treadmill.cpp:89-258`). Each write waits for the next notification
or 2 s, whichever comes first.

```
5B 01 F0 5D                     hello, then wait for one more packet
5B 02 03 01 5D     x4           each waits for a packet
5B 04 00 09 4F 4B 5D
```

That is the whole default init. Start is not sent here.

The F65, F63 and TT8 variants are longer and are listed verbatim in
`solef80treadmill.cpp:126-247`. The F63 variant sends about 50 frames,
including a 25-byte frame split into a 20-byte and a 5-byte write
(`5B 16 24 07` then zeros, then `00 00 00 00 5D`), and ends by sending start
four times. The TT8 variant uses `5B 06 07 01 23 00 9B 43 5D`,
`5B 03 08 20 02 5D` and `5B 05 04 0A 00 00 00 5D` where the default uses
`...9B AA...`, `08 10 01` and `04 00 00 00 00`. The trailing bytes of those
`07 01 23 00` frames are unexplained constants.

## Keepalive

Every 300 ms tick after init, QZ writes `5B 04 00 10 4F 4B 5D` and waits for
a reply. With any of the F65/F63/TT8 settings it also writes
`5B 04 00 06 4F 4B 5D`. Telemetry keeps flowing without the keepalive; the
keepalive's role in keeping the console in app-controlled mode is inferred,
not verified.

## Telemetry

**18-byte status frame** on the notify characteristic, identified only by
its length (`solef80treadmill.cpp:517-549`):

| offset | size | meaning |
|---|---|---|
| 9 | uint8 | heart rate, bpm (hand grips) |
| 10 | uint8 | speed in 0.1 mph (with the default `sole_treadmill_miles`) |
| 11 | uint8 | incline, whole percent |

Nothing else in the frame is parsed. There is no power; QZ computes it from
speed, incline and weight (see `../qz-base-behavior.md`).

**Stop event**: a 5-byte `5B 02 03 xx 5D` from the treadmill means the user
pressed stop or pause on the console. QZ reruns the init on the next tick
(except on F63).

**Paused**: in the proprietary mode the treadmill sends no frames while
paused. QZ forces speed to 0 and resets its integration timer on the next
frame so distance does not jump.

**FTMS `0x2ACD`**, if the unit also has FTMS, is parsed with the standard
layout. Total distance is skipped because it is a lifetime odometer. Total
energy is used for calories.

## Control: button-press emulation

There are no absolute set-points. QZ presses up or down once per 300 ms tick
until the reported value reaches the target (`forceSpeed` and `forceIncline`,
`solef80treadmill.cpp:422-482`):

```
speed up      5B 02 F1 02 5D
speed down    5B 02 F1 03 5D
incline up    5B 02 F1 04 5D
incline down  5B 02 F1 05 5D
```

Convergence rules that matter:

* A request is dropped once the reported value equals the target.
* A request is also dropped **as soon as the direction reverses**. If one
  press overshoots, QZ stops rather than hunting. The belt ends at the
  nearest reachable step, not the exact target.
* Speed requests are only acted on between 0 and 22 km/h. The step per press
  is not stated in QZ; the "fast" mode assumes 0.1 per press.
* Incline is compared as whole percent, clamped to 0..15, negatives become 0.
  QZ reports a 1 % minimum incline step for this driver.
* Presses only take effect once the belt is already running. Start the belt
  (from the console or with the start command) before sending any
  (issue #429).
* With `sole_treadmill_inclination_fast`, QZ sends up to
  `|Δspeed|*10 - 1` speed presses and `|Δincline|` incline presses inside one
  tick, each waiting for a reply.

A large speed change therefore takes several seconds: at one press per
~300 ms, a 3 mph jump is around 30 presses. Plan game pacing around that, or
use the fast mode.

## Start and stop

```
start:  5B 02 03 04 5D  x3,  then 5B 04 00 40 4F 4B 5D (not on F65)
stop:   5B 02 03 06 5D  x3,  5B 04 00 32 4F 4B 5D,  5B 02 03 07 5D  x3
stop (F63 by name):  5B 02 F1 06 5D  x2,  5B 02 03 06 5D  x4
```

## Practical recipe for a game

1. If the treadmill advertises `0x1826`, try FTMS first. Probe incline and
   speed separately; expect incline to work in 1 % steps and speed to be
   refused on 2023-era firmware. Never send an incline below the unit's
   minimum: one F85 jumped to 15 % when sent -1 % (issue #2552). QZ now sets
   the minimum to -5 % for F85/F89 and -6 % for TT8.
2. If incline over FTMS is ignored, use the proprietary path: connect,
   subscribe to the UART notify, run the default init, keepalive every 300 ms.
3. Drive speed and incline with the press loop above. Read back from the
   18-byte frame. Treat speed as mph tenths.
4. Rerun init after a console stop event.
