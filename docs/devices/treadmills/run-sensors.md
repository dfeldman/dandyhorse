# Run sensors (foot pods, belt sensors) and the Peloton Tread

A treadmill that cannot be read or controlled can still drive a game through
a sensor on the runner or the belt. QZ supports foot pods and belt sensors
either as the whole "treadmill" or as an accessory that overrides a real
treadmill's speed, cadence or power.

Source: `src/devices/strydrunpowersensor/strydrunpowersensor.cpp` (QZ), which
handles every sensor on this page despite its name.

## Peloton Tread and Tread+

QZ has no driver for the Peloton Tread. Its Peloton code
(`src/peloton.cpp`) reads class targets from the Peloton app, and maps
Peloton's pace levels to speeds so that *other* treadmills can follow a
Peloton class (`peloton_treadmill_level`, `peloton_treadmill_walk_level`).
For a game, treat a Tread as an unsupported treadmill: pair a foot pod or
belt sensor instead.

## Routing (`bluetooth.cpp:1149`)

A sensor becomes QZ's main "treadmill" when its name matches one of these:

| name | sensor |
|---|---|
| the configured `power_sensor_name`, with `power_sensor_as_treadmill` on | any running power meter, typically Stryd |
| the configured `cadence_sensor_name`, with `cadence_sensor_as_treadmill` on | any cadence sensor |
| `TREADMILL` advertising RSC (`0x1814`) | generic RSC foot pod |
| `S10` advertising RSC | |
| `NOHRD SPRINTBOK` | NOHRD Sprintbok (a non-motorized curved treadmill with a sensor) |
| `ZWIFT RUNPOD` | Zwift RunPod |

Any other device matching `power_sensor_name` is attached to the real
treadmill as an accessory. A name starting `FORERUNNER` (a Garmin watch
broadcasting as a sensor) is subscribed to only its Heart Rate and RSC
services.

NPE's **RUNN** belt sensor advertises `RUNN ...` and exposes FTMS Treadmill
Data, so QZ routes it to the generic FTMS treadmill driver; it reports
speed and incline and cannot control anything. In 2026 QZ was adding a mode
that reads speed from a RUNN while sending commands to the real treadmill
(issue #4167).

## Services parsed

| service / characteristic | what QZ reads |
|---|---|
| RSC `0x1814` / `0x2A53` | speed (bytes 1..2, uint16 LE, m/s ÷ 256), cadence (byte 3), stride length (bytes 4..5 ÷ 2, when flag bit 0 is set) |
| Cycling Power `0x1818` / `0x2A63` | power (bytes 2..3, uint16 LE), with incline watts added (below) |
| CSC `0x1816` / `0x2A5B` | crank and wheel revolutions, for sensors that use it |
| FTMS `0x2ACD` | incline, heart rate; speed and distance are ignored on this path |
| Heart Rate `0x2A37`, Battery `0x2A19` | heart rate, battery level |
| `7e78aa19-72cd-d3b8-a81f-5b7e589bea0f` (Stryd) | 20-byte frames starting `32`: ground contact time, bytes 4..5 (ms) |
| `0000ff00-...` | 5-byte frames starting `0F`: ground contact (bytes 1..2), vertical oscillation (bytes 3..4) |

Cadence: RSC cadence is steps per minute on some pods and strides per
minute (half) on others. QZ has a doubling setting,
`powr_sensor_running_cadence_double`, and one more for what is exported to
Strava. A Stryd user needed a new QZ setting for stable cadence
(issue #4052), and a Zwift RunPod's cadence did not match Strava until
changed (issue #1099).

If a sensor supplies no power, QZ computes treadmill watts from speed and
incline as usual.

## Stryd indoor mode

Stryd 5 (name starting `Stryd5`) must be switched to indoor mode for
treadmill running, or its pace uses GPS-style outdoor logic
(`strydrunpowersensor.cpp:110-131`, `520-535`):

* Write `15 00` to `7e78aa20-72cd-d3b8-a81f-5b7e589bea0f`.
* The pod answers on `7e78aa19-...` with `15 00 <mode>`; `00` means indoor,
  `01` outdoor.
* If the answer is not indoor, QZ retries once a second, up to three times.

## Power on inclines

A foot pod on a treadmill measures running power as if on the flat. QZ
adds the climbing component (`treadmill::powerSensor`, `treadmill.cpp:291`):

```
default:        vwatts = 9.8 × weight_kg × incline% / 100
custom (A, B):  vwatts = (A + B × speed_kmh) × incline%        (power_sensor_speed_inclination_coeff_a/b)
```

In the accessory path this is applied only when `stryd_add_inclination_gain`
is on; the Stryd-as-treadmill path always adds the default term. A user
argued the default under-counts at steep grades and high speed compared with
published tables (issue #4150); QZ's answer was the custom A and B
coefficients.

## Settings that route sensor data into a treadmill

| setting | default | effect |
|---|---|---|
| `stryd_speed_instead_treadmill` | false | show the pod's speed instead of the treadmill's; QZ also nudges speed commands by the difference, up to 20 % |
| `stryd_inclination_instead_treadmill` | false | same for incline |
| `power_sensor_cadence_instead_treadmill` | false | take cadence from the pod |
| `stryd_add_inclination_gain` | false | add incline watts to pod power |

## Field reports

* **Negative incline and altitude**: a Stryd on a NordicTrack 2950 produced
  negative altitude in QZ's FIT file while Zwift recorded only climbs
  (issue #1038). Decide how a game accumulates elevation on descents.

## Practical recipe for a game

1. Offer foot pods as a first-class input: RSC for speed and cadence,
   Cycling Power for power.
2. Switch Stryd 5 to indoor mode.
3. Add incline watts yourself when the treadmill's incline is known.
4. Let the user choose whether pod speed or treadmill speed wins when both
   exist.
