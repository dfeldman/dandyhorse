# Other treadmills (smaller and budget brands)

Short entries for treadmills QZ supports with their own drivers that did
not warrant a full page. Most are budget walking pads or regional brands.
Byte arrays are verbatim from the named QZ source file.

| brand / names | control | notes |
|---|---|---|
| True, Assault (`TRUE...`, `ASSAULT TREADMILL `, `WDWAY` + 3) | none | read-only; newer True models (`TRUE TREADMILL nnn`, `TRUE 1000`) are FTMS |
| Lifespan (`LIFESPAN`) | speed | poll-and-reply protocol; no incline |
| Sperax walking pads (`SPERAX_RM01`, `SPERAX_RM-02`) | speed 0.1..6.0 km/h | replayed frame table; `SPERAX_RM-01` (hyphen) is FTMS |
| PitPat / DeerRun / Superun (`PITPAT-T`) | speed and incline together | three templates; newer firmware unanswered |
| Focus Fitness (`EW-TM-`) | speed and incline together | |
| esLinker (`ESANGLINKER`, `ESLINKER`) | speed; incline on one variant | variant chosen by setting; switches to FTMS if found |
| Pafers (`PAFERS_`, with `pafers_treadmill`) | speed (whole km/h), incline | same `55` framing as Toorx's Classic protocol, over BLE |
| Activio (`RUNNERT`) | speed | |
| Zipro (`RZ_TREADMIL`) | none | commands exist in the source but are commented out |
| ShuaA5 (`ZW-`) | speed, incline | minimal FTMS |

## True and Assault

Source: `src/devices/truetreadmill/truetreadmill.cpp`. Read-only; the driver
has no command functions.

GATT: service `a026ee07-0a7d-4ab3-97fa-f1500f9feb8b`, notify
`a026e01d-0a7d-4ab3-97fa-f1500f9feb8b`. That is Wahoo's UUID base, so these
consoles presumably use a Wahoo-derived Bluetooth module; QZ's Chrono bike
driver uses the same UUIDs.

Telemetry, by notification length:

| variant / length | speed (uint16 LE, 0.01 km/h) | incline (0.1 %) |
|---|---|---|
| default, 16 bytes | bytes 6..7 | byte 14 |
| default, 19 bytes | bytes 7..8 | none |
| default, 4 bytes | none | byte 2 |
| Assault, 16 bytes | bytes 5..6 | none |
| WDWAY, 18 bytes | bytes 6..7 | byte 16 |

The plain name `TREADMILL` with neither RSC nor FTMS advertised also lands
in this driver in QZ.

## Lifespan

Source: `src/devices/lifespantreadmill/lifespantreadmill.cpp`. GATT: `0xFFF0`,
write `0xFFF2`, notify `0xFFF1`. The same name is used by Lifespan bikes; QZ
picks the bike driver when `lifespan_bike` is on. QZ's first attempt found
"7 different metrics in 7 different frames" (issue #1689).

Replies carry no command identifier, so **parse each reply according to the
last query sent**. QZ alternates two queries, one per tick:

| send | reply bytes |
|---|---|
| `A1 82 00 00 00` (speed) | speed = byte 2 + byte 3 / 100 |
| `A1 88 00 00 00` (steps) | steps = bytes 2..3, big-endian |
| `A1 85 00 00 00` (distance) | distance = bytes 2..3, big-endian, ÷ 10 |

| action | frame |
|---|---|
| set speed | `D0 <whole> <hundredths> 00 00` |
| start | `E1 00 00 00 00` |
| stop / pause | `E0 00 00 00 00` |

Incline is not implemented.

## Sperax walking pads

Source: `src/devices/speraxtreadmill/speraxtreadmill.cpp`. GATT: `0xFFF0`,
write `0xFFF2` (without response), notify `0xFFF1`.

Frames are `F5 <length> ... <two checksum bytes> FA`. QZ never computes the
checksum: **every speed from 0.1 to 6.0 km/h is a replayed frame** from a
lookup table. Example, 2.0 km/h:

```
F5 0A 00 15 01 14 00 05 95 FA
```

Bytes 5 is speed × 10; bytes 7..8 are the unknown checksum. Some entries are
11 bytes with an `F0 0N` pair, which looks like byte-stuffing of values
0xF0 and above. Speeds above 6.0 or at 0 have no frame.

| action | frame |
|---|---|
| init | `F5 07 00 01 26 D8 FA` twice, then `F5 09 00 13 01 00 89 B8 FA` |
| poll (every 200 ms) | `F5 08 00 19 F0 0A 59 FA` |
| start | `F5 0A 00 15 01 02 00 BE 98 FA` (the 0.2 km/h entry) |
| stop | `F5 0A 00 15 00 00 00 D3 01 FA` |

Telemetry: frames of at least 24 bytes; steps at bytes 15..16 (big-endian);
speed ÷ 10 in the byte 7 from the end of the frame. No incline hardware.

## PitPat / DeerRun / Superun

Source: `src/devices/deeruntreadmill/deerruntreadmill.cpp`. Three variants
with 23- to 27-byte templates in which QZ patches speed and a checksum:

* **PitPat**: `6A 17 00 00 00 00 <speed×1000, BE> 01 <incline> 64 00 0C ... <checksum at byte 21> 43`.
  The checksum function is `calculatePitPatChecksum` in the source.
* **Superun BA04** and **default**: `4D 00 <counter> 17 6A 17 ... <speed×100, BE at bytes 10..11> ... <XOR at byte 25> 43`.

QZ says it also uses an unlock characteristic on some units. Two users with
different PitPat firmware saw QZ connect but get no response (issues #3589,
#4058); the second was still failing after a patch.

## Focus Fitness

Source: `src/devices/focustreadmill/focustreadmill.cpp`. Speed and incline in
one frame:

```
F0 C3 03 03 <speed×10> <incline> <checksum>      checksum = 0xB9 + speed×10 + incline  (mod 256)
```

That equals the sum of the first four bytes plus the two values, the same
additive checksum as other `F0` protocols. Telemetry: speed = byte 10 ÷ 10,
incline = byte 11.

## esLinker

Source: `src/devices/eslinkertreadmill/eslinkertreadmill.cpp`. The variant is
chosen by setting (`eslinker_cadenza` is the default):

| variant | set speed | set incline |
|---|---|---|
| Cadenza Fitness T45 | `01 01 <speed×10>` | `04 01 <incline>` |
| Ypoo Mini Change | `A9 01 01 <speed×10> <XOR of the first 4 bytes>` | none |
| Costaway | `A9 A0 03 02 <speed×10> 00 <XOR>` | none |

If the driver finds FTMS it stores the name as QZ's FTMS treadmill and asks
for a restart.

## Pafers

Source: `src/devices/paferstreadmill/paferstreadmill.cpp`. Only used when
`pafers_treadmill` is on; otherwise `PAFERS_` is a bike.

| action | frame |
|---|---|
| set speed | `55 0F 02 <whole km/h> 00` |
| set incline | `55 11 01 <percent>` |

Telemetry: speed from bytes 9 (whole) and 10 (fraction), incline byte 11.

## Activio

Source: `src/devices/activiotreadmill/activiotreadmill.cpp`. Set speed:
`03 <speed×10> 00 00 00 <0x28 + speed×10> <check>`, where the last byte is
`speed×10 + 1` by default and a nibble-dependent adjustment for the Fitfiu
MC-V460 and Zero ZT2500 (see `forceSpeed`). Telemetry bytes are permuted;
see the source.

## Zipro

Source: `src/devices/ziprotreadmill/ziprotreadmill.cpp`. Read-only in QZ.
The commented-out commands are Pafers-style `55 0F 02 <speed> 00` and
`55 11 01 <incline>`.

## ShuaA5

Source: `src/devices/shuaa5treadmill/shuaa5treadmill.cpp`. A minimal FTMS
client: `02 <speed×100, LE>` and `03 <incline×10>` (one byte), without
Request Control first.
