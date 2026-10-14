# FTMS treadmills — per-brand quirks

QZ has no `ftmstreadmill` class. Every FTMS treadmill goes through
`horizontreadmill` (`src/devices/horizontreadmill/horizontreadmill.cpp`), which
carries ~40 name-keyed flags. This page lists them so you know what to expect
from a given box. Routing list: `bluetooth.cpp:1636-1750`; flag assignment:
`horizontreadmill.cpp:2647-2790`.

The generic FTMS path (no flag) does, per 200 ms tick:

* `update_metrics()` with watts computed from speed/incline/weight.
* If a speed request is pending and differs from current by >= 0.1 km/h:
  `00` (request control), `07` (start), `02 <uint16 speed*100 LE>`.
* If an incline request is pending: round to 0.5 %, clamp to
  `[minInclination, maxInclination]` (default 0..15), then `00`, `07`,
  `03 <sint16 incline*10 LE>`.
* Start: `00`, `07`. Stop: `08 01`. Pause: `08 02`.
* Telemetry from `0x2ACD` (see `../ftms-common.md`); if the device lacks
  `0x2ACD` but has `0x2ACE`, that is parsed instead.

## Name → flag table

`startsWith` on the upper-cased advertised name unless noted.

| name prefix | brand / model | what changes |
|---|---|---|
| `F80`, `F85`, `F89`, `S77`, `TT8`, `ST90`, `XT485` | **Sole** (routed to FTMS only when `sole_treadmill_inclination` is off, else the proprietary Sole driver) | F85: no 0.5 % steps (0.5 → 1.0), min incline -5; F89: min -5; TT8: min -6, 1 % step; S77: 1 % step |
| `BFX_T9_` (`BFX_T`) | **Bowflex T9** | speed *sent* in mph (`*0.621371`) even though FTMS says km/h; if `fitshow_treadmill_miles` is on, received speed is also treated as mph; the `0xFFF3` custom characteristic it exposes is ignored |
| `TREADMILL` (exact prefix, with FTMS service or `gem_module_inclination`) | **Technogym Run / MyRun (FTMS mode)** | flag `technogymrun`; no behaviour change today (QZ's dedicated Technogym drivers cover the proprietary side) |
| `KETTLER TREADMILL` | Kettler | incline command uses a lookup table: target 0..12 % in 0.5 steps → bytes `05 0a 14 15 1e 25 32 35 3c 45 50 55 5a 65 6e 75 78 85 8c 95 96 | 05 01 ...` (the console rounds; see `horizontreadmill.cpp:1362-1440`); 1 % min step |
| `TUNTURI T60-`, `TUNTURI T90-` | Tunturi | inclination in `0x2ACD` is ignored; QZ sets `Inclination` from what it requested (device does not report it back) |
| `MOBVOI TM`, `MOBVOI TMP`, `MOBVOI WMTP` | Mobvoi | TMP: cannot go below 1 km/h (requests <1 are dropped); uses elapsed-time field in `0x2ACD` to detect "user stepped off" and forces speed 0 after 2 s without elapsed-time change; TM: incline not reported, QZ mirrors the request |
| `WELLFIT TM` | Wellfit | extra `00` request-control ×2 after init; no `00`/`07` before speed writes |
| `ANPLUS-`, `ANPIUS-` | Anplus | no `00`/`07` before speed/incline writes |
| `TRX3500`, `TRX4500` | Toorx TRX | `07` re-sent every second as keepalive; no `00`/`07` before writes; 1 % incline step; on iOS characteristic/descriptor discovery is disabled for these |
| `TOORX`, `I-CONSOLE+` | Toorx / iConsole | only here when `toorx_ftms_treadmill` is set and `toorx_ftms` (bike) is not; 1 % step |
| `T01_` | iConcept (T01) | inclination in `0x2ACD` comes as odd encoded values: `3C 00`=1 %, `82 00`=2, `C8 00`=3, `04 01`=4, `4A 01`=5, `90 01`=6, `CC 01`=7, `12 02`=8, `58 02`=9, `94 02`=10, `DA 02`=11, `20 03`=12, `5C 03`=13, `A2 03`=14, `E8 03`=15. With `iconcept_ftms_treadmill_inclination_table` on, the *same* values are written back for set-incline |
| `SCHWINN 810`, `SCHWINN 510T` | Schwinn | incline not reported; QZ mirrors the requested value |
| `YESOUL` | Yesoul | incline not reported; mirrored |
| `SW` + 12 chars, no parentheses, FTMS present | "SW" boards (e.g. `SW12345678901`) | auto-pause disabled; incline not reported (mirrored); reset incline to 0 on stop; when a Zwift-side FTMS `07` arrives QZ forwards it as a real start; no `00`/`07` before writes |
| `DOMYOS-TC` (with FTMS and `domyostreadmill_notfmts` false) | Decathlon Domyos T900C/TC | only the FTMS service is discovered; if the Domyos vendor service `49535343-fe7d-4ae5-8fa9-9fafd205e455` also shows up QZ sets `domyostreadmill_notfmts` and asks for a restart so the proprietary Domyos driver is used; `domyos_treadmill_ts100`: fixed 15 % incline |
| `MX-TM ` | | `0xFFF3` ignored (treat as pure FTMS) |
| `FIT-` (not `FIT-BK-`), `FIT-TM-` | Sportstech F37s and similar "FIT-" boards | `FIT-`: 1 % step. `FIT-TM-` has a real incline motor but does not report incline; QZ shows the last requested value |
| `3G PRO `, `3G ELITE ` | 3G Cardio | incline set via table: floor(incline) 0..10 % → byte `0x10 + 10*n` = `10 1a 24 2e 38 42 4c 56 60 6a 74`, high byte 0; ELITE: speed received is mph when console in miles; no `00`/`07` before writes; 1 % step |
| `TP1` (exact, length 3) | | waits for `0x2ADA` status `02 01` from the treadmill and only then sends `00`,`07`; no `00`/`07` before writes |
| `TM4800-`, `TM6500-`, `TM4500` | | speed sent in mph when `miles_unit`; TM4500/6500 min incline -3 |
| `MRK-T` | Merach | needs an unlock write on custom characteristic `59554c55-0000-6666-8888-4d4552414348`: `AA 01 00 01 55` (also subscribe to its indications); speed sent in mph when miles; 3 s debounce on transient speed=0 frames |
| `WT` + 3 digits (length 5) | | speed in mph when miles |
| `THERUN  T15` (two spaces) | | speed in mph both ways when miles |
| `JFTM T202` | Horizon-family FTMS-only board | target speed must be sent in mph always |
| `YPOO-MINI PRO-` | Ypoo | requires `01 00 00 03 08 00 02 09` written to vendor char `d18d2c10-c44c-11e8-a355-529269fb1459` before control, then `00` twice; no `00`/`07` before writes |
| `FS-` | | max incline 40 %; no `00`/`07` before writes; inclination override table bypassed unless customised |
| `ADIDAS` | | incline range -6..40 |
| `KICKR RUN` | Wahoo KICKR Run | plain FTMS path, no flags |
| `KS-*`, `URTM`, `SF-T`, `NOBLEPRO CONNECT`, `ASSAULTRUNNER`, `RUN BT-`, `X-T`, `TC-`, `TM XP_`, `BODYCRAFT_`, `LJJ-`, `WLT-EP-`, `TRUE 1000`, `TRUE TREADMILL nnn`, `XTERRA TR`, `T118_`, `T218_`, `T318_`, `DK` (len>=11), `CT800`, `XT685`, `XT285`, `FITNESS`, `RUNN `, `YS_T`, `LB600`, `TM55-`, `CITYSPORTS-LINKER`, `CTM` (len>=15), `SPERAX_RM-01`, `AB300S-`, `TF04-`, `FOCUS M3`, `SWALK LITE-`, `MOBVOI WMTP` | Kingsmith/WalkingPad, Urevo, Sunny, NoblePro, Assault, Xterra, True, Lifesmart, Focus, Sperax ... | plain FTMS path, no flags |

The `ftms_treadmill` setting (a device name) forces any name into this driver;
`horizon_treadmill_force_ftms` also enables `TF-` boards.

## Common treadmill-side traps

* **Inclination unit**: FTMS says 0.1 %. Some boards send degrees or a level
  index. QZ solves this with a user-configurable 31-entry override table
  (`treadmill_inclination_override_0 ... _150`, plus gain/offset), applied on
  read and inverted on write (`treadmill.cpp:334-570`). If a device's incline
  looks off by a constant factor, that is where QZ users fix it.
* **0.5 % steps**: QZ rounds every incline request to 0.5 % (or 1 % for the
  flagged models). Sending 0.3 % to a device that only does 0.5 % steps is
  ignored by many consoles.
* **Control after idle**: several boards drop control after some seconds;
  hence the `00`+`07` before every write. But the models listed above with "no
  `00`/`07` before writes" will *stop the belt* or reset the workout if you do
  that. There is no way to detect which class you have from the wire; QZ keys
  on the name.
* **Start from the app vs the console**: many treadmills refuse `02` speed
  while stopped until `07` has been sent; some (TP1) refuse `07` until the user
  presses start on the console.
* **Distance**: lifetime totals on many boards; QZ integrates speed instead
  (`treadmill_direct_distance` switches).
* **Auto pause**: QZ marks "paused" when speed reads 0 for more than a
  moment, except within 10 s after a start command.
* **Cadence**: rarely provided (Cross Trainer frames carry step rate; RSC
  service on Technogym/Wahoo). QZ estimates cadence from speed and rider
  height when absent (`treadmill.cpp:669`).
