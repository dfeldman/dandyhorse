# Peloton Bike and Bike+

**Peloton bikes send no sensor data over Bluetooth or ANT+ to third-party
apps.** The flywheel sensor talks to the Peloton tablet over an internal
serial link. The Bluetooth device a phone sees is the tablet itself. A game
cannot read a Peloton bike directly (issue #3914).

**Recommendation: do not support directly.** It needs a sideloaded app on the Peloton tablet. If a rider runs such a bridge, the bike appears as an ordinary FTMS or Cycling Power device and needs no special code.

There is no resistance control either. The Bike has a manual knob. The
Bike+ motor is driven only by Peloton's own software. QZ's Peloton driver has
an empty `forceResistance`.

Source: `src/devices/pelotonbike/pelotonbike.cpp` (QZ).

## How QZ gets data

**1. QZ on the tablet, with a Grupetto backend.** The rider sideloads QZ onto
the Peloton tablet. QZ CI builds two special APKs, one for the Bike and one
for the Bike+. They read the bike through Peloton's internal Android system
service, the method used by the open-source Grupetto overlay
(github.com/selalipop/grupetto). QZ then acts as an FTMS/Cycling Power bike
for Zwift or MyWhoosh on another device.

* Sideloading requires developer access on the tablet (users follow the
  "OpenPelo" guide). Grupetto's author notes it was put behind an active
  Peloton subscription.
* The system service is undocumented. A Peloton update broke Grupetto on the
  non-plus Bike in 2025, with metrics shown as "asleep" (issue #3574); it
  worked again by late 2025 (issue #3914).
* Early builds reported Bike+ speed and power far too high (issue #3652) and
  treated mph as km/h (issue #4604). Both are fixed. Check units if you
  implement this.

**2. UDP text on port 8003** (QZ setting `peloton_bike_ocr`). QZ listens on
UDP 8003 on all interfaces. Any bridge on the tablet can send:

```
<anything>;<watts>;<cadence rpm>;<resistance 0-100>;<speed>
```

Field 0 is ignored. QZ replies to the sender's port 8003 with the URL of its
floating-overlay web page. The same port and reply are used by QZ's iFit
companion apps (see `../treadmills/ifit.md`).

## What a game can do

* Treat a Peloton as unsupported unless the rider runs a bridge on the
  tablet that re-broadcasts it as an FTMS or Cycling Power bike. QZ and
  Grupetto-based tools do this.
* Once bridged, it is a read-only bike: power, cadence, Peloton resistance
  (0-100) and speed. Grade must be shown to the rider as a target
  resistance, which they set by hand.

The "Peloton resistance" scale that QZ computes for other bikes comes from
Peloton's power model; see `../qz-base-behavior.md`.
