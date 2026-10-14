# Echelon Stride treadmills

Echelon's folding treadmills (Stride, Stride 4, Stride 6, Stride 6S, Stride 8S,
Sport). They share Echelon's Bluetooth service and frame format with Echelon
bikes, rowers and the stair climber.

**Speed and incline cannot be controlled over Bluetooth.** QZ's author:
"echelon stride doesn't have these controls from Bluetooth" (issue #2534). A
dedicated QZ test build that tried to change speed never succeeded
(issue #1721). Start, stop and heart rate do work. QZ still sends speed and
incline commands, shown below for completeness.

Source: `src/devices/echelonstride/echelonstride.cpp` (QZ).

## Routing (`bluetooth.cpp:2262`)

Names starting `ECH-STRIDE`, `ECH-UK-`, `ECH-FR-`, `STRIDE`, `STRIDE6S-` or
`ECH-SD-SPT`. A name starting `STRIDE4` selects the Stride 4 variant inside
the driver. New model names keep appearing (the Stride 6S needed `STRIDE6S-`
added, issue #2534).

## GATT

| UUID | role |
|---|---|
| `0bf669f1-45f2-11e7-9598-0800200c9a66` | Echelon service |
| `0bf669f2-45f2-11e7-9598-0800200c9a66` | write (with response) |
| `0bf669f3-45f2-11e7-9598-0800200c9a66` | notify 1, CCCD `01 00` |
| `0bf669f4-45f2-11e7-9598-0800200c9a66` | notify 2, CCCD `01 00` |

## Frame format (all Echelon equipment)

Decoded from QZ's constant frames; every one satisfies it:

```
F0 <command> <length> <data: length bytes> <checksum>
checksum = (sum of all preceding bytes) mod 256
```

## Init (`btinit`)

Each frame waits up to 300 ms for a reply:

```
F0 A4 00 94
F0 A1 00 91   x4
F0 A3 00 93
F0 A1 00 91                (not on Stride 4)
```

Stride 4 instead starts with `F0 A4 00 94` twice, then
`F0 E0 FD 3E 65 48 D5 8D`, then `F0 A4 00 94`, before the `A1`/`A3` frames. The
source comment says the treadmill first sends a frame like
`F0 E0 72 85 18 58 61 98`. That looks like a challenge and response, but QZ
always replies with the same fixed bytes.

## Poll

Every 2 seconds QZ sends `F0 A0 01 <counter> <checksum>`, with the counter
running 1..255 and skipping 0.

## Telemetry, and the echo rule

**The treadmill's `D0`, `D2` and `D3` frames must be echoed back.** QZ writes
each one straight back to the write characteristic, unchanged, as an
acknowledgement (`characteristicChanged`).

| frame | content |
|---|---|
| `F0 D3 ...` | speed: bytes 3..4, uint16 big-endian, ÷ 1000 |
| `F0 D2 ...` | incline: byte 3, whole percent |
| `F0 D0 ...` | state; echo only |
| `F0 D1 ...` (Stride 4) | speed: bytes 7..8, uint16 big-endian, ÷ 100 |
| `F0 D1 ...` longer than 11 bytes | heart rate: byte 11 |

**Speed units vary by unit.** Some Strides report mph × 1000 and others
km/h × 1000. QZ multiplies by 1.60934 when its miles setting is on (by
default it is; the setting is shared with Sole). Users with km/h consoles
turn it off (issues #1528, #1662).

No power; QZ computes it.

## Commands

| action | frame |
|---|---|
| start | `F0 B0 01 01 A2`, then `F0 D0 01 00 C1` and `F0 D0 01 11 D2`. Stride 4 also sends `F0 A5 00 95` and `F0 D3 02 01 F4 BA` |
| stop | `F0 B0 01 00 A1` |
| set speed (no effect reported) | `F0 B2 02 <speed×1000 hi> <lo> <checksum>`; QZ passes km/h here even though it reads mph |
| set incline (no effect reported) | `F0 B1 01 <whole percent> <checksum>` |

## Field reports

* **Stays in app mode**: on iOS the Stride kept showing "app connected"
  after QZ closed, because iOS kept the Bluetooth link alive. Send stop and
  disconnect cleanly (issue #1155).
* **Locked by Echelon, 2026**: a newer Stride sent no metrics at all because
  Echelon locks the treadmill until its own app has authenticated
  (issue #4831). QZ's answer, in an open pull request (#4581), is a proxy:
  QZ advertises the Echelon service, the official Echelon app connects to
  QZ, and QZ relays packets both ways, so the vendor app performs the unlock.
  It needs Android, where the official app can run on the same device.

## Practical recipe for a game

1. Treat the Stride as a speed sensor with start and stop.
2. Init, poll `F0 A0` every 2 s, echo every `D0`/`D2`/`D3` frame back.
3. Decide the speed unit once against the console display, and let the user
   flip it.
4. If no telemetry arrives, the treadmill is probably vendor-locked; only a
   relay through the official app works.

## 2026 firmware lock

Stride treadmills on mid-2026 firmware send an 8-byte `F0 E0 ...` challenge
and stream nothing until the official Echelon app authenticates (issue #4831).
QZ unlocks them by relaying the Echelon app's handshake, the same way as
Echelon bikes; see `../bikes/echelon.md`. The fixed Stride 4 reply above
predates this lock and does not answer it.
