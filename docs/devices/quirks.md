# Device quirk flags

A uniform vocabulary of per-device quirks, so game code can switch on flags
instead of on device names. The registry itself is `quirks.yaml` in this
folder; this page defines every flag.

## Rules

1. **Every boolean flag defaults to false.** A device entry lists only the
   flags that are true for it.
2. **A flag means "this device deviates from the baseline for its class".**
   The baselines are below. So `power_not_reported` exists for bikes, but no
   treadmill needs it, because treadmills never report power.
3. **Numbers and strings go in `params`**, not in flags: incline limits,
   steps, maximum resistance, unlock bytes, lookup tables.
4. Each entry cites where the knowledge came from: QZ `file:line`, and QZ
   issue numbers for firmware facts that the code cannot express.
5. **Matching.** The name keys (prefix, exact, contains, regex) are
   alternatives; every other match key must also hold. Entries whose
   `user_option` the user has chosen are tried first, then the entries
   without one, in file order; the first match wins. Specific prefixes come
   before generic ones, and catch-all prefixes carry `exclude_prefix` lists,
   as QZ guards its catch-alls.

## Class baselines

**Every FTMS device**
* Control point `0x2AD9`, indications on. Send `00` (request control) then
  `07` (start) once after connecting.
* Writes are serialized: one in flight, next after the ack or 300 ms.
* Distance and calories from the device are ignored; integrate from speed and
  power instead.

**Treadmill (FTMS)**
* Speed `02 <uint16 LE, 0.01 km/h>`; incline `03 <sint16 LE, 0.1 %>`.
* Resend `00` and `07` before each speed or incline write, because many boards
  drop control.
* Incline 0..15 %, in 0.5 % steps. Speed step 0.1 km/h.
* Speed and incline are read from `0x2ACD`.
* Power is **never** read. It is computed from speed, incline and body weight
  (`qz-base-behavior.md`).
* Cadence is estimated from speed and height when not reported.

**Bike (FTMS)**
* Grade `11 00 00 <sint16 LE, 0.01 %> 28 19` (wind 0, Crr 0.004, Cw 0.25).
* Cadence, power and speed are read from `0x2AD2`.
* ERG `05 <sint16 LE W>` is supported.
* Resistance level is not reported (most trainers don't).

**Elliptical (FTMS)**
* Cross Trainer Data `0x2ACE`, with **3-byte** flags.
* Cadence = step rate ÷ 2 (strides per minute).
* Resistance `04 <sint16 LE, level × 10>`; incline `03 <sint16 LE, 0.1 %>`.
* Send `00` once; `07` is not required.
* Power is reported.

**Rower (FTMS)**: service `0x1826`, Rower Data `0x2AD1`, Control Point `0x2AD9`. Send Request Control `00`, then Start `07`. Stroke rate is uint8 in 0.5 spm units followed by a uint16 stroke count; pace is uint16 seconds per 500 m (0 or 65535 means none); distance is uint24 metres. Resistance, when supported, is `04 <level x 10>` (uint8). No ERG or simulation. When power is absent, derive it from pace: `W = 2.8 x (500 / pace)^3`. Zero stroke rate, power and speed after 3 s without a new stroke. See `rowers/ftms-rower.md`.

**Stair climber, stepper, jump rope, body sensors**: no standard service. Each is a vendor protocol; see `other/odd-equipment.md`. Steps or jumps are counted cumulatively; derive cadence from the change over time and zero it after about 2 s without change.

## Flags

### Routing and protocol choice

| flag | meaning | what to do |
|---|---|---|
| `has_proprietary_protocol` | a vendor protocol exists alongside or instead of FTMS | see the device page for when to prefer it |
| `prefer_proprietary_if_vendor_service` | FTMS may be advertised but is broken when the vendor service is also present | check for the vendor service UUID and use the vendor protocol if found |
| `ftms_capability_varies_by_firmware` | what FTMS accepts depends on region or firmware year | probe: send a change and check the reported value follows |
| `name_changes_with_firmware` | a firmware update changes the advertised name | match on services, not only names |
| `connects_to_advertised_peripherals` | the device connects out to any FTMS peripheral it sees | stop advertising your own peripheral while connecting |
| `model_selection_required` | traffic differs per model and the model cannot be detected | ask the user for the exact model; `params.models` lists them |

### Control handshake

| flag | meaning | what to do |
|---|---|---|
| `skip_control_refresh` | resending `00`/`07` before each write disrupts the device (treadmills) | send them once only |
| `request_control_twice` | needs `00` sent twice, 500 ms apart | |
| `request_control_with_code` | Request Control must carry extra bytes after `00` | `params.request_control_bytes`; never send the bare `00` |
| `vendor_text_one_byte_per_write` | vendor text commands must be written one byte per BLE write | loop over the bytes |
| `reset_before_control` | needs `00`, `01` (reset), then `00`, `07` | |
| `start_via_stop_opcode` | streams only if init uses `08 01` instead of `07` | |
| `inject_start_before_sim` | rejects `11` unless `07` came after the last `00` | send `07` before the first `11` |
| `wait_for_console_start` | refuses control until the user presses start on the console; announces it with `0x2ADA` = `02 01` | wait for that status, then send `00`,`07` |
| `control_only_while_belt_running` | commands are ignored until the belt is moving | start the belt first |
| `vendor_unlock_required` | a write to a vendor characteristic must precede control | `params.unlock_char`, `params.unlock_bytes` |
| `write_with_response_required` | WriteWithoutResponse is silently dropped | always write with response |
| `subscribe_ftms_service_only` | subscribing to non-FTMS services breaks telemetry | only enable CCCDs on `0x1826` (plus any listed in params) |
| `keepalive_start_every_second` | needs `07` resent every second | |
| `init_right_after_discovery` | expects `00`,`07` as soon as services are discovered | |
| `backoff_on_control_not_permitted` | a `80 xx 05` reply means "slow down" | wait 3 s, rerun `00`,`07`, retry |
| `control_is_button_press` | no absolute set-points; control is up/down key presses | press once per tick until the reported value matches |
| `speed_incline_single_command` | speed and incline are set by one combined command | always send the current value of the one you are not changing |
| `retry_until_echoed` | commands are silently lost unless resent until the device echoes them | resend on alternate ticks, give up after 3 |
| `limits_reported_by_device` | the device reports its own speed/incline limits during init | read them and clamp to them; send nothing before they arrive |
| `cipher_variant_unknown` | frames are obfuscated with a per-firmware substitution table that cannot be detected up front | try the known tables until a reply decodes to plausible text |
| `lock_state_needs_unlock` | the device reports a child-lock state and ignores commands until unlocked | send the unlock command when the lock flag appears |
| `echo_device_frames` | frames the device sends must be written back unchanged as acknowledgements | echo each listed frame type (`params.echo_commands`) |
| `vendor_app_auth_required` | the device stays silent until the vendor's own app has authenticated | only a relay through the official app works; mark as unsupported otherwise |
| `bluetooth_classic_only` | the device speaks Serial Port Profile over Bluetooth Classic, not BLE | not usable from iOS apps or Web Bluetooth |
| `proprietary_init_overwrites_user_profiles` | the vendor init rewrites console user profiles | warn the user, or prefer FTMS |
| `control_via_touch_injection` | control works by injecting touches on the console's own screen (ADB `input swipe`) | per-model, per-UI-version coordinates; verify each change against telemetry |

### Speed (treadmills)

| flag | meaning |
|---|---|
| `speed_control_unsupported` | speed commands are ignored |
| `user_driven_speed` | no motor: the user's own effort sets the speed (Zero Runner, curved non-motorized treadmills) |
| `speed_sent_in_mph` | target speed must be sent in mph, in the FTMS km/h field |
| `speed_sent_in_mph_when_console_miles` | as above, only while the console is set to miles |
| `speed_sent_in_tenth_kmh` | target speed must be sent in 0.1 km/h units in the FTMS 0.01 km/h field; reported speed stays standard. Round up to the next 0.1 km/h so a console that truncates to 0.1 mph shows the intended value (Horizon 7 series) |
| `speed_reported_in_mph_when_console_miles` | reported speed is mph while the console is in miles |
| `speed_reported_in_mph` | reported speed is always mph |
| `transient_zero_speed_frames` | occasional single speed=0 frames while running; debounce `params.zero_speed_debounce_ms` |
| `off_belt_detect_via_elapsed_time` | elapsed time stops when the user steps off; treat 2 s without change as speed 0 |
| `nonsense_speed_on_connect` | first speed after connect is garbage; don't auto-start on it |
| `telemetry_keys_localized` | text telemetry uses keys in the console's language |
| `wire_values_plus_one` | every numeric byte is sent as value + 1 (subtract 1 before decoding; add 1 when encoding) |

### Incline (treadmills)

| flag | meaning |
|---|---|
| `incline_control_unsupported` | incline commands are ignored |
| `incline_not_reported` | device never reports incline; show the last requested value |
| `incline_report_unreliable` | device reports a stale or wrong incline; show the last requested value |
| `incline_encoded_lookup` | incline uses a vendor table, `params.incline_table` (both directions unless noted) |
| `incline_no_half_percent` | 0.5 % is rejected; send 1.0 instead |
| `incline_fixed_report` | device reports a constant incline, `params.incline_fixed` |
| `incline_half_percent_units` | incline travels in 0.5 % units on the wire (double on write, halve on read) |

Incline range and step go in `params.incline_min`, `incline_max`, `incline_step`.

### Resistance (bikes)

| flag | meaning |
|---|---|
| `sim_unsupported` | `0x11` is ignored or misbehaves; use a resistance level |
| `erg_unsupported` | `0x05` is ignored; convert power to a level |
| `resistance_uint16_x10` | `0x04` takes a 2-byte level × 10 |
| `resistance_uint8_x10` | `0x04` takes a 1-byte level × 10 |
| `resistance_via_vendor_char` | resistance goes to a vendor characteristic, `params.resistance_frame` |
| `resistance_via_sim_grade` | resistance level must be sent as an FTMS `0x11` grade, `params.grade_per_level`, `params.flat_level` |
| `speed_from_cadence` | no speed from the machine; derive it from cadence (`params.speed_per_rpm`) |
| `resistance_report_div10` | reported resistance is level × 10 |
| `resistance_report_ignore` | reported resistance is meaningless; trust what was sent |
| `resistance_level_x2` | FTMS resistance level is written and reported doubled (half-level steps) |
| `gears_via_wheel_circumference` | virtual gears can be implemented by changing the trainer's wheel circumference setting |
| `bike_physical_tilt` | the bike tilts its frame; grade commands move it physically |
| `sim_mode_lost_after_erg` | after an ERG command the trainer ignores grade until simulation mode is sent again |
| `cadence_ghost_when_freewheeling` | the crank sensor keeps counting while the rider freewheels (motorised flywheel); report cadence 0 when power is 0 |
| `negative_grade_spins_flywheel` | a negative grade makes the trainer's motor drive the flywheel; avoid negative grade from virtual gears on flat roads |
| `falls_back_to_ftms` | if the vendor characteristic is missing, drive the device as a generic FTMS bike |
| `no_wireless_sensor_output` | the equipment sends no Bluetooth or ANT+ data to third-party apps; data only via a bridge app on its own console |
| `advertisement_only` | the device never connects; all data comes from repeated advertisements, so the app must scan continuously with duplicates allowed |
| `do_not_poll` | the device streams on its own; unsolicited poll or query frames can switch it into another mode |
| `stroke_rate_whole_spm` | FTMS stroke rate is sent in whole strokes per minute, not 0.5 units |
| `ignore_zero_power_samples` | isolated 0 W samples are glitches; keep the previous value |
| `distance_from_speed` | the device's distance field is wrong; integrate speed instead |
| `energy_div10` | total energy is reported x10 |
| `power_from_pace` | the power field is unusable; compute power from pace |
| `metrics_need_cadence` | pace and power are valid only while stroke rate or cadence is above 0 |
| `resistance_not_reported` | the device never reports its level; show the last value sent |
| `resistance_control_unsupported` | resistance is manual only |
| `row_state_gate` | discard data while the device's rowing-state field says idle (Concept2 PM5) |
| `resistance_rate_limited` | at most one level change per `params.write_min_interval_ms` |

`params.max_resistance` holds the level range.

### Telemetry (bikes)

| flag | meaning |
|---|---|
| `power_not_reported` | no power; estimate from HR or cadence and resistance |
| `power_unreliable` | reported power is wrong; use `params.power_formula` |
| `power_reported_at_zero_cadence` | power is valid even at 0 rpm |
| `cadence_from_cps_crank` | cadence must come from the Cycling Power crank data, not `0x2AD2` |

### Zwift protocol

| flag | meaning |
|---|---|
| `zwift_zap_service` | exposes the Zwift service `00000001-19CA-...` |
| `zap_gear_needs_grade_first` | gear commands are ignored until a grade has been sent |

### Auto start and pause (treadmills)

| flag | meaning |
|---|---|
| `no_auto_pause` | speed 0 does not mean paused on this device |
| `auto_start_on_speed` | treat a non-zero speed as "started" |
