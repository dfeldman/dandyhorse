import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceSession } from '../src/session/session.ts';
import { DeviceManager } from '../src/session/manager.ts';
import { SimulatedBike } from '../src/sim/bike.ts';
import { SimulatedTreadmill } from '../src/sim/treadmill.ts';
import { MockAdapter, MockPeripheral } from '../src/transport/mock.ts';
import { UUID } from '../src/core/uuid.ts';
import { Logger, TraceRecorder } from '../src/core/log.ts';
import { hubGearRatio, ZWIFT_GEAR_RATIOS } from '../src/protocols/zwift/zap.ts';
import { hex } from '../src/core/bytes.ts';
import { flush, ManualClock, slowWrites, waitFor } from './helpers.ts';

const quiet = { autoTick: false, autoReconnect: false } as const;

test('Horizon 7.0AT with FTMS: FTMS is preferred and drives speed and incline', async () => {
  const sim = new SimulatedTreadmill({ horizonVendorService: true });
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  assert.equal(s.info.entry?.id, 'horizon_7_series');
  assert.equal(s.info.protocolId, 'ftms');
  assert.equal(s.info.selection, 'preferred-ftms');
  assert.equal(s.info.protocolName, 'Bluetooth FTMS');
  assert.deepEqual(s.info.protocolOptions.native, { id: 'horizon', name: 'Horizon (Johnson Health Tech)', implemented: true });
  assert.equal(s.info.protocolOptions.switchable, true);
  assert.equal(s.deviceClass, 'treadmill');
  // Treadmills only request control on connect; Start would move the belt.
  assert.deepEqual(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT), ['00']);

  s.setTargetSpeed(8);
  s.setTargetIncline(2.3);
  await s.tick();
  // Horizon 7-series firmware reads target speed in 0.1 km/h: 8 km/h goes out as 80, not 800.
  assert.deepEqual(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).slice(1), ['00', '07', '02 50 00', '00', '03 19 00']);
  assert.equal(sim.targetSpeedKmh, 8);
  assert.equal(sim.targetInclinePct, 2.5);

  // Unchanged targets are not re-sent.
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).length, 6);

  sim.speedKmh = 8;
  sim.step(0);
  await flush();
  const t = await s.tick();
  assert.equal(t.speedKmh, 8);
  assert.ok(t.computed.includes('powerW'), 'treadmill power is computed');
  assert.ok(t.powerW! > 100);
  await s.disconnect();
});

test('Horizon 7 series: speed in tenths of a km/h, rounded up so mph targets display exactly', async () => {
  const sim = new SimulatedTreadmill({ horizonVendorService: true });
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  assert.ok(!s.info.unhandledFlags.includes('speed_sent_in_tenth_kmh'));
  assert.equal(s.capabilities.limits.speedKmh?.max, 19.3);
  s.setTargetSpeed(3 * 1.609344); // 3.0 mph = 4.83 km/h; 48 would show 2.9 mph on a truncating console
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '02 31 00');
  assert.equal(sim.targetSpeedKmh, 4.9);
  s.setTargetSpeed(30);
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '02 c1 00', 'clamped to 19.3 km/h');
  await s.disconnect();
});

test('the tenths quirk can be switched off for a unit with standard firmware', async () => {
  const sim = new SimulatedTreadmill({ horizonVendorService: true, speedCommandUnitKmh: 0.01 });
  const s = await DeviceSession.connect(sim.peripheral, { ...quiet, quirkOverrides: { flags: { speed_sent_in_tenth_kmh: false } } });
  s.setTargetSpeed(8);
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '02 20 03');
  assert.equal(sim.targetSpeedKmh, 8);
  await s.disconnect();
});

test('raw control frames go through the FTMS queue, and the tick loop leaves them alone', async () => {
  const sim = new SimulatedTreadmill();
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  assert.equal(await s.sendRawControl(Uint8Array.of(0x00)), 'success');
  assert.equal(await s.sendRawControl(Uint8Array.of(0x07)), 'success');
  assert.equal(await s.sendRawControl(Uint8Array.of(0x02, 0x1e, 0x00)), 'success');
  assert.equal(sim.targetSpeedKmh, 0.3, 'below the usual minimum, which setTargetSpeed would raise');
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '02 1e 00');
  assert.equal(hex(await s.readRaw(UUID.SUPPORTED_SPEED_RANGE)), '50 00 d0 07 0a 00');
  await s.disconnect();
});

test('the FTMS/native switch changes protocol on the live connection', async () => {
  const sim = new SimulatedTreadmill({ horizonVendorService: true });
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  await s.setProtocolPreference('native');
  assert.equal(s.info.protocolId, 'horizon');
  assert.equal(s.info.protocolName, 'Horizon (Johnson Health Tech)');
  assert.ok(sim.peripheral.writesTo(UUID.VENDOR_FFF3).includes('55 aa 01 00 01 02 00 00 00 00'));
  assert.equal(s.capabilities.speed, false, 'vendor control stays off unless the app opts in');
  assert.equal(sim.peripheral.isSubscribed(UUID.TREADMILL_DATA), false);
  await s.setProtocolPreference('ftms');
  assert.equal(s.info.protocolId, 'ftms');
  await s.disconnect();
});

test('unknown FTMS trainer: grade uses fixed wind and rolling resistance, gears add grade', async () => {
  const sim = new SimulatedBike();
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  assert.equal(s.info.selection, 'standard');
  assert.equal(s.deviceClass, 'bike');
  assert.deepEqual(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT), ['00', '07']);
  s.setGrade(3);
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '11 00 00 2c 01 28 19');
  assert.equal(sim.gradePct, 3);
  s.shiftUp();
  await s.tick();
  assert.equal(sim.gradePct, 3.5);
  s.setTargetPower(200);
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '05 c8 00');
  sim.step();
  await flush();
  const t = await s.tick();
  assert.equal(t.powerW, 200);
  assert.equal(t.cadenceRpm, 85);
  assert.equal(t.gear, 13);
  await s.disconnect();
});

test('Zwift Hub over the Zwift protocol: grade and native gears, no FTMS 0x11', async () => {
  const sim = new SimulatedBike({ zwiftHub: true });
  const s = await DeviceSession.connect(sim.peripheral, { ...quiet, zwiftProtocol: true });
  assert.equal(s.info.entry?.id, 'zwift_hub');
  assert.equal(s.info.protocolName, 'Bluetooth FTMS + Zwift protocol');
  assert.equal(s.capabilities.nativeGears, true);
  assert.equal(sim.zwiftCommands[0], '52 69 64 65 4f 6e 02 01');
  s.setGrade(0.4);
  await s.tick();
  assert.ok(sim.zwiftCommands.includes('04 22 02 10 50'));
  assert.ok(sim.zwiftCommands.includes('04 2a 04 10 c0 bb 01'), 'gear 12 = ratio 2.4');
  assert.equal(sim.gradePct, 0.4, 'gears do not change the grade on native-gear trainers');
  s.shiftUp();
  await s.tick();
  await flush();
  assert.ok(sim.zwiftCommands.includes(hex(hubGearRatio(ZWIFT_GEAR_RATIOS[12]!))));
  assert.equal(sim.gearRatio, ZWIFT_GEAR_RATIOS[12]);
  assert.ok(!sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).some((w) => w.startsWith('11')));
  await s.disconnect();
});

test('Zwift Hub: returning from ERG to the same grade re-sends it over the Zwift protocol', async () => {
  const sim = new SimulatedBike({ zwiftHub: true });
  const s = await DeviceSession.connect(sim.peripheral, { ...quiet, zwiftProtocol: true });
  const grade3 = '04 22 03 10 d8 04';
  s.setGrade(3);
  await s.tick();
  s.setTargetPower(200);
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '05 c8 00');
  s.setGrade(3);
  await s.tick();
  await flush();
  assert.equal(sim.zwiftCommands.filter((c) => c === grade3).length, 2);
  assert.equal(sim.mode, 'sim');
  await s.disconnect();
});

test('Zwift Hub without the Zwift protocol is a plain FTMS trainer', async () => {
  const sim = new SimulatedBike({ zwiftHub: true });
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  assert.equal(s.info.protocolName, 'Bluetooth FTMS');
  s.setGrade(-1);
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '11 00 00 9c ff 28 19');
  assert.equal(sim.zwiftCommands.length, 0);
  await s.disconnect();
});

test('telemetry goes stale, and distance integrates from speed', async () => {
  const clock = new ManualClock();
  const sim = new SimulatedTreadmill();
  const s = await DeviceSession.connect(sim.peripheral, { ...quiet, clock });
  sim.speedKmh = 3.6; // 1 m/s
  sim.running = true;
  sim.step(0);
  await flush();
  await s.tick();
  for (let i = 0; i < 10; i++) {
    clock.advance(1000);
    sim.step(0);
    await flush();
    await s.tick();
  }
  const t = s.telemetry!;
  assert.ok(Math.abs(t.distanceM - 10) < 0.01, `distance ${t.distanceM}`);
  assert.equal(t.fresh, true);
  clock.advance(5000);
  const stale = await s.tick();
  assert.equal(stale.fresh, false);
  assert.equal(stale.speedKmh, 0);
  await s.disconnect();
});

test('reconnects after the link drops and re-sends targets', async () => {
  const sim = new SimulatedTreadmill();
  const s = await DeviceSession.connect(sim.peripheral, { autoTick: false, reconnectDelaysMs: [10, 10] });
  const states: string[] = [];
  s.events.on('state', (st) => states.push(st));
  s.setTargetSpeed(6);
  await s.tick();
  const before = sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).filter((w) => w.startsWith('02')).length;
  sim.peripheral.failConnects = 1;
  sim.peripheral.simulateDisconnect();
  await waitFor(() => s.state === 'ready' && states.includes('reconnecting'));
  await s.tick();
  const after = sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).filter((w) => w.startsWith('02')).length;
  assert.equal(after, before + 1);
  await s.disconnect();
});

test('a device without a driver is captured raw, and every byte is traced', async () => {
  const p = new MockPeripheral({
    name: 'MYSTERY-1',
    services: [{ uuid: 0xffe0, characteristics: [{ uuid: 0xffe1, properties: { notify: true } }] }],
  });
  const rec = new TraceRecorder();
  const s = await DeviceSession.connect(p, { ...quiet, log: new Logger({ sinks: [rec] }) });
  assert.equal(s.info.selection, 'raw');
  p.notify(0xffe1, Uint8Array.of(1, 2, 3));
  await flush();
  assert.ok(rec.traces.some((r) => r.dir === 'rx' && r.hex === '01 02 03'));
  await s.disconnect();
});

test('manager merges a heart-rate strap into the machine telemetry', async () => {
  const bike = new SimulatedBike();
  const strap = new MockPeripheral({
    name: 'HRM-Pro',
    services: [{ uuid: UUID.HEART_RATE, characteristics: [{ uuid: UUID.HEART_RATE_MEASUREMENT, properties: { notify: true } }] }],
  });
  const m = new DeviceManager(new MockAdapter([bike.peripheral, strap]), quiet);
  const b = await m.connect(bike.peripheral);
  const h = await m.connect(strap);
  assert.equal(h.info.protocolName, 'Bluetooth Heart Rate');
  strap.notify(UUID.HEART_RATE_MEASUREMENT, Uint8Array.of(0, 142));
  bike.step();
  await flush();
  await h.tick();
  await b.tick();
  const t = m.merged()!;
  assert.equal(t.heartRateBpm, 142);
  assert.equal(t.powerW, 150);
  await m.disconnectAll();
});

test('requestDevice asks for every service the registry knows', async () => {
  const bike = new SimulatedBike();
  const adapter = new MockAdapter([bike.peripheral]);
  const m = new DeviceManager(adapter, quiet);
  await m.requestDevice();
  const services = adapter.lastRequest?.optionalServices ?? [];
  assert.ok(services.includes(UUID.FTMS));
  assert.ok(services.includes(UUID.ZWIFT_SERVICE));
  assert.ok(services.includes('49535343-fe7d-4ae5-8fa9-9fafd205e455'));
  assert.ok(!services.includes(UUID.INDOOR_BIKE_DATA), 'characteristic UUIDs are left out');
});

test('float noise from m/s does not round a Horizon speed target up a whole tenth', async () => {
  const sim = new SimulatedTreadmill({ horizonVendorService: true });
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  assert.ok(s.info.quirkFlags.includes('speed_sent_in_tenth_kmh'));
  s.setTargetSpeed(0.5556 * 3.6); // 2 km/h after an app rounded it to 0.0001 m/s: 2.000016 km/h
  await s.tick();
  assert.equal(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).at(-1), '02 14 00');
  assert.equal(sim.targetSpeedKmh, 2);
  assert.equal(hex(s.encodeSpeedTarget(1)!), '02 0a 00', 'diagnostics get the same quirk-aware frame');
  await s.disconnect();

  const plain = new SimulatedTreadmill();
  const p = await DeviceSession.connect(plain.peripheral, quiet);
  assert.equal(hex(p.encodeSpeedTarget(1)!), '02 64 00');
  assert.deepEqual(p.info.quirkFlags, []);
  await p.disconnect();
});

test('stop and pause take control first, so an emergency stop works after control was lost', async () => {
  const sim = new SimulatedTreadmill();
  const s = await DeviceSession.connect(sim.peripheral, quiet);
  s.setTargetSpeed(6);
  await s.tick();
  assert.equal(sim.running, true);
  sim.hasControl = false; // another app took control of the machine
  await s.stop();
  assert.deepEqual(sim.peripheral.writesTo(UUID.FTMS_CONTROL_POINT).slice(-2), ['00', '08 01']);
  assert.equal(sim.running, false);
  await s.disconnect();
});

test('the control point waits for the reply after a slow write is acknowledged', async () => {
  const sim = new SimulatedTreadmill();
  // Each write takes 120 ms to be acknowledged; the reply budget is 100 ms, counted from the acknowledgement.
  const s = await DeviceSession.connect(slowWrites(sim.peripheral, 120), { ...quiet, quirkOverrides: { params: { control_timeout_ms: 100 } } });
  assert.equal(await s.sendRawControl(Uint8Array.of(0x00)), 'success');
  assert.equal(await s.sendRawControl(Uint8Array.of(0x07)), 'success');
  await s.disconnect();
});

test('a Horizon-firmware simulator behaves like the measured 7.0AT: no incline, no status, mph range numbers', async () => {
  const clock = new ManualClock();
  const sim = new SimulatedTreadmill({ horizonVendorService: true, horizonFirmware: true });
  const s = await DeviceSession.connect(sim.peripheral, { ...quiet, clock });
  assert.equal(s.info.entry?.id, 'horizon_7_series');
  assert.equal(hex(await s.readRaw(UUID.SUPPORTED_SPEED_RANGE)), '32 00 b0 04 0a 00');
  assert.equal(s.capabilities.limits.speedKmh?.max, 19.3, 'the registry wins over the mph numbers');
  const notices: string[] = [];
  s.events.on('notice', (n) => notices.push(n.kind));
  sim.userStart();
  sim.userSpeed(4.2);
  assert.equal(sim.targetSpeedKmh, 5);
  clock.advance(6000); // past the speed the firmware reports right after connecting
  sim.step(0);
  await flush();
  const t = await s.tick();
  assert.equal(t.speedKmh, 5);
  assert.equal(t.inclinePct, undefined, 'no incline field in its Treadmill Data');
  sim.userStop();
  await flush();
  assert.deepEqual(notices, [], 'its own buttons are never reported');
  await s.disconnect();

  const plain = new SimulatedTreadmill();
  const p = await DeviceSession.connect(plain.peripheral, quiet);
  const seen: string[] = [];
  p.events.on('notice', (n) => seen.push(n.kind));
  plain.userStart();
  plain.userStop();
  await flush();
  assert.deepEqual(seen, ['started_by_user', 'stopped_by_user'], 'standard FTMS reports them');
  await p.disconnect();
});
