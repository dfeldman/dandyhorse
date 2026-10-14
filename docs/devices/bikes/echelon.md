# Echelon Connect bikes

Echelon Connect EX-1 through EX-8S, EX-3, EX-5, EX-5s, EX-4s+, GT+ and Connect
Sport. They use Echelon's own Bluetooth service, shared with the Stride
treadmills, rowers and stair climber (`../treadmills/echelon-stride.md`).
They have no FTMS.

**The bike reports cadence and resistance level only. Power is not
reported**; QZ estimates it from a level × cadence table. The only control is
the resistance level, 1 to 32.

**Since early 2026, Echelon firmware locks the bike to its own app.** A locked
bike sends a challenge frame and no telemetry. A third-party app can only get
data by relaying the official Echelon app's handshake. See "2026 firmware
lock" below.

**Recommendation: support only unlocked, pre-2026 firmware.** Detect the lock frame and tell the rider. The relay through Echelon's own app is not practical for a game.

Source: `src/devices/echelonconnectsport/echelonconnectsport.cpp` (QZ).

## Routing (`bluetooth.cpp:2375`)

Any name starting `ECH`, **case-sensitive**, that earlier branches did not
take. Earlier branches take `ECH-STRIDE`, `ECH-UK-`, `ECH-FR-`, `ECH-SD-SPT`
(treadmills), `ECH-ROW` (rower) and `ECH-EC-SPT` (stair climber). Real bike
names look like `ECHEX-3-183508` or `ECHEX-5s-113399`.

## GATT

| UUID | role |
|---|---|
| `0bf669f1-45f2-11e7-9598-0800200c9a66` | Echelon service |
| `0bf669f2-45f2-11e7-9598-0800200c9a66` | write, with response |
| `0bf669f3-45f2-11e7-9598-0800200c9a66` | notify 1, CCCD `01 00` |
| `0bf669f4-45f2-11e7-9598-0800200c9a66` | notify 2, CCCD `01 00` |

QZ's emulated Echelon bike also lists `0bf669f0-...` as its primary service,
so the real bike probably advertises that UUID. Treat either as the Echelon
fingerprint.

## Frames

`F0 <cmd> <len> <data> <sum>`, where the checksum is the sum of all preceding
bytes mod 256. Every write waits up to 300 ms for a notification.

| direction | frame | meaning |
|---|---|---|
| app → bike | `F0 A1 00 91` | device info request; bike replies `F0 A1 06 00 07 01 29 07 04 D3` (bytes as seen by QZ's emulator) |
| app → bike | `F0 A3 00 93` | limits request; reply `F0 A3 02 20 01 B6` (0x20 = 32, the maximum level) |
| app → bike | `F0 A4 00 94` | reply `F0 A4 01 00 95` |
| app → bike | `F0 B0 01 01 A2` | start streaming; reply `F0 D0 01 01 C2` |
| app → bike | `F0 B0 01 00 A1` | stop streaming; reply `F0 D0 01 00 C1` |
| app → bike | `F0 A0 01 <n> <sum>` | keep-alive poll every 2 s, n = 1..255 skipping 0; the bike echoes it |
| app → bike | `F0 B1 01 <level> <sum>` | set resistance level 1..32 |
| bike → app | `F0 D1 09 ...` (13 bytes) | telemetry |
| bike → app | `F0 D2 01 <level> <sum>` | resistance level, sent only when it changes |
| bike → app | `F0 E0 ...` (8 bytes) | locked: authentication challenge (2026 firmware) |
| bike → app | `F0 A5 01 0E A4` | unlock accepted |

Resistance examples: level 10 → `F0 B1 01 0A AC`; level 20 → `F0 B1 01 14 B6`.

### Telemetry frame (`F0 D1`, 13 bytes)

| bytes | field |
|---|---|
| 3..4 | elapsed seconds, big-endian |
| 7..8 | distance, big-endian, ÷ 100 (QZ logs it but computes its own) |
| 10 | cadence, rpm |

## Session

```
subscribe notify 1 and notify 2
F0 A1 00 91   ×4
F0 A3 00 93
F0 A1 00 91
F0 B0 01 01 A2              start streaming
F0 B1 01 <last level>       only after a reconnect, to restore the level
then: F0 A0 01 <n> <sum> every 2 s
```

QZ sends a level only when it differs from the last reported one, clamped to
1..32.

## Power estimate

QZ picks a row by level (0..32) and interpolates by cadence in 10 rpm steps.
Column 0 (0 rpm) is 0 W. Above 100 rpm it scales the 100 rpm value
linearly: `W = cadence / 100 × table[level][100 rpm]`. Power is 0 whenever
cadence is 0.

```
k = floor(cadence / 10)                     (0..9)
W = t[k] + (t[k+1] − t[k]) / 10 × (cadence mod 10)
```

Default table (`wattTable`, from issue #62). A second table (`mgarcea`) is
selectable; it matches up to level 9 and is flatter at high levels.

| level | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 rpm |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1.0 | 2.2 | 4.8 | 9.5 | 13.6 | 16.7 | 22.6 | 26.3 | 29.2 | 47.0 |
| 1 | 1.0 | 2.2 | 4.8 | 9.5 | 13.6 | 16.7 | 22.6 | 26.3 | 29.2 | 47.0 |
| 2 | 1.3 | 3.0 | 5.4 | 10.4 | 14.5 | 18.5 | 24.6 | 27.6 | 33.5 | 49.5 |
| 3 | 1.5 | 3.7 | 6.7 | 11.7 | 15.9 | 19.6 | 26.1 | 30.8 | 35.2 | 51.2 |
| 4 | 1.6 | 4.7 | 7.5 | 13.7 | 17.6 | 22.6 | 29.0 | 36.9 | 42.6 | 57.2 |
| 5 | 1.8 | 5.2 | 8.0 | 14.8 | 19.1 | 23.5 | 32.5 | 37.5 | 50.8 | 61.8 |
| 6 | 1.9 | 5.7 | 8.7 | 15.6 | 20.2 | 25.5 | 33.5 | 39.6 | 52.1 | 65.3 |
| 7 | 2.0 | 6.2 | 9.5 | 16.8 | 21.8 | 28.1 | 37.0 | 42.8 | 57.8 | 68.4 |
| 8 | 2.1 | 6.8 | 10.8 | 18.2 | 23.6 | 29.5 | 40.0 | 47.6 | 60.5 | 72.1 |
| 9 | 2.2 | 7.3 | 11.5 | 19.3 | 26.3 | 33.5 | 45.3 | 51.8 | 66.7 | 76.8 |
| 10 | 2.4 | 7.9 | 12.7 | 20.8 | 29.8 | 37.6 | 52.2 | 56.2 | 73.5 | 83.6 |
| 11 | 2.6 | 8.5 | 13.5 | 23.5 | 33.6 | 41.9 | 55.1 | 59.0 | 78.6 | 89.7 |
| 12 | 2.7 | 9.1 | 14.2 | 25.6 | 35.4 | 45.3 | 57.3 | 62.8 | 81.3 | 95.0 |
| 13 | 2.9 | 9.6 | 16.8 | 29.1 | 37.5 | 49.6 | 62.5 | 69.0 | 84.7 | 99.3 |
| 14 | 3.0 | 10.0 | 22.3 | 31.2 | 40.3 | 51.8 | 65.0 | 70.0 | 92.6 | 108.2 |
| 15 | 3.2 | 10.4 | 24.0 | 36.6 | 42.5 | 56.3 | 74.0 | 85.0 | 98.2 | 123.5 |
| 16 | 3.5 | 10.9 | 25.1 | 38.5 | 47.6 | 65.4 | 83.0 | 93.0 | 114.8 | 136.8 |
| 17 | 3.7 | 11.5 | 26.0 | 41.0 | 53.2 | 71.6 | 90.0 | 100.0 | 121.7 | 149.2 |
| 18 | 4.0 | 12.1 | 27.5 | 43.6 | 56.0 | 82.3 | 101.0 | 113.6 | 143.0 | 162.8 |
| 19 | 4.2 | 12.7 | 29.7 | 46.7 | 64.2 | 87.9 | 109.2 | 128.9 | 154.0 | 172.3 |
| 20 | 4.5 | 13.7 | 32.0 | 50.0 | 71.8 | 95.6 | 113.8 | 135.6 | 165.0 | 185.0 |
| 21 | 4.7 | 14.9 | 34.5 | 54.2 | 77.0 | 100.7 | 127.0 | 147.6 | 180.0 | 200.0 |
| 22 | 5.0 | 15.8 | 36.5 | 58.3 | 83.4 | 110.1 | 136.0 | 168.1 | 196.0 | 213.5 |
| 23 | 5.6 | 17.0 | 39.5 | 64.3 | 88.8 | 123.4 | 154.0 | 182.0 | 210.0 | 235.0 |
| 24 | 6.1 | 18.2 | 44.0 | 70.7 | 99.9 | 133.3 | 166.0 | 198.0 | 230.0 | 253.5 |
| 25 | 6.8 | 19.4 | 49.0 | 79.0 | 108.8 | 147.2 | 185.0 | 217.0 | 255.2 | 278.0 |
| 26 | 7.6 | 22.0 | 54.8 | 88.0 | 127.0 | 167.0 | 212.0 | 244.0 | 287.0 | 305.0 |
| 27 | 8.7 | 26.0 | 62.0 | 100.0 | 145.0 | 190.0 | 242.0 | 281.0 | 315.1 | 350.0 |
| 28 | 9.2 | 30.0 | 71.0 | 114.4 | 161.6 | 215.1 | 275.1 | 317.0 | 358.5 | 390.0 |
| 29 | 9.8 | 36.0 | 82.5 | 134.5 | 195.3 | 252.5 | 313.7 | 360.0 | 420.3 | 460.0 |
| 30 | 10.5 | 43.0 | 95.0 | 157.1 | 228.4 | 300.1 | 374.1 | 403.8 | 487.8 | 540.0 |
| 31 | 12.5 | 48.0 | 99.3 | 162.2 | 232.9 | 310.4 | 400.3 | 435.5 | 530.5 | 589.0 |
| 32 | 13.0 | 53.0 | 102.0 | 170.3 | 242.0 | 320.0 | 427.9 | 475.2 | 570.0 | 625.0 |

Speed is derived as `0.37497622 × cadence` km/h unless power-based speed is
chosen. Treat Echelon power as an estimate. A rider saw power roughly double
at the same effort after the bike's brake changed, which the table cannot
detect (issue #4115).

**Grade and ERG are emulated.** Grade becomes a level through the app's
mapping. ERG picks the highest level whose table power at the current cadence
does not exceed the target, recomputed every tick.

QZ's displayed Peloton resistance:
`0.0097·L³ − 0.4972·L² + 10.126·L − 37.08`, floored at 0.

## 2026 firmware lock

Firmware from early 2026 (bikes), and May-July 2026 (rowers and Stride
treadmills), no longer streams to an unknown central. After connecting, the
bike sends an 8-byte `F0 E0 ...` challenge and nothing else (issues #4379,
#4750, #4831, #4957, #4970, #4990). QZ cannot answer the challenge itself.

QZ's workaround, "Virtual Echelon":

1. QZ connects to the bike as usual.
2. QZ advertises an Echelon bike with the real bike's name and the Echelon
   service.
3. The user opens the official Echelon app, which connects to QZ.
4. QZ forwards every byte the app writes to the bike, and every bike
   notification back to the app. The app completes the handshake.
5. When the bike sends `F0 A5 01 0E A4`, the bike is unlocked and telemetry
   flows to QZ. QZ then offers to switch its emulated device to a normal
   FTMS bridge for Zwift and similar apps.

Constraints seen in the field:

* It needs a phone or tablet that can act as a BLE peripheral while QZ runs.
  Early builds needed Android; an iOS unlock was confirmed later
  (issue #4379).
* How long an unlock lasts is not documented in QZ or its issues.
* A browser (Web Bluetooth) cannot advertise, so a web-only game cannot do
  this. Detect the `F0 E0` frame and tell the user the bike is locked.
* Echelon paused the rower firmware after complaints about changed metrics.
  Echelon did not say whether third-party pairing will return (issue #4750).

## Other field reports

* **Cadence stuck at 0** for 10 to 15 minutes, then fine: a failing Echelon
  cadence sensor. Any Bluetooth cadence sensor can replace it (issue #3619).
* A connected bike with no data and no `F0 E0` frame was a different
  problem: another app held the bike, or the user skipped the unlock
  (issue #4868).

## Practical recipe for a game

1. Connect to `0bf669f1`, subscribe to `f3` and `f4`.
2. Send the init frames and `F0 B0 01 01 A2`, then poll every 2 s.
3. If an 8-byte `F0 E0` frame arrives, report "locked by Echelon firmware".
4. Read cadence from byte 10 of `F0 D1` frames and level from `F0 D2` frames.
5. Estimate power from the table. Map your simulated grade to a level 1..32
   and send `F0 B1 01 <level>` only when it changes.
