# FTMS bikes and smart trainers — per-brand quirks

Driver: `src/devices/ftmsbike/ftmsbike.cpp` (QZ). This is the catch-all for any
bike advertising `0x1826`, plus ~60 name-keyed exceptions. Trainers with their
own protocol (Wahoo KICKR family, Tacx FE-C, Elite via FTMS, Saris) are in
`wahoo.md`, `tacx.md` and `smart-trainers-other.md`; console/spin bikes with proprietary protocols are in
`console-brands.md`, `domyos.md`, `toorx.md`, `echelon.md` and `schwinn-bowflex.md`.

## Baseline behaviour (no flag)

* Connect, discover all services, subscribe to every notify/indicate.
* On first descriptor write: `00` (request control) then `07` (start),
  each waiting for a response (`ftmsbike::init`).
* Every 200 ms: if a resistance request changed, send it; if an inclination
  (grade) request changed, send `11 00 00 <grade*100 LE> 28 19`; if a power
  request changed, `05 <W LE>`.
* Read `0x2AD2` for speed/cadence/power/resistance; `0x2ACE` as fallback;
  `0x2A63` (Cycling Power Measurement) only until the first `0x2AD2` frame.
* Resistance level scaling: **gain/offset are applied by QZ**
  (`bike_resistance_gain`, default 1.0, `bike_resistance_offset`, default 4)
  when converting a "Peloton-style" 1..100 resistance into a grade-field hack
  (see below). Not applied to `0x04`.

## Three ways QZ sets "resistance" on an FTMS bike

1. `0x11` sim grade — real grade in 0.01 %. Used for GPX/Zwift routing when the
   bike is not `resistance_lvl_mode`. Gears are applied by adding
   `gearsModifier() * 50` (0.5 % per gear step) to the grade
   (`GEARS_SLOPE_MULTIPLIER`, `ftmsbike.cpp:1920`).
2. `0x11` with a **resistance level in the grade field**: for a resistance
   request `r`, grade field = `(r * gain + offset) * 10` (so 0.1 % units of
   "fake grade"). Default path for `forceResistance` when the bike is not
   flagged `resistance_lvl_mode` (`ftmsbike.cpp:339-360`).
3. `0x04` target resistance: 1 byte raw level, or 2 bytes `level*10` LE for
   the devices listed below. Used when `resistance_lvl_mode` is set, or the
   user sets `force_resistance_instead_inclination`.

For a game with a fixed physics model: use (1) on trainers and (3) on
console-style bikes; QZ's name table below tells you which is which.

## Name → behaviour table

Match is `startsWith` on upper-cased name unless noted.
"lvl" = `resistance_lvl_mode` (use `0x04`, ignore `0x11`);
"noERG" = `ergModeSupported=false` (QZ converts `0x05` into a level).

| name | device | max res | flags / quirk |
|---|---|---|---|
| `SUITO` | Elite Suito | 16 | |
| `DIRETO XR` | Elite Direto XR | | `0x04` uses 2-byte `level*10` |
| `MAGNUS ` (with FTMS) | Saris/CycleOps Magnus | | lvl, ERG ok: power target sent as `0x05`, resistance as `0x04` |
| `HAMMER` (not saris) | Saris Hammer | | sends `00` then `01` (reset) before `00`,`07`; only FTMS service is subscribed (`hammer_racer_s` setting) |
| `ZWIFT HUB` | Zwift Hub | | plain FTMS; when the Zwift custom service `00000001-19CA-...` is present and `gears_zwift_ratio` is on, resistance/grade go over the Zwift protocol instead (see `../zwift-protocol.md`) |
| `KICKR CORE` etc. | Wahoo | | **not** this driver (goes to `wahookickrsnapbike`) unless an FTMS bike was already picked |
| `DOMYOS` (FTMS) | Decathlon Domyos bikes (EB500/EB900/Bike 500...) | 32 | lvl, noERG; writes with response; no power in `0x2AD2` → QZ estimates watts from HR; `0x04` rate-limited to one per 1.5 s and backed off 3 s after `80 04 05` (control not permitted), re-running `00`/`07`; only FTMS service subscribed; if no control point found QZ sets `domyosbike_notfmts` and switches to the proprietary Domyos driver on restart |
| `ICONSOLE+` (when `toorx_ftms`) | iConsole+/Toorx | 24 | lvl, noERG |
| `DU30-` | | 32 | resistance read from vendor char `0xFFF1` byte 5; watts from a fitted polynomial `1.462*cad + 8.88e-5*cad*r + 6.25e-4*r² + 0.058*cad + 0.00293*r + 6.48` |
| `ICSE` (exact) | | | `00`,`01`,`00`,`07` init; subscribes only to FTMS and CSC; 15 s telemetry reset; auto resistance off by default |
| `D500V2` | | | if a `0x11` arrives before `07` after `00`, QZ injects `07` first |
| `3G Cardio RB` | 3G Cardio | | `0x04` 1-byte with `level*10`; never uses `0x11` for resistance |
| `SCH_190U`, `SCH_290R` | Schwinn 190U / 290R (FTMS) | 100 | only FTMS subscribed; 290R runs init immediately after discovery |
| `D2RIDE` | | | battery notifications ignored |
| `VFSPINBIKE` | | | flag only |
| `SMARTSPIN2K` | SmartSpin2k (Peloton add-on) | | `SS2K`; on stop sends `11 00 00 00 00 28 19`; with `ss2k_peloton`, resistance goes via `0x04` |
| `JFBK5.0`, `JFBK7.0` | JFIT / Horizon 5R-style | | lvl, noERG, 2-byte `0x04`; `JFBK5.0R` loads a default cadence×resistance→watts table (`horizon5r_defaults.h`) |
| `BIKE-` | | | resistance value in `0x2AD2` is `/10` |
| `SMB1` | | | only FTMS subscribed; init right after discovery |
| `SPAX-BK-` | Sperax bike | | lvl, noERG |
| `LYDSTO`, `DMASUN-*-BIKE` | | | with `watt_ignore_builtin`, watts from HR |
| `SL010-` | | 25 | lvl, noERG; `0x04` 1-byte `level*10`; reported resistance ignored (QZ trusts what it set) |
| `REEBOK` | Reebok | 32 | lvl, noERG; gear multiplier 1 (not 5) |
| `RAVE` | Zipro Rave | 32 | lvl, noERG, 2-byte `0x04` |
| `TITAN 7000` | | | power target converted to resistance; resistance echoed from the request, not the frame |
| `T2 ` | | | gears read from vendor char `6e400003-b5a3-f393-e0a9-e50e24dcca9e` bytes 54..55 (62-byte frame) |
| `FIT-BK-` | Sportstech (FTMS bike) | | noERG, 2-byte `0x04`; only FTMS subscribed; init after discovery |
| `EXPERT-SX9` | | | noERG |
| `YS_G1MPLUS` | Yesoul G1M Plus | 100 | |
| `PM5` | Concept2 PM5 seen as bike | | if no control point, QZ sets `ftms_rower` to this name and restarts |
| `THINK X`, `THINK-` | Thinkrider X | | CPS (`0x2A63`) crank/wheel parsing enabled for cadence |
| `WLT8828` | | 32 | lvl, noERG |
| `VANRYSEL-HT` | Van Rysel | | watts reported even at cadence 0 |
| `MRK-S26C-` | Merach S26C | | watts = `cadence * resistance * 1.16` |
| `MRK-S28-` | Merach S28 | | lvl, 2-byte `0x04` |
| `MRK-S36C-` | Merach S36C | | lvl, noERG, `0x04` 1-byte `level*10` |
| `YPBM` (len 10) | Ypoo | 32 | lvl, noERG, 2-byte `0x04` |
| `TOPUTURE TEB5` | | 32 | noERG; `0x2ACE` watts unrealistic → replaced by a cadence²-fit × per-level multiplier when `toputure_teb1` is on |
| `SPORT01` | | 10 | lvl, noERG; watts from cadence-fit × level multiplier `{0.60,0.75,0.85,0.95,1.00,1.18,1.40,1.70,2.00,2.40}` when `toputure_teb1` |
| `MOKFITNESS-` | MOK S10 Ultra | 32 | noERG; `0x2AD9` NAKs resistance; instead write `AF 05 04 <level> AA` to vendor char `0xFFF2` |
| `TX-500MB IRON` | | custom | lvl, noERG; manual resistance bike: user-entered resistance/watts table |
| `SMARTBIKE-nnn` | | custom | same manual-resistance mode |
| `FS-YK-` | | 24 | lvl, noERG, 2-byte `0x04`; reported resistance ignored; no software ERG (conflicts with QZ's HR PID) |
| `S18` (exact) | | 24 | |
| `SPEEDRACEX` | | 32 | lvl, noERG, 2-byte `0x04`; default erg table from `speedracex_defaults.h` |
| `USDC-D700-` | | | lvl; init sends `00` then `08 01` (stop!) instead of `07` — that is what keeps it streaming |
| `Tunturi E50-168` (exact, ci) | Tunturi | 48 | lvl; 2-byte `0x04`; distance in `0x2ACE` is `/10000`; gear multiplier 1 |
| `DHZ-` | JK Fitness 577 | | only the FTMS service is created at all |
| Wattbike Atom (service `b4cc1223-...`) | Wattbike | 22 gears | gears read from char `b4cc1224-...` (`xx 03 B6 <gear>`), default gear 6 |
| `STAGES BIKE` | Stages SB20 | | plain FTMS (see QZ docs: flags `0x00C5`, occasionally degrades to flags `0x0011` with no power until power-cycled) |

## Reading cadence and watts — what to trust

* `0x2AD2` instant cadence (bit 2) `/2` and instant power (bit 6) are correct on
  every mainstream trainer.
* When power is absent, QZ falls back to average power, then to HR-based
  estimate. For a game, treat absent power as "no power source", not zero.
* Resistance level (bit 5) is missing on most *trainers* (Wahoo, Tacx, Elite);
  it is present on console bikes. Don't depend on it.
* QZ re-derives a synthetic 1..100 "Peloton resistance" from cadence and watts
  using a quadratic fit of the Peloton Bike (constants in
  `../qz-base-behavior.md`). That is what the "resistance" number in QZ means on
  a trainer.

## Gears

QZ implements virtual gears in three ways, in priority order:

1. Zwift protocol gear ratio (Zwift Hub / KICKR Core with Zwift service +
   `gears_zwift_ratio`): sends a `PhysicalParam.GearRatioX10000` message; see
   `../zwift-protocol.md`.
2. Grade offset: `grade += gear * 0.5 %` (sim mode).
3. Resistance offset: `level += gear * 5` (or *1 on Reebok/Tunturi).

## Dual-protocol devices worth knowing

| device | proprietary | FTMS | QZ prefers |
|---|---|---|---|
| Wahoo KICKR / CORE / SNAP / BIKE / MOVE | Wahoo extension on CPS (`a026e005-...`) | yes (recent firmware) | proprietary driver, FTMS only if the FTMS bike driver was already chosen |
| Tacx Neo / Flux | FE-C over BLE (`6e40fec1-...`) | yes | `tacxneo2` driver unless name-routed elsewhere |
| Elite (Suito, Direto, Zumo, Tuo) | none needed | yes | FTMS |
| Saris H3 / Magnus | CPS + vendor | yes | FTMS with flags |
| Zwift Hub / Zwift Cog+Click on KICKR Core | Zwift protobuf service | yes | FTMS for telemetry; Zwift service for gears/grade when enabled |
| Echelon | vendor (`0bf669f1-...`) | no | vendor |
| Peloton Bike / Bike+ | serial / vendor | no (Bike+ has power broadcast only) | vendor |
| Schwinn IC4 / IC8 / 800IC | vendor | no (IC4 broadcasts CPS + CSC) | `schwinnic4bike` reads CPS; resistance is *not* controllable |
| Domyos (Decathlon) 2020+ | vendor `49535343-...` | yes on some | FTMS first, falls back to vendor if control point missing |
| iConsole+ / Toorx / JLL / Reebok | vendor `49535343-...` (iConsole) | some newer boards | vendor unless `toorx_ftms` |
| Yesoul S3/G1/M1/A6 | none | yes | FTMS |
| NordicTrack / ProForm iFit (S22i etc.) | iFit BLE frames / ADB / WiFi | no | see `../treadmills/ifit.md` |
