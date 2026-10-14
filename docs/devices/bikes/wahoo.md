# Wahoo KICKR family (Wahoo trainer extension)

Wahoo KICKR, KICKR CORE, KICKR SNAP, KICKR BIKE, KICKR ROLLR and KICKR MOVE
expose the standard Cycling Power service plus a Wahoo control
characteristic. Recent firmware also exposes FTMS, but QZ talks to them
through the Wahoo extension. It gives grade, ERG, resistance level, and QZ's
virtual gears.

Source: `src/devices/wahookickrsnapbike/wahookickrsnapbike.cpp` (QZ). The
command encodings below match a real QZ log in issue #4881, for example
`20 EE FC` (unlock) and `43 20 1C 04 00 90 01` (simulation mode for 72 kg).

## Routing (`bluetooth.cpp:2053`)

Names starting `KICKR SNAP`, `KICKR BIKE`, `KICKR ROLLR`, `KICKR CORE`,
`KICKR MOVE `, `HOI FRAME ` or `WAHOO KICKR`; and `HAMMER ` when the user
sets `saris_trainer` (a Saris Hammer driven through the same commands). A
plain `KICKR` without a suffix is not matched, and `KICKR RUN` is a
treadmill. The branch only runs if the FTMS bike driver has not already
claimed the device.

**Zwift-firmware trainers**: if the device has the Zwift service
(`00000001-19CA-...`) but not Wahoo's service (`a026ee01-...`), QZ switches it
to its FTMS bike driver on the next start, for Zwift-protocol virtual gears
(`wahookickrsnapbike.cpp:863-900`; see `../zwift-protocol.md`).

## GATT

| UUID | role |
|---|---|
| `0x1818` / `0x2A63` | Cycling Power Measurement: power and crank revolutions |
| `a026ee01-0a7d-4ab3-97fa-f1500f9feb8b` | Wahoo trainer service (presence check) |
| `a026e005-0a7d-4ab3-97fa-f1500f9feb8b` | Wahoo control characteristic: write; replies arrive as notifications |

QZ enables every notification and indication on every service, and starts
the init once all of those descriptor writes have completed. Android
connection parameters: interval 30-50 ms, latency 0, supervision 4.2 s.

## Commands

All values are little-endian. First byte is the opcode.

| opcode | name | payload |
|---|---|---|
| `20` | unlock | `EE FC` |
| `40` | resistance mode | uint16 = (1 − r) × 16383, r = 0..1 (so 0 % = `3FFF`, 100 % = `0000`) |
| `41` | standard mode | level (uint8); QZ does not use it |
| `42` | ERG | uint16 watts. Reply `01 42 01 00 <watts LE>` |
| `43` | simulation mode | uint16 weight × 100 (kg), uint16 Crr × 1000, uint16 Cw × 1000 |
| `44` | simulation Crr | uint16 Crr × 1000 |
| `45` | simulation wind resistance | uint16 Cw × 1000 |
| `46` | simulation grade | uint16 = (clamp(grade% / 100, −1, 1) + 1) × 65535 / 2 |
| `47` | simulation wind speed | uint16 = (m/s + 32.767) × 1000 |
| `48` | wheel circumference | uint16 mm × 10 |

Grade examples: 0 % → `46 FF 7F`; +5 % → `46 65 86`; −5 % → `46 99 79`.

## Session

Init (`update()`, `wahookickrsnapbike.cpp:229-275`):

```
20 EE FC                                   unlock
(wait 700 ms)
43 <weight×100> 04 00 90 01                simulation mode: rider weight, Crr 0.004, Cw 0.4
(wait 700 ms)
48 <circumference×10>                      wheel circumference for the current virtual gear (default mode only)
```

Then, per 200 ms tick:

* **Grade**: `46 ...` whenever the requested grade changes. On a KICKR SNAP
  QZ adds 0.5 % per virtual gear to the grade.
* **Leaving ERG**: if the last command was ERG (`42`), QZ reruns the whole init
  (unlock and simulation mode) before sending a grade. A grade on its own
  does not take the trainer out of ERG.
* **Resistance level**: `40 ...` with the requested level ÷ 100. QZ only sends
  it when no FTMS app is connected to QZ's own virtual trainer.
* **ERG**: `42 <watts>`.

## Virtual gears: wheel circumference

By default QZ implements virtual gears **by changing the trainer's wheel
circumference**. The trainer's speed-to-resistance model then makes a
"bigger wheel" feel like a harder gear (`wheelcircumference.h`):

```
circumference = gear_circumference × (gear_chainring / gear_cog) / (real_chainring / real_cog)
defaults: gear_circumference 2070 mm, real bike 42/14,
          gear table 38/44, 38/38, 38/32, 38/28, 38/24, 38/21, 38/19, 38/17, 38/15, 38/13, 38/11, 38/10
```

Settings that matter: `gear_crankset_size`, `gear_cog_size` (the rider's
real drivetrain) and `gear_circumference`. A KICKR SNAP owner had to enter
their real chainring and cog before virtual gears felt right (issue #3232).

With `wahoo_without_wheel_diameter` on, QZ never sends `48`; each virtual
gear instead adds 1 % to the grade (QZ's gear
step and gear offset settings scale this). A user whose resistance lagged gear
changes by several seconds fixed it with that setting (issue #3855).

**KICKR BIKE** has a motor that tilts the frame. QZ sends grade (`46`)
instead of resistance, and treats incline as available in hardware. For iFit
classes QZ now changes the tilt instead of the resistance (issue #2224).

## Telemetry

Cycling Power Measurement (`0x2A63`): power at bytes 2..3; cadence from the
crank revolution count and event time, per the standard. Two QZ details:

* QZ's rollover correction for the crank event time adds 1024 instead of
  65536; use the standard 16-bit wrap.
* QZ reports 0 W whenever cadence is 0.

The trainer does not report a resistance level. QZ shows a Peloton-style
resistance computed from power and cadence (`../qz-base-behavior.md`).

## Field reports

* **No watts on an older KICKR** until the user set it as a Cycling Power
  sensor used as the bike; another app on a second phone had also been
  holding the connection (issue #1229).
* **Zwift Click on a KICKR CORE Zwift One**: shifting did not change the
  physical resistance through QZ even though the trainer acknowledged every
  command (issue #3237). Zwift-firmware trainers are better driven through
  the Zwift protocol.
* **KICKR SNAP, 2026**: no resistance change in QZ's virtual-speed mode
  (issue #4881).

## Practical recipe for a game

1. Connect, enable all notifications, send unlock, wait, send simulation
   mode with the rider's weight and your fixed Crr and Cw.
2. Send grade with `46` whenever it changes. Resend simulation mode after any
   ERG segment.
3. Read power and crank cadence from `0x2A63`.
4. For virtual gears, add a grade offset (simplest), or use the
   wheel-circumference method if you want gearing to scale with speed.
