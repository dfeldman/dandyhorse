# Toorx / iConsole+ bikes and their clones

Spin and upright bikes built on the same Chinese console electronics as the
Toorx treadmills (`../treadmills/toorx.md`): Toorx SRX, Taurus IC90, JLL
IC400, Reebok, Adidas C1, DKN Motion, Tunturi, VirtuFit, Fit Hi Way, Casall,
Hertz XR-770, Enerfit SPX 9500, Hammer Speed Bike S, Hop-Sport HS-090H,
Bikzu, Pasyou, FAL Sports, Elite Zircon and others. Three transports exist:

| transport | QZ driver | control |
|---|---|---|
| App Gate BLE, `F0` frames | `trxappgateusbbike` | resistance level 1..32 |
| Bluetooth Classic (SPP), `F0` frames | `iconsolebike` | resistance level |
| FTMS | generic FTMS bike, with `toorx_ftms` | resistance level (max 24); no grade, no ERG |

The bikes report cadence, speed, power and resistance level. **Every value
byte is sent as value + 1**, so zero never appears on the wire. There is no
grade or ERG command; QZ maps grade and power targets to a level.

Source: `src/devices/trxappgateusbbike/trxappgateusbbike.cpp`,
`src/devices/iconsolebike/iconsolebike.cpp` (QZ).

## Routing (`bluetooth.cpp:2838`)

These names go straight to the App Gate bike driver:

* `TUN `, `FITHIWAY`, `FIT HI WAY`, `BIKZU_`, `PASYOU-`, `VIRTUFIT`, `IBIKING+`
* `ADIDAS` followed by 4 or more digits
* `TC` followed by exactly 3 digits

These names are shared with the family's treadmills, ellipticals and rowers.
They reach the bike driver **only when the user sets `toorx_bike`**:

* `TOORX` (case-sensitive), `I-CONSOLE+`, `I-CONSOIE+` (sic), `ICONSOLE+`,
  `VIFHTR2.1`, `REEBOK`, `DKN MOTION`
* names containing `CR011R`, and `FAL-SPORTS`

`ICONSOLE+` has three possible drivers. With `trx_route_key` it is the
Bluetooth Classic driver; with `toorx_ftms` it is FTMS; with `toorx_bike` it
is App Gate; with none of these, no driver. A user who ticks an FTMS option
by mistake gets a connection with no data (issues #3706, #4946).

Several models cannot be told apart by name. Riders choose them in settings:
`toorx_bike_srx_500`, `taurua_ic90`, `jll_IC400_bike`, `fytter_ri08_bike`,
`asviva_bike`, `hertz_xr_770`, `enerfit_SPX_9500`, `hop_sport_hs_090h_bike`,
`toorx_srx_3500` and `toorx_3_0`. A MAC address starting `E8` selects the
Chang Yow console variant.

## App Gate BLE

### GATT

Service `0xFFF0` (write `0xFFF2`, notify `0xFFF1`), or the Microchip UART
`49535343-fe7d-4ae5-8fa9-9fafd205e455` on i-Running, iConsole, Chang Yow, JLL,
Fytter, Tunturi, Fit Hi Way, FAL Sports, TC and Hammer consoles. When the
expected service is missing, QZ switches to the other one (the `_2`
variants). Writes use WriteWithoutResponse where offered.

### Frames

`F0 <cmd> <id> <sub> [data] <sum>`, where the checksum is the sum of all
preceding bytes mod 256. The id byte selects the console variant.

| variant | id | sub | poll every tick |
|---|---|---|---|
| iConsole, i-Running, Pasyou, Hertz | `01` | `01` | `F0 A2 01 01 94` |
| DKN Motion | `02` | `01` | `F0 A2 02 01 95` |
| Tunturi | `03` | `01` | `F0 A2 03 01 96` |
| FAL Sports | `1B` | `01` | `F0 A2 1B 01 AE` |
| VirtuFit | `1E` | `01` | `F0 A2 1E 01 B1` |
| Chang Yow, Enerfit SPX 9500, Hammer, Toorx SRX 500 | `23` | `01` | `F0 A2 23 01 B6` |
| Reebok | `32` | `01` | `F0 A2 32 01 C5` |
| Casall | `3B` | `01` | `F0 A2 3B 01 CE` |
| Hop-Sport HS-090H | `3F` | `01` | `F0 A2 3F 01 D2` |
| Bikzu | `54` | `31` | `F0 A2 54 31 17` |
| Adidas C1 | `5B` | `01` | `F0 A2 5B 01 EE` |
| Taurus IC90 | `01` | `31` | `F0 A2 01 31 C4` |
| Asviva, Fytter RI08 | `00` | `C8` | `F0 A2 00 C8 5A` |
| JLL IC400 | counter | `C8` | `F0 A2 <n> C8 <sum>`, n starts at `0B` and steps by `0C` |
| Toorx App Gate 3.0 and default | `23` | `D3` | `F0 A2 23 D3 88` |

The poll runs every 500 ms for the setting-selected models and every 200 ms
otherwise. The poll triggers the telemetry reply.

### Init

For most variants the pattern is:

```
F0 A0 01 01 92                     hello (generic id)
F0 A0 <id> <sub> <sum>
F0 A1 <id> <sub> <sum>
F0 A3 <id> <sub> 01 <sum>
F0 A4 <id> <sub> 01 01 01 01 01 01 01 01 01 01 <sum>     (not on every variant)
F0 A5 <id> <sub> 02 <sum>          start
```

Example for Toorx SRX 500 (id `23`):

```
F0 A0 01 00 91
F0 A0 23 01 B4
F0 A1 23 01 B5     (A0/A1 repeated three times in total)
F0 A3 23 01 01 B8
F0 A4 23 01 01 01 01 01 01 01 01 01 01 01 C2
F0 A5 23 01 02 BB
```

Each frame waits up to 300 ms for a notification. The exact sequence per
variant is in `btinit()` (`trxappgateusbbike.cpp:477-892`). Copy it for the
model you support; the frames differ in repeats and in extra `A6` frames.

### Telemetry (21 bytes; 19 on JLL, Asviva, Fytter, Pasyou and Hammer; 20 or 21 on Tunturi)

Every byte below is value + 1:

| bytes | field |
|---|---|
| 4, 5 | elapsed: seconds = (b4−1) + (b5−1)×60 |
| 6, 7 | speed km/h = ((b6−1)×100 + (b7−1)) / 10 |
| 8, 9 | cadence rpm = (b8−1)×100 + (b9−1) |
| 12, 13 | calories = (b12−1)×100 + (b13−1) |
| 16, 17 | power W = ((b16−1)×100 + (b17−1)) / 10 |
| 18 | resistance level = b18 − 1 |

Variants:

* JLL IC400, Asviva and Hammer Speed Bike S send cadence **without** the +1
  offset (b8×100 + b9) and no speed, power or level. QZ estimates power and
  shows a Peloton-style resistance.
* Fytter RI08 sends power at bytes 6..7 as (b6−1)×100 + b7.
* With `toorx_srx_3500`, QZ estimates power from level L and cadence C with a
  fit from rider data (issue #1999):
  `P = 37.069 − 1.483·C − 4.942·L + 0.023·C² + 0.336·C·L − 0.036·L²`.

### Set resistance

```
F0 A6 <id> 01 <level+1> <sum>
level 10, default id: F0 A6 01 01 0B A3
```

QZ uses id `02` on DKN Motion 2, `1E` on VirtuFit, `5B` on Adidas C1, `3F` on
Hop-Sport, `23` on Toorx SRX 500 and `1B` on FAL Sports; every other variant
gets `01`. Levels are clamped to 1..32 and sent only when different from the
reported level.

## Bluetooth Classic (iConsole+ with Route Key)

Serial Port Profile, UUID `00001101-0000-1000-8000-00805f9b34fb`, same `F0`
frames with id `01 01`:

```
F0 A0 00 00 90          hello
F0 A0 01 01 92
F0 A1 01 01 93
F0 A5 01 01 04 9B       then F0 A5 01 01 02 99 (start)
F0 A2 01 01 94          poll
F0 A6 01 01 <level+1> <sum>
```

Telemetry frames start `F0 B2`. Byte 18 is level + 1. **Byte 8 must be `01`
for cadence to be valid**; with `02`, byte 9 holds something else and
readings jump (seen on a Ride6 iPlus). This driver reads cadence in byte 9
directly, without the +1 offset, and computes speed as cadence × 0.38 km/h.
Power comes from a fitted surface in level L and cadence R:
`P = −25.7646 − 13.4642·L + 1.3646·R + 0.9992·L² + 0.1915·L·R + 0.001468·R²`.

## Field reports

* **Taurus IC90 (iConsole+ 0181)** showed tiles but no data until QZ added its
  variant (`taurua_ic90`, id `01`, sub `31`) (issue #3692).
* **Enerfit SPX 9500**: resistance stopped following gears when QZ's "get
  gears from Zwift" was on; turning it off fixed it (issue #4119).
* **FTMS vs App Gate on a Toorx SRX**: in FTMS mode the bike sends no
  resistance level. App Gate mode reports it (issue #2602).

## Practical recipe for a game

1. Pick the variant from the name. Ask the rider when the name is shared
   (`TOORX`, `ICONSOLE+`, `REEBOK`) or the model needs a setting.
2. Find `FFF0` or the Microchip UART service; subscribe to notify.
3. Send the variant's init frames, then its poll every 200-500 ms.
4. Parse the reply, subtracting 1 from each byte. Use the bike's power
   where it sends it.
5. Map grade to a level and send `F0 A6` only when the level changes.
