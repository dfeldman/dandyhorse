# Console bikes with their own protocols: Sole, Horizon GR7, Sportstech, Yesoul, Nautilus, Kettler C12, Flywheel / Life Fitness IC

Smaller families, each with its own framing. Most report cadence, power and
resistance level. Few accept commands. The table summarises them; sections
below give the bytes.

| family | names | protocol | reads | control |
|---|---|---|---|---|
| Sole LCB, LCR, R92 | `LCB`, `LCR`, `R92` | Dyaco `5B … 5D` over Microchip UART | cadence, power, speed, level | level, by button presses |
| Horizon GR7 (Johnson) | `JFIC` | FTMS, or `55 AA` + `0xFFF4` frames | cadence, level; power via FTMS | FTMS simulation frame with level as grade |
| Sportstech SX / ESX / AF | `EW-BK`, `AF` + 5 chars | `F2` frames on `0xFFF0` | cadence, power, speed, level | level, embedded in the poll |
| Yesoul S1 / S3 (older) | `YESOUL`, `YS_G1M_` | `F5 … F6` on `0xFFF0` | cadence, power, level | none |
| Nautilus bikes | `NAUTILUS B` | Nautilus Inc frames | cadence, power, speed, level, HR | none |
| Kettler C12 ergometer | `ERGO C12`, `KETTLER C12` | Kettler service + Cycling Power + CSC | cadence, power, speed, level | **target power 0-250 W** |
| Flywheel, Life Fitness IC5 / IC8 (ICG consoles) | `Flywheel`; `BIKE` (6 chars) with a setting | ICG frames over Nordic UART | cadence, power, speed, brake level, HR | none |

Other Yesoul models (`YS_C1_`, `YS_G1_`, `YS_M1P_`, `YS_A…`) are FTMS; see
`ftms-bike.md`.

## Sole LCB / LCR / R92

Source: `src/devices/solebike/solebike.cpp`. Framing is the Dyaco format of
Sole treadmills (`../treadmills/sole.md`).

* **Routing** (`bluetooth.cpp:2901`): names starting `LCB`, `LCR`, `R92`, when
  no FTMS bike is set. If the Microchip service is missing but FTMS exists,
  QZ saves the bike as an FTMS bike and asks for a restart.
* **GATT**: service `49535343-fe7d-4ae5-8fa9-9fafd205e455`, write
  `49535343-8841-…`, notify `49535343-1e4d-…`.
* **Init** (LCB/LCR):
  `5B 01 F0 5D`, `5B 02 03 01 5D`, `5B 06 07 01 23 00 9B 43 5D`,
  `5B 03 08 10 01 5D`, `5B 05 04 00 00 00 00 5D`, `5B 02 02 02 5D`,
  `5B 02 03 04 5D`. The R92 sequence adds `5B 04 00 13 4F 4B 5D`,
  `5B 04 00 14 4F 4B 5D`, `5B 04 00 09 4F 4B 5D` and `5B 04 00 10 4F 4B 5D`
  acknowledgements in between.
* **Poll**: rotate `5B 04 00 10 4F 4B 5D`, `5B 04 00 06 4F 4B 5D`,
  `5B 04 00 13 4F 4B 5D` (R92: `…14…`). `4F 4B` is ASCII "OK".
* **Telemetry**: frames of 20+ bytes with byte 1 = `13`. Elapsed seconds
  3..4, distance 7..8 ÷ 100, cadence 10, speed 11..12 ÷ 100, power 13..14;
  all big-endian. Speed and distance are in miles when the console is set to
  miles.
* **Level**: `5B 02 13 <level> 5D`, level 1..40.
* **Control**: the level only moves by button presses, `5B 02 F1 02 5D` (up)
  and `5B 02 F1 03 5D` (down), one per tick until the reported level matches.
  **QZ's current code always sends "up"**; a correct driver compares the
  levels and picks the direction.

## Horizon GR7

Source: `src/devices/horizongr7bike/horizongr7bike.cpp`.

* **Routing** (`bluetooth.cpp:2092`): names starting `JFIC`.
* **With FTMS** (`0x2AD9` found): QZ parses FTMS `0x2AD2` normally. To set a
  level 1..12 it writes an FTMS **simulation** frame
  `11 00 00 <level×100 LE> 00 00` — the level is sent as the grade in
  percent. When an app is connected to QZ's virtual bike, QZ passes that
  app's FTMS commands straight through instead.
* **Without FTMS**: QZ writes `55 AA 00 00 02 16 00 00 00 00 0D 0A` to
  `0xFFF3` and reads 13-byte frames on `0xFFF4`: cadence at byte 11, level at
  byte 12. There is no power in these frames; QZ uses its heart-rate power
  model. QZ writes the same simulation frame to `0xFFF3`, with no evidence
  that it works there.
* A 2026 fix restored missing power data (issue #4250).

## Sportstech

Source: `src/devices/sportstechbike/sportstechbike.cpp`.

* **Routing** (`bluetooth.cpp:2472`): `EW-BK`, or `AF` with a 7-character name
  (for example `AF7019E`). Setting `sportstech_esx500` selects the ESX500
  (levels 0..10); others use 0..24.
* **GATT**: service `0xFFF0`, write `0xFFF2`, notify `0xFFF1`.
* **Frames**: `F2 <cmd> <len> <data> <sum>`, checksum = sum of all preceding
  bytes mod 256.
* **Init**:
  `F2 C0 00 B2`, `F2 C1 05 01 FF FF FF FF B5`,
  `F2 C4 0D 00 00 00 00 00 00 00 00 00 00 FF FF FF C0`,
  `F2 C3 07 01 00 00 00 00 FF FF BB`.
* **Poll and control in one frame**, every tick:
  `F2 C3 07 04 <level> 00 00 00 FF FF <sum>` (sum = `BE` + level), level 0..23.
  QZ's separate resistance function is disabled.
* **Telemetry**, 20 bytes: minutes 3, seconds 4, calories 7..8, power 9..10,
  heart rate 11, speed 12..13 ÷ 10, level 15, cadence 17 (big-endian).
* QZ reports 0 W at 0 rpm. It has power tables for the ESX500 and the AF7019
  for ERG emulation.

## Yesoul (proprietary models)

Source: `src/devices/yesoulbike/yesoulbike.cpp`.

* **Routing** (`bluetooth.cpp:2555`): `YESOUL` (case-sensitive) or `YS_G1M_`.
* **GATT**: service `0xFFF0`, write `0xFFF1`, notify `0xFFF4`.
* **Init**: `F5 20 20 40 F6`, then subscribe. No poll.
* **Telemetry**, 12 bytes: level at byte 4, cadence at byte 6, power 7..8
  big-endian. Speed = 0.37497622 × cadence.
* **No control**: QZ's resistance call is commented out.
* If `0xFFF0` is missing and the name is exactly `YESOUL`, QZ saves the device
  as an FTMS *treadmill* and asks for a restart. That looks like a QZ bug;
  treat it as an FTMS bike.
* Some Yesoul G1 bikes send nothing usable over Bluetooth. QZ's answer is a
  companion app on the bike's tablet (`QZCompanionYesoul`), like Peloton
  (issue #4688).

## Nautilus bikes (B616, B628, U626 and others)

Source: `src/devices/nautilusbike/nautilusbike.cpp`. Nautilus Inc framing,
as on Bowflex treadmills and the Schwinn 170/270
(`schwinn-bowflex.md`).

* **Routing** (`bluetooth.cpp:1310`): names starting `NAUTILUS B`.
* **Service** (first found): `b1f93401-d4bd-4839-b7d7-b7434e9656cc`, else
  `f755c9cf-e1fc-4ecd-8d90-f2d7ebf56b81` (B616), else
  `44f8d44f-7e03-4baf-9cc1-bd5a9c7a076b`.
* **Init**: `07 01 D3 00 1F 05 01`.
* **14-byte frame**: cadence byte 1; speed 3..4 LE ÷ 100; power 6..7 LE ÷ 100.
  The B628 and most models send speed **always in mph**. The B616 sends km/h,
  or mph when the console is set to miles (issue #4838).
* **20-byte frame**: heart rate byte 16, level byte 18.
* **No control.** QZ has a U626 power fit, levels 1..25 (issue #2118), used
  only for ERG emulation.

## Kettler C12 ergometer

Source: `src/devices/kettlerc12bike/kettlerc12bike.cpp`. Built from a
Kinomap Bluetooth capture.

* **Routing** (`bluetooth.cpp:2119`): `ERGO C12` (case-sensitive) or
  `KETTLER C12`. QZ's FTMS elliptical list runs first and its `KETTLER `
  prefix (`bluetooth.cpp:1259`) catches `KETTLER C12`, so in QZ only
  `ERGO C12` names reach this driver. A library should exclude the C12 from
  any `KETTLER ` rule.
* **Services**: Kettler `8ce5cc01-0a4d-11e9-ab14-d663bd873d93` or
  `638af000-7bde-3e25-ffc5-9de9b2a0197a`; also Cycling Power `0x1818` and
  CSC `0x1816`.
* **Characteristics** (`638a1xxx-7bde-3e25-ffc5-9de9b2a0197a`): `100e`
  control (write), `1105` handshake, `1001` level, `1002` cadence, `1003`
  power, `1004` speed ÷ 10, `1008` distance (uint32, metres). All values are
  little-endian. QZ prefers the Cycling Power reading when one arrived in the
  last 3 s.
* **Init**:

  ```
  00 05 01 00 00 00 00 00 00 00 00 00
  00 00 01 00 00 00 00 00 00 00 04 00 00
  25 00 / 25 01 / 25 02 / 25 03 / 25 04 / 25 05 02 00
  00 00 01 00 00 00 00 00 00 00 01 00 02
  00 00 01 00 00 00 00 00 00 00 16 00 00
  ```

* **Target power (ERG)**: `81 <seq> 00 06 84 12 01 0C <W lo> <W hi>`, with a
  sequence byte that increments per command, 0..250 W. QZ treats every
  resistance or grade request as a wattage.
* **Do not poll.** The bike streams once notifications are on; QZ removed its
  poll because extra traffic "can move the bike into a different protocol
  mode".

## Flywheel / Life Fitness IC5 / IC8 (ICG consoles)

Source: `src/devices/flywheelbike/flywheelbike.cpp`. Flywheel Sports home
bikes and Life Fitness IC5 / IC8 share the Indoor Cycling Group console.

* **Routing** (`bluetooth.cpp:2714`): `Flywheel` (case-sensitive), or `BIKE`
  with exactly 6 characters when the user sets `flywheel_life_fitness_ic8` or
  `life_fitness_ic5`. `BIKE…` names are otherwise ambiguous.
* **GATT**: Nordic UART, service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, write
  `…0002`, notify `…0003`.
* **Frames**: `FF <len> <msg id> <data> <crc> 55`. QZ does not check the CRC.
  Live data is message `0C`.
* **Init**: Flywheel and IC8: `F5 20 20 40 F6`. IC5: a set-name frame
  `FF 10 05 55 6E 6B 6E 6F 77 6E 20 44 65 76 69 63 65 45 55` ("Unknown
  Device") and `FF 0C 02 00 2A 5B 02 00 E2 B8 01 4A 4A 26 55`. An IC5 showed
  only zeros until the IC8 setting was turned on (issue #2429).
* **Live data** (message `0C`, packed): power 0..1 **big-endian**, FTP % 2..3,
  zone 4, heart rate 5, HR % 6, power:HR 7, W/kg 8, cadence 9, speed 10..11
  big-endian ÷ 10, brake level 12, lap 13, lap time 14..17, lap distance
  18..19, laps 20, workout time 21..24, distance 25..26, calories 27..28.
* The console sends occasional frames with 0 cadence, speed or power. QZ's
  `flywheel_filter` ignores up to N such frames in a row.
* No control.

## Other small drivers (not documented)

QZ has drivers for these low-volume or obscure bikes. Routing names are in
`../appendix-qz-routing.md`:

Inspire (`IC` + 8 chars), MePanel, PitPat (`PITPAT-S`), Apex (`WLT8266BM`),
Chrono (`CHRONO `), Ultrasport (`X-BIKE`), Volava (`XQ` + 10 chars),
XCX (`XCX-`), Skandika Wiri (`BFCP`, `HT` + 9-10 chars), Lifespan (setting),
MCF (`MCF-`), Snode (`FS-` with a setting, `TF-`), Sports Plus
(`CARDIOFIT`, `HT` + 8 chars), Pafers (`PAFERS_`), FitPlus / Merach MRK
(`FS-`, `X100-`, `MRK-`), and Freebeat (serial port).
