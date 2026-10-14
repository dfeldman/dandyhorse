# Octane Zero Runner (ZR7, ZR8, ZR8000)

The Zero Runner is a **non-motorized** running machine: the runner swings
pedal arms, somewhere between a treadmill and an elliptical. There is no belt
motor and no incline, so there is nothing to set. It is a pace and cadence
sensor. QZ files it under treadmills and its speed and incline functions are
empty.

Octane's Q37 elliptical uses the same Bluetooth service and message scheme;
it is covered on the elliptical page.

Source: `src/devices/octanetreadmill/octanetreadmill.cpp` (QZ). The top of that
file carries the full list of message IDs from Octane's Android app
(`com.octane.machineparsinglibrary`), which is what makes the protocol
readable (QZ issue #864).

## Routing (`bluetooth.cpp:2296`)

Names starting `ZR7` or `ZR8`. `ZR8` also switches on the ZR8 packet handling.

## GATT

| UUID | role |
|---|---|
| `96dc867d-7a83-4c22-b6be-6381d727aeda` | service |
| `96dc867f-7a83-4c22-b6be-6381d727aeda` | write (with response) |
| `96dc867e-7a83-4c22-b6be-6381d727aeda` | notify |

## Frames and message IDs

Frames start with `A5`, then a length byte. Their payload is a list of
Octane message IDs, each followed by its value. Message IDs used by QZ,
from the enum in the source:

| ID | name |
|---|---|
| 5 (`0x05`) | MODEL_AND_VERSION |
| 35 (`0x23`) | ZR_PACE |
| 58 (`0x3A`) | ZR_CADENCE |
| 112 (`0x70`) | MACHINE_PREFS |

The enum also lists LEVEL_CONTROL (27), STRIDE_CONTROL (30),
INCLINE_CONTROL (31), CONTROL_PAUSE (93), CONTROL_RESUME (91) and
CONTROL_TARGET_WATTS (98), among about 150 others. QZ never sends them, so it
is unknown whether a Zero Runner accepts stride-length or resistance-level
commands over Bluetooth.

## Init

Two requests, each waiting up to 400 ms:

```
A5 04 21 05 01 D9       request MODEL_AND_VERSION (5)
A5 04 21 70 01 6E       request MACHINE_PREFS (112)
```

The last byte is a checksum. Only these two frames exist, so the algorithm
is not confirmed: in both, checksum + (sum of bytes 1..4) ≡ 0x04 (mod 256).

## Telemetry

**ZR7**: 20-byte notifications; frames starting `A5 17` are ignored.

**ZR8**: frames start with `A5 <length code>` and span several
notifications. Reassemble to 29 bytes (`1D`), 32 (`20`/`21`), 35 (`23`) or
38 (`26`, gait analysis). Only frames `A5 {1D, 20, 21, 23} 06 ...` carry speed.

Values are found by searching for their message ID, not by fixed offset
(`characteristicChanged`):

* **Pace**: find `02 23`, `01 23` or `00 23` (a byte, then ZR_PACE). The next
  two bytes are the pace value, uint16 little-endian. QZ computes
  `speed_kmh = 3600 / pace`, which treats the value as seconds per kilometre.
* **Cadence** (ZR8): find `3A`; the next byte is cadence, valid 20..200.

Stopping detection in QZ: ZR7 treats 5 s without a frame as stopped. ZR8
treats 5 s of cadence below 20, or 30 s without a valid cadence, as stopped.

No power; QZ computes it as for a treadmill.

## Field reports

* **ZR8000 pace accuracy**: the console showed 9 min/mile while QZ showed
  about 5, with about ten dropouts per minute. Pace on a self-driven
  machine fluctuates stride to stride, and the parsing was still being
  tuned (issue #2030).
* **ZR8 with Zwift**: works as a run sensor through QZ's virtual treadmill
  (issue #1338).

## Practical recipe for a game

Treat the Zero Runner as a pace and cadence sensor, smoothed over a few
seconds. Never offer speed or incline control.
