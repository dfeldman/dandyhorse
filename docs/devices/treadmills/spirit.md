# Spirit (and SynchronAction) treadmills

Spirit Fitness, like Sole, is a Dyaco brand (QZ issue #283), and the
treadmills use the same Bluetooth board and `5B ... 5D` framing as Sole's
proprietary protocol (`sole.md`). The SynchronAction XT900 sold in Italy is
also Dyaco-made (issue #550).

**Speed is not controllable.** Spirit confirmed to a user that its own
Spirit+ app was deliberately stopped from changing treadmill speed "for
safety" (issue #2323, 2024 XT485). Incline can be controlled on at least
some units. For speed, the QZ author's only workaround is soldering a relay
board to the console's speed buttons (issue #525).

Source: `src/devices/spirittreadmill/spirittreadmill.cpp` (QZ).

## Routing

| name | driver |
|---|---|
| `XT385`, `XT800`, `XT900`; `XT485` without advertised FTMS | proprietary Spirit driver (`bluetooth.cpp:2789`) |
| `XT485` advertising `0x1826`, `XT685`, `XT285` | generic FTMS treadmill driver |

Inside the proprietary driver the name selects the `XT385` or `XT485`
variant; everything else uses the default variant.

An XT385 that showed no data on the proprietary driver worked once the user
set it as QZ's FTMS treadmill. Incline control then worked and speed did not
(issue #4474, 2025). **Try FTMS first on any Spirit.**

## GATT

Microchip transparent UART, as on Sole and Domyos: service
`49535343-fe7d-4ae5-8fa9-9fafd205e455`, write
`49535343-8841-43f4-a8d4-ecbe34729bb3` (with response), notify
`49535343-1e4d-4bd9-ba61-23c647249616`.

## Init

Each frame waits up to 300 ms for a reply. Verbatim from `btinit`:

```
XT485:
5B 01 F0 5D
5B 04 00 10 4F 4B 5D
5B 02 03 01 5D   x2
5B 04 00 10 4F 4B 5D
5B 02 03 01 5D
5B 04 00 09 4F 4B 5D  x4 (with one 5B 04 00 10 ... among them)
5B 06 07 01 2C 00 61 59 5D
5B 03 08 20 04 5D
5B 05 04 0A 00 00 00 5D
5B 02 22 09 5D
5B 02 02 02 5D

default (XT800 / XT900):
as XT485, but with 5B 02 03 01 5D x3, and
5B 06 07 00 23 00 84 40 5D,  5B 03 08 10 01 5D,  5B 05 04 00 00 00 00 5D

XT385:
5B 01 F0 5D,  5B 02 03 01 5D x3,  5B 04 00 09 4F 4B 5D x2,
5B 04 00 10 4F 4B 5D x10,  5B 06 07 01 23 00 9B AA 5D x2,
5B 03 08 10 01 5D,  5B 05 04 62 00 00 00 5D x2,
5B 02 22 09 5D,  5B 02 02 02 5D,  5B 02 03 04 5D x2
```

These are variants of the same Dyaco sequence as Sole's (compare
`5B 06 07 0x 23 00 ...` and `5B 03 08 ...`). The meaning of the constants is
not documented.

## Poll

Every 200 ms tick QZ writes `5B 04 00 10 4F 4B 5D` and waits for a reply. The
code intends to alternate it with a second no-op (`...00 40...` on the
default variant, `...00 06...` on XT385/XT485), but passes the first frame
both times, so only `00 10` is actually sent.

## Telemetry

The 18-byte frame, identified by length only, as on Sole:

| offset | size | meaning |
|---|---|---|
| 7..8 | uint16 BE | calories, 0.1 kcal |
| 10 | uint8 | speed, 0.1 (QZ treats it as km/h; Sole's identical frame is mph) |
| 11 | uint8 | incline, 0.1 % (Sole's is whole percent) |

Hand-grip heart rate is not read. No power; QZ computes it.

The units of byte 10 are unconfirmed: QZ reads the same byte as mph on Sole
and km/h on Spirit. Check against the console display.

## Control in QZ

| action | XT385 | XT485 and default |
|---|---|---|
| speed up | `5B 02 F1 02 5D`, then `5B 04 00 06 4F 4B 5D` | `5B 04 00 06 4F 4B 5D` |
| speed down | `5B 02 F1 03 5D`, then `5B 04 00 06 4F 4B 5D` | `5B 04 00 32 4F 4B 5D` |
| incline up / down | `5B 02 F1 04 5D` / `F1 05`, each followed by `5B 04 00 06 4F 4B 5D`; press-and-reverse loop as on Sole | not sent |
| start | `5B 02 03 04 5D` x2 | XT485: `5B 02 03 03 5D` x2; default: nothing |
| stop | `5B 02 F1 06 5D` x4 | XT485: same; default: nothing |

Given Spirit's statement about speed, treat the speed rows as unlikely to
work on current firmware. Incline requests are rounded to 0.5 % and limited
to 0..15 %.

## Field reports

* **2024 XT485**: after a QZ update for the new firmware, the treadmill
  connected, stopped auto-starting a built-in workout, and followed incline
  changes; speed stayed uncontrollable, as in Spirit's own app
  (issue #2323).
* **XT685 on FTMS**: QZ's speed-based cadence estimate looked wrong to a
  user; it depends on the height set in QZ (issue #4505).

## Practical recipe for a game

1. Prefer FTMS (`XT485` with FTMS, `XT685`, `XT285`, or any Spirit that
   works as an FTMS treadmill). Expect incline control and no speed control.
2. Otherwise: proprietary init, poll `5B 04 00 10 4F 4B 5D`, read the 18-byte
   frame, and drive incline with presses on the XT385 only.
3. Design game modes where the runner sets the pace.
