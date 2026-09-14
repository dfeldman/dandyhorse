/**
 * Standard Bluetooth sensor profiles, read-only: Heart Rate (0x180D), Cycling Power (0x1818),
 * Cycling Speed and Cadence (0x1816) and Running Speed and Cadence (0x1814).
 * These cover power meters, HR straps, foot pods, and trainers whose control protocol is not implemented.
 */
import { ByteReader } from '../core/bytes.ts';
import type { Capabilities, DeviceClass, DeviceData } from '../core/types.ts';
import { noCapabilities } from '../core/types.ts';
import { UUID } from '../core/uuid.ts';
import type { QuirkFlag } from '../quirks/flags.generated.ts';
import { BaseDriver, INFORMATIONAL_FLAGS, type DriverContext } from './driver.ts';

// ---------------------------------------------------------------- codecs

export function parseHeartRate(d: Uint8Array): number {
  const r = new ByteReader(d);
  const flags = r.u8();
  return flags & 0x01 ? r.u16() : r.u8();
}

export interface RevolutionSample {
  revs: number;
  /** Event time in the profile's units (1/1024 s for crank and CSC wheel, 1/2048 s for CPS wheel). */
  time: number;
}

export interface CyclingPowerSample {
  powerW: number;
  crank?: RevolutionSample;
  wheel?: RevolutionSample;
}

/** Cycling Power Measurement, 0x2A63. */
export function parseCyclingPower(d: Uint8Array): CyclingPowerSample {
  const r = new ByteReader(d);
  const f = r.u16();
  const out: CyclingPowerSample = { powerW: r.s16() };
  if (f & 0x0001) r.u8(); // pedal power balance
  if (f & 0x0004) r.u16(); // accumulated torque
  if (f & 0x0010) out.wheel = { revs: r.u32(), time: r.u16() };
  if (f & 0x0020) out.crank = { revs: r.u16(), time: r.u16() };
  return out;
}

/** CSC Measurement, 0x2A5B. */
export function parseCsc(d: Uint8Array): { wheel?: RevolutionSample; crank?: RevolutionSample } {
  const r = new ByteReader(d);
  const f = r.u8();
  const out: { wheel?: RevolutionSample; crank?: RevolutionSample } = {};
  if (f & 0x01) out.wheel = { revs: r.u32(), time: r.u16() };
  if (f & 0x02) out.crank = { revs: r.u16(), time: r.u16() };
  return out;
}

/** RSC Measurement, 0x2A53. */
export function parseRsc(d: Uint8Array): DeviceData & { strideM?: number } {
  const r = new ByteReader(d);
  const f = r.u8();
  const out: DeviceData & { strideM?: number } = {};
  out.speedKmh = (r.u16() / 256) * 3.6;
  out.stepRatePerMin = r.u8();
  out.cadenceRpm = out.stepRatePerMin;
  if (f & 0x01) out.strideM = r.u16() / 100;
  if (f & 0x02) out.deviceDistanceM = r.u32() / 10;
  return out;
}

/**
 * Turns cumulative revolution counters into a rate. Holds the last rate while events repeat,
 * and drops to zero after `staleMs` without a new revolution.
 */
export class RevolutionRate {
  #last: RevolutionSample | undefined;
  #rate = 0;
  #lastChange = 0;
  readonly timeUnitsPerSecond: number;
  readonly revWrap: number;
  readonly staleMs: number;

  constructor(timeUnitsPerSecond: number, revWrap: number, staleMs = 3000) {
    this.timeUnitsPerSecond = timeUnitsPerSecond;
    this.revWrap = revWrap;
    this.staleMs = staleMs;
  }

  /** Revolutions per minute. */
  update(s: RevolutionSample, now: number): number {
    const last = this.#last;
    this.#last = s;
    if (!last) {
      this.#lastChange = now;
      return 0;
    }
    const dRevs = (s.revs - last.revs + this.revWrap) % this.revWrap;
    const dTime = (s.time - last.time + 0x10000) % 0x10000;
    if (dRevs > 0 && dTime > 0) {
      this.#rate = (dRevs / (dTime / this.timeUnitsPerSecond)) * 60;
      this.#lastChange = now;
    } else if (now - this.#lastChange > this.staleMs) {
      this.#rate = 0;
    }
    return this.#rate;
  }
}

// ---------------------------------------------------------------- drivers

const SENSOR_FLAGS: readonly QuirkFlag[] = [...INFORMATIONAL_FLAGS, 'cadence_from_cps_crank'];

abstract class SensorDriver extends BaseDriver {
  readonly handledFlags = SENSOR_FLAGS;

  capabilities(): Capabilities {
    return noCapabilities();
  }
}

export class HeartRateDriver extends SensorDriver {
  readonly protocolId = 'heart_rate';
  readonly protocolName = 'Bluetooth Heart Rate';
  readonly deviceClass: DeviceClass = 'heart_rate';

  async start(): Promise<void> {
    const c = this.ctx.gatt.char(UUID.HEART_RATE_MEASUREMENT);
    if (!c) throw new Error('no Heart Rate Measurement characteristic');
    await this.listen(c, (d) => this.emitData({ heartRateBpm: parseHeartRate(d) }));
  }
}

export class CyclingPowerDriver extends SensorDriver {
  readonly protocolId = 'cycling_power';
  readonly protocolName = 'Bluetooth Cycling Power';
  readonly deviceClass: DeviceClass;
  #crank = new RevolutionRate(1024, 0x10000);

  constructor(ctx: DriverContext) {
    super(ctx);
    this.deviceClass = ctx.classHint ?? 'bike';
  }

  async start(): Promise<void> {
    const c = this.ctx.gatt.char(UUID.CYCLING_POWER_MEASUREMENT);
    if (!c) throw new Error('no Cycling Power Measurement characteristic');
    await this.listen(c, (d) => {
      const s = parseCyclingPower(d);
      const out: DeviceData = { powerW: s.powerW };
      if (s.crank) out.cadenceRpm = this.#crank.update(s.crank, this.ctx.clock.now());
      this.emitData(out);
    });
    const hr = this.ctx.gatt.char(UUID.HEART_RATE_MEASUREMENT);
    if (hr) await this.listen(hr, (d) => this.emitData({ heartRateBpm: parseHeartRate(d) }));
  }
}

export class CscDriver extends SensorDriver {
  readonly protocolId = 'csc';
  readonly protocolName = 'Bluetooth Speed & Cadence';
  readonly deviceClass: DeviceClass;
  #crank = new RevolutionRate(1024, 0x10000);
  #wheel = new RevolutionRate(1024, 0x100000000);

  constructor(ctx: DriverContext) {
    super(ctx);
    this.deviceClass = ctx.classHint ?? 'sensor';
  }

  async start(): Promise<void> {
    const c = this.ctx.gatt.char(UUID.CSC_MEASUREMENT);
    if (!c) throw new Error('no CSC Measurement characteristic');
    const circumferenceM = this.ctx.quirks.num('wheel_circumference_m', 2.105);
    await this.listen(c, (d) => {
      const s = parseCsc(d);
      const now = this.ctx.clock.now();
      const out: DeviceData = {};
      if (s.crank) out.cadenceRpm = this.#crank.update(s.crank, now);
      if (s.wheel) out.speedKmh = (this.#wheel.update(s.wheel, now) * circumferenceM * 60) / 1000;
      this.emitData(out);
    });
  }
}

export class RscDriver extends SensorDriver {
  readonly protocolId = 'rsc_cps';
  readonly protocolName = 'Bluetooth Running Speed & Cadence';
  readonly deviceClass: DeviceClass = 'run_sensor';

  async start(): Promise<void> {
    const c = this.ctx.gatt.char(UUID.RSC_MEASUREMENT);
    if (!c) throw new Error('no RSC Measurement characteristic');
    await this.listen(c, (d) => {
      const { strideM: _stride, ...data } = parseRsc(d);
      this.emitData(data);
    });
    const cp = this.ctx.gatt.char(UUID.CYCLING_POWER_MEASUREMENT);
    if (cp) await this.listen(cp, (d) => this.emitData({ powerW: parseCyclingPower(d).powerW }));
  }
}
