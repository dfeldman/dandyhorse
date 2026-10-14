# FTMS as it actually works (BLE Fitness Machine Service, 0x1826)

This is the FTMS behaviour that QZ (qdomyos-zwift) relies on across ~150 device
drivers, written down so a new implementation does not have to rediscover it.
Byte layouts below are exactly what QZ walks in
`src/devices/ftmsbike/ftmsbike.cpp` and `src/devices/horizontreadmill/horizontreadmill.cpp`
(the latter is QZ's generic FTMS *treadmill* driver despite its name).

## Services and characteristics

| UUID | Name | Dir | Used for |
|---|---|---|---|
| `0x1826` | Fitness Machine Service | | container |
| `0x2ACC` | Fitness Machine Feature | read | QZ ignores it |
| `0x2ACD` | Treadmill Data | notify | treadmill telemetry |
| `0x2ACE` | Cross Trainer Data | notify | elliptical telemetry (also emitted by some bikes and treadmills) |
| `0x2AD1` | Rower Data | notify | rower telemetry |
| `0x2AD2` | Indoor Bike Data | notify | bike telemetry |
| `0x2AD3` | Training Status | notify | ignored |
| `0x2AD5` | Supported Inclination Range | read | Horizon driver reads min inclination from it if ever read (`horizontreadmill.cpp:2582`) |
| `0x2AD6` | Supported Resistance Level Range | read | ignored by QZ; it uses per-name `max_resistance` tables instead |
| `0x2AD8` | Supported Power Range | read | ignored |
| `0x2AD9` | Fitness Machine Control Point | write + indicate | all control |
| `0x2ADA` | Fitness Machine Status | notify | mostly ignored (one treadmill uses it as a "start" trigger, see TP1) |

Some FTMS-ish devices also expose the Cycling Power Service (`0x1818`,
measurement `0x2A63`), Cycling Speed and Cadence (`0x1816`, `0x2A5B`) and
Running Speed and Cadence (`0x1814`, `0x2A53`). QZ subscribes to *every*
notify/indicate characteristic on every service it discovers unless a
per-device flag restricts it (see quirks pages).

## Control point (0x2AD9) op codes

```
0x00 Request Control
0x01 Reset
0x02 Set Target Speed          [uint16 LE, 0.01 km/h]
0x03 Set Target Inclination    [sint16 LE, 0.1 %]
0x04 Set Target Resistance     [uint8 (spec: 0.1 units) ... many devices want raw level, some want level*10 as uint16]
0x05 Set Target Power          [sint16 LE, W]
0x07 Start / Resume
0x08 Stop / Pause              [0x01 = stop, 0x02 = pause]
0x11 Set Indoor Bike Simulation [wind sint16 LE 0.001 m/s][grade sint16 LE 0.01 %][crr uint8 0.0001][cw uint8 0.01]
0x12 Set Wheel Circumference   [uint16 LE 0.1 mm]
0x13 Spin Down Control
0x14 Set Targeted Cadence
0x80 Response Code
```

Response to any write arrives as an **indication** on `0x2AD9`:
`80 <request op> <result>` with result `01` success, `02` not supported,
`03` invalid parameter, `04` operation failed, `05` control not permitted.

### The canonical session

```
0x2AD9 <- 00            Request Control      -> 80 00 01
0x2AD9 <- 07            Start/Resume         -> 80 07 01
0x2AD9 <- 11 00 00 <grade lo> <grade hi> 28 19   sim: wind 0, grade, Crr 0x28=40 -> 0.0040, Cw 0x19=25 -> 0.25 kg/m (QZ's fixed values)
0x2AD9 <- 05 <W lo> <W hi>   ERG target
0x2AD9 <- 04 <level>          resistance level
```

QZ's FTMS bike driver sends `00` + `07` once (`ftmsbike::init`, `ftmsbike.cpp:174`)
and then never again unless the connection drops. The FTMS treadmill driver, by
contrast, re-sends `00` + `07` **before every** speed and incline write
(`horizontreadmill.cpp:1266` and `:1456`) because several treadmills drop
control after a few seconds; a per-name list of treadmills that *break* if you
do this is in the treadmill quirks page.

### What QZ actually uses for a simulated grade on bikes

Preferred: `0x11` with grade = `requestInclination * 100` as sint16, wind 0,
crr byte `0x28`, cw byte `0x19` (`ftmsbike::forceInclination`, `ftmsbike.cpp:398`).

Fallback when the bike is flagged `resistance_lvl_mode` (it does not honour
`0x11` or lies about it): `0x04` with a plain resistance level, either 1-byte
raw or 2-byte level*10 depending on the device. QZ maps grade to resistance
level through a self-learned table (see `qz-base-behavior.md`, section
"inclination-resistance table") plus user gain/offset.

"Fake sim through resistance": when QZ wants a resistance level on a bike that
supports `0x11` but not `0x04`, it sends `0x11` with the *resistance level* in
the grade field (`level * gain + offset`, then `*10`) — `ftmsbike.cpp:339-360`.
This is a hack that works on Wahoo/Elite/Tacx style trainers because grade and
resistance are monotonic.

### Read side: Indoor Bike Data (0x2AD2)

Flags are a uint16 LE at bytes 0..1; fields follow in this fixed order, each
present only if its flag bit is set. QZ walks it exactly like this
(`ftmsbike.cpp:865-1020`):

| bit | field | size | scale | QZ use |
|---|---|---|---|---|
| 0 | More Data (**inverted**: bit 0 == 0 means instantaneous speed IS present) | uint16 | 0.01 km/h | Speed |
| 1 | Average speed | uint16 | 0.01 km/h | used as Speed only if bit0 set and no instant speed |
| 2 | Instantaneous cadence | uint16 | 0.5 rpm (divide by 2) | Cadence |
| 3 | Average cadence | uint16 | 0.5 rpm | fallback cadence |
| 4 | Total distance | uint24 | m | ignored (device totals are lifetime totals on many bikes) |
| 5 | Resistance level | sint16 | unitless | Resistance (with per-device scaling exceptions) |
| 6 | Instantaneous power | sint16 | W | Watts |
| 7 | Average power | sint16 | W | fallback watts if instant is 0/absent |
| 8 | Expended energy | uint16 + uint16 + uint8 | kcal, kcal/h, kcal/min | skipped (5 bytes) |
| 9 | Heart rate | uint8 | bpm | Heart |
| 10 | Metabolic equivalent | uint8 | 0.1 | skipped |
| 11 | Elapsed time | uint16 | s | skipped |
| 12 | Remaining time | uint16 | s | skipped |

Gotchas QZ has hit:
* Devices that set bit 0 (no instant speed) but do send average speed: QZ uses
  the average as speed.
* Devices that omit instant power but send average power: QZ uses average
  power until a non-zero instant power has been seen once (`wattReceived`).
* Many bikes don't send resistance at all. QZ then back-computes a "Peloton
  resistance" from cadence + watts (formula in `qz-base-behavior.md`) and, after
  3 s without a native resistance value, promotes it to `Resistance`
  (`shouldUseCalculatedResistanceFallback`, `ftmsbike.cpp:707`).
* Distance is integrated from speed by QZ, not read.
* Cadence in FTMS is always in 0.5 rpm units; if a device shows double cadence
  it is because it sends rpm not rpm*2 (QZ has no per-device flag for that on
  bikes; it just divides by 2).

### Read side: Treadmill Data (0x2ACD)

uint16 LE flags at 0..1, fields in order (`horizontreadmill.cpp:1877-2080`):

| bit | field | size | scale |
|---|---|---|---|
| 0 | More Data (inverted; 0 = instant speed present) | uint16 | 0.01 km/h |
| 1 | Average speed | uint16 | 0.01 km/h |
| 2 | Total distance | uint24 | m |
| 3 | Inclination **and** ramp angle | sint16 + sint16 | 0.1 % and 0.1 deg (QZ reads incline, skips ramp = 4 bytes total) |
| 4 | Elevation gain (pos + neg) | uint16 + uint16 | 0.1 m |
| 5 | Instantaneous pace | uint8 | 0.1 km/min |
| 6 | Average pace | uint8 | 0.1 km/min |
| 7 | Expended energy | uint16+uint16+uint8 | |
| 8 | Heart rate | uint8 | bpm |
| 9 | Metabolic equivalent | uint8 | |
| 10 | Elapsed time | uint16 | s |
| 11 | Remaining time | uint16 | s |
| 12 | Force on belt + power output | sint16 + sint16 | N, W (QZ does not parse; treadmill watts are computed) |

Typical default flags observed by QZ on the Horizon FTMS path: `0x0484`
(distance + inclination + elapsed time). Almost no consumer treadmill reports
power; QZ computes it (see `qz-base-behavior.md`).

### Read side: Cross Trainer Data (0x2ACE)

Flags are **3 bytes** (uint24 LE) at 0..2; fields in order
(`ftmsbike.cpp:1235-1600`, `horizontreadmill.cpp:2082-2270`):

| bit | field | size | scale |
|---|---|---|---|
| 0 | More Data (inverted) | uint16 | 0.01 km/h |
| 1 | Average speed | uint16 | 0.01 km/h |
| 2 | Total distance | uint24 | m |
| 3 | Step per minute + average step rate | uint16 + uint16 | spm (QZ uses the first as Cadence) |
| 4 | Stride count | uint16 | |
| 5 | Elevation gain pos + neg | uint16 + uint16 | |
| 6 | Inclination + ramp angle | sint16 + sint16 | 0.1 % / 0.1 deg (QZ skips) |
| 7 | Resistance level | sint16 | |
| 8 | Instantaneous power | sint16 | W |
| 9 | Average power | sint16 | W |
| 10 | Expended energy | 5 bytes | |
| 11 | Heart rate | uint8 | |
| 12 | Metabolic equivalent | uint8 | |
| 13 | Elapsed time | uint16 | |
| 14 | Remaining time | uint16 | |
| 15 | Movement direction | (flag only) | |

QZ prefers `0x2AD2` when both arrive: after the first `0x2AD2` frame it stops
integrating distance/kcal from `0x2ACE` (`ftmsFrameReceived`).

## Write mechanics that matter

* **Write-with-response vs without**: QZ uses WriteWithoutResponse when the
  characteristic advertises it, except for Domyos (they need with-response,
  `ftmsbike.cpp:105`).
* **Serialize writes**: QZ queues writes and only sends the next when the
  previous one is acked (characteristicWritten) or a 300 ms timeout expires
  (`processWriteQueue`, `ftmsbike.cpp:132`). Sending two control-point writes
  back to back without waiting breaks many cheap boards.
* **Poll interval**: QZ's `update()` tick is 200 ms (`poll_device_time`). A
  resistance/grade write is only issued when the requested value differs from
  the last one sent or the current reported value.
* **Subscribe to indications on 0x2AD9** (CCCD `02 00`), not notifications; a
  few devices refuse control until you do.
* **Connection parameters** (Android): QZ requests interval 24-40 (30-50 ms),
  latency 0, supervision 4.2 s (`ftmsbike.cpp:2036`).
* Devices whose FTMS control point is absent: QZ still binds `gattFTMSService`
  to whichever service carries `0x2ACD`/`0x2ACE` so it can at least read
  (`horizontreadmill.cpp:2404`).

## Speed vs pace vs miles

FTMS speed is always km/h on the wire. Several treadmills nonetheless send or
expect **miles** depending on the console's unit setting; QZ keeps per-name
flags for that (see treadmill quirks). If speeds look 1.6x off, that is why.

## ERG on FTMS bikes (secondary for this project)

`0x05` target power. QZ tracks whether a device supports ERG natively
(`ergModeSupported`); for the ones that do not, it converts power to a
resistance level through a self-learned cadence/resistance/watts table
(`ergtable.h`) with a 2 s debounce and a "death spiral" guard that refuses to
raise resistance below 50 rpm (`ftmsbike.cpp:626-670`).
