# Schwinn IC4 / IC8, Bowflex C6 / C7 / C9 / C10, Schwinn 170 / 270

Two unrelated families sold under Nautilus Inc brands (now BowFlex Inc).

| family | protocol | reads | control |
|---|---|---|---|
| Schwinn IC4, IC8, Bowflex C6, C7, C9/C10 | FTMS Indoor Bike Data, read-only | cadence, power, speed | **none**; manual knob |
| Schwinn 170, 270 upright/recumbent | Nautilus proprietary | power, speed, crank count, resistance level | **none** from QZ |

Neither family accepts resistance commands from QZ. Auto-resistance needs
an add-on motor such as SmartSpin2k (SS2K), which turns the knob and becomes
a separate FTMS device.

## Schwinn IC4 / IC8 / Bowflex C6 / C7 / C9-C10

Source: `src/devices/schwinnic4bike/schwinnic4bike.cpp` (QZ).

### Routing (`bluetooth.cpp:2449`)

Names starting `IC BIKE` (IC4, IC8), `C7-` unless the name is exactly 17
characters long, and `C9/C10`. The Bowflex C6 advertises as `IC BIKE` too.
QZ sends these to a dedicated read-only driver, not its FTMS bike driver.

**iOS**: the bike accepts connections from more than one central.
On iOS QZ remembers the last `IC BIKE` or `C7-` name and connects at startup
without waiting for a scan (`bluetooth.cpp:714-727`).

### Telemetry

Standard FTMS `0x2AD2` (see `ftms-bike.md`): speed, cadence ÷ 2, total
distance, power. QZ uses the reported speed and distance unless the rider
picks power-based speed.

**No resistance level is sent.** The bike has a 1-100 knob, but the level
does not appear in the FTMS data. QZ computes a Peloton-style resistance from
power and cadence (`../qz-base-behavior.md`). That estimate jumps between
neighbouring values while the knob is still; QZ added a smoothing setting,
`schwinn_resistance_smooth`, which ignores changes smaller than N (issue
#1236). Power itself matches the console (issue #2371).

QZ maps its Peloton-style resistance onto the Schwinn knob with one of three
curves, selectable in settings:

```
default: p > 54 → p;  p < 26 → p / 5;  else 0.04·p² − 1.32·p + 11.8
v2:      p > 20 → (p − 20) × 1.25;  else 1
v3:      p < 30 → 0;  else −35.3 + 1.91·p − 0.0358·p² + 0.00043·p³
```

### With SmartSpin2k

The SS2K reports its own resistance to QZ as an FTMS accessory. Syncing the
two is fragile. A Bowflex C6 knob at 0 showed as 5 in QZ, and SS2K
occasionally drove resistance above 90 mid-ride (issue #500). A game that
supports SS2K should talk to it as an FTMS bike and read power from the
Schwinn.

## Schwinn 170 / 270

Source: `src/devices/schwinn170bike/schwinn170bike.cpp` (QZ). The console
speaks the Nautilus Inc protocol also used by Bowflex and Nautilus
treadmills (`../treadmills/bowflex-nautilus.md`).

### Routing (`bluetooth.cpp:2432`)

Names starting `SCHWINN 170/270`.

### GATT and init

QZ subscribes to every notify and indicate characteristic. It writes one
frame to Nautilus write characteristic `5ec4e520-9804-11e3-b4b9-0002a5d5c51b`
or `1717b3c0-9803-11e3-90e1-0002a5d5c51b`, and to any write-without-response
characteristic:

```
07 01 D3 00 1F 05 01        len 7, seq 1, zero-sum checksum D3, command 1F 05 01
```

**The console only streams during a workout.** The rider must press Quick
Start on the bike first (issue #3220).

### Frames (told apart by length)

| length | contents |
|---|---|
| 14 | speed: bytes 3..4 LE ÷ 100 km/h; power: bytes 6..7 LE ÷ 100 W |
| 17 | cumulative crank count: bytes 4..5 LE |
| 20 | resistance level: byte 18 |

Cadence is the crank-count delta divided by the time between changes.
Samples are coarse, so a single sample can be far off. Users needed QZ's
cadence gain and offset to match the console (issues #1957, #2366). Average
over a few seconds instead.

QZ sends no resistance commands; its `forceResistance` call is commented out.

## Practical recipe for a game

* **IC4 family**: connect as a read-only FTMS bike. Show grade as a target
  knob position with the curve above, and let the rider turn it.
* **Schwinn 170/270**: subscribe, send the init frame, ask the rider to press
  Quick Start. Read power from the 14-byte frame and cadence from the
  crank-count frame. Show the resistance level from the 20-byte frame.
