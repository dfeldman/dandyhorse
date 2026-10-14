# Stair climbers, steppers, jump ropes and body sensors

Low priority. None of these has a standard Bluetooth service. Each needs a
small vendor adapter, and they are sold in small numbers, except the cheap
SunnyFit stepper.

| device | names | read | control | recommendation |
|---|---|---|---|---|
| Echelon stair climber (Sport) | `ECH-EC-SPT` | steps, floors climbed, step rate, HR | speed and level commands exist | optional; same 2026 lock risk as other Echelon gear |
| SunnyFit mini stepper | `SF-S` | step rate, step count | none | support (cheap and common) |
| Crossrope smart jump rope | `CROSSROPE` | jump count | none | optional |
| Moxy muscle-oxygen sensor | `MOXY6` | SmO2, total haemoglobin | none | niche |
| CORE body-temperature sensor | `CORE ` | core and skin temperature, HR | none | niche |

## Echelon stair climber

Source: `src/devices/echelonstairclimber/echelonstairclimber.cpp`. Echelon
service and framing, as on the bikes (`../bikes/echelon.md`):
`F0 <cmd> <len> <data> <sum>`, sum of preceding bytes mod 256.

* **Init**:

  ```
  F0 A4 00 94
  F0 E0 85 F8 03 68 D2 8A
  F0 A4 00 94
  F0 E0 38 04 03 B5 14 D8
  F0 A1 00 91   ×4
  F0 A3 00 93
  ...
  ```

  The two fixed `F0 E0` frames look like captured answers to Echelon's
  authentication challenge (compare the Stride 4 in
  `../treadmills/echelon-stride.md`). Whether they still work on 2026
  firmware is not known.
* **Poll**: `F0 A0 01 <n> <sum>`.
* **Start** `F0 B0 01 01 A2`, then `F0 D0 01 00 C1` and `F0 D0 01 11 D2`.
  **Stop** `F0 B0 01 00 A1`.
* **Telemetry** `F0 D1`: step count bytes 5..6 BE, floors or elevation
  counter 7..8 BE, step rate byte 9 (steps/min), heart rate byte 11. QZ
  shows speed as step rate ÷ 3.2.
* **Commands QZ has**: speed `F0 B2 02 <speed×1000 BE> <sum>` and level
  `F0 B1 01 <level> <sum>`. No field reports confirm what they do.

## SunnyFit stepper

Source: `src/devices/sunnyfitstepper/sunnyfitstepper.cpp`.

* **GATT**: service `fd710001-e950-458e-8a4d-a1cbc5aa4cce`, write
  `fd710002-…`, notify `fd710003-…` and `fd710006-…`.
* **Frames** start `5A` and end `A5`. Init:

  ```
  5A 02 00 08 07 A0 31 32 33 34 35 36 E6 A5     (contains ASCII "123456")
  5A 02 00 03 02 A3 00 AA A5
  5A 02 00 03 02 B4 00 BB A5
  5A 04 00 03 02 F1 00 FA A5
  ```

* **Telemetry** on `fd710006`: a 32-byte frame sent as 20 bytes (starting
  `5A`) plus 12 bytes; join them. Step rate bytes 6..7 LE, step count
  10..12 LE (uint24). QZ assumes 0.2 m of elevation per step.

## Crossrope

Source: `src/devices/crossrope/crossrope.cpp`.

* **GATT**: service `07eb19be-1e89-4ee5-99a4-1aa7d52dea6b`, write
  `8aab96c2-db98-4ae9-8f41-3896039c95a8`, notify
  `7f5dd3d5-5fb1-4876-a725-56b75626f931`.
* **Init**: `50 00 AF`.
* **Telemetry**: 12-byte frames; jump count at bytes 1..2 BE. Jump rate is
  the change in count over time, averaged over 20 s. QZ zeroes it after 2 s
  without a jump.

## Moxy

Service `6404D801-4CB9-11E8-B566-0800200C9A66`, characteristic
`6404D804-…`. QZ reads, from frames of 8+ bytes: current SmO2 bytes 2..3 LE
÷ 100, previous SmO2 4..5 LE ÷ 100, total haemoglobin 6..7 LE ÷ 10. QZ's own
comment says this layout is an assumption; verify against Moxy's
documentation.

## CORE body temperature

Service `00002100-5B1E-4347-B07C-97B514DAE121`, temperature characteristic
`00002101-…`, control point `00002102-…`. Temperature frame: a flags byte,
then core temperature (sint16 LE, 0.01°; `7FFF` = not available), then
optional fields in flag order: skin temperature (bit 0), reserved (bit 1),
quality and state byte (bit 2), unit is Fahrenheit (bit 3), heart rate
(bit 4), heat strain index (bit 5).
