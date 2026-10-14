# Tacx (FE-C over BLE), ThinkRider, and other FE-C trainers

Tacx trainers (NEO, NEO 2, NEO 2T, NEO Bike, Flux, Flux S, Flux 2, Flow
Smart, Vortex Smart) accept ANT+ FE-C messages over a BLE characteristic.
They also expose Cycling Power, Cycling Speed and Cadence, and on newer
firmware FTMS. QZ reads the standard characteristics and writes FE-C.

Source: `src/devices/tacxneo2/tacxneo2.cpp` (QZ).

## Routing (`bluetooth.cpp:1838`)

The Tacx driver takes names starting `TACX `, `THINK X`, `THINK-`, `THINK_`
(ThinkRider), `53997-`, `NOZA-ONE ` (Xplova), `VANRYSEL-HT` and
`TACX SMART BIKE`. It skips `TACX SATORI`, a non-smart resistance unit that
goes to the Stages-style power-only driver. This branch sits before the
generic FTMS branch, so these names use FE-C unless the user has chosen an
FTMS bike.

**Fallback to FTMS**: if the FE-C characteristic is missing, the first write
stores the device as the user's FTMS bike and asks for an app restart
(`tacxneo2.cpp:33-41`). From then on, the FTMS driver runs it. A library can
do the same decision up front from the GATT table.

## GATT

| UUID | role |
|---|---|
| `6e40fec1-b5a3-f393-e0a9-e50e24dcca9e` | Tacx FE-C service |
| `6e40fec2-b5a3-f393-e0a9-e50e24dcca9e` | FE-C notify (trainer → app) |
| `6e40fec3-b5a3-f393-e0a9-e50e24dcca9e` | FE-C write (app → trainer) |
| `0x2A63` | Cycling Power Measurement: power; ThinkRider also puts crank data here |
| `0x2A5B` | CSC Measurement: crank revolutions for cadence |
| `0x2AD2` | FTMS Indoor Bike Data (newer firmware): cadence and power |
| `fe03a000-...`, `fe031000-17d0-470a-8798-4ad3e1c1f35b` | skipped by QZ; not needed |

QZ subscribes to every notify and indicate characteristic in the other
services. Writes go one at a time, each waiting up to 300 ms for the write
acknowledgement. Android connection parameters are the same as Wahoo's.

## FE-C framing

Each write is one ANT broadcast message, 13 bytes:

```
A4 09 4E 05 <page> <7 data bytes> <checksum>
sync len  msgid channel   page + 7 bytes = 8-byte ANT payload
checksum = XOR of all 12 preceding bytes, including A4
```

### Page 0x33, track resistance (grade)

```
A4 09 4E 05 33 FF FF FF FF <grade LE> <Crr> <chk>
grade = (grade% + 200) × 100, uint16      Crr: 0xFF = trainer default (0.004); else units of 5×10⁻⁵
```

| grade | bytes (standard checksum) |
|---|---|
| 0 % | `A4 09 4E 05 33 FF FF FF FF 20 4E FF 44` |
| +5 % | `A4 09 4E 05 33 FF FF FF FF 14 50 FF 6E` |
| −3.05 % | `A4 09 4E 05 33 FF FF FF FF EF 4C FF 89` |

QZ's grade checksum is not the ANT XOR: it sums bytes 1..11 and adds 1
(`tacxneo2.cpp:97-101`). Tacx trainers follow QZ's grade commands anyway, so
the checksum does not seem to be validated over BLE. This is an inference
from QZ working; send the standard XOR.

### Page 0x31, target power (ERG)

```
A4 09 4E 05 31 FF FF FF FF FF <watts×4 LE> <chk>
150 W: A4 09 4E 05 31 FF FF FF FF FF 58 02 72
```

QZ's power checksum is the standard XOR.

### Page 0x37, user configuration

```
A4 09 4E 05 37 <user kg×100 LE> FF <wheel-offset | bike-weight bits> <bike weight> <wheel diameter cm> <gear ratio ÷ 0.03> <chk>
```

QZ has a builder for it (`setUserConfiguration`) but never calls it. Its
checksum there is XOR over bytes 1..11, leaving out `A4`.

Page 0x32 (wind resistance) is not used. The trainer is left at its default
wind model, which suits a fixed-wind game.

## Session

There is no unlock or start command. After subscriptions, QZ's 200 ms loop
sends:

* **Grade** (`33`) whenever the app requests a grade. Virtual gears are added
  to the grade: `grade + gear + gears_offset` in grade % (default: 1 % per
  gear).
* **Resistance level** requests become grade = level ÷ 10. QZ does this only
  when no FTMS app is connected to its virtual trainer and no power target is
  active.
* **ERG** (`31`) when the app sets a power target. A grade command takes the
  trainer back out of ERG; no mode switch is needed.

Setting `tacx_neo2_peloton` changes how the displayed resistance is derived
from grade. It does not change what is sent.

## Telemetry

QZ prefers FTMS `0x2AD2` when present: cadence (÷ 2) and power. Once it sees
a non-zero cadence there, it ignores CSC. Otherwise:

* **Power** from `0x2A63` bytes 2..3.
* **Cadence** from CSC `0x2A5B` crank revolutions and event time (1/1024 s).
  QZ handles the 16-bit wrap correctly and drops frames where the count jumps
  backwards by more than 100.
* **ThinkRider X** sends crank data inside `0x2A63` instead of CSC.
* **Cadence is forced to 0 while power is 0.** A NEO's motor keeps the
  flywheel turning when the rider freewheels in a low virtual gear, so the
  crank sensor keeps counting (issue #2157).

Tacx trainers report no resistance level. QZ shows a Peloton-style
resistance computed from power and cadence.

## Quirks and field reports

* **Negative grade drives the flywheel.** A NEO actively spins the flywheel
  on descents. When a virtual gear pushes the sent grade below 0 on a flat
  road, the rider feels the motor push. QZ's
  `tacxneo2_disable_negative_inclination` clamps grade + gear to 0 when the
  road grade is 0 or more (issue #3861).
* **Base resistance feels high.** Riders on a first-generation NEO, a NEO 2T
  and a Flux S reported gear 1 on the flat as far too hard (issues #3861,
  #3274, #4884). On the Flux S, QZ was sending about −3 % and the trainer
  still felt heavy. The user fixed it physically with a 24-tooth chainring
  and a 20-tooth cog. A wheel-on or eddy-current trainer has a floor on how
  light it can get at a given flywheel speed.
* **Gear range saturates.** On the same Flux S, gears 12 to 24 felt identical
  (issue #4884). Expect the top of the grade range to be capped by the
  trainer's maximum brake force.
* **Native Tacx virtual shifting** on 2025 NEO 2T firmware is not exposed to
  QZ (open request #3611). A 2025 test of "NEO 2 as FTMS" showed no
  difference from FE-C (issue #3511).
* **Resistance command reaches the trainer but nothing changes**: in one
  report Zwift had simply stopped sending grade to QZ; restarting the Wi-Fi
  router fixed it (issue #4114). Log the outgoing grade before blaming the
  trainer.

## Practical recipe for a game

1. Connect, subscribe to `6e40fec2`, `0x2A63`, `0x2A5B` and `0x2AD2` if
   present.
2. Send page `33` with your grade whenever it changes, Crr byte `FF` (or your
   fixed Crr ÷ 0.00005). Optionally send page `32` once with your fixed wind.
3. Read power from `0x2A63`. Read cadence from `0x2AD2` if present, else CSC.
   Report cadence 0 whenever power is 0.
4. Implement virtual gears as a grade offset, and clamp the result at 0 on
   flat or rising roads if the trainer is a NEO.
5. Without `6e40fec1`, drive the trainer as a generic FTMS bike.
