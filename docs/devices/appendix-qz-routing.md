# Appendix: QZ's full routing ladder

Verbatim extraction of QZ's device-routing chain (`bluetooth::deviceDiscovered`), preserved for library builders who want to reproduce QZ's behaviour exactly. Line numbers refer to the QZ checkout used for this documentation set (September 2026). The first matching row wins. For the recommended identification approach see `identification.md`.


Source: `src/devices/bluetooth.cpp` (4891 lines). `deviceDiscovered` = lines 549-3086; `connectedAndDiscovered` = 3088-3727; `speedChanged`/`inclinationChanged` = 4857-4868. Settings defaults: `src/qzsettings.h` (bool/int in-class `static constexpr`) and `src/qzsettings.cpp` (QString). All line numbers below refer to this checkout.

Notation used in the matrix:
- `U^"X"` = `b.name().toUpper().startsWith("X")` (case-insensitive prefix).
- `^"X"` = `b.name().startsWith("X")` (case-SENSITIVE prefix).
- `=="X"` = exact match (`compare(...) == 0`, case-insensitive unless noted).
- `has(0x1826)` = `deviceHasService(b, FTMS)`; `has(0x1814)` = RSC service present in the advertisement's service-UUID list (lines 540-547; pure UUID-list scan, no GATT connect).
- `len==N` = `b.name().length() == N`.
- `dflt(ftms_bike)` = `ftms_bike.contains("Disabled")` i.e. the setting is still at its default. NOTE: this is a *global* guard: setting `ftms_bike` to ANY device name disables every branch guarded by `dflt(ftms_bike)` for ALL devices, not only for the named one.
- `!X` in the "Extra conditions" column where X is a driver pointer (e.g. `!ftmsBike`) means "that driver has not already been instantiated in this scan".
- `filter` = the `filter_device` check (see section 0).

## 0. Pre-chain gating (lines 549-830)

| Line | What happens |
|---|---|
| 551-666 | All settings loaded once per call (see table in section 3). |
| 556-557, 668-709 | "Accessory found" booleans: an accessory counts as found if its name setting starts with `"Disabled"` (default), or if `*Avaiable()` finds an exact-name match in the `devices` list (lines 362-528). `zwift_click`/`zwift_play` require **two** devices whose name starts with `"ZWIFT "` (416-427). `sram_axs_controller` needs `U^"SRAM "`; `thinkrider_controller` needs `U^"THINK VS"`/`U^"THINKRIDER"`; `cycplus_bc2_controller` needs `contains("BC2")` or Nordic UART svc `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; `fitmetria_fanfit_enable` needs `=="FITFAN-"` (sic, exact) or `U^"HEADWIND "`. `ss2k_peloton` forces the ftms-accessory flag true (696-698). `cadence_sensor_as_bike/treadmill`, `power_sensor_as_bike/treadmill` mark the sensor as "found" (they become the main device instead). |
| 711-727 | **iOS only**: if `bluetooth_lastdevice_name` starts with `IC BIKE` or `C7-` (upper) and equals `filter_device`, a `schwinnic4bike` is created immediately from the cached `bluetooth_lastdevice_address`, bypassing the scan (Schwinn IC4 iOS reconnect hack). |
| 729-751 | Manufacturer data dumped. **Android only**: nameless advert with `yesoulbike::manufacturerDataId` + matching payload is re-injected into `devices` under the name `"YESOUL"` (734-746). |
| 756-787 | Early returns: desktop waits for `homeformLoaded`; `onlyDiscover`; gym mode with no session device; Windows if a device already exists. |
| 789-792 | `searchDevices` = every configured accessory found **OR** `forceHeartBeltOffForTimeout`. The latter is set in `finished()` (295-305) when the scan timed out with accessories missing; so the first scan waits for all accessories before touching the main device. |
| 795-796 | `effectiveFilterDevice` = `gymModeSessionDevice` if set, else `filterDevice` (`filter_device` setting). |
| 810-813 | `filter` = true unless `filter_device` is non-empty and not starting with `"Disabled"`, in which case `filter = (name == filter_device, case-insensitive)`. Branches marked "no filter" below ignore this. |
| 815-829 | Helpers: `isConfiguredFtmsRowerDevice` = `ftms_rower` not default AND `name == ftms_rower` (CI); `isRI009R` = `upper.contains("RI009R")`; `isTrxAppGateUsbBikeTC` = `U^"TC"` && len==5 && chars 2..4 all digits. |

The chain is one `if / else if` ladder inside `for (b : devices)`; the **first** matching branch wins and the pointer guard (`!xxx`) makes each driver a singleton, so after a match the rest of the ladder is dead for that scan.

## 1. Routing matrix (in ladder order)

| # | Line | Advertised name pattern (verbatim, comparison) | Extra conditions | Driver class | Type | Notes |
|---|---|---|---|---|---|---|
| 1 | 831 | `^"M3"` (case-sens) | `m3ibike::isCorrectUnit(b)` (manufacturer-data check), `!m3iBike`, filter | `m3ibike` | bike | Keiser M3i. Only instantiates if `isCorrectUnit` passes; otherwise the ladder is NOT continued for this device (the `if` matched). |
| 2 | 848 | *(any name)* | `applewatch_fakedevice` setting true, `!fakeBike` | `fakebike` | bike | Virtual device; no filter. |
| 3 | 862 | *(any)* | `fakedevice_elliptical` | `fakeelliptical` | elliptical | no filter |
| 4 | 877 | *(any)* | `fakedevice_rower` | `fakerower` | rower | no filter |
| 5 | 891 | *(any)* | `fakedevice_treadmill` | `faketreadmill` | treadmill | no filter |
| 6 | 907 | *(any)* | `proformtdf4ip` non-empty | `proformwifibike` | bike | WiFi, not BLE |
| 7 | 922 | *(any)* | `proformtdf1ip` non-empty | `proformtelnetbike` | bike | telnet |
| 8 | 938 | *(any)* | `computrainer_serialport` non-empty | `computrainerbike` | bike | serial |
| 9 | 953 | *(any)* | `kettler_usb_serialport` non-empty | `kettlerusbbike` | bike | serial |
| 10 | 966 | *(any)* | `freebeat_serialport` non-empty | `freebeatbike` | bike | serial |
| 11 | 979 | *(any)* | `csafe_rower` non-empty | `csaferower` | rower | serial CSAFE |
| 12 | 993 | *(any)* | `waterrower_usb` true | `waterrowerusb` | rower | USB |
| 13 | 1005 | *(any)* | `csafe_elliptical_port` non-empty | `csafeelliptical` | elliptical | serial |
| 14 | 1022 | *(any)* | `antbike` true | `antbike` | bike | ANT+ USB stick (desktop) |
| 15 | 1035 | *(any)* | `android_antbike` true | `android_antbike` | bike | ANT+ via Android |
| 16 | 1048 | *(any)* | `proformtreadmillip` non-empty | `proformwifitreadmill` | treadmill | WiFi |
| 17 | 1063 | *(any)* | `nordictrack_2950_ip` non-empty | `nordictrackifitadbtreadmill` | treadmill | ADB/WiFi |
| 18 | 1076 | *(any)* | `tdf_10_ip` non-empty | `nordictrackifitadbbike` | bike | ADB |
| 19 | 1090 | *(any)* | `proform_elliptical_ip` non-empty | `nordictrackifitadbelliptical` | elliptical | ADB |
| 20 | 1104 | *(any)* | `proform_rower_ip` non-empty | `nordictrackifitadbrower` | rower | ADB |
| 21 | 1118 | (`cadence_sensor_as_bike` && `^cadence_sensor_name` case-sens) \|\| `U^"JOROTO-BK-"` \|\| (`U^"BGYM"` && len==8) | `!cscBike`, filter | `cscbike` | bike | Generic **CSC (0x1816) cadence sensor used as the bike**. No service-UUID check; purely name. |
| 22 | 1135 | `power_sensor_as_bike` && `^power_sensor_name` (case-sens) | `!powerBike`, filter | `stagesbike` (as `powerBike`) | bike | Generic **CPS (0x1818) power meter used as the bike**. |
| 23 | 1149 | (`power_sensor_as_treadmill` && `^power_sensor_name`) \|\| (`cadence_sensor_as_treadmill` && `^cadence_sensor_name`) \|\| (`U^"TREADMILL"` && has(0x1814)) \|\| (`U^"S10"` && has(0x1814)) \|\| `U^"NOHRD SPRINTBOK"` \|\| `U^"ZWIFT RUNPOD"` | `!powerTreadmill`, filter | `strydrunpowersensor` | treadmill | Generic **RSC (0x1814) foot pod / run power used as the treadmill** (Stryd, Zwift RunPod, NOHRD). |
| 24 | 1170 | `U^"DOMYOS-ROW"` | `!^"DomyosBridge"` (case-sens), `!domyosRower`, `dflt(ftms_rower)`, filter | `domyosrower` | rower | |
| 25 | 1187 | `^"Domyos-Bike"` (case-sens) | (`!has(0x1826)` \|\| `domyosbike_notfmts`), `!^"DomyosBridge"`, `!domyosBike`, `dflt(ftms_bike)`, filter | `domyosbike` | bike | Domyos bikes that ALSO advertise FTMS fall through to `ftmsbike` (#52 line 1955) unless `domyosbike_notfmts` is set. `domyosbike.cpp:754-761` writes `ftms_bike = name` if its proprietary service is missing; `ftmsbike.cpp:1800-1803` writes `domyosbike_notfmts = true` if FTMS is missing. |
| 26 | 1203 | (`U^"MRK-R11S-"` \|\| `U^"I-CONSOLE+"`) && `iconsole_rower` | `!trxappgateusbRower`, `dflt(ftms_bike)`, filter | `trxappgateusbrower` | rower | |
| 27 | 1221 | (`U^"FAL-SPORTS"` && `!toorx_bike`) \|\| (`U^"I-CONSOLE+"` && `iconsole_elliptical`) | `!trxappgateusbElliptical`, `dflt(ftms_bike)`, `dflt(ftms_elliptical)`, filter | `trxappgateusbelliptical` | elliptical | |
| 28 | 1239 | `^"Domyos-EL"` (case-sens) | `!domyos_elliptical_fmts`, `!^"DomyosBridge"`, `!domyosElliptical`, filter | `domyoselliptical` | elliptical | `domyoselliptical.cpp:564-571` sets `domyos_elliptical_fmts = true` when its service is missing, so next run goes to #29. |
| 29 | 1256 | `U^"YPOO-U3-"` \|\| `U^"SCH_590E"` \|\| `U^"SCH411/510E"` \|\| `U^"KETTLER "` \|\| `U^"MRK-E"` \|\| `U^"FEIER-EM-"` \|\| `U^"MX-AS "` \|\| (`^"Domyos-EL"` && `domyos_elliptical_fmts`) \|\| (`U^"SF-"` && `midRef(3).toInt() > 0`) \|\| `U^"MYELLIPTICAL "` \|\| `U^"CARDIOPOWER EEGO"` \|\| regex `^TRUE ELLIPTICAL \d{3,}$` (on upper) \|\| (`U^"E35"` && has(0x1826)) \|\| (`U^"E25"` && has(0x1826)) \|\| (`^"FS-"` case-sens && (`iconsole_elliptical` \|\| `gymstick_gx6_0_elliptical`)) \|\| `== ftms_elliptical` (CI) | `!ypooElliptical`, `!horizonTreadmill`, `dflt(ftms_bike)`, filter | `ypooelliptical` | elliptical | **This is the generic FTMS elliptical driver.** An unknown FTMS elliptical only lands here if the user sets `ftms_elliptical` to its exact name. |
| 30 | 1291 | `U^"NAUTILUS E"` \|\| `U^"NAUTILUS M"` \|\| `U^"NAUTILUS 616"` | `!nautilusElliptical`, filter | `nautiluselliptical` | elliptical | Comment: 616 is really a bike with elliptical characteristics. |
| 31 | 1310 | `U^"NAUTILUS B"` | `!nautilusBike`, filter | `nautilusbike` | bike | B628 |
| 32 | 1326 | `U^"I_FS"` | `!proformElliptical`, filter | `proformelliptical` | elliptical | |
| 33 | 1340 | `U^"I_EL"` | `!nordictrackElliptical`, filter | `nordictrackelliptical` | elliptical | |
| 34 | 1356 | `U^"I_VE"` | `!proformEllipticalTrainer`, filter | `proformellipticaltrainer` | elliptical | |
| 35 | 1372 | `U^"I_RW"` | `!proformRower`, filter | `proformrower` | rower | |
| 36 | 1386 | `U^"B01_"` | `dflt(ftms_bike)`, `!bhFitnessElliptical`, filter | `bhfitnesselliptical` | elliptical | |
| 37 | 1401 | `U^"E95S"` \|\| (`U^"E25"` && !has(0x1826)) \|\| (`U^"E35"` && !has(0x1826)) \|\| `U^"E55"` \|\| `U^"E95"` \|\| `U^"E98"` \|\| `U^"XG400"` \|\| `U^"E98S"` | `!soleElliptical`, `dflt(ftms_elliptical)`, filter | `soleelliptical` | elliptical | Sole ellipticals; E25/E35 with FTMS went to #29. |
| 38 | 1424 | `^"Domyos"` (case-sens) | `!^"DomyosBr"`, `!U^"DOMYOS-BIKE-"`, `!U^"DOMYOS-BIKING-"`, `name != ftms_treadmill` (CI), `!domyos && !domyosElliptical && !domyosBike && !domyosRower && !ftmsBike && !horizonTreadmill`, (`!has(0x1826)` \|\| `domyostreadmill_notfmts`), filter | `domyostreadmill` | treadmill | Catch-all for any other `Domyos*` name (treadmills, `Domyos-TC`). FTMS-advertising Domyos treadmills fall to #46 (`DOMYOS-TC` entry). `horizontreadmill.cpp:2366-2370` sets `domyostreadmill_notfmts = true` if it finds the Domyos service. |
| 39 | 1448 | `U^"KS-ST-K12PRO"` \|\| `U^"KS-R1AC"` \|\| `U^"KS-HC-R1AA"` \|\| `U^"KS-HC-R1AC"` \|\| `U^"KS-X21"` \|\| `U^"KS-HDSC-X21C"` \|\| `U^"KS-HDSY-X21C"` \|\| `U^"KS-NACH-X21C"` \|\| `U^"KS-NGCH-X21C"` \|\| `U^"KS-NACH-MXG"` \|\| `U^"KS-NGCH-G1C"` | `!kingsmithR2Treadmill`, filter | `kingsmithr2treadmill` | treadmill | KingSmith/Xiaomi WalkingPad R2/X21/X23/G1 |
| 40 | 1487 | `U^"R1 PRO"` \|\| `U^"KINGSMITH"` \|\| (`U^"DYNAMAX"` && `dflt(ftms_treadmill)`) \|\| `U^"WALKINGPAD"` \|\| `U^"KS-ST-A1P"` \|\| `U^"KS-SC-BLR2C"` \|\| `=="RE"` (upper) \|\| `U^"KS-H"` \|\| `U^"KS-F0"` \|\| `U^"KS-BLC"` \|\| `U^"KS-BLR"` | **excluded**: `U^"KS-HD-Z1D"` (FTMS, goes to #46); `!kingsmithR1ProTreadmill`, `!kingsmithR2Treadmill`, filter | `kingsmithr1protreadmill` | treadmill | `kingsmithr1protreadmill.cpp:488-495` writes `ftms_treadmill = name` if it finds FTMS but not the KingSmith service. Note `KS-H` prefix also swallows `KS-HC-*` not listed in #39. |
| 41 | 1524 | `U^"ZW-"` | `!shuaA5Treadmill`, `dflt(ftms_bike)`, filter | `shuaa5treadmill` | treadmill | |
| 42 | 1542 | (`U^"TRUE"` **minus** regex `^TRUE TREADMILL \d{3,}$`, `^TRUE ELLIPTICAL \d{3,}$`, `U^"TRUE 1000"`) \|\| `U^"ASSAULT TREADMILL "` \|\| (`U^"WDWAY"` && len==8) \|\| (`U^"TREADMILL"` && `!gem_module_inclination` && !has(0x1814) && !has(0x1826)) | `!trueTreadmill`, `dflt(ftms_treadmill)`, `!horizonTreadmill`, filter | `truetreadmill` | treadmill | Plain name `TREADMILL` is 3-way split: RSC -> #23, FTMS or gem -> #46, neither -> here. |
| 43 | 1571 | (`U^"F80"` && `sole_treadmill_inclination`) \|\| (`U^"F89"` && sole_incl) \|\| `U^"F65"` \|\| (`U^"TT8"` && !has(0x1826)) \|\| `U^"F63"` \|\| (`U^"ST90"` && !has(0x1826)) \|\| `U^"TRX7.5"` \|\| (`U^"S77"` && sole_incl) \|\| (`U^"F85"` && sole_incl) | `dflt(ftms_treadmill)`, `!soleF80`, filter | `solef80treadmill` | treadmill | Sole proprietary. With `sole_treadmill_inclination` false, F80/F85/F89/S77 go to #46 (FTMS). |
| 44 | 1604 | `U^"SPERAX_RM01"` \|\| `U^"SPERAX_RM-02"` | `!speraXTreadmill`, filter | `speraxtreadmill` | treadmill | (`SPERAX_RM-01` is in #46 instead) |
| 45 | 1624 | `U^"LF"` && (len==18 \|\| len==15) | `!lifefitnessTreadmill`, filter | `lifefitnesstreadmill` | treadmill | |
| 46 | 1649 | **Generic FTMS treadmill list**: `U^"HORIZON"`, `U^"HZ_T101-"`, `U^"HZ_7.0AT-"`, `U^"AFG SPORT"`, `U^"WLT2541"`, (`U^"TREADMILL"` && (`gem_module_inclination` \|\| has(0x1826))), `U^"T318_"`, (`U^"DK"` && len>=11 && `!toorx_bike`), `U^"T218_"`, `U^"TRX3500"`, `U^"JFTMPARAGON"`, `U^"PARAGON X"`, `U^"MX-TM "`, `U^"JFTM"`, `U^"CT800"`, `U^"TRX4500"`, `U^"MATRIXTF50"`, `U^"T01_"`, (`^"SW"` case-sens && len==14 && no `(`/`)` && has(0x1826)), (`U^"TF-"` && `horizon_treadmill_force_ftms`), ((`U^"TOORX"` \|\| `U^"I-CONSOLE+"`) && `!toorx_ftms` && `toorx_ftms_treadmill`), `== ftms_treadmill` (CI), (`U^"DOMYOS-TC"` && has(0x1826) && `!domyostreadmill_notfmts`), `U^"XT685"`, `U^"XT285"`, `U^"FITNESS"`, `U^"WELLFIT TM"`, `U^"XTERRA TR"`, `U^"T118_"`, `U^"TM4500"`, `U^"TM6500"`, `U^"RUNN "`, `U^"YS_T"`, `U^"YPOO-MINI PRO-"`, `U^"BFX_T"`, `U^"3G PRO "`, `U^"3G ELITE "`, `U^"AB300S-"`, `U^"TF04-"`, regex `^TRUE TREADMILL \d{3,}$`, (`U^"FIT-"` && `!U^"FIT-BK-"`), `U^"FIT-TM-"`, `U^"LJJ-"`, `U^"WLT-EP-"` (Flow elliptical!), `U^"TRUE 1000"`, `U^"SCHWINN 810"`, `U^"URTM"`, `U^"SCHWINN 510T"`, `U^"MRK-T"`, `U^"SF-T"`, `U^"KS-MC"`, `U^"FOCUS M3"`, `U^"ANPIUS-"`, `U^"SWALK LITE-"`, `U^"KICKR RUN"`, `U^"SPERAX_RM-01"`, (`U^"TP1"` && len==3), `U^"KS-HD-Z1D"`, `U^"KS-AP-"`, `U^"KS-NG-"`, `U^"KS-ESP-"`, (`U^"NOBLEPRO CONNECT"` && has(0x1826)), (`U^"TT8"` && has(0x1826)), (`U^"ST90"` && has(0x1826)), (`U^"XT485"` && has(0x1826)), `U^"MOBVOI TM"`, `U^"MOBVOI WMTP"`, `U^"TM4800-"`, `U^"TM55-"`, `U^"LB600"`, `U^"TUNTURI T60-"`, `U^"TUNTURI T90-"`, `U^"KETTLER TREADMILL"`, `U^"ASSAULTRUNNER"`, `U^"CITYSPORTS-LINKER"`, (`U^"CTM"` && len>=15 && `dflt(ftms_bike)`), (`U^"F85"`/`"S77"`/`"F89"`/`"F80"` && `!sole_treadmill_inclination`), `U^"ANPLUS-"`, `U^"RUN BT-"`, `U^"X-T"`, `U^"ToputureTP6"` (**bug**: upper name compared to mixed-case literal, never matches), `U^"TC-"`, `U^"TM XP_"`, `U^"THERUN  T15"` (two spaces), `U^"BODYCRAFT_"`, (`U^"WT"` && len==5 && `midRef(2).toInt()>0`) | `!horizonTreadmill`, filter. **No** `dflt(ftms_treadmill)` guard on this branch. | `horizontreadmill` | treadmill | **This is the generic FTMS treadmill driver** despite its name. An unknown FTMS treadmill reaches it only via `ftms_treadmill == name`, or via the plain `TREADMILL` prefix + FTMS UUID. Several drivers self-heal into it by writing `ftms_treadmill = name` when they see 0x1826 but not their own service: `fitshowtreadmill.cpp:302-304`, `eslinkertreadmill.cpp:332-334`, `kingsmithr1protreadmill.cpp:488-493`, `yesoulbike.cpp:320-325`. Note `KETTLER TREADMILL` is here but `KETTLER ` (with space) is in #29, so `KETTLER TREADMILL` is captured by #29 first. |
| 47 | 1771 | `U^"MYRUN "` \|\| `U^"MERACH-U3"` | `!technogymmyrunTreadmill` (and, non-iOS, `!technogymmyrunrfcommTreadmill`), filter | `technogymmyruntreadmill` (BLE) or, non-iOS with `technogym_myrun_treadmill_experimental`, `technogymmyruntreadmillrfcomm` (1790/1815) | treadmill | |
| 48 | 1838 | `U^"TACX "` \|\| `U^"THINK X"` \|\| `U^"THINK-"` \|\| `U^"THINK_"` \|\| `U^"53997-"` \|\| `U^"NOZA-ONE "` \|\| `U^"VANRYSEL-HT"` \|\| **bluetooth address `C1:14:D9:9C:FB:01`** \|\| `U^"TACX SMART BIKE"` | **excluded** `U^"TACX SATORI"` (goes to #58); `dflt(ftms_bike)`, `!tacxneo2Bike`, filter | `tacxneo2` | bike | **Tacx / FE-C-over-BLE fallback**. `tacxneo2.cpp:33-37` writes `ftms_bike = name` if the Tacx custom service is missing, so next run it becomes an `ftmsbike`. |
| 49 | 1862 | `U^"XCX-"` | `!xcxBike`, filter | `xcxbike` | bike | |
| 50 | 1872 | `U^"INDOORCYCLE"` \|\| (`U^"MAGNUS "` && !has(0x1826)) | `!cycleopsphantomBike`, filter | `cycleopsphantombike` | bike | CycleOps Phantom / Magnus (non-FTMS firmware) |
| 51 | 1887 | `U^">CABLE"` \|\| (`U^"MD"` && len==7) \|\| (`U^"BIKE"` && len==6 && `!(flywheel_life_fitness_ic8 \|\| life_fitness_ic5)` && `!technogym_bike`) | `!npeCableBike`, filter | `npecablebike` | bike | NPE Cable. `BIKE n` names are 3-way split by settings: default -> here; ic8/ic5 -> #95 `flywheelbike`; `technogym_bike` -> #54. |
| 52 | 1907 | **Generic FTMS bike list**: (`^"FS-"` case-sens && `hammer_racer_s`), (`U^"ICONSOLE+"` && `toorx_ftms`), (`U^"DI"` && len==2), `U^"DHZ-"`, `U^"MKSM"`, `U^"YS_C1_"`, `U^"YS_G1_"`, `U^"YS_M1P_"`, `U^"YS_G1MPLUS"`, `U^"YS_G1MMAX"`, `U^"YS_A"`, `U^"DS25-"`, `U^"3G CARDIO "`, `U^"ZWIFT HUB"`, (`U^"MAGNUS "` && has(0x1826)), (`U^"HAMMER "` && `!power_sensor_as_bike` && `!saris_trainer`), `U^"FLXCY-"`, `U^"QB-WC01"`, `U^"XBR55"`, `U^"ECHO_BIKE_"`, `U^"EW-JS-"`, (`U^"DT-"` && len>=14), (`U^"YSV"` && len==9), (`U^"URSB"` && len==7), (`U^"DBF"` && len==6), (`U^"KSU"` && len==7), (`U^ftms_accessory_name.toUpper()` && `ss2k_peloton`), `U^"MERACH-MR667-"`, `U^"DS60-"`, `U^"BIKE-"`, `U^"M9-"`, `U^"SPAX-BK-"`, `U^"YSV1"`, (`U^"VOLT"` && len==4), `U^"VICTORY"`, `U^"CECOTEC"`, `U^"WATTBIKE"`, `U^"ZYCLEZBIKE"`, `U^"ZBIKE2.0"`, `U^"WAVEFIT-"`, `U^"KETTLERBLE"`, `U^"JAS_C3"`, `U^"SCH_190U"`, `U^"SCH_290R"`, `U^"RAVE WHITE"`, `U^"DOMYOS-BIKING-"`, (`^"Domyos-Bike"` && has(0x1826) && `!domyosbike_notfmts`), (`U^"F"` && upper endsWith `"ARROW"`), (`U^"ICSE"` && len==4), (`U^"TUO"` && len==3), (`U^"FLX"` && len==10), (`U^"CSRB"` && len==11), `U^"DU30-"`, `U^"BIKZU_"`, `U^"WLT8828"`, `U^"HARISON-X15"`, `U^"FEIVON V2"`, `U^"FELVON V2"`, `U^"JUSTO"`, `U^"MYCYCLE "`, `U^"T2 "`, `=="S18"` (CI), `U^"RC-MAX-"`, `U^"TPS-SPBIKE-2.0"`, `U^"NEO BIKE SMART"`, `U^"ZDRIVE"`, `U^"TUNTURI E60-"`, `U^"TUNTURI F40-"`, `U^"JFBK5.0"`, `U^"NEO 3M "`, `U^"JFBK7.0"`, `U^"SPEED RACE S"`, `U^"SPEEDRACEX"`, `U^"POOBOO"`, `U^"ZYCLE ZPRO"`, `U^"SM720I"`, `U^"H9115 LYON"`, `U^"AVANTI"`, `U^"T300P_"`, `U^"T200_"`, `U^"BZ9110 "`, (`U^"CFC"` && len==14), `U^"TITAN 7000"`, `U^"LYDSTO"`, `U^"CYCLO_"`, `U^"SL010-"`, `U^"EXPERT-SX9"`, `U^"MRK-S26S-"`, `U^"MRK-S26C-"`, `U^"MRK-S28-"`, `U^"MRK-S38-"`, `U^"ROBX"`, `U^"ORLAUF_ARES"`, `U^"SPEEDMAGPRO"`, `U^"SMARTBIKE-"`, `U^"TX-500MB IRON"`, `U^"D500V2"`, `U^"FBIKE-HEAVY-PRO"`, `U^"NEO BIKE PLUS "`, (`U^"PM5"` && !endsWith `"SKI"` && !endsWith `"ROW"`), (`U^"L-"` && len==11), (`U^"DMASUN-"` && endsWith `"-BIKE"`), `U^"FIT-BK-"`, `U^"VFSPINBIKE"`, `U^"RIVO COG"`, `U^"RAVE"`, `U^"TOPUTURE-"`, `U^"TOPUTURE TEB"`, `U^"BESP-"`, (`U^"GLT"` && has(0x1826)), (`U^"SPORT01-"` && has(0x1826)), `U^"FS-YK-"`, `U^"T600E_"`, `U^"SPEEDBIKE S2"`, `U^"B56-"`, (`U^"HT"` && len==10 && `!dflt(ftms_bike)`), `U^"ZUMO"`, `U^"XS08-"`, `U^"B94"`, `U^"STAGES BIKE"`, `U^"SUITO"`, `U^"D2RIDE"`, `U^"DIRETO X"`, `U^"MERACH-667-"`, `U^"USDC-D700-"`, `U^"RCR-"`, **`== ftms_bike` (CI)**, `U^"SMB1"`, `U^"UBIKE FTMS"`, `U^"INRIDE"`, `U^"INCONDI"`, (`U^"YPBM"` && len==10), regex `^XQ\d{10}$` (CI) | **excluded**: regex `^ADIDAS\d{4,}$` (CI) (goes to #104); `dflt(ftms_rower)`; `!ftmsBike && !ftmsRower && !snodeBike && !fitPlusBike && !stagesBike`; filter | `ftmsbike` | bike | **This is the generic FTMS bike driver.** An unknown FTMS bike reaches it only if the user sets `ftms_bike` to its exact name; there is NO "advertises 0x1826 therefore ftmsbike" rule. Note the `dflt(ftms_rower)` guard: configuring an FTMS rower name disables this whole branch. Self-healing writers into `ftms_bike`: `fitplusbike.cpp:990-992`, `wahookickrsnapbike.cpp:891-893` (Zwift svc but no Wahoo svc), `tacxneo2.cpp:33-36`, `domyosbike.cpp:754-759`. `ftmsbike.cpp:1804-1807` writes `ftms_rower = name` if a `PM5` has no FTMS. |
| 53 | 2053 | `U^"KICKR SNAP"` \|\| `U^"KICKR BIKE"` \|\| `U^"KICKR ROLLR"` \|\| `U^"KICKR CORE"` \|\| `U^"KICKR MOVE "` \|\| `U^"HOI FRAME "` \|\| (`U^"HAMMER "` && `saris_trainer`) \|\| `U^"WAHOO KICKR"` | `!wahooKickrSnapBike`, `!ftmsBike`, filter | `wahookickrsnapbike` | bike | **Wahoo proprietary fallback**. `KICKR RUN` is caught earlier by #46. Plain `KICKR` (no suffix) is NOT matched here. |
| 54 | 2072 | (`U^"BIKE "` && `!(ic8 \|\| ic5)` && `technogym_bike` && `midRef(5).toInt() > 0`) \|\| `U^"MYCYCLING"` | `!technogymBike`, filter | `technogymbike` | bike | |
| 55 | 2086 | `U^"JFIC"` | `!horizonGr7Bike`, filter | `horizongr7bike` | bike | Horizon GR7 |
| 56 | 2100 | `U^"SMART CONTROL"` | `!kineticInroadBike`, filter | `kineticinroadbike` | bike | Kinetic inRide |
| 57 | 2114 | `U^"ERGO C12"` \|\| `U^"KETTLER C12"` | `!kettlerC12Bike`, filter | `kettlerc12bike` | bike | |
| 58 | 2127 | `U^"STAGES "` \|\| `U^"TACX SATORI"` \|\| `U^"RACER S"` \|\| (`U^"KU"` && len==2) \|\| `U^"ELITETRAINER"` \|\| `U^"MISURO B+"` \|\| `U^"TOUR 600"` \|\| `U^"SMART+ #"` \|\| (`U^"QD"` && len==2) \|\| (`U^"RM"` && len==2) \|\| (`U^"DR"` && len==2) \|\| (`U^"DFC"` && len==3) \|\| (`U^"THINK A"` && len==18) \|\| (`U^"ASSIOMA"` && `power_sensor_name` starts with `"Disabled"`) | `!stagesBike`, `!ftmsBike`, filter | `stagesbike` | bike | **Generic CPS (0x1818) power-meter-as-bike fallback by name** (Stages, Elite Misuro, Favero Assioma, Tacx Satori...). No service UUID check. |
| 59 | 2155 | `U^"SMARTROW"` | `!U^"SMARTROWER"`, `dflt(ftms_rower)`, `!smartrowRower`, filter | `smartrowrower` | rower | |
| 60 | 2170 | `U^"PM5"` && upper endsWith `"SKI"` | `!concept2Skierg`, filter | `concept2skierg` | other (ski erg) | Concept2 SkiErg |
| 61 | 2186 | `U^"MRK-R28-"` | `!fitPlusRower`, filter | `fitplusrower` | rower | |
| 62 | 2199 | **Generic FTMS rower list**: `U^"CR 00"`, `U^"KAYAKPRO"`, `U^"WHIPR"`, `U^"H-181-"`, `U^"S4 COMMS"`, `U^"KS-WLT"`, `U^"I-ROWER"`, `U^"MRK-CRYDN-"`, `U^"MRK-R06-"`, `U^"MRK-R15-"`, (`U^"MRK-R11S-"` && `!iconsole_rower`), `U^"YOROTO-RW-"`, `U^"SF-RW"`, `U^"SMARTROWER"`, `U^"NORDLYS"`, `U^"ROWER "`, `U^"COACH 2"`, `U^"ROGUE CONSOLE "`, `U^"DFIT-L-R"`, **`== ftms_rower` (CI)**, (`U^"PM5"` && endsWith `"ROW"`) | `!ftmsRower`, filter | `ftmsrower` | rower | **This is the generic FTMS rower driver.** Unknown FTMS rower reaches it only via `ftms_rower == name`. Note: `PM5` without SKI/ROW suffix is treated as a BIKE (#52) until `ftmsbike` self-corrects `ftms_rower`. |
| 63 | 2234 | `U^"ECH-EC-SPT"` | `!echelonStairclimber`, filter | `echelonstairclimber` | other (stair climber) | |
| 64 | 2249 | `U^"SF-S"` | `!sunnyfitStepper`, filter | `sunnyfitstepper` | other (stepper) | Note `SF-` + digits went to #29 and `SF-T` to #46, `SF-RW` to #62. |
| 65 | 2262 | `U^"ECH-STRIDE"` \|\| `U^"ECH-UK-"` \|\| `U^"ECH-FR-"` \|\| `U^"STRIDE"` \|\| `U^"STRIDE6S-"` \|\| `U^"ECH-SD-SPT"` | `!echelonStride`, `!echelonStairclimber`, filter | `echelonstride` | treadmill | |
| 66 | 2282 | `U^"Q37"` | `!octaneElliptical`, filter | `octaneelliptical` | elliptical | |
| 67 | 2296 | `U^"ZR7"` \|\| `U^"ZR8"` | `!octaneTreadmill`, filter | `octanetreadmill` | treadmill | |
| 68 | 2312 | `U^"RZ_TREADMIL"` | `!ziproTreadmill`, filter | `ziprotreadmill` | treadmill | |
| 69 | 2326 | `U^"LIFESPAN"` && `lifespan_bike` | `!lifespanBike`, filter | `lifespanbike` | bike | |
| 70 | 2339 | `U^"LIFESPAN"` && `!lifespan_bike` | `!lifespanTreadmill`, filter | `lifespantreadmill` | treadmill | |
| 71 | 2355 | `U^"ECH-ROW"` \|\| `U^"ROWSPORT"` \|\| `U^"ROW-7S-"` \|\| `U^"ROW-S"` | `!echelonRower`, filter | `echelonrower` | rower | |
| 72 | 2374 | `^"ECH"` (case-sens) | `!echelonRower && !echelonStride && !echelonStairclimber && !ftmsBike && !echelonConnectSport`, filter | `echelonconnectsport` | bike | Catch-all for remaining Echelon names. |
| 73 | 2391 | `U^"WLT8266BM"` | `!apexBike`, filter | `apexbike` | bike | |
| 74 | 2400 | `U^"XQ"` && len==12 | `!volavaBike`, filter | `volavabike` | bike | `XQ` + exactly 10 digits goes to #52 first. |
| 75 | 2409 | `U^"BKOOLSMARTPRO"` \|\| `U^"BKOOLFBIKE"` \|\| `U^"BKOOLFITNESSBIKE"` | `!bkoolBike`, filter | `bkoolbike` | bike | |
| 76 | 2421 | `U^"MEPANEL"` | `!mepanelBike`, filter | `mepanelbike` | bike | |
| 77 | 2432 | `U^"SCHWINN 170/270"` | `!schwinn170Bike`, filter | `schwinn170bike` | bike | |
| 78 | 2449 | `U^"IC BIKE"` \|\| (`U^"C7-"` && len!=17) \|\| `U^"C9/C10"` | `!schwinnIC4Bike`, filter | `schwinnic4bike` | bike | Schwinn IC4/IC8, Bowflex C6/C7 |
| 79 | 2467 | `U^"EW-BK"` \|\| (`U^"AF"` && len==7) | `!sportsTechBike`, filter | `sportstechbike` | bike | |
| 80 | 2485 | `U^"EW-EP-"` | `!sportsTechElliptical`, `!horizonTreadmill`, filter | `sportstechelliptical` | elliptical | |
| 81 | 2501 | `U^"EW-ST-"` | `!sportsTechRower`, filter | `sportstechrower` | rower | |
| 82 | 2512 | `U^"CARDIOFIT"` \|\| (`U^"HT"` && len==10 && `dflt(ftms_bike)`) \|\| (upper `contains("CARE")` && len==11) | `!sportsPlusBike`, filter | `sportsplusbike` | bike | `HT` len 10 with non-default `ftms_bike` went to #52. |
| 83 | 2532 | (upper `contains("CARE")` && len>=12) \|\| `U^"VMAX"` | `!sportsPlusRower`, filter | `sportsplusrower` | rower | |
| 84 | 2549 | `^"YESOUL"` (case-sens, `yesoulbike::bluetoothName`) \|\| `U^"YS_G1M_"` | `!yesoulBike`, filter, `name != ftms_treadmill` (CI), `name != ftms_bike` (CI) | `yesoulbike` | bike | `yesoulbike.cpp:320-325` writes `ftms_treadmill = name` when name is exactly `YESOUL` and FTMS exists (Yesoul treadmills share the name). |
| 85 | 2566 | `^"I_EB"` (case-sens) \|\| `^"I_SB"` (case-sens) \|\| upper `contains("_IFIT_BIKE")` | `!proformBike`, filter | `proformbike` | bike | |
| 86 | 2583 | `^"I_TL"` \|\| `^"I_IT"` (case-sens) \|\| upper `contains("_IFIT TREADMILL")` | `!proformTreadmill`, filter | `proformtreadmill` | treadmill | |
| 87 | 2600 | `U^"ESANGLINKER"` \|\| `U^"ESLINKER"` | `!eslinkerTreadmill`, filter | `eslinkertreadmill` | treadmill | self-heals to `ftms_treadmill` (332-334) |
| 88 | 2616 | `U^"PITPAT-T"` | `!deerrunTreadmill`, filter | `deerruntreadmill` | treadmill | |
| 89 | 2631 | `U^"PAFERS_"` | `!pafersTreadmill`, (`pafers_treadmill` \|\| `pafers_treadmill_bh_iboxster_plus`), filter | `paferstreadmill` | treadmill | default (both false) -> #110 `pafersbike` |
| 90 | 2649 | `U^"MOXY6"` | `!moxy5Sensor`; **no filter** | `moxy5sensor` | other (SmO2 sensor) | Instantiated as a main device slot but it's a sensor. |
| 91 | 2654 | `U^"CORE "` | `!coreSensor`; **no filter** | `coresensor` | other (core temp sensor) | |
| 92 | 2662 | `U^"BOWFLEX T"` | `!bowflexT216Treadmill`, filter | `bowflext216treadmill` | treadmill | |
| 93 | 2677 | `U^"CROSSROPE"` | `!crossRope`, filter | `crossrope` | other (jump rope) | |
| 94 | 2692 | `U^"NAUTILUS T"` | `!nautilusTreadmill`, filter | `nautilustreadmill` | treadmill | |
| 95 | 2707 | `^"Flywheel"` (case-sens) \|\| (`U^"BIKE"` && len==6 && (`flywheel_life_fitness_ic8` \|\| `life_fitness_ic5`)) | `!flywheelBike`, filter | `flywheelbike` | bike | |
| 96 | 2726 | `U^"MCF-"` | `!mcfBike`, filter | `mcfbike` | bike | |
| 97 | 2740 | `U^"ICONSOLE+"` && `trx_route_key` | `!iconsole`; **no filter** | `iconsolebike` | bike | |
| 98 | 2749 | `^"TRX ROUTE KEY"` (case-sens) \|\| `U^"MASTERT40-"` \|\| `U^"BH DUALKIT TREAD"` \|\| `U^"TF-T"` \|\| `U^"BH-TR-"` | `!toorx`, filter | `toorxtreadmill` | treadmill | Classic-BT RFCOMM driver. |
| 99 | 2763 | (`U^"BH DUALKIT"` && `!U^"BH DUALKIT TREAD"`) \|\| `U^"BH-"` | `!iConceptBike`, `!toorx`, `!iconcept_elliptical`, `!iconsole`, filter | `iconceptbike` | bike | RFCOMM |
| 100 | 2776 | `U^"BH DUALKIT"` && `iconcept_elliptical` | `!iConceptElliptical`, `!iconsole`, filter | `iconceptelliptical` | elliptical | RFCOMM |
| 101 | 2789 | `U^"XT385"` \|\| (`U^"XT485"` && !has(0x1826)) \|\| `U^"XT800"` \|\| `U^"XT900"` | `!spiritTreadmill`, `!horizonTreadmill`, filter | `spirittreadmill` | treadmill | |
| 102 | 2805 | `U^"RUNNERT"` | `!activioTreadmill`, filter | `activiotreadmill` | treadmill | |
| 103 | 2816 | `^"TOORX"` (case-sens) \|\| `^"V-RUN"` (case-sens) \|\| `U^"K80_"` \|\| `U^"I-CONSOLE+"` \|\| `U^"ICONSOLE+"` \|\| `U^"I-RUNNING"` \|\| `U^"DKN RUN"` \|\| `U^"ADIDAS "` \|\| `U^"REEBOK"` | `!trxappgateusb && !trxappgateusbBike`, `!toorx_bike && !toorx_ftms && !toorx_ftms_treadmill && !iconsole_elliptical && !iconsole_rower`, `dflt(ftms_elliptical)`, `dflt(ftms_bike)`, filter | `trxappgateusbtreadmill` | treadmill | The Toorx/i-Console family default is TREADMILL; `toorx_bike` (or any of its aliases) flips it to #104, `toorx_ftms` to #109 `renphobike`/#52, `toorx_ftms_treadmill` to #46, `iconsole_elliptical` to #27, `iconsole_rower` to #26, `trx_route_key` to #97. |
| 104 | 2838 | `isTrxAppGateUsbBikeTC` (`TC`+3 digits) \|\| `U^"TUN "` \|\| `U^"FITHIWAY"` \|\| `U^"FIT HI WAY"` \|\| `U^"BIKZU_"` \|\| `U^"PASYOU-"` \|\| `U^"VIRTUFIT"` \|\| `U^"IBIKING+"` \|\| `isRI009R` (contains) \|\| regex `^ADIDAS\d{4,}$` (CI) \|\| ((`^"TOORX"` case-sens \|\| `U^"I-CONSOIE+"` \|\| `U^"I-CONSOLE+"` \|\| `U^"ICONSOLE+"` \|\| `U^"VIFHTR2.1"` \|\| `U^"REEBOK"` \|\| upper `contains("CR011R")` \|\| (`U^"FAL-SPORTS"` && `toorx_bike`) \|\| `U^"DKN MOTION"`) && `toorx_bike`) | `!trxappgateusb`, `!toorx_ftms`, `!toorx_ftms_treadmill`, `!trxappgateusbBike`, `!isConfiguredFtmsRowerDevice`, (`filter` \|\| `isRI009R`), `!iconsole_elliptical`, `!iconsole_rower`, `dflt(ftms_elliptical)`, `!cadence_sensor_as_bike` | `trxappgateusbbike` | bike | `BIKZU_` is listed here but #52 catches it first. |
| 105 | 2872 | `U^"X-BIKE"` | `!ultraSportBike`, filter | `ultrasportbike` | bike | |
| 106 | 2884 | `U^"KEEP_BIKE_"` \|\| `U^"KEEP_CC_"` | `!keepBike`, filter | `keepbike` | bike | |
| 107 | 2895 | `U^"LCB"` \|\| `U^"LCR"` \|\| `U^"R92"` | `dflt(ftms_bike)`, `!soleBike`, filter | `solebike` | bike | |
| 108 | 2908 | `U^"BFCP"` \|\| (`U^"HT"` && (len==11 \|\| len==12)) | `!skandikaWiriBike`, filter | `skandikawiribike` | bike | |
| 109 | 2922 | (`U^"RQ"` && len==5) \|\| (`U^"R-Q"` && len>6 && `!power_sensor_as_bike`) \|\| `U^"SCH130"` \|\| (`^"TOORX"` case-sens && `toorx_ftms` && `!toorx_ftms_treadmill`) | `!renphoBike && !snodeBike && !fitPlusBike`, filter | `renphobike` | bike | Renpho; also an FTMS-style driver used for Toorx FTMS bikes. |
| 110 | 2936 | `U^"PAFERS_"` | `!pafersBike`, `!pafers_treadmill`, filter | `pafersbike` | bike | |
| 111 | 2947 | (`^"FS-"` case-sens && `snode_bike`) \|\| (`U^"TF-"` && `!U^"TF-T"` && `!horizon_treadmill_force_ftms`) | `!snodeBike && !ftmsBike && !fitPlusBike`, filter | `snodebike` | bike | `TF-` default is a Snode bike; `horizon_treadmill_force_ftms` sends it to #46. |
| 112 | 2961 | (`^"FS-"` case-sens && `fitplus_bike`) \|\| `^"X100-"` (case-sens) \|\| `U^"H9110 OSAKA"` \|\| `^"MRK-"` (case-sens) | `!fitPlusBike && !ftmsBike && !ftmsRower && !snodeBike && !horizonTreadmill && !trxappgateusbRower`, filter | `fitplusbike` | bike | Catch-all for remaining `MRK-*` (Merach) names. Self-heals to `ftms_bike` (990-992). |
| 113 | 2978 | `U^"EW-TM-"` | `!focusTreadmill`, filter | `focustreadmill` | treadmill | |
| 114 | 2992 | (`^"FS-"` case-sens && `!horizonTreadmill && !snode_bike && !fitplus_bike && !ftmsBike && !iconsole_elliptical`) \|\| `U^"TR510-T"` \|\| (`U^"NOBLEPRO CONNECT"` && !has(0x1826)) \|\| (`^"SW"` case-sens && len==14 && no parens && !has(0x1826)) \|\| (`^"SW"` && len==15 && `indexOf('-')==10`) \|\| `U^"WINFITA"` \|\| `U^"TUNTURI T80-"` \|\| `U^"SW-BLE"` \|\| `^"BF70"` (case-sens) | `!fitshowTreadmill && !ftmsRower && !isConfiguredFtmsRowerDevice && !iconsole_elliptical && !horizonTreadmill`, filter | `fitshowtreadmill` | treadmill | **`FS-` default = FitShow treadmill.** The `FS-` prefix is routed 6 ways by settings: `iconsole_elliptical`/`gymstick_gx6_0_elliptical` -> #29, `hammer_racer_s` -> #52, `snode_bike` -> #111, `fitplus_bike` -> #112, `FS-YK-` -> #52, else here. Self-heals to `ftms_treadmill` (302-304). |
| 115 | 3017 | `U^"IC"` && len==8 | `!inspireBike`, filter | `inspirebike` | bike | (`IC BIKE` is len 7 so it stays in #78) |
| 116 | 3040 | `U^"CHRONO "` | `!chronoBike`, filter | `chronobike` | bike | |
| 117 | 3061 | `U^"PITPAT-S"` | `!pitpatBike`, filter | `pitpatbike` | bike | Last branch; anything unmatched is simply ignored (no generic fallback). |

Count: 117 ladder branches (plus the pre-chain iOS Schwinn and Android Yesoul specials), covering ~330 distinct name patterns.

## 2. How QZ decides the *type* of an unknown FTMS (0x1826) device

There is **no generic "has FTMS -> pick driver by FTMS characteristic" rule** anywhere in `deviceDiscovered`. Type is decided entirely by:

1. **Hard-coded name prefix lists** (above). The four "generic" FTMS drivers are just the branches with the longest lists:
   - bike -> `ftmsbike` (#52, line 1907)
   - treadmill -> `horizontreadmill` (#46, line 1649)
   - rower -> `ftmsrower` (#62, line 2199)
   - elliptical -> `ypooelliptical` (#29, line 1256)
2. **User "exact name" settings**, each of which is an entry in the corresponding list: `ftms_bike` (1932), `ftms_treadmill` (1675), `ftms_rower` (2218), `ftms_elliptical` (1275). Compare is `!b.name().compare(setting, Qt::CaseInsensitive)` = exact CI match. These are the only path for a never-seen FTMS device.
3. `deviceHasService(b, 0x1826)` is used **only as a tiebreaker** for ambiguous prefixes shared by proprietary and FTMS firmware: `Domyos-Bike`, `DOMYOS-TC`/`Domyos*`, `E25`, `E35`, `TT8`, `ST90`, `XT485`, `TREADMILL`, `SW` (14 chars), `NOBLEPRO CONNECT`, `MAGNUS `, `GLT`, `SPORT01-`. `0x1814` (RSC) tiebreaks `TREADMILL`/`S10` toward `strydrunpowersensor`. No branch checks 0x1818 (CPS) or 0x1816 (CSC).
4. **Driver-side self-correction**: when a proprietary driver connects and discovers it lacks its own service but sees 0x1826 (or vice versa), it writes the device name into `ftms_bike` / `ftms_treadmill` / `ftms_rower`, or flips `domyosbike_notfmts` / `domyostreadmill_notfmts` / `domyos_elliptical_fmts`, toasts "restart QZ", and the *next* scan routes it differently (writers listed in the Notes column of #25, #28, #38, #40, #46, #48, #52, #62, #84, #87, #112, #114).
5. **Side-effect of the `dflt(ftms_*)` guards**: because the guards test `contains("Disabled")` rather than name equality, setting `ftms_bike` to any name disables branches #25, #26, #27, #29, #36, #41, #48, #82(HT), #103, #107 and the `CTM` entry in #46 for *every* device; `ftms_rower` non-default disables #24, #52 (the whole ftmsbike branch!), #59; `ftms_treadmill` non-default disables `DYNAMAX` in #40, #42, #43; `ftms_elliptical` non-default disables #27, #37, #103, #104.

Other protocol fallbacks (all name-based):
- **FE-C / Tacx**: `tacxneo2` (#48) by `TACX `, `THINK X/-/_`, `53997-`, `NOZA-ONE `, `VANRYSEL-HT`, `TACX SMART BIKE`, or the hard-coded MAC `C1:14:D9:9C:FB:01`; `TACX SATORI` excluded -> `stagesbike`.
- **Wahoo**: `wahookickrsnapbike` (#53) by `KICKR SNAP/BIKE/ROLLR/CORE/MOVE `, `HOI FRAME `, `WAHOO KICKR`, `HAMMER ` + `saris_trainer`. `KICKR RUN` -> `horizontreadmill`.
- **CPS power meter as bike**: `stagesbike` via #22 (user-named `power_sensor_name` + `power_sensor_as_bike`) or #58 (name list).
- **CSC cadence as bike**: `cscbike` via #21 (`cadence_sensor_name` + `cadence_sensor_as_bike`, `JOROTO-BK-`, `BGYM`).
- **RSC as treadmill**: `strydrunpowersensor` via #23.
- **ANT+**: `antbike` (#14, desktop USB) / `android_antbike` (#15) as main device; ANT+ HR/cadence as accessories via `ant_heart`/`ant_cadence` on Android (3654-3672).

## 3. Settings keys referenced in `deviceDiscovered` / `connectedAndDiscovered`

Defaults from `src/qzsettings.h` (`static constexpr bool/int`) and `src/qzsettings.cpp` (`const QString`). `"Disabled"` is the sentinel meaning "not configured" for all name-type keys.

| Key | Default | Effect on routing |
|---|---|---|
| `filter_device` | `"Disabled"` | If set, only a device whose name equals it (CI) may become the main device (810-813). |
| `gym_mode` | false | If on and no session device selected, discovery does nothing (764). |
| `ftms_bike` | `"Disabled"` | Exact name -> `ftmsbike`; any non-default value also disables ~10 proprietary branches (see section 2.5). |
| `ftms_treadmill` | `"Disabled"` | Exact name -> `horizontreadmill`; excludes that name from `domyostreadmill` (1427) and `yesoulbike` (2551); non-default disables `truetreadmill`, `solef80treadmill`, `DYNAMAX`. |
| `ftms_rower` | `"Disabled"` | Exact name -> `ftmsrower`; non-default disables `domyosrower`, **`ftmsbike`**, `smartrowrower`, and `trxappgateusbbike`/`fitshowtreadmill` for that name. |
| `ftms_elliptical` | `"Disabled"` | Exact name -> `ypooelliptical`; non-default disables `trxappgateusbelliptical`, `soleelliptical`, `trxappgateusbtreadmill`, `trxappgateusbbike`. |
| `ftms_accessory_name` | `"Disabled"` | SmartSpin2k name (accessory); with `ss2k_peloton` its prefix instead routes the *main* device to `ftmsbike` (1933). |
| `ss2k_peloton` | false | SS2K on a Peloton: skips accessory wait, makes SS2K the main FTMS bike, suppresses `smartspin2k` accessory attach (3195). |
| `heart_rate_belt_name` | `"Disabled"` | HR belt name; discovery waits for it (accessory gate); attached in `connectedAndDiscovered`. |
| `hrm_lastdevice_name` / `hrm_lastdevice_address` | `""` | Cached HRM for iOS reconnect (`ios_cache_heart_device`, default **true**). |
| `cadence_sensor_name` | `"Disabled"` | CSC name; accessory unless `cadence_sensor_as_bike` / `cadence_sensor_as_treadmill` (both false) make it the main device (#21/#23). |
| `power_sensor_name` | `"Disabled"` | CPS name; accessory unless `power_sensor_as_bike` / `power_sensor_as_treadmill` (false) make it main (#22/#23). Also gates `ASSIOMA` in #58 and `HAMMER ` in #52. |
| `elite_rizer_name` / `elite_sterzo_smart_name` | `"Disabled"` | Steering/inclination accessories (prefix match). `*_address`, `*_lastdevice_name` (`""`) are written on attach. |
| `csc_sensor_address`, `power_sensor_address`, `ftms_accessory_address` (+ `_lastdevice_name`) | `""` | Written on accessory attach for reconnect. |
| `bluetooth_lastdevice_name` / `bluetooth_lastdevice_address` | `""` | Last main device; used by the iOS Schwinn shortcut (711-727) and re-emitted at 3714-3722. |
| `zwift_click` | false | Wait for >=2 `ZWIFT ` devices; attach `ZWIFT CLICK` (v1 or v2 pair) as gear controller (BIKE only). |
| `zwift_play` | false | Same wait; attach `ZWIFT PLAY`/`ZWIFT RIDE`/`ZWIFT SF2` pair and Elite `SQUARE` (BIKE only). |
| `zwiftplay_swap` | false | Swap which Play half drives gear feedback. |
| `sram_axs_controller` | false | Wait for + attach `SRAM ` shifter (BIKE only). |
| `thinkrider_controller` | false | Wait for + attach `THINK VS`/`THINKRIDER` shifter. |
| `cycplus_bc2_controller` | false | Wait for + attach `BC2` / Nordic-UART device as shifter. |
| `fitmetria_fanfit_enable` | false | Wait for + attach fans (`FITFAN-`, `HEADWIND `, `ARIA`). |
| `applewatch_fakedevice`, `fakedevice_elliptical`, `fakedevice_rower`, `fakedevice_treadmill` | false | Virtual main device of that type (#2-#5), takes precedence over every BLE branch. |
| `proformtdf4ip`, `proformtdf1ip`, `proformtreadmillip`, `nordictrack_2950_ip`, `tdf_10_ip`, `proform_elliptical_ip`, `proform_rower_ip` | `""` | Non-empty -> WiFi/ADB driver of that type (#6, #7, #16-#20). |
| `computrainer_serialport`, `kettler_usb_serialport`, `freebeat_serialport`, `csafe_rower`, `csafe_elliptical_port` | `""` | Non-empty -> serial driver (#8-#11, #13). |
| `waterrower_usb` | false | -> `waterrowerusb` (#12). |
| `antbike` / `android_antbike` | false | ANT+ trainer as main bike (#14/#15). `android_antbike` also starts the Android ANT service. |
| `ant_cadence`, `ant_heart`, `ant_garmin` | false | Android ANT+ accessories (3657-3671). |
| `ant_bike_device_number`, `ant_heart_device_number` | 0 | ANT device IDs passed to `antStart`. |
| `technogym_group_cycle` | false | Passed to Android `antStart`. |
| `toorx_ftms` | false | Toorx/iConsole -> FTMS bike (`ICONSOLE+` -> #52; `TOORX` -> #109 `renphobike`); also forces `toorx_bike` false. |
| `toorx_ftms_treadmill` | false | `TOORX`/`I-CONSOLE+` -> `horizontreadmill` (#46). |
| `toorx_bike` (aliases OR'd in: `jll_IC400_bike`, `fytter_ri08_bike`, `asviva_bike`, `enerfit_SPX_9500`, `toorx_srx_3500`, `hop_sport_hs_090h_bike`, `toorx_bike_srx_500`, `hertz_xr_770`, `taurua_ic90`) | all false | Toorx family -> `trxappgateusbbike` (#104) instead of treadmill (#103); disables `DK` in #46 and `FAL-SPORTS` in #27. |
| `iconsole_elliptical` | false | `I-CONSOLE+`/`FS-` -> `trxappgateusbelliptical` (#27) / `ypooelliptical` (#29). |
| `iconsole_rower` | false | `I-CONSOLE+`/`MRK-R11S-` -> `trxappgateusbrower` (#26). |
| `trx_route_key` | false | `ICONSOLE+` -> `iconsolebike` (#97). |
| `iconcept_elliptical` | false | `BH DUALKIT` -> `iconceptelliptical` (#100) instead of `iconceptbike` (#99). |
| `bh_spada_2` | false | Read in `startDiscovery` (322) only; not in the ladder. |
| `snode_bike` | false | `FS-` -> `snodebike` (#111). |
| `fitplus_bike` (OR `virtufit_etappe`) | false | `FS-` -> `fitplusbike` (#112). |
| `hammer_racer_s` | false | `FS-` -> `ftmsbike` (#52). |
| `gymstick_gx6_0_elliptical` | false | `FS-` -> `ypooelliptical` (#29). |
| `flywheel_life_fitness_ic8`, `life_fitness_ic5` | false | `BIKE n` -> `flywheelbike` (#95) instead of `npecablebike` (#51). |
| `technogym_bike` | false | `BIKE n` -> `technogymbike` (#54). |
| `saris_trainer` | false | `HAMMER ` -> `wahookickrsnapbike` (#53) instead of `ftmsbike`. |
| `lifespan_bike` | false | `LIFESPAN` -> bike (#69) instead of treadmill (#70). |
| `pafers_treadmill`, `pafers_treadmill_bh_iboxster_plus` | false | `PAFERS_` -> treadmill (#89) instead of bike (#110). |
| `sole_treadmill_inclination` | false | `F80/F85/F89/S77` -> proprietary `solef80treadmill` (#43) instead of FTMS (#46). |
| `horizon_treadmill_force_ftms` | false | `TF-` -> `horizontreadmill` (#46) instead of `snodebike` (#111). |
| `gem_module_inclination` | false | Plain `TREADMILL` -> `horizontreadmill` (#46) instead of `truetreadmill` (#42). |
| `domyosbike_notfmts` | false | `Domyos-Bike` with FTMS -> `domyosbike` (#25) rather than `ftmsbike`. Auto-set by `ftmsbike`. |
| `domyostreadmill_notfmts` | false | `Domyos*`/`DOMYOS-TC` with FTMS -> `domyostreadmill` (#38) rather than `horizontreadmill`. Auto-set by `horizontreadmill`. |
| `domyos_elliptical_fmts` | false | `Domyos-EL` -> `ypooelliptical` (#29) instead of `domyoselliptical` (#28). Auto-set by `domyoselliptical`. |
| `technogym_myrun_treadmill_experimental` | false | `MYRUN ` -> RFCOMM driver instead of BLE (non-iOS). |
| `bike_resistance_start` | 1 | Initial resistance sent on first connection (3119-3128); not routing. |
| `ios_cache_heart_device` | true | iOS: re-attach cached HRM by address (3146-3166). |
| `android_notification`, `peloton_workout_ocr`, `peloton_bike_ocr`, `zwift_ocr`, `garmin_companion` | false | Post-connect Android/Garmin side services (3674-3711); not routing. |

## 4. Accessory attachment (`connectedAndDiscovered`, 3088-3727)

Runs once the main device signals `connectedAndDiscovered`. Every accessory is looked up by iterating the same `devices` list captured during the scan, so an accessory that was not seen during the (accessory-gated) scan is never attached. All matches are `b.name().startsWith(setting)` **case-sensitive** unless noted.

| Accessory | Match | Class | Wiring to main device |
|---|---|---|---|
| Heart-rate belt (3170-3190; iOS cached path 3146-3166) | `^heart_rate_belt_name` | `heartratebelt` | `heartRate` -> `device()->heartRate`; `rrIntervalReceived` -> `device()->rrIntervalReceived`. Writes `hrm_lastdevice_name/address`. |
| SmartSpin2k (3193-3216) | `^ftms_accessory_name`, `!ss2k_peloton` | `smartspin2k(false,false,maxResistance,(bike*)device)` | `device.resistanceChanged/resistanceRead` -> SS2K; `SS2K.resistanceRead` -> device. Writes `ftms_accessory_address`. |
| Fans (3220-3253, only if `fitmetria_fanfit_enable`) | `^"FITFAN-"` / `U^"HEADWIND "` / (`U^"ARIA"` && len==4) | `fitmetria_fanfit` / `wahookickrheadwind` / `eliteariafan` | `device.fanSpeedChanged` -> `fanSpeedRequest`. Multiple fans allowed (`fitmetria_fanfit_isconnected` dedupe, 4870). |
| Cadence sensor (3256-3279, only if not used as main device) | `^cadence_sensor_name` | `cscbike(false,false,true)` | `cadenceChanged` -> `device()->cadenceSensor`. Writes `csc_sensor_address`. |
| Power sensor (3282-3331, only if not used as main device) | `^power_sensor_name` | BIKE: `stagesbike(false,false,true)`; TREADMILL: `strydrunpowersensor(false,false,true)` | BIKE: `powerChanged` -> `powerSensor`, `cadenceChanged` -> `cadenceSensor`. TREADMILL: power, cadence, **speed**, **inclination**, stride length, ground contact, vertical oscillation, HR all forwarded into the treadmill object. Writes `power_sensor_address`. |
| Elite Rizer (3334-3355) | `^elite_rizer_name` | `eliterizer(false,false)` | `steeringAngleChanged` -> `bike::changeSteeringAngle`; **`device()->inclinationChanged` -> `eliterizer::changeInclinationRequested`** (direct device-to-accessory connection). |
| Elite Sterzo Smart (3357-3376) | `^elite_sterzo_smart_name`, device is BIKE | `elitesterzosmart(false,false)` | `steeringAngleChanged` -> `bike::changeSteeringAngle`. |
| SRAM AXS (3378-3395) | `sram_axs_controller`, `U^"SRAM "`, BIKE | `sramaxscontroller` | `plus/minus` -> `bluetooth::controllerGearUp/Down` (-> `handleControllerGearChange`, 3729, with MyWhoosh override). |
| Zwift Click (3397-3499) | `zwift_click`, `U^"ZWIFT CLICK"`, BIKE | `zwiftclickremote(device, NONE)` if mfg-data id 2378 byte0 == 11 (or absent for the first); else v2 pair, byte0 3/7 = LEFT else RIGHT | v1: `plus/minus` -> gear up/down. v2: all `AbstractZapDevice` left/right/ride signals -> `bluetooth::zwiftPlay*`/`zwiftRide*` slots and MyWhoosh handlers; `bike::gearOkUp/gearFailedUp/...` -> `bluetooth::gearUp/...` for haptic feedback on the LEFT half (RIGHT if `zwiftplay_swap`). |
| Thinkrider (3501-3517) | `thinkrider_controller`, `U^"THINK VS"`/`U^"THINKRIDER"`, BIKE | `thinkridercontroller` | `plus/minus` -> gear. |
| Cycplus BC2 (3519-3537) | `cycplus_bc2_controller`, `contains("BC2")` or Nordic UART svc, BIKE | `cycplusbc2controller` | `plus/minus` -> gear. |
| Elite Square (3539-3556) | `zwift_play`, `U^"SQUARE"`, BIKE | `elitesquarecontroller` | `plus/minus` -> gear. |
| Zwift Play / Ride / SF2 (3558-3652) | `zwift_play`, `U^"ZWIFT PLAY"`/`U^"ZWIFT RIDE"`/`U^"ZWIFT SF2"`, `< 2` already, BIKE | `zwiftclickremote(device, LEFT if mfg byte 3/7 else RIGHT; ordinal if no mfg data)` | Same signal fan-out as Click v2; `plus/minus` -> MyWhoosh `overrideLocalGears()` else `bike::gearUp/Down`. |
| ANT+ (Android, 3654-3672) | `ant_cadence \|\| android_antbike \|\| ant_heart` | JNI `antStart(activity, cadence, heart, garmin, isTreadmillOrElliptical, antbike, technogym_group_cycle, bikeDevNum, heartDevNum)` | Native. |

Also: first-connection default resistance from `bike_resistance_start` for BIKE/ELLIPTICAL (3119-3128); Android notification / OCR / Garmin companion / lockscreen setup (3674-3711); re-emit `deviceConnected` with cached last device on first connect (3714-3722).

## 5. `inclinationChanged` / `speedChanged` propagation (4857-4868)

```cpp
void bluetooth::speedChanged(double speed)                        { Q_UNUSED(speed); stateFileUpdate(); }
void bluetooth::inclinationChanged(double grade, double inclination){ Q_UNUSED(grade); Q_UNUSED(inclination); stateFileUpdate(); }
```

They **do not propagate anything to accessories**; they only persist the state file. Almost every `connect(driver, speedChanged/inclinationChanged, this, ...)` in the ladder is commented out ("NOTE: Commented due to #358"); only the four fake devices still connect `inclinationChanged` to `bluetooth::inclinationChanged` (853, 867, 882, 896). Inclination reaches the Elite Rizer through the direct `device()->inclinationChanged -> eliterizer::changeInclinationRequested` connection made at 3349-3350, and speed/incline from a Stryd-type pod reach the treadmill through the direct connections at 3313-3316. Gear changes from controllers go through `handleControllerGearChange` (3729-3763), which consults MyWhoosh before calling `bike::gearUp/gearDown`.

## 6. Name exclusion lists (explicit "NOT this driver")

| Driver | Excluded names |
|---|---|
| `domyosrower` / `domyosbike` / `domyoselliptical` | `^"DomyosBridge"` |
| `domyostreadmill` | `^"DomyosBr"`, `U^"DOMYOS-BIKE-"`, `U^"DOMYOS-BIKING-"`, `== ftms_treadmill` |
| `kingsmithr1protreadmill` | `U^"KS-HD-Z1D"` (is FTMS) |
| `truetreadmill` | `TRUE TREADMILL \d{3,}`, `TRUE ELLIPTICAL \d{3,}`, `U^"TRUE 1000"` |
| `horizontreadmill` | `FIT-BK-` (from the `FIT-` entry) |
| `tacxneo2` | `U^"TACX SATORI"` |
| `ftmsbike` | regex `^ADIDAS\d{4,}$`; `PM5*SKI`, `PM5*ROW` |
| `smartrowrower` | `U^"SMARTROWER"` |
| `iconceptbike` | `U^"BH DUALKIT TREAD"` |
| `snodebike` | `U^"TF-T"` |
| `yesoulbike` | `== ftms_treadmill`, `== ftms_bike` |
| `schwinnic4bike` | `C7-` with len 17 |
| `fitshowtreadmill` | `SW` 14-char names that contain `(`/`)` or advertise FTMS |
| `npecablebike` / `flywheelbike` / `technogymbike` | mutually exclusive on `BIKE n` via `flywheel_life_fitness_ic8` / `life_fitness_ic5` / `technogym_bike` |

## 7. Practical takeaways for a QZ-compatible reimplementation

1. Order matters more than service UUIDs: `KETTLER TREADMILL` is an elliptical, `WLT-EP-` (an elliptical) is a treadmill, `NAUTILUS 616` (a bike) is an elliptical, `PM5` (Concept2) is a bike unless the suffix says otherwise. Match the ladder order exactly if you want to reproduce QZ behaviour.
2. There is no discovery-time inspection of FTMS characteristics; any "unknown FTMS device" workflow must either extend the name lists or expose the four `ftms_*` exact-name settings.
3. The accessory-gate (section 0) means the main device is not connected until every configured accessory has been seen or the scan timeout fires; a wrong `heart_rate_belt_name` therefore delays trainer connection by one scan cycle.
4. The `dflt(ftms_*)` guards are global toggles, not per-device; document this to users or replace with exact-name comparisons.
5. Nine drivers rewrite the `ftms_*` / `*_notfmts` settings at runtime and ask for a restart; a port needs the same "second launch routes differently" semantics or an in-process re-route.
