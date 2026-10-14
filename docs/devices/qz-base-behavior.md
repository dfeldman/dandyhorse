# Values QZ computes instead of reading (and the formulas)

Most consumer machines do not report everything a game needs. This page lists
what QZ synthesises, with the exact formulas, so a new implementation can
match user expectations (people compare against QZ/Zwift numbers).

## Treadmill power

No consumer treadmill in QZ reports wattage (a few FTMS ones set bit 12 of
`0x2ACD` but QZ ignores it). Watts are computed every 200 ms
(`treadmill::wattsCalc`, `src/devices/treadmill.cpp:186`), after
https://alancouzens.com/blog/Run_Power.html:

```
pace   = 60 / speed_kmh              (min/km)
VO2R   = 210 / pace                  (ml/kg/min)
VO2A   = VO2R * weight_kg / 1000     (l/min)
hwatts = 75 * VO2A                   (horizontal)
vwatts = 9.8 * weight_kg * incline_percent / 100
watts  = hwatts + vwatts
```
Equivalent: `watts = 0.2625 * weight * speed_kmh + 0.098 * weight * grade%`.
Negative grades reduce power linearly (no clamping in QZ).

A Stryd or other running power meter (`RSC`/CPS foot pod) overrides this
(`powerReceivedFromPowerSensor`).

Calories on treadmills: `kcal/min = ((0.048 * watts + 1.19) * weight * 3.5) / 200`.

## Treadmill cadence

Rarely reported. `treadmill::calculateCadenceFromSpeed` (`treadmill.cpp:669`):

```
stride_m = height_m * 0.415 (male) or 0.413 (female)
cadence_spm = (speed_kmh / 3.6) / stride_m * 60
```
Only used when neither the machine nor a foot pod supplies cadence.

## Treadmill incline override table

QZ has 31 user-editable slots `treadmill_inclination_override_0 .. _150`
(one per 0.5 %) plus `treadmill_inclination_ovveride_gain/offset`. On read,
the machine's value (after gain/offset) is looked up; on write, the table is
searched in reverse (`treadmillInclinationOverrideReverse`,
`treadmill.cpp:334`). This is how users fix treadmills that report levels or
degrees. Defaults are identity.

## Grade-adjusted speed (for pace)

`gradeAdjustedSpeed` (`treadmill.cpp:11-24`), Minetti-style polynomial on
`i = grade/100`:

```
cost(i) = 155.4 i^5 - 30.4 i^4 - 43.3 i^3 + 46.3 i^2 + 19.5 i + 3.6
GAS = speed * cost(i) / cost(0)
```

## "Simulate inclination with speed" (treadmills without incline)

Setting `treadmill_simulate_inclination_with_speed`: instead of an incline
request, speed is scaled so power matches:
`speed' = wattsCalc(w, speed, incline) * speed / wattsCalc(w, speed, 0)`.

## Treadmill ERG (target power → speed)

`treadmill::changePower` (`treadmill.cpp:868`): scans speeds 0.1..30 km/h in
0.1 steps for the first that gives `|wattsCalc - target| <= 3 W` at the
current incline, or uses a learned speed/incline/watts table if a running
power meter is present.

## Bike: Peloton-equivalent resistance from cadence and watts

Used on any bike that does not report resistance (`ftmsbike.cpp:960-1000`,
same constants in every driver):

```
ac = 0.01243107769   bc = 1.145964912   cc = -23.50977444
ar = 0.1469553975    br = -5.841344538  cr = 97.62165482
res = ( sqrt(br^2 - 4*ar*(cr - watts*132 / (ac*cad^2 + bc*cad + cc))) - br ) / (2*ar)
res = res * peloton_gain + peloton_offset
```
`ac,bc,cc` are the Peloton power-vs-cadence fit at resistance ~35; the inner
quotient is a resistance factor, `132` its normaliser; `ar,br,cr` map that
factor back to a 0..100 resistance. NaN (low cadence) keeps the last value.

Inverse (wattsFromResistance on bikes with no power meter, `bike.cpp` and
several console drivers):

```
watts = ((ar*res^2 + br*res + cr) / 132) * (ac*cad^2 + bc*cad + cc)
```
`bike::powerFromResistanceRequest` (Renpho and others): `W = res * cad / 9.5488`
when resistance is in N·m.

## Bike: physics grade → target power (QZ's own sim mode for ERG-only bikes)

`bike::computeSlopeTargetPower` (`bike.cpp:618`):

```
m = rider + bike (default 75 + 10)
v = speed_kmh / 3.6 ; if speed < 5 km/h, v = max(0.5, cadence*0.3) km/h
sin = s/sqrt(1+s^2), cos = 1/sqrt(1+s^2), s = grade/100
P = m g v sin  +  m g Crr v cos  +  0.5 * 1.204 * (0.4 * 1.0) * v^3
Crr default 0.005; grade includes gears*0.5 %
```
Clamped 0..2000 W, 500 ms hysteresis, only re-sent if it changes by >= 3 W.

## Bike: grade → resistance level (self-learned)

`inclinationResistanceTable` (`src/inclinationresistancetable.h`): whenever a
bike reports both its resistance and the grade QZ last requested, and both
have been stable for 5 s, the pair is stored (one per 0.1 % of grade, one per
level). `estimateInclination(level)` / the inverse interpolate between stored
points. Used by `ftmsbike::forceResistance` when ERG is not supported.
There is no factory default table; new users get a linear guess until it
learns. **For a game with a fixed physics model, ship your own table per bike
class instead of learning.**

## Bike: cadence/resistance → watts (self-learned)

`ergTable` (`src/ergtable.h`): buckets `(cadence, resistance)` → median watts
(min 10 samples), skips samples within 1 s of a resistance change,
`estimateWattage` interpolates on cadence within the nearest resistance;
`resistanceFromPowerRequest` searches it. Defaults exist only for two bikes
(`horizon5r_defaults.h` for the Horizon 5R / `JFBK5.0R`, `speedracex_defaults.h`).

## Bike speed

Speed from a trainer is whatever the trainer sends (usually `0x2AD2` bit 0
field). With `speed_power_based`, QZ instead integrates a physics model from
power and grade (`metric::calculateSpeedFromPower`). For console bikes that
send no speed, speed = `cadence * cadence_sensor_speed_ratio` (default ~0.33).

## Distance

Always integrated from speed by QZ (`Distance += speed/3600000 * ms`), never
read, except when `treadmill_direct_distance` is set.

## Heart rate

Machine HR is used only if no belt is configured and `heart_ignore_builtin`
is off; most machines' hand-grip HR is treated as unreliable.

## Rate limits and hysteresis to copy

* Device poll tick: 200 ms.
* Write queue: one BLE write in flight, 300 ms timeout.
* Treadmill speed: send only if `|req - cur| >= minStepSpeed` (0.1 km/h on
  FTMS/Horizon, 0.5 default).
* Treadmill incline: rounded to 0.5 %, only if different from current.
* Bike resistance: only when the requested value differs from the last
  reported one; Domyos additionally 1 per 1.5 s.
* ERG resistance emulation: 2 s debounce, no increase below 50 rpm.
