import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ByteWriter, crc16CcittFalse, fromHex, hex } from '../src/core/bytes.ts';
import { cmd, parseCrossTrainerData, parseIndoorBikeData, parseResponse, parseRowerData, parseTreadmillData } from '../src/protocols/ftms/codec.ts';
import { horizon, HorizonReassembler, parseHorizonStatus } from '../src/protocols/horizon.ts';
import { decodeHubSimulationGrade, hubGearRatio, hubSimulation, parseRidingData, ZWIFT_GEAR_RATIOS_X10000 } from '../src/protocols/zwift/zap.ts';
import { encodeVarint } from '../src/protocols/zwift/protobuf.ts';
import { CyclingPowerDriver, parseHeartRate, parseCsc, RevolutionRate } from '../src/protocols/sensors.ts';

test('CRC-16/CCITT-FALSE check value', () => {
  assert.equal(crc16CcittFalse(new TextEncoder().encode('123456789')), 0x29b1);
});

test('FTMS Indoor Bike Data: speed, cadence, power', () => {
  const d = new ByteWriter().u16(0x0044).u16(3500).u16(170).s16(250).toBytes();
  assert.deepEqual(parseIndoorBikeData(d), { speedKmh: 35, cadenceRpm: 85, powerW: 250 });
});

test('FTMS Indoor Bike Data: average speed and power stand in for missing instant values', () => {
  // bit0 set (no instant speed), bit1 average speed, bit7 average power
  const d = new ByteWriter().u16(0x0083).u16(2000).s16(180).toBytes();
  assert.deepEqual(parseIndoorBikeData(d), { speedKmh: 20, powerW: 180 });
});

test('FTMS Treadmill Data with incline and elapsed time', () => {
  const d = new ByteWriter().u16(0x040c).u16(850).u24(1234).s16(25).s16(0).u16(600).toBytes();
  assert.deepEqual(parseTreadmillData(d), { speedKmh: 8.5, deviceDistanceM: 1234, inclinePct: 2.5, deviceElapsedS: 600 });
});

test('FTMS Treadmill Data: Horizon default flags 84 04 parse', () => {
  const d = new ByteWriter().u16(0x0484).u16(500).u24(10).u16(5).u16(300).u8(2).u16(42).toBytes();
  const out = parseTreadmillData(d);
  assert.equal(out.speedKmh, 5);
  assert.equal(out.deviceEnergyKcal, 5);
  assert.equal(out.deviceElapsedS, 42);
});

test('FTMS Cross Trainer Data uses 3-byte flags and halves the step rate', () => {
  const d = new ByteWriter().u24(0x000108).u16(900).u16(120).u16(110).s16(140).toBytes();
  assert.deepEqual(parseCrossTrainerData(d), { speedKmh: 9, stepRatePerMin: 120, cadenceRpm: 60, powerW: 140 });
});

test('FTMS Rower Data: half-stroke units and pace', () => {
  const d = new ByteWriter().u16(0x0028).u8(60).u16(12).u16(120).s16(210).toBytes();
  assert.deepEqual(parseRowerData(d), { strokeRatePerMin: 30, strokeCount: 12, paceSecPer500m: 120, speedKmh: 15, powerW: 210 });
  assert.equal(parseRowerData(d, true).strokeRatePerMin, 60);
});

test('FTMS control point encoders', () => {
  assert.equal(hex(cmd.setSpeed(8)), '02 20 03');
  assert.equal(hex(cmd.setSpeedRaw(49)), '02 31 00');
  assert.equal(hex(cmd.setIncline(-1.5)), '03 f1 ff');
  assert.equal(hex(cmd.setPower(200)), '05 c8 00');
  // QZ's fixed road: Crr 0.004 -> 0x28, Cw 0.25 -> 0x19
  assert.equal(hex(cmd.setSimulation({ gradePct: -2.5, windMps: 0, crr: 0.004, cwKgPerM: 0.25 })), '11 00 00 06 ff 28 19');
  assert.equal(hex(cmd.setResistanceU16x10(8)), '04 50 00');
  assert.deepEqual(parseResponse(fromHex('80 00 01')), { op: 0, result: 'success' });
  assert.deepEqual(parseResponse(fromHex('80 11 05')), { op: 0x11, result: 'control_not_permitted' });
});

test('Horizon frames match the captures in the docs', () => {
  assert.equal(hex(horizon.hello()), '55 aa 01 00 01 02 00 00 00 00');
  // 2.1 mph, message id 0x32
  assert.equal(hex(horizon.setSpeed(0x32, 3.38)), '55 aa 32 00 03 05 04 00 53 2c 00 15 00 00');
  // 1.0 %, message id 0x38
  assert.equal(hex(horizon.setIncline(0x38, 1.0)), '55 aa 38 00 03 06 03 00 5d 0b 0a 00 00');
  assert.equal(hex(horizon.pause(0x20)), '55 aa 20 00 03 03 01 00 f0 e1 00');
  assert.equal(hex(horizon.resume(0x20)), '55 aa 20 00 03 03 01 00 d1 f1 01');
  assert.equal(hex(horizon.stop(0x21)), '55 aa 21 00 01 14 00 00 00 00');
});

test('Horizon reassembles 20-byte chunks and parses the 0x17 status frame', () => {
  const frame = new Uint8Array(80);
  frame.set([0x55, 0xaa, 0, 0, 0x03, 0x17, 70, 0]);
  frame[24] = 500 & 0xff;
  frame[25] = 500 >> 8; // 5.00 mph
  frame[30] = 25; // 2.5 %
  const asm = new HorizonReassembler();
  const got: Uint8Array[] = [];
  for (let i = 0; i < frame.length; i += 20) got.push(...asm.push(frame.slice(i, i + 20)));
  assert.equal(got.length, 1);
  const s = parseHorizonStatus(got[0]!)!;
  assert.ok(Math.abs(s.speedKmh! - 8.0467) < 0.001);
  assert.equal(s.inclinePct, 2.5);
});

test('Zwift protocol encodings match QZ and Zwift captures', () => {
  assert.equal(hex(hubSimulation({ gradePct: 0.4 })), '04 22 02 10 50');
  assert.equal(hex(hubSimulation({ gradePct: -0.85 })), '04 22 03 10 a9 01');
  assert.equal(hex(hubSimulation({ gradePct: 0 })), '04 22 02 10 00');
  assert.equal(hex(hubSimulation({ gradePct: 1.73, windMps: 0, cwa: 0.51, crr: 0.004 })), '04 22 0b 08 00 10 da 02 18 ec 27 20 90 03');
  assert.equal(hex(hubGearRatio(2.4)), '04 2a 04 10 c0 bb 01');
  assert.equal(decodeHubSimulationGrade(fromHex('04 22 03 10 a9 01')), -0.85);
});

test('Zwift gear table round-trips through the documented varints', () => {
  assert.equal(ZWIFT_GEAR_RATIOS_X10000.length, 24);
  assert.equal(hex(Uint8Array.from(encodeVarint(ZWIFT_GEAR_RATIOS_X10000[0]!))), 'cc 3a');
  assert.equal(hex(Uint8Array.from(encodeVarint(ZWIFT_GEAR_RATIOS_X10000[12]!))), 'f3 cb 01');
  assert.equal(hex(Uint8Array.from(encodeVarint(ZWIFT_GEAR_RATIOS_X10000[23]!))), 'f3 ac 03');
});

test('Zwift riding data', () => {
  assert.deepEqual(parseRidingData(fromHex('03 08 c8 01 10 55 18 ac 1b 20 00')), { powerW: 200, cadenceRpm: 85, speedKmh: 35 });
});

test('Heart rate: 8- and 16-bit forms', () => {
  assert.equal(parseHeartRate(fromHex('00 48')), 72);
  assert.equal(parseHeartRate(fromHex('01 2c 01')), 300);
});

test('Crank revolutions become cadence and go stale', () => {
  const r = new RevolutionRate(1024, 0x10000, 3000);
  assert.equal(r.update({ revs: 10, time: 1024 }, 0), 0);
  assert.equal(r.update({ revs: 11, time: 2048 }, 1000), 60);
  assert.equal(r.update({ revs: 11, time: 2048 }, 2000), 60);
  assert.equal(r.update({ revs: 11, time: 2048 }, 5000), 0);
  // counter wrap
  const w = new RevolutionRate(1024, 0x10000);
  w.update({ revs: 0xffff, time: 0xfc00 }, 0);
  assert.equal(w.update({ revs: 0x0001, time: 0x0400 }, 1000), 60);
});

test('CSC wheel and crank sections parse', () => {
  const d = new ByteWriter().u8(0x03).raw([1, 0, 0, 0]).u16(1024).u16(5).u16(2048).toBytes();
  assert.deepEqual(parseCsc(d), { wheel: { revs: 1, time: 1024 }, crank: { revs: 5, time: 2048 } });
  assert.ok(CyclingPowerDriver);
});

test('FTMS Feature names the machine and target bits', async () => {
  const { parseFeature } = await import('../src/protocols/ftms/codec.ts');
  // average speed, total distance, expended energy, heart rate, elapsed time; targets: speed and incline
  const f = parseFeature(fromHex('05 16 00 00 03 00 00 00'));
  assert.equal(f.machineRaw, 0x1605);
  assert.deepEqual(f.machine, ['Average Speed', 'Total Distance', 'Expended Energy', 'Heart Rate Measurement', 'Elapsed Time']);
  assert.deepEqual(f.target, ['Speed Target', 'Inclination Target']);
  assert.deepEqual(parseFeature(fromHex('01')).machine, [], 'short frames read as no features');
});
