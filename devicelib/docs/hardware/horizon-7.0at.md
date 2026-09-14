# Horizon 7.0AT: hardware findings

Tested 2026-09-12 and 2026-09-13 with the devicelib demo in Chrome, on one treadmill.
Status: **the FTMS speed quirk is confirmed and implemented** as the `speed_sent_in_tenth_kmh`
flag on the `horizon_7_series` registry entry.

## The unit

| item | value |
|---|---|
| Advertised name | `HORIZON_7.0AT 4959` |
| Firmware | 3.001, several years old, and the latest as of September 2026; both have the speed quirk |
| Console units | miles (the console shows mph and minutes per mile) |
| Device Information service | none; manufacturer, model and firmware are not reported over Bluetooth |
| Registry match | `horizon_7_series` (name pattern `HORIZON 7.xAT`, `HORIZON_7.xAT` or `HZ_7.xAT`, plus vendor characteristic `0xFFF3`) |
| Protocol devicelib picks | FTMS, because the entry says `prefer_ftms` |

A firmware update renamed this model's Bluetooth device in early 2026 (QZ issue #4270). The
underscore form `HORIZON_7.0AT` is presumably the new name. devicelib still matches it,
because it matches on the `HORIZON` prefix.

GATT table as the treadmill exposes it:

```
FTMS 0x1826
  0x2ACC Feature            read
  0x2ACD Treadmill Data     notify
  0x2ACE Cross Trainer Data notify
  0x2ACF, 0x2AD0            notify
  0x2AD1 Rower Data         notify
  0x2AD2 Indoor Bike Data   notify
  0x2AD3 Training Status    read, notify
  0x2AD4 Speed Range        read
  0x2AD5 Incline Range      read
  0x2AD6 Resistance Range   read
  0x2AD7 Heart Rate Range   read
  0x2AD8 Power Range        read
  0x2AD9 Control Point      write, indicate
  0x2ADA Status             notify
Vendor 0xFFF0
  0xFFF1 read, write
  0xFFF2 read
  0xFFF3 write
  0xFFF4 notify
  0xFFF5 read
```

It advertises every FTMS data characteristic, including bike and rower data. Only Treadmill Data
carries treadmill telemetry. devicelib picks the class from the registry entry, so this is harmless.

## Finding 1: target speed is read in 0.1 km/h, not 0.01 km/h

The FTMS specification says Set Target Speed (op code `0x02`) carries a uint16 in 0.01 km/h.
This treadmill reads the same field as **0.1 km/h**, ten times coarser.

Each command below was Request Control (`00`), Start (`07`), then Set Target Speed, sent from
the demo's "FTMS speed units test" panel:

| command | raw value | console showed | pace shown | 0.1 km/h converted to mph |
|---|---|---|---|---|
| `02 0a 00` | 10 | 0.6 mph | 100 min/mi | 0.62 |
| `02 14 00` | 20 | 1.2 mph | 50 min/mi | 1.24 |
| `02 1e 00` | 30 | 1.8 mph | 33 min/mi | 1.86 |
| `02 28 00` | 40 | 2.4 mph | 25 min/mi | 2.49 |

Every reading equals the 0.1 km/h interpretation converted to mph and **truncated** to one
decimal. The two other interpretations do not fit:

* Standard 0.01 km/h would mean 0.1 to 0.4 km/h, below the belt's minimum, so the console would
  sit at its minimum speed for all four.
* 0.1 mph would show 1.0, 2.0, 3.0 and 4.0 mph.

Because the console truncates, a target in mph needs rounding up to display exactly. For
example, 3.0 mph is 48.3 tenths of a km/h: sending 48 shows 2.9 mph, while 49 shows 3.0.

### Consequence: speed commands run away

devicelib's FTMS driver sends standard units. Asking for 5.7 km/h sent `02 3a 02` (570). The
treadmill read that as 57 km/h and accelerated to its maximum, 12 mph (a 5:00 mile). Because the
belt ramps gradually, it looked like the speed drifted up at random.

With the quirk in place, `setTargetSpeed` sends tenths of a km/h and is safe on this treadmill.
The raw buttons in the demo's units test panel bypass the quirk on purpose; they stop at 50.

## Finding 2: reported speed is standard

Treadmill Data (`0x2ACD`) reports speed in standard 0.01 km/h. With the belt at 2.00 km/h, the
speed field read raw 200. So the quirk is one-directional: only commands are scaled.

## Finding 3: incline works over FTMS

Set Target Inclination (`0x03`) works in standard 0.1 % units.

## Finding 4: devicelib never received a control-point reply

Every control-point write from devicelib ended in "timeout". No late replies arrived either:

```
control point 00 -> timeout
control point 07 -> timeout
control point 02 3a 02 -> timeout
control point 08 01 -> timeout
```

The treadmill still acted on the commands. Another Bluetooth tool received `Success (0x1)` for
the same kind of write, so the treadmill does send replies. The cause on devicelib's side,
probably in the Web Bluetooth subscription to the control point's indications, is **unresolved**.
The next capture should have "Show raw bytes" on, to see whether any control-point data arrives.

**Probable cause (2026-09-13).** devicelib started the 300 ms reply timer before the write, so the
budget included the write's own queueing and radio round trip, and a late reply was logged only at
debug level. The Dandyhorse bridge, which waits 3 s, received `80 02 01` for the same kind of write
on this treadmill. devicelib now waits 1.5 s counted from the acknowledged write. Still to confirm on
the hardware: control-point results in the bridge's Exercise device console should read "success",
not "timeout".

## Finding 5: the native Horizon protocol does not take commands from devicelib

devicelib's Horizon driver sends only the hello frame. It skips the vendor setup that writes six
user profiles to the console, because that overwrites the owner's profiles. Without that setup
the belt ignores speed and incline frames, as expected.

The owner previously controlled this treadmill through QZ's native protocol, which runs the full
setup.

## Research: is this documented anywhere?

Not that we could find, as of 2026-09-13. What exists:

* **QZ's code** sends standard 0.01 km/h to every FTMS treadmill, Horizons included, with no
  special handling for this model or its new name. QZ users on this firmware would see the same
  runaway if they force FTMS.
* **Not new firmware:** firmware 3.001, several years old, has the quirk as well as the latest. QZ
  uses the vendor protocol on Horizons unless the user forces FTMS, which may explain why nobody has
  reported it. QZ issue #3299 (March 2025) has a 7.0AT-05 owner controlling speed through QZ, but it
  does not say which protocol.
* **QZ's treadmill FAQ** documents a different Horizon unit mix-up. On a 7.4AT, the proprietary
  protocol reports mph while the console is set to km/h, a factor of 1.609.
* **QZ issues #4629 and #4075** (2026) are miles-versus-kilometres confusion on Horizon consoles,
  also a factor of about 1.6, not 10.
* **TrackMyIndoorWorkout issue #470** is a similar-looking report on a Hammer Qvadis 7.0 treadmill
  that turned out to be a byte-order mistake. Its maintainer points out the trap: the Speed Range
  characteristic advertises a 0.1 km/h step while the speed field is in 0.01 km/h. Horizon's
  firmware may have fallen into exactly that trap.
* **A Zwift forum thread** notes that Horizon treadmills report the selected speed, not the
  measured belt speed.

Sources:

* <https://github.com/cagnulein/qdomyos-zwift/issues/3299>
* <https://github.com/cagnulein/qdomyos-zwift/issues/4270>
* <https://github.com/cagnulein/qdomyos-zwift/issues/4629>
* <https://github.com/cagnulein/qdomyos-zwift/issues/4075>
* <https://github.com/cagnulein/qdomyos-zwift/blob/master/docs/faq/treadmill-troubleshooting.md>
* <https://github.com/TrackMyIndoorWorkout/TrackMyIndoorWorkout/issues/470>
* <https://forums.zwift.com/t/horizon-treadmills-something-to-know/606748>

## Still to record

1. The version number of the latest firmware; 3.001 is confirmed to have the quirk too.
2. The raw Speed Range (`0x2AD4`) value, using "Read speed range" in the demo. A maximum near 193
   would mean the range is also in 0.1 km/h, since 12 mph is 19.3 km/h. That would let devicelib
   detect the quirk automatically. A value near 1930 would mean the range is standard.
3. A capture with raw bytes on, to settle finding 4.

## The quirk as implemented

* **Flag:** `speed_sent_in_tenth_kmh`, defined in `docs/devices/quirks.md`. The FTMS driver sends
  Set Target Speed in tenths of a km/h, rounded up to the next tenth so a console that truncates to
  0.1 mph shows the intended value. For example, 3.0 mph is sent as 49, which displays as 3.0.
  Reported speed is read in standard units.
* **Scope:** the `horizon_7_series` entry sets it for every 7-series name: 7.0AT, 7.4AT and 7.8AT.
  The `horizon_7_8` user-option entry sets it too. This is an assumption: it was measured on one 7.0AT,
  on firmware 3.001 and the latest. On a 7-series unit whose firmware uses standard units, the belt would run
  ten times too slow, the safe way to be wrong. Turn it off for such a unit with
  `quirkOverrides: { flags: { speed_sent_in_tenth_kmh: false } }`.
* **Survives the protocol switch:** the flag is on a Horizon-protocol entry, but the session keeps it
  when it picks FTMS, because the flag describes the FTMS firmware.
* **Speed limits:** the entry also sets the range to 0.8 to 19.3 km/h (0.5 to 12 mph). The older
  `horizon_proprietary` entry allowed 22 km/h.

Not done yet:

* **Automatic detection** from the Speed Range characteristic, pending its raw value (item 2 above).
* **A safety guard for every treadmill:** send Stop if the reported speed runs well past the target.
* **Reporting upstream** to QZ and Horizon.
