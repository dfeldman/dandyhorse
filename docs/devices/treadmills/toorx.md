# Toorx / iConsole+ / JTX / Reebok / Adidas / DKN treadmills

A family of treadmills built around the same Chinese control electronics and
the iConsole+ / Toorx "App Gate" Bluetooth key (a dongle that plugs into the
console). Brands include Toorx (Italy), JTX Fitness (UK), Reebok, Adidas, DKN,
Cardiostrong, Focus Fitness and BH. Three transports exist:

| transport | QZ driver | typical units | control |
|---|---|---|---|
| App Gate BLE, `F0` frames | `trxappgateusbtreadmill` | Toorx with App Gate key, JTX Sprint, Reebok FR30, Adidas, DKN | **incline only**; speed is blocked "for safety" |
| Bluetooth Classic SPP, `55` frames | `toorxtreadmill` | older Toorx (TRX Route Key), BH, MasterT40 | speed and incline |
| FTMS | generic FTMS treadmill driver, with `toorx_ftms_treadmill` | newer Toorx and Reebok boards | speed and incline |

Sources: `src/devices/trxappgateusbtreadmill/`, `src/devices/toorxtreadmill/` (QZ).
Despite "usb" in the name, the App Gate driver is Bluetooth LE.

## Routing (`bluetooth.cpp:2749` and `2816`)

The same names are shared by the family's bikes, ellipticals and rowers, so
QZ decides the class from user settings (see `../identification.md`). For
treadmills:

| name | driver |
|---|---|
| `TOORX`, `V-RUN` (case-sensitive); `K80_`, `I-CONSOLE+`, `ICONSOLE+`, `I-RUNNING`, `DKN RUN`, `ADIDAS `, `REEBOK` | App Gate BLE, unless a Toorx bike, elliptical, rower or FTMS setting is on |
| `TRX ROUTE KEY` (case-sensitive), `MASTERT40-`, `BH DUALKIT TREAD`, `TF-T`, `BH-TR-` | Bluetooth Classic |
| `TOORX` or `I-CONSOLE+` with `toorx_ftms_treadmill` on | FTMS driver (1 % incline steps) |

## 1. App Gate BLE

### GATT

Service `0xFFF0` with write `0xFFF2` and notify `0xFFF1`; some variants use
the Microchip UART instead (service `49535343-fe7d-...`, write
`49535343-8841-...`, notify `49535343-1e4d-...`, plus a second notify
`49535343-aca3-481c-91ec-d85e28a60318`). WriteWithoutResponse where offered,
except on Adidas and DKN.

### Frame format

Decoded from the constant frames; all satisfy it:

```
F0 <command> <device id> D3 [data...] <checksum>
checksum = (sum of all preceding bytes) mod 256
```

The device-id byte selects the variant:

| id | variant | QZ selects it by |
|---|---|---|
| `01` | Toorx (App Gate before 3.0), JTX Sprint, i-Running, iConsole+ | default, or `jtx_fitness_sprint_treadmill` |
| `23` | Toorx App Gate 3.0 | `toorx_3_0` |
| `32` | Reebok | name `REEBOK`, or `reebok_fr30_treadmill` for the incline frame |
| `5B` | Adidas | name `ADIDAS ` |
| `04` (with `01` instead of `D3`) | DKN Run | name `DKN RUN` |

Commands seen: `A0` hello, `A1`, `A2` poll, `A3` user data, `A4`, `A5` state
(`02` start, `04` stop), `AC` set incline, `AF`.

### Init

Per variant, 7 to 10 frames (`btinit`). For the default id `01`:

```
F0 A0 01 01 92
F0 A5 01 D3 04 6D
F0 A0 01 D3 64
F0 A1 01 D3 65
F0 A3 01 D3 01 15 01 02 51 01 51 23
F0 A4 01 D3 01 01 01 01 ...        (16 bytes)
F0 AF 01 D3 02 75
```

The Reebok, Adidas and DKN versions are the same frames with their device id
and recomputed checksums.

### Poll

Every 200 ms: `F0 A2 <id> D3 <checksum>`, for example `F0 A2 01 D3 66`
(Reebok `F0 A2 32 D3 97`, Adidas `F0 A2 5B D3 C0`, DKN Run `F0 A2 04 01 97`).

### Telemetry

19-byte frames beginning `F0 B2` (18 bytes on DKN Run), often split across
notifications; reassemble first. **Every value byte is sent as value + 1**
(zero never appears on the wire):

| offset | meaning |
|---|---|
| 6, 7 | distance = ((b6−1)×100 + (b7−1)) / 100 |
| 8, 9 | calories = ((b8−1) << 8) \| (b9−1) |
| 10, 11 | heart rate = (b10−1)×100 + (b11−1) |
| 12, 13 | speed, km/h = ((b12−1)×100 + (b13−1)) / 10 |
| 14 | incline, % = b14 − 1 |

The console start button shows up in the frame: bytes 15..16 = `03 02`
(i-Running) or 16..17 = `04 03` (others). QZ then starts its own session.

### Control

| action | frame |
|---|---|
| set incline | `F0 AC <id> D3 <percent+1> 64 64 <checksum>` (Adidas: `F0 AC 5B D3 ...`) |
| set speed | none: QZ's speed function is empty on this path |
| start | `F0 A5 <id> D3 02 <checksum>` (Adidas sends it twice) |
| stop | Adidas only: `F0 A5 5B D3 04 C7` |

With `jtx_fitness_sprint_treadmill` QZ rounds incline to 0.5 %, because other
values make the console "beep forever".

## 2. Bluetooth Classic (Serial Port Profile)

Older Toorx consoles (TRX Route Key), BH and MasterT40. QZ connects to the
Serial Port service (`00001101-...`) with an RFCOMM socket. On Android it
requests no security; after the first successful SDP discovery it caches the
result (`toorxtreadmill_discovery_completed`). **iOS apps cannot use this
transport.**

Frames are `55 <command> <length> <data...>`, with no checksum.

| action | frame |
|---|---|
| poll (every second) | `55 17 01 01` |
| set speed | `55 0F 02 <whole km/h> <hundredths>` (converted to mph first when QZ's miles setting is on) |
| set incline | `55 0A 01 <whole percent>` |

Start is a scripted sequence of 13 to 16 frames, one per second, that differs
for the default console, `MASTERT40` and `toorx_65s_evo`. The default begins
with a 104-byte block of `55 xx 01 FF` queries, then
`55 01 06 2F 00 56 00 B7 00 ...` and ends with `55 07 01 FF` (verbatim in
`toorxtreadmill.cpp:update`).

Telemetry: 17-byte frames (byte 1 not `27`):

| offset | meaning |
|---|---|
| 7..8 | elapsed seconds, big-endian |
| 9..10 | distance / 100, big-endian |
| 11..12 | calories, big-endian |
| 13, 14 | speed = b13 + b14/100 (mph when the miles setting is on) |
| 15 | incline, % |
| 16 | heart rate |

## Field reports

* **Speed is blocked on the App Gate path**: QZ's author on a JTX Sprint 5:
  "not capable to change speed via bluetooth, only inclination is available
  due to safety reason" (issue #2223). A Toorx Experience Plus with an App
  Gate key likewise allowed incline but not speed (issue #1107).
* **FTMS unlocks speed on some units**: a Reebok FR30z could not be
  speed-controlled until the user enabled `toorx_ftms_treadmill` and set the
  treadmill as QZ's FTMS treadmill; then speed and incline both worked
  (issue #3247). **Try FTMS first.**
* **JTX Sprint 5 drops the connection on incline changes**; Kinomap sends
  each incline change twice and in 0.5 % steps, and even imitating that did
  not fix it (issue #1762).
* **TRX Route Key**: needed start, pause and start again in QZ before the
  belt would respond (issue #541).
* **App Gate 3.0 on some Android phones** dropped the connection while QZ was
  also advertising its virtual device (issue #611).

## Practical recipe for a game

1. If FTMS is present, use it; speed may work there.
2. App Gate BLE: pick the device id, init, poll `F0 A2`, parse the 19-byte
   frame with the −1 decoding, control incline only.
3. Bluetooth Classic: Android and desktop only; poll `55 17 01 01`, set speed
   and incline directly.
