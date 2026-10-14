# Identifying a device

Identification means choosing three things for a Bluetooth peripheral:

1. its **class**: treadmill, bike, elliptical, rower or other;
2. its **protocol adapter**: `ftms`, `horizon`, `domyos_f0`, and so on;
3. its **quirk entry** in `quirks.yaml`.

QZ does almost all of this from the advertised name, in one long ordered
list (`bluetooth.cpp:831-3086`; the full list is in
`appendix-qz-routing.md`). That works but is brittle. This page describes
what QZ does, where it breaks, and a more robust four-phase approach for a
shared library.

## What the scan gives you

| item | notes |
|---|---|
| local name | The main key. Can be missing from the advertisement, truncated, or replaced by a cached name (iOS). Firmware updates can change it (QZ issue #4270). |
| advertised service UUIDs | Often incomplete. QZ checks this list, without connecting, only to break ties (`deviceHasService`, `bluetooth.cpp:540-547`). |
| manufacturer data | Keyed by Bluetooth company ID. QZ uses it for Zwift controllers (2378, `0x094A`), unnamed Yesoul bikes (637, `0x027D`) and Keiser M3i. |
| address | Android and desktop only; iOS gives a per-app random UUID. QZ hard-codes one Tacx MAC address, which you should not copy. |

## Phase 1: before connecting (advertisement)

Walk the registry in two passes. First try the entries whose `user_option`
the user has already chosen for this device, then the entries without a
`user_option`. Within a pass, file order decides and the first entry whose
rules hold wins. The name rules (prefix, exact, contains, regex) are
alternatives; every other rule must hold.

* **Name rules**: prefix (case-insensitive unless marked), exact name, exact
  length, excluded prefixes, excluded characters.
* **Advertised-service rules**: a service must, or must not, be advertised.
  QZ uses this for a handful of prefixes shared by an FTMS model and an older
  proprietary one: `TT8`, `ST90`, `XT485`, `E25`, `E35`, `TREADMILL`, `SW`,
  `NOBLEPRO CONNECT`, `MAGNUS `, `GLT`, `SPORT01-`, and the Domyos names. It
  also uses the Running Speed and Cadence service (`0x1814`) to spot foot pods
  named `TREADMILL` or `S10`.

The output of phase 1 is a candidate entry, or "unknown". Keep it
provisional; phase 2 can override it.

### Name traps QZ has run into

* **Case matters sometimes.** QZ matches `Domyos`, `Domyos-Bike`,
  `Domyos-EL`, `FS-`, `SW`, `TOORX`, `V-RUN`, `MRK-`, `Flywheel`, `BF70`,
  `ECH`, `YESOUL`, `I_EB`, `I_SB`, `I_TL`, `I_IT`, `X100-` and
  `TRX ROUTE KEY` case-sensitively. Everything else is upper-cased first.
* **Length is part of some names**: `TP1` (exactly 3), `ICSE` (4), `WT` +
  3 digits (5), `YPBM...` (10), `SW...` (14 = FTMS or FitShow, 15 with a `-`
  at index 10 = FitShow), `IC` + 6 (Inspire, while `IC BIKE` is Schwinn),
  `BIKE` + 2 (NPE, Flywheel or Technogym, by user choice), `LF` + 13 or 16
  (Life Fitness).
* **Double spaces are real**: `THERUN  T15`.
* **Earlier prefixes shadow later ones.** `KETTLER ` (elliptical list)
  catches `KETTLER TREADMILL` before the treadmill list sees it, and
  `KETTLER C12` before the Kettler ergometer driver does. The registry adds
  exclusions for both.
  `ToputureTP6` in QZ's treadmill list never matches because QZ compares an
  upper-cased name with a mixed-case literal.
* **The same prefix spans classes.** Some prefixes belong to several classes
  and QZ resolves them from user settings, not from the device:

| prefix | possible classes in QZ |
|---|---|
| `FS-` | FitShow treadmill (default), FTMS elliptical, FTMS bike (Hammer Racer S), Snode bike, FitPlus bike; `FS-YK-` is an FTMS bike |
| `TOORX`, `I-CONSOLE+`, `ICONSOLE+`, `REEBOK` | AppGate treadmill (default), AppGate bike, elliptical, rower, FTMS bike or FTMS treadmill |
| `TF-` | Snode bike (default), FTMS treadmill; `TF-T` is a Toorx RFCOMM treadmill |
| `TREADMILL` | foot pod (with RSC), FTMS treadmill (with FTMS), True treadmill (neither) |
| `PM5` | Concept2: `...ROW` rower, `...SKI` SkiErg, otherwise treated as a bike until it proves otherwise |
| `PAFERS_`, `LIFESPAN` | bike or treadmill, by user setting |
| `BIKE` + 2 chars | NPE Cable, Flywheel/Life Fitness IC, or Technogym, by user setting |
| `HT` + 8, 9 or 10 chars | Sportsplus, Skandika, or FTMS bike |
| `XQ...` | FTMS bike (`XQ` + 10 digits) or Volava (length 12) |
| `SF-` | FTMS elliptical (`SF-` + digits), FTMS treadmill (`SF-T`), rower (`SF-RW`), stepper (`SF-S`) |

## Phase 2: after connecting (GATT)

Service discovery is authoritative; advertisements are not. After
connecting, refine the phase-1 guess:

1. **FTMS data characteristics reveal the class.** `0x2ACD` treadmill,
   `0x2ACE` cross trainer, `0x2AD1` rower, `0x2AD2` bike. QZ does **not**
   do this; it trusts the name. A library should, with one caveat: some
   treadmills and bikes also expose `0x2ACE` (QZ parses it as a fallback on
   both), so prefer `0x2ACD`/`0x2AD2`/`0x2AD1` when more than one is present.
2. **A vendor service can override FTMS.** Domyos treadmills can advertise
   FTMS whose control does not work; the Microchip UART service being present
   means "use the proprietary protocol". Horizon's writable `0xFFF3` means the
   proprietary protocol is available.
3. **QZ's self-corrections**, which a library should do in-process instead of
   asking for a restart (QZ writes a setting and toasts "restart QZ"):

| driver finds | QZ then |
|---|---|
| FitShow, esLinker, Kingsmith R1 Pro, Yesoul driver sees FTMS but not its own service | reroutes the name to the FTMS treadmill driver |
| FitPlus, Tacx, Domyos bike, Wahoo driver lacks its own service (Wahoo: sees the Zwift service instead) | reroutes the name to the FTMS bike driver |
| FTMS bike driver sees a `PM5` without FTMS | reroutes it to the FTMS rower driver |
| FTMS treadmill driver sees the Domyos UART service | reroutes to the Domyos proprietary driver |
| FTMS bike driver finds no control point on a Domyos | reroutes to the Domyos bike driver |
| Domyos elliptical driver lacks its service | reroutes to the FTMS elliptical driver |

### Vendor service fingerprints

Collected from every QZ driver (UUIDs in QZ source, excluding QZ's own
virtual devices). A match narrows the vendor but not always the model; the
same board is sold under many brands.

| UUID (service or base) | seen in QZ drivers for |
|---|---|
| `00001826-...` (FTMS) | everything FTMS |
| `49535343-fe7d-4ae5-8fa9-9fafd205e455` (Microchip transparent UART) | Domyos (treadmill, elliptical, rower), Sole (treadmill, elliptical), Spirit, iConsole/Toorx AppGate (treadmill, bike, elliptical) |
| `0000fff0`/`fff1`/`fff2` (generic vendor UART, 16-bit) | Sportstech, Sportsplus, iConsole AppGate, Yesoul, Ypoo, FitPlus, Sperax, esLinker, DeerRun/PitPat, Zipro, Focus, Skandika, Apex, XCX, MePanel, MOK Fitness |
| `0000fff3`/`fff4` | Horizon treadmills and Horizon GR7 bike (with `fff4` also used by Yesoul and Tacx) |
| `6e400001-b5a3-f393-e0a9-e50e24dcca9e` (Nordic UART) | Flywheel, MCF, NPE Cable, Cycplus BC2 shifter, "T2" bike |
| `6e40fec1/2/3-b5a3-...` | Tacx FE-C over BLE |
| `00001533-1412-efde-1523-785feabcd123` | all ProForm / NordicTrack / FreeMotion BLE (iFit) |
| `0bf669f1-45f2-11e7-9598-0800200c9a66` | Echelon (bike, rower, Stride treadmill, stair climber) |
| `...-0002a5d5c51b` family (for example `1717b3c0-9803-11e3-90e1-0002a5d5c51b`) | Nautilus Inc.: Nautilus bike/treadmill/elliptical, Bowflex T216, Schwinn 170/270 |
| `a026ee01` / `a026e005-0a7d-4ab3-97fa-f1500f9feb8b` | Wahoo KICKR control; `a026ee07` / `a026e01d` also appear in True treadmills and Chrono bikes; `a026e002`/`a026e038` KICKR Headwind fan |
| `00000001-19ca-4651-86e5-fa29dcdd09d1` | Zwift ZAP (Zwift Hub, Cog trainers, Click, Play, Ride) |
| `ce060010-43e5-11e4-916c-0800200c9a66` family | Concept2 PM5 |
| `347b0001-7635-408b-8918-8ff3949ce592` family | Elite (Rizer, Sterzo, Aria fan, Square) and some power meters |
| `b4cc1223-bc02-4cae-adb9-1217ad2860d1` | Wattbike Atom |
| `5da54cf2-9cb2-11e5-8994-feff819cdc9f` family, `4a8ff3f1-...`, `c52d3161-...` | Life Fitness treadmills |
| `96dc867d-7a83-4c22-b6be-6381d727aeda` family | Octane (Zero Runner, Q37 elliptical) |
| `df1eb8e4-1753-4bb9-a6a6-e018040af0a3`, `00002a98-...` | Technogym MyRun |
| `58094966-498c-470d-8051-37e617a13895`, `a913bfc0-...` | Technogym bike |
| `0000fe00`-`fe02`; `0000fed7`/`fed8` and `00011234-...` | Kingsmith WalkingPad (R1 Pro; R2/X21) |
| `638af000-7bde-3e25-ffc5-9de9b2a0197a` family | Kettler C12 |
| `e9410200-b434-446b-b5cc-36592fc4c724` family | Kinetic inRide |
| `f03ee002-4910-473c-be46-960948c2f59c` family | BKOOL |
| `72d70001-501f-46f7-95f9-23846ee1aba3` family | Pafers |
| `e54eaa50-371b-476c-99a3-74d267e3edae` family | Activio |
| `c0f4013a-...`, `ca31a533-...` | CycleOps Phantom |
| `7e78aa19-72cd-d3b8-a81f-5b7e589bea0f`, `0000ff00` | Stryd |
| `59554c55-0000-6666-8888-4d4552414348` | Merach treadmill unlock (the bytes spell "YULU ... MERACH") |
| `d18d2c10-c44c-11e8-a355-529269fb1459` | Ypoo Mini Pro control |
| `00001101-0000-1000-8000-00805f9b34fb` (Serial Port Profile, Bluetooth Classic) | Toorx RFCOMM treadmills, iConcept / BH, iConsole bike |
| `b1f93401-d4bd-4839-b7d7-b7434e9656cc`, `f755c9cf-e1fc-4ecd-8d90-f2d7ebf56b81`, `44f8d44f-7e03-4baf-9cc1-bd5a9c7a076b` | Nautilus bikes (`f755c9cf` = B616) |
| `8ce5cc01-0a4d-11e9-ab14-d663bd873d93` | Kettler C12 (alternative to `638af000`) |
| `4b480001-6e6f-7274-6870-6f6c65656e67` | NPE CABLE gym bridge |
| `0x1234` / `0x1235` / `0x1236` (16-bit) | SmartRow |
| `fd710001-e950-458e-8a4d-a1cbc5aa4cce` family | SunnyFit stepper |
| `07eb19be-1e89-4ee5-99a4-1aa7d52dea6b` | Crossrope |
| `6404d801-4cb9-11e8-b566-0800200c9a66` | Moxy muscle-oxygen sensor |
| `00002100-5b1e-4347-b07c-97b514dae121` | CORE body-temperature sensor |
| manufacturer data, company `0x0102`, major version `06` (no connection) | Keiser M3i, advertisement-only |

Two runtime signatures matter as much as UUIDs. An Echelon device that sends
an 8-byte `F0 E0 …` frame after connecting is locked by 2026 firmware
(`bikes/echelon.md`). A Domyos bike that exposes both FTMS and the Microchip UART should be
driven through the UART (`bikes/domyos.md`). A Sole treadmill with both
should be probed over FTMS first and moved to the UART if FTMS ignores
speed or incline commands (`treadmills/sole.md`).

The `fff0` family is used by dozens of unrelated cheap boards. Its presence
tells you almost nothing without the name.

## Phase 3: Device Information Service (`0x180A`)

Read Manufacturer Name (`0x2A29`), Model Number (`0x2A24`) and Firmware
Revision (`0x2A26`) after connecting. QZ does not use them for routing, but
several quirks depend on firmware, not model: Sole's FTMS speed lock varies
by region and year, and Horizon firmware 5.04 behaves differently. Logging
these strings, and keying quirks on them as evidence accumulates, is the
cheapest improvement over QZ.

## Phase 4: probing capabilities

Some capabilities can only be learned by trying:

* Send a small FTMS incline change; check that `0x2ACD` follows within a few
  seconds. Same for speed. Mark the capability unsupported if not.
* Watch the control-point indication: `80 <op> 02` means not supported,
  `80 <op> 05` means control not permitted (often "request control first", or
  on Domyos "too fast").
* Never probe with a value outside the device's range. A Sole F85 went to
  15 % when sent -1 % (QZ issue #2552).

## Variants that cannot be detected

These are chosen by the user in QZ because nothing on the wire tells them
apart. A library needs a user-facing choice, or a probe, for each:

| family | variants |
|---|---|
| Sole proprietary | default, F63, F65, TT8 init sequences |
| Horizon proprietary | standard, 7.8 start/pause frames, Paragon X framing, Omega Z (both) |
| Domyos treadmill | T900A button layout, RUN100E stale incline, TS100 fixed incline |
| Toorx / iConsole+ | treadmill, bike, elliptical, rower, FTMS bike, FTMS treadmill share names |
| `FS-` boards | see the prefix table above |
| Pafers, Lifespan | bike or treadmill |
| `BIKE` + 2 chars | NPE Cable, Flywheel / Life Fitness IC8 / IC5, Technogym |
| any unknown FTMS device | treadmill, bike, elliptical or rower (QZ: the `ftms_*` name settings; a library: the FTMS characteristic check) |

## Recommended algorithm

```
scan -> for each peripheral:
    entry = first registry entry whose name + advertised-service rules match
            (user-chosen variants first, then file order)
    connect, discover services
    if entry has gatt_has rules that fail, or a vendor override applies:
        entry = next matching entry (re-run with GATT facts)
    if entry is none and FTMS present:
        class = from FTMS data characteristics; entry = generic FTMS for class
    read Device Information strings; apply firmware-keyed quirks
    if entry declares user_option variants: ask the user once, remember by address/UUID
    optionally probe speed / incline / resistance capabilities
```

Remember the final decision per device so later sessions skip the probing.
