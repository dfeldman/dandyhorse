/**
 * FTMS (Fitness Machine Service, 0x1826) wire format: data parsers, range parsers and control-point
 * encoders. Pure functions. Layouts follow docs/devices/ftms-common.md.
 */
import { ByteReader, ByteWriter, clamp } from '../../core/bytes.ts';
import type { DeviceData, Range, SimulationParams } from '../../core/types.ts';

// ---------------------------------------------------------------- data characteristics

function energy(r: ByteReader, out: DeviceData): void {
  const total = r.u16();
  r.u16(); // per hour
  r.u8(); // per minute
  if (total !== 0xffff) out.deviceEnergyKcal = total;
}

/** Indoor Bike Data, 0x2AD2. */
export function parseIndoorBikeData(d: Uint8Array): DeviceData {
  const r = new ByteReader(d);
  const f = r.u16();
  const out: DeviceData = {};
  let avgSpeed: number | undefined;
  let avgCadence: number | undefined;
  let avgPower: number | undefined;
  if (!(f & 0x0001)) out.speedKmh = r.u16() / 100; // bit 0 inverted: 0 means speed present
  if (f & 0x0002) avgSpeed = r.u16() / 100;
  if (f & 0x0004) out.cadenceRpm = r.u16() / 2;
  if (f & 0x0008) avgCadence = r.u16() / 2;
  if (f & 0x0010) out.deviceDistanceM = r.u24();
  if (f & 0x0020) out.resistanceLevel = r.s16();
  if (f & 0x0040) out.powerW = r.s16();
  if (f & 0x0080) avgPower = r.s16();
  if (f & 0x0100) energy(r, out);
  if (f & 0x0200) out.heartRateBpm = r.u8();
  if (f & 0x0400) r.u8(); // metabolic equivalent
  if (f & 0x0800) out.deviceElapsedS = r.u16();
  if (f & 0x1000) r.u16(); // remaining time
  if (out.speedKmh === undefined && avgSpeed !== undefined) out.speedKmh = avgSpeed;
  if (out.cadenceRpm === undefined && avgCadence !== undefined) out.cadenceRpm = avgCadence;
  if (out.powerW === undefined && avgPower !== undefined) out.powerW = avgPower;
  if (out.heartRateBpm === 0) delete out.heartRateBpm;
  return out;
}

/** Treadmill Data, 0x2ACD. */
export function parseTreadmillData(d: Uint8Array): DeviceData {
  const r = new ByteReader(d);
  const f = r.u16();
  const out: DeviceData = {};
  let avgSpeed: number | undefined;
  if (!(f & 0x0001)) out.speedKmh = r.u16() / 100;
  if (f & 0x0002) avgSpeed = r.u16() / 100;
  if (f & 0x0004) out.deviceDistanceM = r.u24();
  if (f & 0x0008) {
    const incline = r.s16();
    r.s16(); // ramp angle
    if (incline !== 0x7fff) out.inclinePct = incline / 10;
  }
  if (f & 0x0010) r.skip(4); // elevation gain
  if (f & 0x0020) r.u8(); // instantaneous pace
  if (f & 0x0040) r.u8(); // average pace
  if (f & 0x0080) energy(r, out);
  if (f & 0x0100) out.heartRateBpm = r.u8();
  if (f & 0x0200) r.u8(); // metabolic equivalent
  if (f & 0x0400) out.deviceElapsedS = r.u16();
  if (f & 0x0800) r.u16(); // remaining time
  if (f & 0x1000) {
    r.s16(); // force on belt
    out.powerW = r.s16();
  }
  if (out.speedKmh === undefined && avgSpeed !== undefined) out.speedKmh = avgSpeed;
  if (out.heartRateBpm === 0) delete out.heartRateBpm;
  return out;
}

/** Cross Trainer Data, 0x2ACE. Note the 3-byte flags. Cadence is strides per minute (steps / 2). */
export function parseCrossTrainerData(d: Uint8Array): DeviceData {
  const r = new ByteReader(d);
  const f = r.u24();
  const out: DeviceData = {};
  let avgSpeed: number | undefined;
  let avgPower: number | undefined;
  if (!(f & 0x0001)) out.speedKmh = r.u16() / 100;
  if (f & 0x0002) avgSpeed = r.u16() / 100;
  if (f & 0x0004) out.deviceDistanceM = r.u24();
  if (f & 0x0008) {
    out.stepRatePerMin = r.u16();
    r.u16(); // average step rate
    out.cadenceRpm = out.stepRatePerMin / 2;
  }
  if (f & 0x0010) out.stepCount = r.u16();
  if (f & 0x0020) r.skip(4); // elevation gain
  if (f & 0x0040) {
    const incline = r.s16();
    r.s16();
    if (incline !== 0x7fff) out.inclinePct = incline / 10;
  }
  if (f & 0x0080) out.resistanceLevel = r.s16();
  if (f & 0x0100) out.powerW = r.s16();
  if (f & 0x0200) avgPower = r.s16();
  if (f & 0x0400) energy(r, out);
  if (f & 0x0800) out.heartRateBpm = r.u8();
  if (f & 0x1000) r.u8();
  if (f & 0x2000) out.deviceElapsedS = r.u16();
  if (f & 0x4000) r.u16();
  if (out.speedKmh === undefined && avgSpeed !== undefined) out.speedKmh = avgSpeed;
  if (out.powerW === undefined && avgPower !== undefined) out.powerW = avgPower;
  if (out.heartRateBpm === 0) delete out.heartRateBpm;
  return out;
}

/** Rower Data, 0x2AD1. Stroke rate is in 0.5 spm units unless the device sends whole strokes. */
export function parseRowerData(d: Uint8Array, wholeStrokeRate = false): DeviceData {
  const r = new ByteReader(d);
  const f = r.u16();
  const out: DeviceData = {};
  let avgPower: number | undefined;
  if (!(f & 0x0001)) {
    const sr = r.u8();
    out.strokeRatePerMin = wholeStrokeRate ? sr : sr / 2;
    out.strokeCount = r.u16();
  }
  if (f & 0x0002) r.u8(); // average stroke rate
  if (f & 0x0004) out.deviceDistanceM = r.u24();
  if (f & 0x0008) {
    const pace = r.u16();
    if (pace !== 0 && pace !== 0xffff) {
      out.paceSecPer500m = pace;
      out.speedKmh = 1800 / pace;
    }
  }
  if (f & 0x0010) r.u16(); // average pace
  if (f & 0x0020) out.powerW = r.s16();
  if (f & 0x0040) avgPower = r.s16();
  if (f & 0x0080) out.resistanceLevel = r.s16();
  if (f & 0x0100) energy(r, out);
  if (f & 0x0200) out.heartRateBpm = r.u8();
  if (f & 0x0400) r.u8();
  if (f & 0x0800) out.deviceElapsedS = r.u16();
  if (f & 0x1000) r.u16();
  if (out.powerW === undefined && avgPower !== undefined) out.powerW = avgPower;
  if (out.heartRateBpm === 0) delete out.heartRateBpm;
  return out;
}

// ---------------------------------------------------------------- supported ranges

export function parseSpeedRange(d: Uint8Array): Range {
  const r = new ByteReader(d);
  return { min: r.u16() / 100, max: r.u16() / 100, step: r.u16() / 100 };
}

export function parseInclineRange(d: Uint8Array): Range {
  const r = new ByteReader(d);
  return { min: r.s16() / 10, max: r.s16() / 10, step: r.u16() / 10 };
}

export function parseResistanceRange(d: Uint8Array): Range {
  const r = new ByteReader(d);
  return { min: r.s16() / 10, max: r.s16() / 10, step: r.u16() / 10 };
}

export function parsePowerRange(d: Uint8Array): Range {
  const r = new ByteReader(d);
  return { min: r.s16(), max: r.s16(), step: r.u16() };
}

// ---------------------------------------------------------------- control point

export const OP = {
  REQUEST_CONTROL: 0x00,
  RESET: 0x01,
  SET_SPEED: 0x02,
  SET_INCLINE: 0x03,
  SET_RESISTANCE: 0x04,
  SET_POWER: 0x05,
  START: 0x07,
  STOP_PAUSE: 0x08,
  SET_SIMULATION: 0x11,
  SET_WHEEL_CIRCUMFERENCE: 0x12,
  RESPONSE: 0x80,
} as const;

export const cmd = {
  requestControl: (): Uint8Array => Uint8Array.of(OP.REQUEST_CONTROL),
  reset: (): Uint8Array => Uint8Array.of(OP.RESET),
  start: (): Uint8Array => Uint8Array.of(OP.START),
  stop: (): Uint8Array => Uint8Array.of(OP.STOP_PAUSE, 0x01),
  pause: (): Uint8Array => Uint8Array.of(OP.STOP_PAUSE, 0x02),
  /** Speed in km/h (0.01 resolution on the wire). */
  setSpeed: (kmh: number): Uint8Array => new ByteWriter().u8(OP.SET_SPEED).u16(clamp(kmh, 0, 655) * 100).toBytes(),
  /** A raw Set Target Speed value, for firmware that does not use 0.01 km/h units. */
  setSpeedRaw: (units: number): Uint8Array => new ByteWriter().u8(OP.SET_SPEED).u16(clamp(Math.round(units), 0, 0xffff)).toBytes(),
  /** Incline in percent (0.1 resolution). */
  setIncline: (pct: number): Uint8Array => new ByteWriter().u8(OP.SET_INCLINE).s16(pct * 10).toBytes(),
  /** Target power in watts. */
  setPower: (w: number): Uint8Array => new ByteWriter().u8(OP.SET_POWER).s16(w).toBytes(),
  /** Raw one-byte level, the form most consoles accept. */
  setResistanceRaw: (level: number): Uint8Array => Uint8Array.of(OP.SET_RESISTANCE, clamp(Math.round(level), 0, 255)),
  setResistanceU8x10: (level: number): Uint8Array => Uint8Array.of(OP.SET_RESISTANCE, clamp(Math.round(level * 10), 0, 255)),
  setResistanceU16x10: (level: number): Uint8Array => new ByteWriter().u8(OP.SET_RESISTANCE).u16(clamp(level * 10, 0, 0xffff)).toBytes(),
  /** Indoor bike simulation: wind 0.001 m/s, grade 0.01 %, Crr 0.0001, Cw 0.01 kg/m. */
  setSimulation: (p: SimulationParams): Uint8Array =>
    new ByteWriter()
      .u8(OP.SET_SIMULATION)
      .s16(p.windMps * 1000)
      .s16(p.gradePct * 100)
      .u8(clamp(Math.round(p.crr * 10000), 0, 255))
      .u8(clamp(Math.round(p.cwKgPerM * 100), 0, 255))
      .toBytes(),
  setWheelCircumference: (mm: number): Uint8Array => new ByteWriter().u8(OP.SET_WHEEL_CIRCUMFERENCE).u16(mm * 10).toBytes(),
};

export type FtmsResult = 'success' | 'not_supported' | 'invalid_parameter' | 'failed' | 'control_not_permitted' | 'timeout' | 'error';

const RESULT_CODES: Record<number, FtmsResult> = {
  1: 'success',
  2: 'not_supported',
  3: 'invalid_parameter',
  4: 'failed',
  5: 'control_not_permitted',
};

/** Decode a control-point indication "80 <op> <result>". */
export function parseResponse(d: Uint8Array): { op: number; result: FtmsResult } | undefined {
  if (d.length < 3 || d[0] !== OP.RESPONSE) return undefined;
  return { op: d[1]!, result: RESULT_CODES[d[2]!] ?? 'error' };
}

/** Fitness Machine Status (0x2ADA) op codes the drivers care about. */
export const STATUS = {
  RESET: 0x01,
  STOPPED_OR_PAUSED_BY_USER: 0x02,
  STOPPED_BY_SAFETY_KEY: 0x03,
  STARTED_OR_RESUMED_BY_USER: 0x04,
  CONTROL_PERMISSION_LOST: 0xff,
} as const;

// ---------------------------------------------------------------- names, for diagnostics

/** Fitness Machine Feature (0x2ACC) bits, bit 0 first. */
export const MACHINE_FEATURE_NAMES: readonly string[] = [
  'Average Speed', 'Cadence', 'Total Distance', 'Inclination', 'Elevation Gain', 'Pace', 'Step Count',
  'Resistance Level', 'Stride Count', 'Expended Energy', 'Heart Rate Measurement', 'Metabolic Equivalent',
  'Elapsed Time', 'Remaining Time', 'Power Measurement', 'Force on Belt and Power Output', 'User Data Retention',
];
export const TARGET_FEATURE_NAMES: readonly string[] = [
  'Speed Target', 'Inclination Target', 'Resistance Target', 'Power Target', 'Heart Rate Target',
  'Targeted Expended Energy', 'Targeted Step Number', 'Targeted Stride Number', 'Targeted Distance',
  'Targeted Training Time', 'Targeted Time in Two HR Zones', 'Targeted Time in Three HR Zones',
  'Targeted Time in Five HR Zones', 'Indoor Bike Simulation', 'Wheel Circumference', 'Spin Down Control',
  'Targeted Cadence',
];

export interface FtmsFeature {
  machineRaw: number;
  targetRaw: number;
  machine: string[];
  target: string[];
}

/**
 * Fitness Machine Feature, 0x2ACC: two uint32 bit fields. It is what the firmware claims, not always
 * what it does: a Horizon 7.0AT claims no incline, yet takes incline targets.
 */
export function parseFeature(d: Uint8Array): FtmsFeature {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const machineRaw = d.length >= 4 ? dv.getUint32(0, true) : 0;
  const targetRaw = d.length >= 8 ? dv.getUint32(4, true) : 0;
  const bits = (raw: number, names: readonly string[]): string[] => names.filter((_, i) => (raw >>> i) & 1);
  return { machineRaw, targetRaw, machine: bits(machineRaw, MACHINE_FEATURE_NAMES), target: bits(targetRaw, TARGET_FEATURE_NAMES) };
}

export const OP_NAMES: Readonly<Record<number, string>> = {
  0x00: 'Request Control', 0x01: 'Reset', 0x02: 'Set Target Speed', 0x03: 'Set Target Inclination',
  0x04: 'Set Target Resistance', 0x05: 'Set Target Power', 0x06: 'Set Target Heart Rate', 0x07: 'Start or Resume',
  0x08: 'Stop or Pause', 0x11: 'Set Indoor Bike Simulation', 0x12: 'Set Wheel Circumference',
};

/** Fitness Machine Status (0x2ADA) op codes, first byte of the notification. */
export const STATUS_NAMES: Readonly<Record<number, string>> = {
  0x01: 'Reset', 0x02: 'Stopped or paused by the user', 0x03: 'Stopped by the safety key', 0x04: 'Started or resumed by the user',
  0x05: 'Target speed changed', 0x06: 'Target incline changed', 0x07: 'Target resistance changed',
  0x08: 'Target power changed', 0x09: 'Target heart rate changed', 0x0a: 'Targeted expended energy changed',
  0x0b: 'Targeted step number changed', 0x0c: 'Targeted stride number changed', 0x0d: 'Targeted distance changed',
  0x0e: 'Targeted training time changed', 0x0f: 'Targeted time in two HR zones changed',
  0x10: 'Targeted time in three HR zones changed', 0x11: 'Targeted time in five HR zones changed',
  0x12: 'Indoor bike simulation parameters changed', 0x13: 'Wheel circumference changed', 0x14: 'Spin down status',
  0x15: 'Targeted cadence changed', 0xff: 'Control permission lost',
};
