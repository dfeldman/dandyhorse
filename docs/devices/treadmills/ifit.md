# ProForm / NordicTrack / FreeMotion (iFit) treadmills

ICON Health & Fitness (now iFit) sells the most common home treadmills in
North America under ProForm, NordicTrack and FreeMotion. None of them speaks
FTMS. QZ reaches them three different ways, depending on the console:

| transport | consoles | QZ driver | how control works |
|---|---|---|---|
| iFit Bluetooth LE | LCD consoles with iFit Bluetooth, roughly 2015-2020 | `proformtreadmill` | speed and incline set-points, inside per-model replayed traffic |
| ADB into the console | Android tablet consoles, roughly 2018 on: X22i, X32i, Commercial 1750 / 2450 / 2950, T8.5S, Carbon T7, Trainer 9.0 | `nordictrackifitadbtreadmill` | reads the console's log; **drags the on-screen sliders** with injected touches |
| WiFi WebSocket | consoles with the older iFit WiFi module | `proformwifitreadmill` | JSON `set` messages |

**The model cannot be detected.** On every transport the user picks the
exact model in QZ's settings (61 treadmill models on BLE alone), because
the traffic, packet types and screen geometry differ per model.

Sources: `src/devices/proformtreadmill/`, `src/devices/nordictrackifitadbtreadmill/`,
`src/devices/proformwifitreadmill/` (QZ).

## 1. iFit Bluetooth LE

### Routing (`bluetooth.cpp:2583`)

Name starting `I_TL` or `I_IT` (case-sensitive), or an upper-cased name
containing `_IFIT TREADMILL`. Bikes use `I_EB`/`I_SB`, ellipticals `I_FS`/
`I_EL`/`I_VE`, rowers `I_RW`.

### GATT

| UUID | role |
|---|---|
| `00001533-1412-efde-1523-785feabcd123` | service |
| `00001534-1412-efde-1523-785feabcd123` | write |
| `00001535-1412-efde-1523-785feabcd123` | notify, CCCD `01 00` |

The UUID base is Nordic Semiconductor's sample-service base, which iFit
reused. Every iFit BLE machine (treadmill, bike, elliptical, rower) uses it.

### Packetization

Decoded from QZ's constant frames:

```
header write:  FE 02 <total payload length> <number of writes, including this one>
then chunks:   <chunk index 00, 01, ...; FF for the last chunk> <bytes in this chunk> <payload...>
               each chunk padded to 20 bytes
```

For example the poll header `FE 02 17 03` announces 0x17 = 23 payload bytes
in 3 writes: a chunk `00 12 ...` with 18 bytes, and a final chunk
`FF 05 ...` with 5.

### Init and poll

`btinit` (`proformtreadmill.cpp:3982-9232`) holds 922 init frames across 57
model branches. Each branch is a replay of what the iFit app sends to that
model; QZ does not generate them. Frames are spaced 400 ms apart (600 ms on
Windows).

`update()` then cycles through a per-model poll sequence, typically six
frames. For example ProForm 9.0 and Z1300i:

```
FE 02 17 03
00 12 02 04 02 13 04 13 02 00 0D 92 1A 70 00 00 00 00 00 00
FF 05 00 00 00 84 C6 00 00 00 00 00 00 00 00 00 00 00 00 00   <- speed/incline commands go after this slot
FE 02 17 03
00 12 02 04 02 13 04 13 02 00 0D 1B 94 31 00 00 40 50 00 80
FF 05 18 00 00 01 2F 00 00 00 00 00 00 00 00 00 00 00 00 00
```

To support a model not in QZ, capture the iFit app's traffic (Android
Bluetooth HCI snoop, or an iOS trace) and replay it; that is how every QZ
profile was made.

### Set speed and incline

Both use the same frame, sent after a `FE 02 0D 02` header
(`forceSpeed`, `forceIncline`, `proformtreadmill.cpp:56-150`):

```
byte  0..1   FF 0D                 last (only) chunk, 13 bytes
      2..9   02 04 02 09 04 09 02 01
      10     field: 01 = speed, 02 = incline
      11..12 value * 100, 16-bit little-endian (speed km/h unsigned; incline % signed)
      13     00
      14     checksum
      15..19 00
```

Checksum: the sum of bytes 6 through 12, mod 256, for almost every model.
Exceptions in QZ:

| models | rule |
|---|---|
| NordicTrack T6.5S (all firmware variants), Elite 800, S20, S30 | byte 11 + `0x12` (QZ's formula, used for both speed and incline) |
| NordicTrack Incline Trainer x7i NTL15010 | byte 6 becomes `05`; then the normal sum |
| ProForm 105 CST, incline only | bytes 9..12 become `02 00 10 <whole percent>` |
| ProForm 1800i and 2000 | incline rounded down to a multiple of 0.5 before sending |

Limits in QZ: speed 0..22 km/h (Z1300i: 19.3), incline -3..15 % (Z1300i: 12).

**Speed while stopped**: if a speed request arrives while the belt is
stopped, QZ remembers it, sends start, and applies the speed once the belt
moves (`proformtreadmill.cpp:164-190`).

### Telemetry

20-byte notifications starting `00 12 01 04 02 <type>`. The accepted `<type>`
depends on the model: `31` or `34`, `2E`, `2F`, or `2E`/`2F`. Packets whose
bytes 12..19 are all `FF` are placeholders; skip them
(`proformtreadmill.cpp:3844-3980`).

| offset | size | meaning |
|---|---|---|
| 10..11 | uint16 LE | speed, 0.01 km/h |
| 12..13 | int16 LE | incline, 0.01 % |
| 14..15 | uint16 LE | watts; values above 3000 are noise. On the SE, S20i, T-series 5, Sport 3.0, Carbon TLX and PFTL59723 these bytes are distance in metres instead |

QZ estimates cadence from speed. On the ProForm 705 CST, a packet starting
`FE 02 25 04 00 00` with byte 17 = `01` while stopped means the user pressed
start on the console. The Sport 7.0 sends occasional all-zero packets that
must be ignored.

## 2. ADB into an Android console

The tablet on newer consoles runs Android and the iFit app. QZ never talks
to the motor controller; it talks to the tablet.

### Two modes

| mode | setting | how it works |
|---|---|---|
| ADB remote | `nordictrack_ifit_adb_remote` on, console IP in `nordictrack_2950_ip` | QZ connects to the console with ADB over the network: on Windows through a bundled `adb.exe`, on Android through a Java ADB client, on iOS through `libadb-client`. It tails `logcat` and runs `input swipe` commands |
| QZ Companion | adb remote off | a companion app on the console (QZCompanionNordictrackTreadmill) reads the log locally and sends log lines to QZ by UDP to port **8002**; QZ replies with `"<speed>;<incline>"` by UDP to the sender's port **8003**, `-1` meaning "no change"; the companion performs the swipe |

Both need the console in iFit's "privileged mode" with network ADB enabled.
In one 2026 report privileged mode switched itself off after 30 minutes
(issue #4565).

### Reading telemetry from the log

Lines of interest (`nordictrackifitadbtreadmill.cpp:66-100`, `209-280`):

| line contains | value |
|---|---|
| `Changed KPH` or `Changed Actual KPH` | last token = speed, km/h |
| `Changed Grade` | last token = incline, % |
| `Changed RPM` | cadence |
| `Changed Watts` | watts |
| `HeartRateDataUpdate` | token 14 (or 10 when 14 is 0) = heart rate |

Numbers may use a decimal comma depending on the console's locale.

### Control by touch injection

QZ drags the iFit app's on-screen speed slider (right side) or incline
slider (left side) from the current value to the target:

```
input swipe <x> <y_now> <x> <y_target> 200
```

The geometry depends on the model and screen (`nordictrackifitadbtreadmill.cpp:296-384`):

| model setting | speed slider | incline slider |
|---|---|---|
| default (Commercial 2950 class) | x 1845, y = 807 − 31 × (km/h − 1) | x 75, y = 807 − 31.1 × (% + 3) |
| `nordictrack_x22i` | x 1845, y = 785 − 23.636 × (km/h − 1) | x 75, y = 785 − 11.304 × (% + 6) |
| `nordictrack_treadmill_t8_5s` | x 1206, y = 620 − 35.9 × (mph − 1) | x 78, y = 620 − 32.916 × % |
| `proform_treadmill_carbon_t7` | x 940, y = 458 − 27.5 × (mph − 1) | x 75, y = 458 − 27.5 × % |
| `nordictrack_treadmill_1750_adb` | x 1206, y = 603 − 34 × (mph − 0.5) | x 75, y = 603 − 21.72 × (% + 3) |
| `nordictrack_treadmill_x14i` | default | lookup table in QZ |
| `proform_trainer_9_0` | x 950, lookup table | x 75, lookup table |

mph = km/h × 0.621371. Incline requests are rounded to 0.5 % and sent at
most once per second, because the incline motor is slow.

This is fragile by nature:

* **A new iFit UI moves the sliders.** A 2026 iFit update changed the
  Commercial 1750's interface and broke QZ's swipes; iFit also began
  blocking Android settings and navigation (issue #5024, open). QZ's
  current suggestion for the newest consoles is to install the QZ app on
  the console itself.
* **The wrong profile swipes to the wrong places.** A 1750 with a T8.5S
  profile jumped from 1 to 6 to 9 mph instead of 0.5 steps (issue #3118).
* An X22i without its model setting drifted back to 1 % after each change
  (issue #2171).

## 3. WiFi WebSocket

For consoles with the older iFit WiFi module (setting `proformtreadmillip`).
The protocol comes from the zwifit project
(`dawsontoth/zwifit/src/ifit.js`), as QZ's source notes.

* Connect to `ws://<console ip>/control`.
* Set: `{"type":"set","values":{"KPH":"8.5"}}`, or `"MPH"`, or
  `{"type":"set","values":{"Incline":"2"}}`. Values are strings. QZ waits
  for the next state message before sending another command.
* State messages are JSON with a `values` object:

| key | meaning |
|---|---|
| `Current KPH`, else `KPH`; `MPH` | speed |
| `Actual Incline`, `Incline` | incline, % |
| `Maximum KPH`, `Maximum Incline`, `Minimum Incline` | limits; clamp to them |
| `Kilometers` | odometer |
| `RPM` | cadence |
| `Current Watts` | power |
| `Chest Pulse` | heart rate |

**The keys follow the console's language.** QZ also accepts the Italian
`Chilometri` and `Watt attuali`, and replaces `à` with `a` before parsing.
Other languages will need their own keys.

## Field reports

* **Profile matters on BLE**: a NordicTrack T10.0 with intermittent control
  was on the wrong profile; "NordicTrack 10" was the match (issue #4412).
* **Same model, different firmware or region**: a UK T6.5S could not be
  controlled while another unit on firmware v81.210 worked perfectly
  (issue #1119).
* **Commercial 2950 with embedded WiFi**: the ADB path needed a custom ADB
  client library (`cagnulein/libadb-client.qt`) (issue #815).

## Practical recipe for a game

1. BLE console (`I_TL...`): ask the user for the exact model, replay that
   model's init and poll, send speed and incline frames in the poll's command
   slot, and parse the `00 12 01 04 02` packets.
2. Android console: prefer running the game's bridge on the console, or the
   companion's UDP 8002/8003 protocol. Treat slider coordinates as
   per-model, per-UI-version data, and verify each swipe against the next
   `Changed KPH` / `Changed Grade` log line.
3. WiFi console: WebSocket JSON; clamp to the reported maximums.
