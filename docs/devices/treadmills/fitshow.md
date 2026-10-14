# FitShow-board treadmills

FitShow (Shenzhen) makes a Bluetooth control module and companion app that
many budget and mid-range treadmills use: Sportstech, Tunturi, NoblePro,
Winfita, Bluefin, AnyRun, Hammer and others. The same framing also appears on
at least one rower (see the last section). Newer boards add FTMS alongside.

Source: `src/devices/fitshowtreadmill/fitshowtreadmill.cpp` (QZ).

## Routing (`bluetooth.cpp:2992-3004`)

| name | notes |
|---|---|
| `FS-...` (case-sensitive) | default meaning of `FS-`; several user settings reroute it to bikes or ellipticals (see `../identification.md`) |
| `TR510-T...` | |
| `NOBLEPRO CONNECT...` without advertised FTMS | NoblePro E8i / E10i; with FTMS it goes to the FTMS treadmill driver |
| `SW` + 12 characters without FTMS, or `SW` + 13 with `-` at index 10 (like `SW5731CAXI-0061`) | case-sensitive `SW`; the 14-character form with FTMS goes to the FTMS driver |
| `WINFITA...`, `TUNTURI T80-...`, `SW-BLE...`, `BF70...` (case-sensitive) | |

**Self-switch to FTMS**: if the driver discovers service `0x1826` and the
name is not `FS-`, `TR510-T` or `TUNTURI T80-`, QZ stores the name as its
FTMS treadmill and asks for a restart (`fitshowtreadmill.cpp:302-308`). So
FitShow boards with FTMS end up on the FTMS path, except those three
families, which QZ keeps on FitShow because their FTMS side does not work
for control.

## GATT

The data service is chosen in this order (`fitshowtreadmill.cpp:293-309`,
`757-772`):

| service | write characteristic | notify characteristic |
|---|---|---|
| `0xFFF0` (preferred) | `0xFFF2` | `0xFFF1` |
| `0xFFE0` | `0xFFE1` | `0xFFE4` |
| `0000ae00-0000-1000-8000-00805f9b34fb` (NoblePro) | `0xAE01` | `0xAE02` |

WriteWithoutResponse if the characteristic offers it. CCCD `01 00`.

QZ also opens the Running Speed and Cadence service (`0x1814`) when present
and reads cadence from RSC Measurement (`0x2A53`) byte 3.

Maximum frame size is 25 bytes.

## Frame format

```
02 <payload...> <XOR of payload bytes> 03
```

The checksum covers the payload only, not the `02` and `03`. Incoming frames
with a bad checksum are dropped. Payload byte 0 is the command, byte 1 the
sub-command:

| command | value | sub-commands |
|---|---|---|
| `SYS_INFO` | `0x50` | `00` model (with date), `01` date, `02` speed limits, `03` incline limits, `04` totals, `05` combined limits (AnyRun) |
| `SYS_STATUS` | `0x51` | poll with no sub-command; replies carry the state (below) |
| `SYS_DATA` | `0x52` | `00` sport data, `01` workout info |
| `SYS_CONTROL` | `0x53` | `00` user data, `01` ready/start, `02` set speed and incline, `03` stop, `06` pause |
| `SYS_KEY` | `0x54` | console keys (not used by QZ) |

Status states (`SYS_STATUS` reply byte 1): `00` normal (idle), `01` end,
`02` start countdown (byte 2 = seconds), `03` running, `04` stopped,
`05` error (byte 2 = error code), `06` safety key pulled, `07` study,
`0A` paused.

## Command queue and retries

QZ queues commands (`fitshowtreadmill.cpp:57-61`, `262-279`). Every 200 ms
tick:

* If the queue is empty, send the status poll `02 51 51 03`.
* Otherwise resend the head command on every other tick, and drop it after
  three unanswered sends.
* A command leaves the queue when a reply with the same command and
  sub-command arrives.

This "send, wait a tick, resend" pattern is what makes these boards
reliable; single fire-and-forget writes get lost.

## Init (`btinit`, `fitshowtreadmill.cpp:686-745`)

All are payloads; wrap each as above.

```
53 00 <uid lo> <uid hi> 6E 1E <weight kg> AA     user data: user id (default 0x13AA), 110, age 30, weight, height 170
                                                 (AnyRun: 7 bytes, height omitted)
50 00 <yy-2000> <MM> <dd> <hh> <mm> <ss>         model + current date/time (not on AnyRun)
50 02                                            speed limits
50 03                                            incline limits
50 04                                            totals
50 01                                            date
```
AnyRun (`fitshow_anyrun`) sends only `50 05` instead of the four info
requests. The meaning of the `6E` (110) byte is not known.

The replies matter: **speed and incline limits come from the treadmill**.

| reply | payload bytes | meaning |
|---|---|---|
| `50 02` | 2 = max, 3 = min speed (0.1 units), 4 = unit | speed limits |
| `50 03` | 2 = max, 3 = min incline; bit `0x02` of byte 4 = pause supported | incline limits. A reply shorter than 7 bytes means **no incline motor**; QZ then forces incline to 0 |
| `50 05` | max speed, min speed, max incline, min incline, HR-control flag, countdown | AnyRun combined |

QZ sends no speed command until it has the maximum speed.

## Telemetry: status reply (`51 03`, `51 04`, `51 0A`, `51 01`)

Frames of at least 16 bytes. Offsets are into the payload (raw frame offset
minus one) (`fitshowtreadmill.cpp:455-545`):

| payload offset | size | meaning |
|---|---|---|
| 2 | uint8 | speed, 0.1 km/h (0.1 mph with `fitshow_treadmill_miles`) |
| 3 | int8 | incline, whole percent, signed (NoblePro: half-percent units) |
| 4..5 | uint16 LE | elapsed seconds (AnyRun: minutes, seconds) |
| 6..7 | uint16 LE | distance; QZ divides by 10 and only logs it, unit not confirmed (AnyRun: big-endian) |
| 8..9 | uint16 LE | calories (AnyRun: big-endian) |
| 10..11 | uint16 LE | step count (AnyRun: big-endian) |
| 12 | uint8 | heart rate |
| 13 | uint8 | unknown |

Speed only counts while the state is `03` running; QZ reports 0 otherwise.
QZ ignores the treadmill's distance and calories and integrates its own.
There is no power; QZ computes it.

## Control

**Speed and incline are always set together** (`forceSpeedOrIncline`,
`fitshowtreadmill.cpp:128-154`):

```
53 02 <speed> <incline>
speed   = round(speed_kmh * 10)             (divide by 1.60934 first with fitshow_treadmill_miles)
incline = whole percent                     (NoblePro: incline * 2)
```

Both are clamped to the limits the treadmill reported. QZ rounds incline to
whole percent (0.5 % on NoblePro) before sending. Its comment explains why:
other values make the console "beep forever".

| command | payload |
|---|---|
| start | `53 01 00 00 00 00 00 00 00 00` (sport id 0, normal mode), then a speed/incline command |
| stop | `53 03` |
| pause | `53 06` |

After start QZ suppresses auto-pause for 10 s; after stop it suppresses
auto-start for 25 s.

## Model-specific settings

| setting | default | effect |
|---|---|---|
| `fitshow_treadmill_miles` | false | the treadmill reports and expects mph |
| `fitshow_anyrun` | false | AnyRun variant: big-endian counters, shorter init, `50 05` limits |
| `fitshow_truetimer` | false | use the treadmill's elapsed time instead of QZ's |
| `fitshow_user_id` | `0x13AA` | user id in the init |
| `atletica_lightspeed_treadmill` | false | send start during init |

## Field reports

* **Tunturi T80** could not be controlled until QZ gave it the plain FitShow
  profile; the official FitShow app controls it fine (issue #3567). In 2026
  it still paused two or three times right after a QZ start before running
  (issue #4524, unresolved).
* **NoblePro**: incline travels as half-percent units, so QZ doubles on write
  and halves on read. A user's "incline not working" report was QZ's
  "simulate incline with speed" setting, not the treadmill (issue #4880).
* **An unnamed FitShow-based treadmill** (2026) accepted speed from QZ but
  not incline; unresolved (issue #4549).
* **Winfita T532** incline levels did not map linearly to percent; that
  request is what created QZ's 31-slot incline override table (issue #1244).
* **FitShow on a rower**: the Topiom `FS-442900` advertises `FS-`, services
  `0x180A`, `0x180F` and `0xFFF0`, board strings `Henortek` / `HNKBKBLE1.0`,
  and uses different data frames (`0x42`, `0x43`). QZ added a separate
  "FitShow rower" setting. The console display turns off while a Bluetooth
  client is connected (issue #4840).

## Practical recipe for a game

1. If `0x1826` is present and the name is not `FS-`, `TR510-T` or
   `TUNTURI T80-`, use FTMS.
2. Otherwise subscribe to `0xFFF1` (or the fallback characteristics), send
   the init, and read the speed and incline limits.
3. Poll `02 51 51 03` every 200 ms. Send `53 02` commands through a
   retry-until-echoed queue, with speed and incline together.
4. Round incline to whole percent (0.5 % on NoblePro), clamp to the reported
   limits, and never send speed before the limits are known.
