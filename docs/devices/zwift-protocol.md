# The Zwift BLE protocol (Zwift Hub, Zwift Cog + Click, Zwift Play / Ride, "Zwift One" KICKR Core)

Zwift's own devices, and third-party trainers that ship "Zwift Ready"
firmware (Wahoo KICKR Core Zwift One, some JetBlack), expose a custom GATT
service alongside FTMS. Zwift the app talks to the trainer over this service
for gear changes, riding data and control; FTMS still works in parallel for
everyone else. QZ implements both sides:

* **client** — `ftmsbike.cpp` (`zwiftPlayInit`, `sendZwiftPlayInclination`,
  gear commands) and `src/zwift_play/` (Click / Play / Ride controllers,
  `abstractZapDevice.h`, `zwiftclickremote.cpp`).
* **server / emulator** — `virtualbike.cpp` + `characteristicwriteprocessor0003.cpp`
  when `zwift_play_emulator` is on: QZ pretends to *be* a Zwift Hub so the Zwift
  app will use virtual shifting with any bike.

Message definitions: `src/devices/zwifthubbike/Zwift hub.proto` (protobuf 2).

## GATT

| UUID | property | role |
|---|---|---|
| `00000001-19CA-4651-86E5-FA29DCDD09D1` | service | "Zwift Accessory Protocol" (ZAP) |
| `00000002-19CA-...` | notify | **Async**: device → host stream (riding data, button state) |
| `00000003-19CA-...` | write / write-no-response | **Sync RX**: host → device commands |
| `00000004-19CA-...` | indicate | **Sync TX**: device → host replies to commands |
| `00000006-19CA-...` | | unknown |

Manufacturer-specific advertising data uses company ID **2378** (Zwift Inc.).
The first byte of that blob identifies the device type: `3` = Play left,
`2` = Play right, `7` = Ride left?, `9` = Click, `11` = Click v1 (see
`bluetooth.cpp:3402-3436`, `zapConstants.h`).

## Message framing

Every message on any characteristic is `<1-byte type> <protobuf payload>`.

| type | dir | payload | meaning |
|---|---|---|---|
| `"RideOn"` (`52 69 64 65 4F 6E`) | both | | handshake. Host writes `RideOn 02 01` (+ optionally its public key); device replies `RideOn 02 00` on Sync TX. Older Click/Play v1 firmware also does an ECDH key exchange: host sends `RideOn` + `00 09` + 64-byte P-256 public key, device replies `RideOn` + `01 03` + its key; traffic is then AES-256-CCM with a 4-byte MAC and a 4-byte big-endian counter nonce (HKDF-SHA256 over the ECDH secret, salt = devicePub‖hostPub, 36-byte output: 32-byte key + 4-byte IV). Implemented in `zapCrypto.h`; **current Zwift firmware uses the unencrypted variant** and QZ only sends the plain handshake. |
| `0x00` | host → device | `HubRequest{DataId}` | request info; `00 08 88 04` (DataId 520) asks for the gear ratio, `00 08 00` general info |
| `0x03` | device → host (Async) | `HubRidingData{Power=1, Cadence=2, SpeedX100=3, HR=4, Unknown1=5, Unknown2=6}` | riding data, ~4 Hz |
| `0x04` | host → device (Sync RX) | `HubCommand{PowerTarget=3, Simulation=4, Physical=5}` | control |
| `0x07` | Play → host | `PlayKeyPadStatus` | Play controller buttons |
| `0x12` | host → Play | `PlayCommand` | haptics |
| `0x15` | | empty | keepalive |
| `0x19` | device → host | `Idle` | periodic when idle |
| `0x23` | Ride → host | `RideKeyPadStatus{ButtonMap=1, AnalogButtons=2}` | Zwift Ride buttons |
| `0x37` | Click → host | `ClickKeyPadStatus{Plus=1, Minus=2}` | Click buttons (`37 08 xx 10 yy`, a `00` means pressed) |
| `0x3C` | device → host (Sync TX) | `DeviceInformation` | reply to `0x41`/`0x00` |
| `0x41` | host → device | `41 08 05` | device-info request |
| `0x2A` | device → host | log/text | free-text debug lines from the hub (e.g. `"gap_params_change(2): 72, 72, 0, 600"`) |

Protobuf reminders: field key = `(field << 3) | wiretype`, varint LE-7-bit;
`sint32` is zig-zag encoded (`(n << 1) ^ (n >> 31)`).

### HubCommand (0x04) sub-messages

```
SimulationParam (HubCommand.4):
  1 sint32 Wind         m/s * 100   (Zwift always 0; negative = tailwind)
  2 sint32 InclineX100  grade * 100
  3 uint32 CWa          Cw*A * 10000 (Zwift constant 5100 → 0.51)
  4 uint32 Crr          Crr * 100000 (Zwift constant 400 → 0.004)
PhysicalParam (HubCommand.5):
  2 uint32 GearRatioX10000
  4 uint32 BikeWeightx100
  5 uint32 RiderWeightx100
PowerTarget (HubCommand.3): uint32 W   (ERG)
```

Encoded examples (what QZ sends / accepts):

```
04 22 03 10 <zigzag grade>          set grade only  (22 = field 4 len-delim; 10 = field 2 varint)
   e.g. grade 0.4 % → InclineX100 = 40 → zigzag 80 → varint 50 → 04 22 02 10 50
   e.g. grade -0.85 % → -85 → zigzag 169 → varint A9 01 → 04 22 03 10 A9 01
04 2A 04 10 <varint ratio>          set gear ratio (2A = field 5; 10 = field 2)
   e.g. ratio 2.4000 → 24000 → varint C0 BB 01 → 04 2A 04 10 C0 BB 01
04 2A 0A 10 C0 BB 01 20 BF 06 28 B4 42   gear ratio 2.4 + bike weight 8.31 kg (831) + rider 85 kg (8500)
04 22 0B 08 00 10 DA 02 18 EC 27 20 90 03   wind 0, grade 1.73 %, CWa 5100, Crr 400
04 18 <varint W>                    ERG target power
```

### HubRidingData (0x03)

```
03 08 <power> 10 <cadence> 18 <speedX100> 20 <hr> 28 <unknown1> 30 <unknown2>
```
Power W, cadence rpm, speed 0.01 km/h. Unknown1 is a monotonically growing
counter (QZ's emulator fakes it as +400..800 per frame, wrapping at 24000);
Unknown2 is constant per session.

## Client side: how QZ drives a Zwift Hub / Cog trainer (`ftmsbike.cpp`)

Only active when the device also has FTMS (it always does) **and** the user
enables `gears_zwift_ratio`. Otherwise QZ ignores the Zwift service completely
and uses FTMS `0x11`.

Init (`zwiftPlayInit`, `ftmsbike.cpp:206`), every write waits for the reply:

```
52 69 64 65 4F 6E 02 01          RideOn (+ "02 01")
41 08 05                         device info
04 2A 04 10 C0 BB 01             gear ratio 2.4
00 08 00                         info request
41 08 05
00 08 88 04                      read gear ratio (DataId 520)
04 2A 0A 10 C0 BB 01 20 BF 06 28 B4 42   ratio + weights
04 22 0B 08 00 10 DA 02 18 EC 27 20 90 03   full sim params
04 2A 04 10 C0 BB 01
00 08 88 04
04 22 03 10 A9 01                grade -0.85 % (replayed from a Zwift capture)
04 2A 04 10 C0 BB 01
00 08 88 04
04 22 02 10 00                   grade 0
```

Operation:
* Grade: `04 22 03 10 <zigzag(grade*100)>` built by protobuf on iOS/Android
  (`ZwiftHubBike.inclinationCommand`). **Quirk**: gear commands are ignored
  until at least one inclination command has been sent; QZ sends 0.4 % first
  (`ftmsbike.cpp:574`).
* Gear: ratio = `10000 * (current_ratio / base_ratio) * (42/14)` where the
  ratio comes from a 12-gear crankset/cog table (default 38t chainring,
  cogs 44,38,32,28,24,21,19,17,15,13,11,10) and `base_ratio` is the user's
  physical crankset/cog setting (`ftmsbike.cpp:585-595`). After each gear write
  QZ sends `00 08 88 04` ("gearApply", actually a read-back request).
* When the Zwift service is active, **all FTMS control-point writes except
  `0x05` power targets are suppressed** (`ftmsbike::writeCharacteristic`,
  `ftmsbike.cpp:87-104`): grade goes over ZAP, ERG still over FTMS.
* Telemetry: QZ still reads `0x2AD2`. On iOS it additionally parses `0x03`
  Async frames for power/cadence (`ftmsbike.cpp:787`).

Zwift's own gear ratio table as decoded by QZ's emulator (varint of ratio*10000,
`characteristicwriteprocessor0003.cpp:62-92`):

| gear | bytes | ratio |
|---|---|---|
| 1 | `CC 3A` | 0.75 |
| 2 | `FC 43` | 0.87 |
| 3 | `AC 4D` | 0.99 |
| 4 | `DC 56` | 1.11 |
| 5 | `8C 60` | 1.23 |
| 6 | `E8 6B` | 1.38 |
| 7 | `C4 77` | 1.53 |
| 8 | `A0 83 01` | 1.68 |
| 9 | `A8 91 01` | 1.86 |
| 10 | `B0 9F 01` | 2.04 |
| 11 | `B8 AD 01` | 2.22 |
| 12 | `C0 BB 01` | 2.40 |
| 13 | `F3 CB 01` | 2.61 |
| 14 | `A8 DC 01` | 2.82 |
| 15 | `DC EC 01` | 3.03 |
| 16 | `90 FD 01` | 3.24 |
| 17 | `D4 90 02` | 3.49 |
| 18 | `98 A4 02` | 3.74 |
| 19 | `DC B7 02` | 3.99 |
| 20 | `9F CB 02` | 4.24 |
| 21 | `D8 E2 02` | 4.54 |
| 22 | `90 FA 02` | 4.84 |
| 23 | `C8 91 03` | 5.14 |
| 24 | `F3 AC 03` | 5.49 |

(`bike::gearsZwiftRatio`, `bike.cpp:559`, same numbers.)

### What a Zwift Cog trainer does with grade vs FTMS

A Zwift Hub / Cog-equipped KICKR Core has a single-speed cog; "gears" are
purely resistance changes computed inside the trainer from
`grade`, `ratio`, weights, Crr and CWa. Consequences for a game:

* If you only use FTMS `0x11`, the trainer behaves like any other trainer;
  the Click buttons do nothing unless *you* implement shifting (read the
  Click over ZAP, adjust the grade or a virtual ratio yourself).
* If you use ZAP `HubCommand.Simulation` + `Physical.GearRatioX10000`, the
  trainer does the shifting maths and Zwift Click presses are consumed by...
  nobody: the Click is a separate BLE peripheral, the trainer does not read it.
  The app must connect to the Click and translate presses into ratio changes.
* Don't mix: with ZAP grade active, FTMS `0x11` writes are rejected or
  overridden on the next ZAP frame.

## Zwift Click / Play / Ride as input devices (`src/zwift_play/`)

Advertised names: `ZWIFT CLICK`, `ZWIFT PLAY`, `ZWIFT RIDE`, `ZWIFT SF2`.
QZ only pairs them when a bike is the main device and `zwift_click` /
`zwift_play` settings are on; up to two Play/Ride halves (left/right by
manufacturer byte `3`/`7` = left).

Handshake: write `RideOn` (6 bytes, no suffix) to Sync RX after subscribing;
then the device streams on Async. If nothing arrives for 10 s QZ shows
"upgrade the firmware" (old encrypted firmware).

Button decoding (`abstractZapDevice.h:60-330`):

* Click: `37 08 <p> 10 <m>` (5 bytes). `bytes[2]==0` → plus pressed,
  `bytes[4]==0` → minus pressed (`00` = pressed, `01` = released).
* Play (`0x07`): a `PlayKeyPadStatus`; QZ scans offsets 1..19 for the best
  protobuf parse (firmware variants prepend junk). Paddle "steer/brake" is
  `Analog_LR` ±100. Gear up/down heuristics: `... 40 C7 01` (right, minus)
  / `... 40 C8 01` (left, plus) tail, or bytes `[11]==0x30 && [12]==0x00`.
* Ride (`0x23`): `ButtonMap` bitmask, **0 = pressed**, masks
  as used by the code: `LEFT 0x1, UP 0x2, RIGHT 0x4, DOWN 0x8, A 0x10, B 0x20,
  Y 0x40, Z 0x80, SHFT_UP_L 0x100, SHFT_DN_L 0x200, POWERUP_L 0x400,
  POWER_L 0x800, SHFT_UP_R 0x1000, SHFT_DN_R 0x2000, POWERUP_R 0x4000,
  POWER_R 0x8000, ONOFF_R 0x20000`; analog paddles in `RideAnalogKeyGroup`
  (location 0 left, 1 right; |value| >= 90 = pressed). The proto file's enum
  is shifted one bit from Z upward relative to the code; the code is what
  was tested (`abstractZapDevice.h:390-410`).
* Auto-repeat: while held, QZ re-emits every 500 ms until 400 ms pass without
  a frame.
* Haptic: write `12 12 08 0A 06 08 02 10 00 18 <pattern>` to Sync RX
  (`zwiftclickremote::vibrate`).

## Server side: emulating a Zwift Hub for the Zwift app

With `zwift_play_emulator` QZ advertises FTMS **plus** the ZAP service
(`virtualbike.cpp:419-441`; write char `0003` Write|WriteNoResponse, `0002`
Notify, `0004` Indicate) and answers the Zwift app's requests with captured
replies (`characteristicwriteprocessor0003.cpp:writeProcess`):

| app writes (Sync RX) | QZ replies |
|---|---|
| `52 69 64 65 4F 6E 02 ...` | Async: `2A 08 03 12 11 22 0F "ATX 04, STX 04" 00`, Async: `2A 08 03 12 0D 22 0B "RIDE_ON(2)" 00`, Sync TX: `52 69 64 65 4F 6E 02 00` |
| `41 08 05` | Sync TX: `3C 08 00 12 32 0A 30 08 80 04 12 04 05 00 05 01 1A 0B "KICKR CORE" 00 32 0F "40241800984" 00 00 00 00 3A 01 "1" 42 04 08 01 10 14 0` (device info claiming to be a KICKR CORE) |
| `00 08 88 04` | Sync TX: `3C 08 88 04 12 06 0A 04 40 C0 BB 01` (gear ratio 2.4) |
| `04 2A 0A 10 C0 BB 01 20 ...` (ratio + weights) | Async: `03 08 00 10 00 18 59 20 00 28 00 30 9B ED 01`, Async: text `gap_params_change(2): 72, 72, 0, 600` |
| `04 22 ...` (simulation) | decode zig-zag `InclineX100`; QZ converts it into an FTMS `11 69 01 <grade LE> 32 28` and feeds it to its own bike driver; replies Async `0x03` riding data |
| `04 2A 04 10 <ratio>` | ratio → gear 1..24 via the table above; QZ shifts its virtual gear accordingly; replies Sync TX `3C 08 88 04 12 06 0A 04 40 <ratio bytes>` then Async `03 08 00 10 00 18 27 E7 20 00 28 96 14 30 93 ED 01` |
| `04 2A 03 10 <ratio>` (2-byte ratio) | same, reply `3C 08 88 04 12 05 03 40 8C 60` patched with the ratio |
| `04 18 <W>` | ERG target → FTMS `05 <W LE>` to the bike |
| `04 2A 08 10 ...` | Sync TX `05 0A 08 40 00 58 B6 05 60 FC 26` |
| `00 08 00` | Sync TX `3C 08 00 12 24 08 80 04 12 04 00 04 00 0C 1A 00 32 0F "BA-E4372D927BDE" 3A 00 42 04 08 01 10 53` |

Riding data (`0x03`) is pushed on Async every time QZ pushes an FTMS `0x2AD2`
frame, with power, cadence, speed 0, HR = power (sic), and the fake counter.

Zwift's implied constants are visible in the captures: Crr 0.004, CWa 0.51,
bike 8.31 kg, gear ratio 2.4 = "gear 12" of 24.

## Reading list

* QZ issue tracker mentions "Zwift Cog" with KICKR Core: works as FTMS + Click.
* `zwiftplay/` at repo root is an unrelated Android side project.
