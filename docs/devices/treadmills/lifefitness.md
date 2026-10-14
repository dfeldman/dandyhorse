# Life Fitness treadmills (and GEM-module retrofits)

Life Fitness makes mostly commercial gym treadmills, plus home models such
as the T3 and T5 with Track Connect consoles. **QZ treats them as
read-only**: its FTMS speed and incline writes for this driver are commented
out, and no issue reports working control.

Source: `src/devices/lifefitnesstreadmill/lifefitnesstreadmill.cpp` (QZ).

## Routing (`bluetooth.cpp:1624`)

Name starting `LF` with a total length of exactly 15 or 18 characters.

Commercial treadmills retrofitted with a North Pole Engineering **GEM**
module (Life Fitness, Precor, Star Trac) advertise the plain name
`TREADMILL` and expose FTMS. QZ sends them to the generic FTMS treadmill
driver when the setting `gem_module_inclination` is on, or when the
advertisement lists `0x1826`. That setting was the fix for a Life Fitness T5
that showed no data (issue #2476). A Precor 956i on a GEM Retro works the
same way (issue #579).

## GATT

QZ discovers every service and binds these characteristics
(`lifefitnesstreadmill.cpp:stateChanged`):

| UUID | role |
|---|---|
| `0x2AD9`, `0x2ACD`, `0x2ACE`, `0x2AD3` | FTMS control point, Treadmill Data, Cross Trainer Data, Training Status |
| `5da558dc-9cb2-11e5-8994-feff819cdc9f` | Life Fitness write 1 (service 1) |
| `5da569e2-9cb2-11e5-8994-feff819cdc9f` | Life Fitness write 2 (service 1) |
| `5da54cf2-9cb2-11e5-8994-feff819cdc9f` | Life Fitness write 3 (service 2) |
| `ce78e85e-9cb6-11e5-8994-feff819cdc9f` | Life Fitness write 4 (service 2); its presence selects the Track Connect handshake |
| `c52d3161-d1a1-11e3-9c1a-0800200c9a66` | T5 command characteristic; its presence selects the T5 handshake |
| `4a8ff3f1-c933-11e3-9c1a-0800200c9a66` | T5 telemetry (notify) |

## Handshake A: Track Connect consoles

When `ce78e85e-...` exists (`btinit`):

1. `01` to write 1.
2. Empty writes to the standard User Data characteristics: first name
   `0x2A8A`, last name `0x2A90`, email `0x2A87`, age `0x2A80`, gender
   `0x2A8C`, language `0x2AA2`.
3. A 32-character ASCII hex token to write 3:
   `8a24c84aa4c0400c96ed1faa20fa4594`. It looks like an app key captured from
   the Life Fitness app; QZ sends the same value to every unit.
4. `01` to write 4.
5. Empty writes to weight `0x2A98` and height `0x2A8E`.
6. `00 00 00 01 B8 5B 5D` to write 2.
7. `02` to write 1.

Then QZ enables notifications on Training Status and on Treadmill Data (or
Cross Trainer Data if there is no Treadmill Data).

## Handshake B: T5 consoles

When `c52d3161-...` exists, QZ replays 14 frames captured from the Life
Fitness app. They start with `F1 00 <length>`, and carry workout names
("Norwegian 4x4", "5 x 1km at 9", "20min intervals (10 runs)") and a JSON
workout-library fragment; the last byte of each looks like a checksum. After
this the console shows "Android phone connected" and lists the app's
workouts (issue #3381). The first frames are:

```
F1 00 01 11 EE
F1 00 03 02 00 08 F3
```

The full set is in `lifefitnesstreadmill.cpp` (`btinit`, `lifet5` branch).

## Telemetry

* **FTMS `0x2ACD`**, standard layout. Incline is read as unsigned 0.1 %.
  Total energy from the frame is used as calories when present.
* **FTMS `0x2ACE`** (Cross Trainer Data), standard 3-byte flags; used on units
  that only expose it. Step rate becomes cadence; power and resistance are
  read when present.
* **T5 frame**: 40-byte notifications on `4a8ff3f1-...`:

| offset | size | meaning |
|---|---|---|
| 27 | uint8 | incline, 0.1 % |
| 32 | uint8 | speed, 0.1 km/h |

An older T5 log decoded by the QZ author (issue #834) showed a 20-byte frame
`19 53 CB 1A 21 06 00 00 FA 00 34 03 00 00 00 46 00 02 00 00`, with speed
`FA 00` = 250 = 2.5 km/h and incline `02`.

No power on treadmills; QZ computes it.

## Control

None. QZ limits speed requests to changes larger than 0.1 km/h and rounds
incline to 0.5 %, but then sends nothing. The commented-out code shows the
plain FTMS attempt (`00`, `07`, `02`/`03`), so it presumably did not work.

## Practical recipe for a game

1. Name `LF...` of length 15 or 18: pick handshake A or B from the
   characteristics present, then read FTMS or the T5 frame. Treat as a
   sensor.
2. Name `TREADMILL` with FTMS: a GEM retrofit. Use plain FTMS; control may
   work, depending on the treadmill behind the module.
