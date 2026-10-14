# Domyos (Decathlon) bikes

Domyos exercise bikes: EB 500, EB 520 B, EB 900 / EB900B, Training 900, Bike
500 and similar consoles from about 2016. Older consoles speak Domyos's
`F0` protocol, the same framing as Domyos treadmills
(`../treadmills/domyos.md`). Newer consoles also expose FTMS, **but FTMS on
these bikes carries no power and resistance commands have misbehaved**;
the proprietary protocol is the more reliable way to control them.

Source: `src/devices/domyosbike/domyosbike.cpp`; the FTMS path is the
`DOMYOS` branch of `src/devices/ftmsbike/ftmsbike.cpp` (QZ).

## Routing

| name and services | QZ driver |
|---|---|
| `Domyos-Bike…` (case-sensitive), no FTMS `0x1826` advertised | proprietary `domyosbike` (`bluetooth.cpp:1191`) |
| `Domyos-Bike…` advertising `0x1826` | FTMS bike, Domyos mode (`bluetooth.cpp:1955`) |
| `DOMYOS-BIKING-…` | FTMS bike, Domyos mode |
| `DomyosBridge…` | skipped |

The setting `domyosbike_notfmts` ("ignore FTMS") forces the proprietary
driver even when FTMS is advertised. Each driver corrects the other on
failure. If the proprietary service is missing but FTMS exists, QZ saves the
bike as an FTMS bike and asks for a restart. If FTMS is missing on a `DOMYOS`
device, QZ sets "ignore FTMS".

**Two riders fixed failing auto-resistance by enabling "ignore FTMS".** On an
EB900B, resistance reset to 1 on climbs (issue #4967). On an EB 520 B,
resistance never changed (issue #3971). Prefer the proprietary service when
both are present.

## Proprietary protocol

### GATT (Microchip transparent UART)

| UUID | role |
|---|---|
| `49535343-fe7d-4ae5-8fa9-9fafd205e455` | service |
| `49535343-8841-43f4-a8d4-ecbe34729bb3` | write, with response |
| `49535343-1e4d-4bd9-ba61-23c647249616` | notify, CCCD `01 00` |

### Frames

`F0 <opcode> <payload> <sum>`, where the checksum is the sum of all preceding
bytes mod 256. Frames longer than 20 bytes go as a 20-byte write followed by
the remainder. Writes are queued, one in flight, 300 ms timeout.

### Init

Each step waits up to 300 ms for a notification and is **retried until one
arrives** that is not a 20-byte half-frame.

```
F0 C8 01 B9
F0 C9 B9
F0 A3 93
F0 A4 94
F0 A5 95
F0 AB 9B
F0 C4 03 B7
F0 AD FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF 01 FF | FF FF 8B            (Bluetooth icon on)
F0 CB 02 00 08 FF FF FF FF FF FF FF FF FF FF FF FF FF 01 00 | 00 01 FF FF FF FF B6   (Bluetooth text)
F0 AD FF FF 00 05 FF FF FF FF FF FF FF 00 00 FF FF FF 01 FF | FF FF 94            (start)
```

`|` marks the split between the 20-byte write and the tail. On an app
"start", QZ adds
`F0 CB FF FF FF FF FF FF FF FF FF FF FF FF 01 00 14 01 FF FF | FF FF FF FF FF FF BD`.

### Poll

**The console is request/response.** Every 300 ms QZ sends `F0 AC 9C`, and
the bike answers with one status frame. About once a second QZ sends a
display update (elapsed time, speed, cadence, calories) instead; a game can
skip it and send only the poll. Do not send while half of a split status
frame is still pending.

### Status frame (26 bytes)

Header `F0 BC` (`F0 DB` and `F0 DD` also occur). Some consoles split it into
20 + 6 bytes (20 + 7 for `DB`/`DD`); join the halves before parsing.

| bytes | field |
|---|---|
| 6..7 | speed, big-endian, ÷ 10 km/h |
| 9 | cadence, rpm |
| 10..11 | calories, big-endian (`FF xx` at startup means 0) |
| 12..13 | distance, big-endian, ÷ 10 km |
| 14 | resistance level, 1..15 |
| 18 | heart rate |
| 22 | console button: `06` start pressed, `07` stop pressed |

### Set resistance

23 bytes, level 1..15 at byte 10, `FF` elsewhere meaning "unchanged":

```
F0 AD FF FF FF FF FF FF FF FF <level> FF FF FF FF FF FF 00 01 FF | FF FF <sum>
level 8: F0 AD FF FF FF FF FF FF FF FF 08 FF FF FF FF FF FF 00 01 FF | FF FF 95
```

QZ sends it only when the level differs from the reported one. There is no
power or grade command.

### Power estimate

**The bike does not report power.** QZ estimates it from level R and cadence
C, and reports 0 W at 0 rpm:

```
default:  W = (10.39 + 1.45·(R − 1)) · e^(0.028·C)
torque:   W = k(R) · C / 9.5488          (k in N·m; 9.5488 = 60 / 2π)
k = 1:5.0  2:5.7  3:6.5  4:7.5  5:8.6  6:9.9  7:11.4  8:13.6
    9:15.3 10:17.3 11:19.8 12:22.5 13:25.6 14:28.4 15:35.9
```

Bike 500 profile v1 uses the exponential below level 8 and the torque table
from level 8. Profile v2 uses the torque table for every level; it was added
because the exponential read too high for a Bike 500 owner (issue #2573).

## FTMS mode (newer consoles)

QZ treats FTMS Domyos bikes as resistance-level devices, levels 1..32, with
no ERG. Details are in `ftms-bike.md`. In short:

* The Indoor Bike Data has **no power and no resistance**. QZ falls back to
  its heart-rate power model, or cadence × 1.2 without heart rate.
* Write the control point with response, at most one resistance write per
  1.5 s, and back off 3 s after "control not permitted".
* Subscribe only to the FTMS service.

## Grade

Neither mode takes a grade. QZ's default mapping is
`level = round(grade% × 1.5) + 5`, clamped to the bike's range. Riders tune
it with the gain and offset settings, for example to reach the lowest level
on steep descents (issue #4717). Negative grades are rounded, not truncated,
so they do lower the level (issue #136).

## Field reports

* Resistance control that stops after a while is usually the link between
  QZ's virtual device and the PC running the game, not the bike (issues
  #3943, #4626).

## Practical recipe for a game

1. If the Microchip UART service `49535343-fe7d-…` exists, use it even when
   FTMS is also present.
2. Subscribe, run the init frames, then poll `F0 AC 9C` every 300 ms.
3. Parse cadence (byte 9) and level (byte 14) from each 26-byte reply.
   Estimate power with the torque table.
4. Map grade to a level 1..15 and send `F0 AD` only when it changes.
