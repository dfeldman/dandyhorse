# Horizon / Johnson Health Tech treadmills — proprietary protocol

Horizon (also sold as Matrix, Vision, AFG, Tempo, and some "JFTM" boards) is
the one major treadmill brand where the mainstream models need a proprietary
protocol for control. Newer Horizons **also** advertise FTMS (0x1826); the two
behave differently and QZ lets the user choose.

Source: `src/devices/horizontreadmill/horizontreadmill.cpp` (QZ). The same
driver is also QZ's generic FTMS treadmill driver, so only the
`gattCustomService` branches apply to this page.

## Which models

| Advertised name (`startsWith`, case-insensitive) | Notes |
|---|---|
| `HORIZON` | 7.0AT, 7.4AT, 7.8AT, T101, T202, Omega Z, Paragon X ... |
| `HZ_T101-`, `HZ_7.0AT-` | newer T101 / 7.0AT boards |
| `AFG SPORT` | AFG rebrand |
| `WLT2541` | |
| `JFTMPARAGON`, `PARAGON X` | Paragon X uses the alternate "paragon" framing below |
| `JFTM` | JFTM boards (T202 is FTMS-only, see quirks) |
| `MATRIXTF50` | Matrix TF50 |
| `HORIZON_7.8AT` | routed here too; flag `HORIZON_78AT_treadmill` exists but currently gates nothing |

Routing: `bluetooth.cpp:1636-1750`. Selection of proprietary vs FTMS happens
*after* connection: if a writable characteristic `0xFFF3` exists and the user
has not set `horizon_treadmill_force_ftms`, the proprietary path is used
(`horizontreadmill.cpp:2431`). Bowflex T9 and `MX-TM` boards also have `0xFFF3`
but are explicitly excluded from it.

Settings that change the proprietary path:

| setting | default | effect |
|---|---|---|
| `horizon_treadmill_force_ftms` | false | ignore 0xFFF3, use FTMS only |
| `horizon_treadmill_7_8` | false | use the "7.8 style" start/resume/pause/stop frames with message IDs (needed on 7.8AT and Omega Z) |
| `horizon_paragon_x` | false | Paragon X framing: no message IDs, CRLF terminated, different init |
| `horizon_treadmill_omega_z` | false | implies both `7_8` and `paragon_x` behaviours where they are checked |
| `horizon_treadmill_disable_pause` | false | don't send stop/pause frames at all |
| `horizon_treadmill_suspend_stats_pause` | false | ignore telemetry while paused |
| `horizon_treadmill_profile_user1..5` | "" | user names written into the profile init frames (max 8 chars) |
| `miles_unit` | false | changes profile init bytes and speed encoding on this path |

## GATT

Custom service with two characteristics (16-bit UUIDs; the service is the
FFF0-family vendor service):

| UUID | property | role |
|---|---|---|
| `0xFFF3` | write (with or without response, driver picks whatever it offers) | commands |
| `0xFFF4` | notify | telemetry and acks |

QZ subscribes only to the custom service's notify characteristics when the
custom path is active (it deliberately does *not* subscribe to FTMS
notifications at the same time, `horizontreadmill.cpp:2475`). If you subscribe
to both, the FTMS `0x2ACD` frames on some models report speed in different units
than the custom frames and you get flicker.

Long frames are split into 20-byte writes; on the read side notifications are
also 20-byte chunks that must be reassembled (see "Reassembly").

## Frame format (standard, non-Paragon)

All frames start with `55 AA`.

```
offset  size  field
0       2     0x55 0xAA
2       2     message ID (uint16 LE), incremented by the host for each command
4       1     group      (0x01 = system/profile, 0x03 = workout control)
5       1     command    (see table)
6       2     payload length (uint16 LE)
8       2     CRC-16/CCITT-FALSE of the payload (uint16 LE) — see CRC
10      n     payload
```

Commands seen in QZ:

| group/cmd | dir | meaning |
|---|---|---|
| `01 02` | host | hello / handshake (payload len 0) |
| `01 16` | host | write user profile slot (payload 0xDB = 219 bytes, split in 20-byte writes) |
| `01 00` | host | query profile slot (payload `b7 f1 1a 00`) — sent 5 times with IDs 0x09..0x0D |
| `03 14` | host | set date/time (payload 8 bytes: `3f 01 e5 07 02 08 13 12` observed) |
| `03 01` | host | ? (payload `01`), part of init |
| `03 10` | host | ? (payload `00`), end of init |
| `03 02` | host | start workout (payload 17 bytes) |
| `03 03` | host | pause (`01`) / resume (`00` on 7.8 flavour) |
| `01 14` | host | stop (payload len 0) |
| `03 05` | host | set speed (payload 4 bytes) |
| `03 06` | host | set incline (payload 3 bytes) |
| `xx 17` | device | periodic status frame (>70 bytes) |
| `xx 12` | device | alternate periodic status frame (>70 bytes) |
| 29-byte frame | device | short status (speed only) |

### CRC

CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no xorout) over
the **payload bytes only** (from offset 10), stored little-endian at offset 8.
Table-driven implementation at `horizontreadmill.cpp:2852-2883`. For the
profile frames the CRC is chained across all 20-byte chunks of the 219-byte
payload (`updateProfileCRC`, `horizontreadmill.cpp:2921`).

### Set speed (`03 05`)

```
55 AA <id lo> <id hi> 03 05 04 00 <crc lo> <crc hi> 00 <s lo> <s hi> 00
s = round(speed_kmh * 0.621371 * 10)      // tenths of MPH, always, regardless of console units
```
Example from a capture in the source: `55aa320003050400532c00150000` (speed 2.1 mph).
`horizontreadmill.cpp:1219-1240`. QZ waits for a `0xFFF4` packet before sending
the next command (`wait_for_response=true`, 8 s timeout on this path).

QZ only sends a speed change when the tenth-of-mph value actually changes
(`checkIfForceSpeedNeeding`), speed is clamped to 0..22 km/h, and the
difference to the current speed must be at least `minStepSpeed()` = 0.1 km/h.

### Set incline (`03 06`)

```
55 AA <id lo> <id hi> 03 06 03 00 <crc lo> <crc hi> <i lo> <i hi> 00
i = incline_percent * 10  (uint16)
```
Example: `55aa3800030603005d0b0a0000` (1.0 %). `horizontreadmill.cpp:1314-1330`.
Incline is rounded to 0.5 % steps before sending; range 0..15 % by default
(`minInclination`/`maxInclination`, some FTMS models override).

### Start / resume / pause / stop

Default flavour (`horizon_treadmill_7_8` false), `horizontreadmill.cpp:1090`:

```
start:  55 AA 11 00 03 02 11 00 84 BE 00 00 08 07 00 00 00 00 00 05   (20 bytes)
        00 00 00 01 00 00 01                                          (7 bytes)
```
This is a fixed 17-byte "manual workout" payload with a precomputed CRC; the
message ID is *not* patched in this flavour (it stays 0x0011).

7.8 flavour (`horizon_treadmill_7_8` or Omega Z), IDs patched, CRC computed:

```
start:  55 AA <id> <id> 03 02 11 00 <crc> <crc>
        1A 17 00 00 34 17 00 00 00 00 00 05 00 00 00 01 00 00 01
        (0x1734 = 5940 s = 99 min workout length in two places)
resume: 55 AA <id> <id> 03 03 01 00 D1 F1 01
pause:  55 AA <id> <id> 03 03 01 00 F0 E1 00
stop:   55 AA <id> <id> 01 14 00 00 00 00
```
On the 7.8 flavour QZ tracks a `horizonPaused` flag: after a pause the next
"start" sends *resume*, not *start*. The treadmill also sends the pause frame
itself when the user presses stop on the console
(`55 AA 00 00 03 03 01 00 F0 E1 00`, matched at `horizontreadmill.cpp:1665`),
and QZ then forces Speed = 0.

### Init sequence (required before any control)

`btinit()`, `horizontreadmill.cpp:90-905`. Skipping it means the belt ignores
speed commands on most models. Sequence (each step waits for an `0xFFF4`
frame; if none arrives the step is repeated):

1. `55 AA 01 00 01 02 00 00 00 00` (hello). Wait for one full packet.
2. Seven user-profile writes (`01 16`, message IDs 0x02..0x08, slots 0..5).
   Each is a 731-byte payload (`db 02` in the length field) sent as 20-byte
   chunks: a header chunk (slot index at payload offset 0, 9-byte name at
   offset 1..9), zero chunks, a chunk carrying weight/height/dob
   (`initData9*`), a units/settings chunk (`initData10*`: byte 2 `01`=km /
   `00`=mi, byte 10 `0x38`=km / `0x23`=mi), a run of `30 30 ...` (ASCII '0')
   chunks, more zero chunks, and a final single byte `0x30`. The CRC in the
   header covers the whole payload (chained over the chunks). The exact chunk
   sequence per slot is the `writeCharacteristic` list in `btinit()`
   (`horizontreadmill.cpp:203-690`); the constant bytes are in
   `horizontreadmill.h:142-198`. Names come from the profile settings, 8 chars
   max, default "user".
3. Five profile queries `55 AA <09..0D> 00 01 00 02 00 B7 F1 1A 00`.
4. `55 AA 0E 00 03 14 08 00 3F 01 E5 07 02 08 13 12 21 00` (date/time).
5. `55 AA 0F 00 03 01 01 00 D1 F1 01`.
6. `55 AA 10 00 03 10 01 00 F0 E1 00`.
7. `messageID = 0x10`; subsequent commands increment from there.

If the profile handshake never completes and an FTMS service is present, QZ
toasts "enable Force Using FTMS". That is the practical fallback: **for a game,
try FTMS first on any Horizon that advertises 0x1826, and only use the
proprietary path if FTMS control is refused.**

## Paragon X flavour

`horizon_paragon_x` (and Omega Z). Frames end with `0D 0A`, message ID bytes
are always `00 00`, and the CRC still covers the payload:

```
init1:   55 AA 00 00 02 20 00 00 00 00 0D 0A          (wait for 3 packets)
init2:   55 AA 00 00 03 02 0E 00 42 EF 00 00 00 00 00 00 00 00
init3:   01 00 00 00 00 00 0D 0A
start:   55 AA 00 00 03 02 0E 00 38 CE 00 00 00 00 00 00 00 00 + 01 38 00 0F 00 00 0D 0A
         (payload: 01 <speed*10 lo> <hi> <incline*10> ... ; CRC in the source is precomputed for 5.6 km/h, 1.5 %)
speed:   55 AA 00 00 03 05 03 00 <crc> <crc> <s lo> <s hi> 01 0D 0A     s = round(speed*10) (km/h unless miles_unit)
incline: 55 AA 00 00 03 06 02 00 <crc> <crc> <i> 00 0D 0A               i = incline*10 (uint8)
pause:   55 AA 00 00 03 03 00 00 00 00 0D 0A
stop:    55 AA 00 00 02 14 00 00 00 00 0D 0A
```
`horizontreadmill.cpp:111-118, 1130-1147, 1241-1265, 1331-1350`.

## Telemetry (0xFFF4)

### Reassembly

A frame starts with `0x55` and its total length is `payload_len + 10` where
payload_len is the uint16 LE at bytes 6..7. Notifications are 20-byte chunks;
concatenate until `received >= expected` (`horizontreadmill.cpp:1567-1583`).

### Status frame, command byte 0x17 (most models)

Parsed from the reassembled buffer (`horizontreadmill.cpp:1593`):

| offset | size | field |
|---|---|---|
| 24..25 | uint16 LE | speed in **0.01 mph** (QZ: `/100 * 1.60934` → km/h) |
| 30 | uint8 | incline in 0.1 % |

Everything else (time, distance, calories, HR) is not parsed by QZ.

### Status frame, command byte 0x12 (other firmware)

| offset | size | field |
|---|---|---|
| 61..62 | uint16 LE | speed in **0.001 mph** (`/1000 * 1.60934`) |
| 63 | uint8 | incline in 0.1 % |

### 29-byte short frame

| offset | size | field |
|---|---|---|
| 14..15 | uint16 LE | speed in 0.1 km/h |

No incline in this frame.

**Power is never reported**; QZ computes it from speed, incline and body weight
(see `qz-base-behavior.md`).

## Auto start/stop behaviour

* Horizon reports a nonsense speed right after connect, so QZ does *not* auto
  start when speed > 0 on the standard flavour; it does on Paragon X / 7.8
  (`autoStartWhenSpeedIsGreaterThenZero`, `horizontreadmill.cpp:2901`).
* Auto pause on speed==0 is suppressed for 10 s after a start command.

## Field reports from QZ's issue tracker

* **The 7.0AT reads FTMS target speed in 0.1 km/h.** Measured by devicelib on a 7.0AT
  (advertised as `HORIZON_7.0AT xxxx`) in September 2026, on firmware 3.001 and on the latest: `02 0a 00` gave 0.6 mph, where the FTMS
  spec's 0.01 km/h would mean 0.1 km/h. Reported speed in `0x2ACD` stays standard, and incline is
  standard. Standard speed commands therefore run the belt ten times too fast; QZ sends standard
  units, so its FTMS path would do the same. QZ uses the vendor protocol on Horizons unless the user
  forces FTMS, which may be why this has not been reported. The registry entry
  `horizon_7_series` sets `speed_sent_in_tenth_kmh` for every 7-series name, which is assumed, not
  verified. Details: `devicelib/docs/hardware/horizon-7.0at.md`.

* **The proprietary init overwrites the console's user profiles.** The six
  profile frames replace the names and reset each profile's weight to the
  default (issue #4091, Horizon 7.8). A game should not run this init unless
  the user accepts that. Forcing FTMS avoids it.
* **Horizon 7.8AT firmware 5.04** would only go between 0.8 and 1.0 km/h through the
  proprietary path. QZ's maintainer suggested forcing FTMS; the owner never confirmed whether it
  helped (issue #3391).
* **FTMS speed on a 7.8 with the console in miles** was wrong in a 2026
  report: a 7.5 mph request arrived as 4.6, which is 7.5 × 0.621. That points
  to one unit conversion too many somewhere between app and console. It was
  still open (issue #4091). Verify unit handling on the first speed write.
* **Incline halved on the 7.8** came from a stray `/2` in QZ, since removed
  (issue #4070 / #4071).
* **Omega Z** needs both the Paragon X framing and the 7.8 start frames;
  QZ added `horizon_treadmill_omega_z` to set both (issue #3809).
* **A firmware update can change the advertised name**, which silently breaks
  any name-based routing (issue #4270). Match on services as well as names.
* QZ's author gives "enable Force FTMS" as the first fix for nearly every
  Horizon control problem. FTMS on the 7.0AT/7.8AT accepts both speed and
  incline.

## Practical recipe for a game

1. Prefer FTMS whenever `0x1826` is present (all recent Horizons). Use the
   native path only for units without FTMS, and warn the user that its init
   rewrites the console's user profiles. Native path: run the init sequence
   (2-5 s), then poll every 200 ms.
2. Send set-speed / set-incline only on change, wait for an `0xFFF4` frame (or
   ~300 ms) between writes.
3. Read speed/incline from the 0x17 or 0x12 status frames.
4. FTMS path: `00`,`07`, then `02 <speed*100>` / `03 <incline*10>`. On 7-series units, send
   `02 <speed*10>` instead (see the first field report).
   and read `0x2ACD`. The FTMS path on Horizon reports incline in 0.1 % with the
   inclination flag (bit 3) set; default flags `84 04`.
