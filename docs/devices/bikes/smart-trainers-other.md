# Other smart trainers: Elite (legacy), Bkool, Technogym, CycleOps, Kinetic, Renpho

**Recommendation.** Current trainers from all of these brands except
Kinetic's Smart Control units, and possibly Bkool, expose FTMS. Drive them as
FTMS bikes (`ftms-bike.md`). The vendor protocols below matter only for older
firmware. Kinetic's protocol is obfuscated; skip it unless the trainer has no
FTMS.

| brand | QZ names | vendor protocol | grade | ERG | QZ's FTMS behaviour |
|---|---|---|---|---|---|
| Elite (pre-FTMS) | via the Stages/power-meter driver | service `347b0001-…` | yes (`02`) | yes (`00`) | if FTMS is seen, QZ switches to FTMS |
| Bkool Smart Pro, Fitness Bike | `BKOOLSMARTPRO`, `BKOOLFBIKE`, `BKOOLFITNESSBIKE` | FE-C pages on `f03ee002` | yes (page `33`) | yes (page `31`) | not checked |
| Technogym bikes | `BIKE <n>` with a setting | `F8` / `F9` frames | yes (`F9`) | yes (`F8`) | passes FTMS commands through |
| CycleOps Phantom / Magnus | `INDOORCYCLE`, `MAGNUS ` | control char on `C0F4013A-…` | faked as power | yes | Magnus with FTMS goes to FTMS |
| Kinetic Smart Control | `SMART CONTROL` | obfuscated, `E9410200-…` | yes | yes | none |
| Renpho (and SCH130) | `RQ` + 3 chars, `R-Q…`, `SCH130` | FTMS with a ×2 level scale | FTMS `11` | FTMS `05` | is FTMS |

## Elite, older trainers (Stages driver)

Source: `src/devices/stagesbike/stagesbike.cpp`. Modern Elite trainers
(Suito, Direto XR and others) are FTMS and appear in `ftms-bike.md`. If this
driver sees FTMS `0x1826`, it saves the trainer as an FTMS bike and asks for
a restart.

* **GATT**: service `347b0001-7635-408b-8918-8ff3949ce592`, command
  characteristic `347b0010-…`, second characteristic `347b0018-…`. Power and
  cadence come from Cycling Power `0x2A63`.
* **Init**: `01 AD` on `347b0010`, wait 2 s, `45 0A` on `347b0018`. Skipped on
  names containing `DR`.
* **Commands** on `347b0010`:

  | command | bytes |
  |---|---|
  | target power | `00 <W LE>`, up to 4000 W |
  | brake level | `01 <level 0..200>` |
  | simulation | `02 <grade LE> <Crr ÷ 0.00005> <Cw ÷ 0.01> <wind km/h + 127> <drafting ÷ 0.01>` |

  Grade should be `(grade% + 200) × 100`, as in FE-C. **QZ multiplies the
  grade by 100 before adding 200**, which is wrong by a factor of 100 for any
  grade (and overflows uint16 above about 4.5 %); treat QZ's encoding as a bug. QZ sends Crr 0.005, Cw 0.5, no wind and drafting 1.0.
* Names containing `DR` get brake-level commands instead of simulation.

## Bkool

Source: `src/devices/bkoolbike/bkoolbike.cpp`.

* **Routing** (`bluetooth.cpp:2409`): `BKOOLSMARTPRO`, `BKOOLFBIKE`,
  `BKOOLFITNESSBIKE`.
* **GATT**: write `f03ee002-4910-473c-be46-960948c2f59c`, cadence notify
  `f03ee006-…`; power from Cycling Power `0x2A63`.
* **Frames**: bare 8-byte ANT FE-C pages, with `25` in the second byte and no
  ANT header or checksum:

  ```
  grade:  33 25 FF FF FF <(grade%+200)×100 LE> A0
  power:  31 25 FF FF FF FF <W×4 LE>
  ```

* **Init**: `30 25 FF FF FF FF FF 00`, `32 25 FF FF FF 1E 7F 00` (wind),
  `33 25 FF FF FF 20 4E 00` (0 % grade), then user-configuration pages:
  Smart Pro `37 4C 1D FF 80 0C 46 21`, `37 EE 16 FF 80 0C 46 21`; Fitness
  Bike `37 4C 1D FF 80 0C 46 21`, `37 C8 19 FF E0 0A 46 21` twice and
  `32 25 FF FF FF 25 7F 00`.
* Virtual gears are added to the grade, as on Tacx.

## Technogym bikes

Source: `src/devices/technogymbike/technogymbike.cpp`.

* **Routing** (`bluetooth.cpp:2072`): `BIKE ` followed by a number, only with
  the `technogym_bike` setting (otherwise `BIKE…` names go to other drivers).
* **GATT**: QZ uses the Technogym characteristics `a913bfc0-929e-11e5-b928-0002a5d5c51b`
  and `58094966-498C-470D-8051-37E617A13895` for writes; power and cadence
  come from Cycling Power.
* **Commands**:

  ```
  target power: F8 01 <W LE> E4 02 18 01 03 19 00
  level/grade:  F9 01 <value LE> E4 02 18 01 03 19 00
  ```

  QZ sends the level divided by 3 in the `F9` frame, and the integer grade
  when passing an app's FTMS simulation command through.

## CycleOps Phantom / Magnus

Source: `src/devices/cycleopsphantombike/cycleopsphantombike.cpp`.

* **Routing** (`bluetooth.cpp:1872`): `INDOORCYCLE`, or `MAGNUS ` when the
  trainer does not advertise FTMS.
* **GATT**: service `C0F4013A-A837-4165-BAB9-654EF70747C6`, control
  `CA31A533-A858-4DC7-A650-FDEB6DAD4C14`.
* **Control frame**: `00 10 <mode> <p1 LE> <p2 LE> 00 00 00`. Mode `01` is
  manual power (p1 = W). Mode `02` is manual slope (p1 = weight kg × 100,
  p2 = grade % × 10), but it did not work for the user who tested it.
* **Grade** is therefore sent as power: `W = 100 + grade% × 10 × gain + offset`.
* The trainer needs about 3 s between targets and 4-5 s to reach one.

## Kinetic Smart Control

Source: `src/devices/kineticinroadbike/` (QZ ports Kinetic's SmartControl
library). Names starting `SMART CONTROL`; service `E9410200-B434-446B-B5CC-36592FC4C724`
with characteristics `E9410201` to `E9410204`.

Commands are obfuscated: each carries a random nonce and is scrambled with a
CRC-8 chain (`SmartControl.cpp`). ERG and simulation mode (weight, Crr 0.004,
wind coefficient 0.6, grade, wind speed 0) are supported. **Not worth
reimplementing for a game** unless you port that library as-is.

## Renpho

Source: `src/devices/renphobike/renphobike.cpp`. Renpho bikes are FTMS; QZ
uses a custom FTMS driver.

* **Routing** (`bluetooth.cpp:2922`): `RQ` with a 5-character name, `R-Q` with
  more than 6 characters, `SCH130`, or `TOORX` with `toorx_ftms`.
* **Start**: request control `00`, start `07`, then an FTMS simulation frame
  `11 00 00 F3 00 28 33` (2.43 %).
* **Levels are doubled**: QZ writes `04 <level × 2>` and halves the reported
  level. The `renpho_bike_double_resistance` setting disables the doubling.
  Reported levels move in 0.5 steps.
* When the user turns auto-resistance off, QZ sends `08 01` (stop) every tick
  so the rider can use the knob.
