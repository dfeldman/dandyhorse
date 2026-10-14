# Bowflex and Nautilus treadmills (Nautilus Inc.)

Bowflex, Nautilus and Schwinn are Nautilus Inc. (now BowFlex Inc.) brands.
Their older consoles share one Bluetooth design: vendor UUIDs ending in
`0002a5d5c51b`, the write characteristic `1717b3c0-9803-11e3-90e1-0002a5d5c51b`,
and a common frame format. The same family is used by Nautilus ellipticals,
Nautilus bikes and the Schwinn 170/270 bikes (covered on their own pages).

**These treadmills are read-only.** QZ can start and stop some of them but
cannot set speed or incline; its speed and incline functions are empty. The
QZ author: Bowflex devices "don't have speed or control from any external
app" (issue #2202). Newer Bowflex treadmills (`BFX_T...`, for example the T9)
are FTMS and controllable; see `ftms-treadmill-quirks.md`.

Sources: `src/devices/bowflext216treadmill/bowflext216treadmill.cpp`,
`src/devices/nautilustreadmill/nautilustreadmill.cpp` (QZ). A third driver,
`bowflextreadmill`, exists in the source but is never used.

## Routing

| name | driver |
|---|---|
| `BOWFLEX T...` (BXT116, BXT216, BXT326, T22, T6, T8J, T128) | `bowflext216treadmill` (`bluetooth.cpp:2662`) |
| `NAUTILUS T...` (T616, T618, T628) | `nautilustreadmill` (`bluetooth.cpp:2692`) |
| `BFX_T...` | FTMS driver, matched earlier in QZ's list |

## Frame format (whole family)

Decoded from the constant frames in both drivers; every one of the eight
satisfies it:

```
<length> <sequence> <checksum> 00 <command> [args...]
length   = total frame length in bytes
sequence = incrementing message counter
checksum = chosen so that all bytes of the frame sum to 0 mod 256
```

## Bowflex BXT/T series

### GATT

The service UUID varies. QZ tries these in order and the one found selects
the telemetry layout (`bowflext216treadmill.cpp:serviceScanDone`):

| service | variant |
|---|---|
| `edff9e80-cad7-11e5-ab63-0002a5d5c51b` | default (BXT216 and similar) |
| `b1216c2e-464e-4c46-b2b4-0b5c8eb23dae` | default layout |
| `15b7bf49-1693-481e-b877-69d33ce6bafa` | T6 |
| `b5c78780-cad7-11e5-b9f8-0002a5d5c51b` | BTX116 |
| `ebbe6870-d00a-4bf4-bb79-63b35bf4c6b5` | T8J |

Inside the service: write `1717b3c0-9803-11e3-90e1-0002a5d5c51b`; notify
characteristics `35ddd0a0-...`, `6be8f580-...`, `a46a4a80-9803-11e3-8f3c-0002a5d5c51b`,
`b8066ec0-...`, `d57cda20-...` (all with the `-9803-11e3-...-0002a5d5c51b`
suffix). QZ enables all five; data comes on `a46a4a80`.

### Init

Each write waits up to 300 ms for a notification:

```
05 01 E3 00 17
05 02 E4 00 15
05 03 E1 00 17
07 04 D1 00 1F 05 00
05 05 DF 00 17
```

### Start and stop

```
start:        07 06 CF 00 1F 05 00
stop / pause: 0A 08 7A 00 19 28 01 32 00 00
```

### Telemetry

Frames of 20 bytes (12 on the T8J). QZ reads only frames from `a46a4a80`,
except on the BTX116 and T8J variants, which it accepts from any
characteristic.

| variant | speed | incline |
|---|---|---|
| default | bytes 6..7, uint16 LE, 0.01 mph | byte 4, whole percent |
| T6 | bytes 9..10, uint16 LE, 0.01 mph | not available |
| T8J (12-byte frames) | bytes 3..4, uint16 LE, 0.01 mph | byte 6 |
| T128 (name `BOWFLEX T128`) | bytes 9..10 on `a46a4a80`, 0.01 mph | byte 7 of frames on the other characteristics |

If no data frame arrives for 5 s, QZ sets speed to 0. Pausing on the console
keeps the last speed on the wire, so QZ cannot tell pause from running
(issue #712).

There is no power; QZ computes it from speed, incline and weight.

## Nautilus T616 / T618 / T628

### GATT

Service, tried in order: `89e14b5e-a841-48ad-b580-935f4545fffc`,
`f12f71ab-c228-45f2-98a2-6654f9adbe78`, `19df5b20-31c7-11e6-a336-0002a5d5c51b`,
`4b2387a0-be8e-11e3-8039-0002a5d5c51b`. Write `1717b3c0-...`; notify
`a46a4a80-...` and `6be8f580-...`.

### Init

```
07 01 D3 00 1F 05 01        (not waited for)
```

The same frame initializes Nautilus ellipticals, Nautilus bikes and the
Schwinn 170/270.

### Telemetry

12-byte frames:

| offset | size | meaning |
|---|---|---|
| 3..4 | uint16 LE | speed, 0.01 mph |
| 6 | uint8 | incline, whole percent (not on the T628) |

Start and stop are not sent; control is not possible.

## Field reports

* **Control**: none from any third-party app. For users who insist, the QZ
  author wires a Modbus relay board to the console's speed and incline
  buttons, and QZ drives the relays (issue #2202).
* **Newer Bowflex on FTMS, 2026**: speeds were first shown at 0.62× and,
  after a fix, at 1.61× the console value; QZ's up and down buttons both moved
  speed in one direction. It is the mph/km/h ambiguity again (issue #4210).
  Verify units on the first frame and the first command.

## Practical recipe for a game

1. Treat `BOWFLEX T...` and `NAUTILUS T...` as speed and incline sensors
   only. Offer "follow the treadmill" game modes, not "the game sets the
   pace".
2. Run the init, read the frame layout for the service variant found,
   convert 0.01 mph to km/h.
3. Treat 5 s without data as stopped.
