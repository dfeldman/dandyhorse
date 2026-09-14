# devicelib

A TypeScript library for exercise games that talk to treadmills, bikes, smart trainers,
ellipticals, rowers and sensors over Bluetooth LE. It hides the protocols behind one small API:
connect, read telemetry, set speed, incline, grade, power or resistance, and shift virtual gears.

It has no runtime dependencies and no framework. It runs in the browser today (Web Bluetooth) and
is structured so native apps can reuse it. The device knowledge comes from
[`../docs/devices`](../docs/devices), the protocol notes extracted from QZ (qdomyos-zwift).

## Status

| area | state |
|---|---|
| Web Bluetooth transport | done |
| Mock transport and simulated treadmill and trainer | done; used by tests and the demo |
| Registry matching, all 174 entries, quirk flags | done |
| FTMS: treadmill, bike, elliptical, rower | done, with about 45 quirk flags implemented |
| Zwift Hub: FTMS, plus the Zwift protocol for grade and native gears | done; Zwift protocol is opt-in |
| Horizon vendor protocol | telemetry done; control opt-in and incomplete (see below) |
| Standard sensors: heart rate, cycling power, speed/cadence, running speed/cadence | read-only, done |
| Every other vendor protocol | raw capture: connects, subscribes, logs every byte |

First hardware tests were on a Horizon 7.0AT; see Hardware notes below. The Zwift Hub is untested.
Unit tests use byte captures from the docs and the simulators.

## Quick start (web)

```js
import { DeviceManager, WebBluetoothAdapter, Logger, consoleSink } from './dist/index.js';

const manager = new DeviceManager(new WebBluetoothAdapter(), {
  log: new Logger({ sinks: [consoleSink()] }),
  rider: { weightKg: 80 },
});

connectButton.onclick = async () => {
  const session = await manager.requestAndConnect(); // opens the browser's chooser
  console.log(session.info.protocolName);            // e.g. "Bluetooth FTMS"
  session.setGrade(4);                                // trainers simulate it, treadmills tilt
};

manager.events.on('telemetry', (t) => {
  // t.speedKmh, t.powerW, t.cadenceRpm, t.inclinePct, t.heartRateBpm, t.distanceM, ...
  // t.computed lists values devicelib estimated; t.fresh is false when data stopped.
});
```

Without hardware, use `createSimulatorAdapter()` instead of `WebBluetoothAdapter`. `SimulatedTreadmill({ horizonVendorService: true,
horizonFirmware: true })` behaves like the measured Horizon 7.0AT: tenths of a km/h, no incline in
its Treadmill Data, no Machine Status, the mph numbers in its Speed Range. `userStart()`,
`userSpeed(deltaKmh)` and `userStop()` press a simulated machine's own buttons.

## The API a game uses

`DeviceManager` holds a machine plus optional sensors, merges their telemetry, and forwards
controls to the machine. `DeviceSession` is one device:

| call | what happens |
|---|---|
| `setTargetSpeed(kmh)`, `setTargetIncline(pct)` | treadmills; clamped and rounded to the device's steps |
| `setGrade(pct)` | trainers: FTMS simulation with the fixed road in `road` (wind 0, Crr 0.004, Cw 0.25). Console bikes: a mapped resistance level. Treadmills and ellipticals: incline. |
| `setTargetPower(w)` | ERG |
| `setResistance(level)` | a plain level |
| `shiftUp()`, `shiftDown()`, `setGear(n)` | native gears on Zwift-protocol trainers; otherwise emulated as +0.5 % grade (or +1 level) per gear |
| `start()`, `pause()`, `stop()` | workout commands, each after Request Control; `stop()` also clears the speed target |
| `sendRawControl(bytes)`, `encodeSpeedTarget(kmh)`, `readRaw(uuid)` | diagnostics: a raw control-point frame through the queue, the speed frame `setTargetSpeed` would send in the device's own units, any readable characteristic |
| `setProtocolPreference('auto' \| 'ftms' \| 'native')` | the "prefer FTMS or device native" switch, applied on the live connection |

Targets are desired state. The session reconciles them every tick (200 ms) and sends only what
changed, one control write at a time. After a reconnect everything is re-sent.

`session.info` describes the device for the UI: `protocolName` (a friendly name),
`selectionNote` (why that protocol), `protocolOptions` (whether an FTMS/native switch makes sense),
the registry entry, variants the user may need to pick, the quirk flags in force and those not
implemented yet, device information strings, and the GATT table. `ftmsCodec` exports the FTMS wire
format (frame builders, parsers, Feature bits, op, result and status names) for diagnostics tools.

`Telemetry` fields are `undefined` when the device does not report them, never a fake zero.
Distance, time and energy are always integrated by the session. Treadmill power and bike speed
are computed when missing and listed in `computed`.

## Layers

```
game
 └─ session/    DeviceManager, DeviceSession, telemetry integration, physics, gears, reconnect
     └─ protocols/   one module per device family: ftms/, horizon.ts, zwift/, sensors.ts, raw.ts
         ├─ registry/  matcher over the generated registry, friendly protocol names
         ├─ quirks/    typed flag and param access
         └─ transport/ BleAdapter interface: webbluetooth.ts, mock.ts, gatt.ts (tracing)
             └─ core/  bytes, events, logging, clock, UUIDs, types
```

Only `transport/webbluetooth.ts` touches a platform API. Codecs are pure functions over
`Uint8Array`. Time comes from an injected `Clock`, so everything is testable.

### Logging

`Logger` has two channels. Log records are leveled messages. Trace records are every byte
written, read or notified, as hex with a timestamp and characteristic label. Add sinks with
callbacks, or a `TraceRecorder` to keep them in memory. A recorded capture is the fastest way to
add or debug a device: the demo's "Download capture" button saves one.

### Protocol choice

After connecting, the session matches the registry with the real GATT table, then picks:

1. the protocol the user forced, if any;
2. with preference `native`: the vendor protocol, or a raw capture of it if not implemented;
3. FTMS, when present and the preference is `ftms` or the entry says `prefer_ftms`;
4. the entry's own protocol, when devicelib implements it;
5. FTMS as a fallback, then a standard sensor profile, then raw capture.

When the session switches a device away from its registry protocol, only portable quirks carry
over, because the entry's flags describe the vendor path.

## Adding a device family

1. Write a driver: extend `BaseDriver` in `src/protocols/`, implement `start`, `capabilities`,
   `apply(targets)` and `command`, and emit `DeviceData` from notifications.
2. List the quirk flags it acts on in `handledFlags`; the session reports the rest.
3. `registerDriver('<protocol id from quirks.yaml>', (ctx) => new MyDriver(ctx))`.
4. Test the codec against captured bytes, and the session against a `MockPeripheral`.

## The registry

`docs/devices/quirks.yaml` is the source of truth. `npm run gen:registry` (Python 3 with PyYAML)
writes:

* `src/registry/entries.generated.ts` and `src/quirks/flags.generated.ts` for this library;
* `generated/registry.json`, the same data as plain JSON for native ports.

## Native apps

The structure leaves room for them in two ways:

* **Same code, new transport.** Hybrid apps (Capacitor, React Native, Electron) implement the four
  interfaces in `transport/types.ts` over their BLE plugin. Nothing else changes.
* **Native code, shared data.** Swift or Kotlin code loads `generated/registry.json` and ports the
  small, pure codecs. The tests double as the byte-level spec.

## Horizon vendor protocol

The Horizon 7.0AT also exposes FTMS, which is the default. The vendor path reads speed and
incline. Its control needs an init that rewrites all of the console's user profiles, which is not
implemented. With `vendorControl: true` devicelib sends speed and incline frames without that
init, and the belt may ignore them.

## Hardware notes

Findings from real devices live in [`docs/hardware/`](docs/hardware):

* [Horizon 7.0AT](docs/hardware/horizon-7.0at.md): firmware 3.001 and the latest both read FTMS
  target speed in 0.1 km/h instead of 0.01 km/h. The `speed_sent_in_tenth_kmh` quirk handles it, and is assumed for
  every Horizon 7-series treadmill.

## Deliberate differences from QZ

* **Treadmill incline writes send `00` then `03`.** QZ's generic FTMS treadmill path sends
  `00 07 03`, re-sending Start before every incline change. devicelib leaves out `07` because
  Start can move a stopped belt. If a treadmill refuses incline changes, try adding `07` first.
* **Treadmills get only Request Control on connect**, not Start, for the same reason. Bikes and
  rowers get both, as in QZ.
* **Control-point replies get 1.5 s, counted from the acknowledged write.** QZ waits 300 ms from
  the write call. On a Horizon 7.0AT, 300 ms counted from before the write never saw a reply, while
  the Dandyhorse bridge's 3 s wait always did (`80 02 01`). Set `control_timeout_ms` to change it.
* **Stop and pause send Request Control first**, as start does, so an emergency stop still works
  after the machine took control back.

## Development

```bash
npm install
npm test            # node --test, runs the TypeScript sources directly (Node 22.6+)
npm run typecheck
npm run build       # emits dist/ (ES modules, .d.ts)
npm run demo        # build, then serve on http://localhost:8321/demo/
```

The demo needs Chrome or Edge for Web Bluetooth; its simulator buttons work in any browser.
