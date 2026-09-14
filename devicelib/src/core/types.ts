/** Domain types shared by drivers, the session and games. */

export type DeviceClass =
  | 'treadmill'
  | 'bike'
  | 'elliptical'
  | 'rower'
  | 'run_sensor'
  | 'sensor'
  | 'stair_climber'
  | 'stepper'
  | 'jump_rope'
  | 'heart_rate'
  | 'unknown';

/**
 * What a driver reports, one notification at a time. Every field is optional:
 * a missing field means "this device does not report it", never zero.
 */
export interface DeviceData {
  speedKmh?: number;
  inclinePct?: number;
  cadenceRpm?: number;
  powerW?: number;
  heartRateBpm?: number;
  resistanceLevel?: number;
  strokeRatePerMin?: number;
  strokeCount?: number;
  paceSecPer500m?: number;
  stepRatePerMin?: number;
  stepCount?: number;
  /** Device totals are often lifetime counters; the session integrates its own distance and energy. */
  deviceDistanceM?: number;
  deviceElapsedS?: number;
  deviceEnergyKcal?: number;
  gearRatio?: number;
  batteryPct?: number;
}

export type MetricKey = keyof DeviceData;

/** The merged picture a game reads, emitted by the session on every tick. */
export interface Telemetry extends DeviceData {
  /** Clock time of this snapshot, ms. */
  t: number;
  /** Integrated by devicelib from speed while not paused. */
  distanceM: number;
  /** Time since the session's workout started, s. */
  elapsedS: number;
  /** Time with speed, cadence or power above zero, s. */
  movingS: number;
  /** Integrated from power (bikes, rowers) or the treadmill model, kcal. */
  energyKcal: number;
  /** Current virtual gear, when gears are in use. */
  gear?: number;
  /** The grade the game asked for, before gears. */
  targetGradePct?: number;
  /** Fields in this snapshot that devicelib computed rather than read from the device. */
  computed: MetricKey[];
  /** False when no device data has arrived for longer than the stale timeout. */
  fresh: boolean;
}

export interface Range {
  min: number;
  max: number;
  step: number;
}

/** What the connected device can do, after quirks are applied. */
export interface Capabilities {
  speed: boolean;
  incline: boolean;
  /** Road-feel simulation: grade, wind, rolling resistance. */
  simulation: boolean;
  /** Target power. */
  erg: boolean;
  resistance: boolean;
  /** The device implements gear ratios itself (Zwift protocol). Otherwise the session emulates gears. */
  nativeGears: boolean;
  startStop: boolean;
  limits: {
    speedKmh?: Range;
    inclinePct?: Range;
    resistance?: Range;
    powerW?: Range;
  };
}

export function noCapabilities(): Capabilities {
  return {
    speed: false,
    incline: false,
    simulation: false,
    erg: false,
    resistance: false,
    nativeGears: false,
    startStop: false,
    limits: {},
  };
}

export interface SimulationParams {
  gradePct: number;
  /** Head wind positive, m/s. */
  windMps: number;
  /** Rolling resistance coefficient, e.g. 0.004. */
  crr: number;
  /** Wind resistance coefficient Cw (CdA x air density / 2 in FTMS terms), kg/m, e.g. 0.51. */
  cwKgPerM: number;
}

export type LoadTarget =
  | ({ mode: 'sim' } & SimulationParams)
  | { mode: 'erg'; powerW: number }
  | { mode: 'resistance'; level: number };

/** The desired device state. Drivers reconcile it on every tick and send only what changed. */
export interface Targets {
  speedKmh?: number;
  inclinePct?: number;
  /** Resistance side: road simulation, target power or a plain level (bikes, ellipticals, rowers). */
  load?: LoadTarget;
  /** Virtual gear index for devices with native gears (1-based). */
  gear?: number;
}

export type WorkoutCommand = 'start' | 'pause' | 'stop';

export interface RiderProfile {
  weightKg: number;
  heightCm: number;
  bikeWeightKg: number;
}

export const DEFAULT_RIDER: RiderProfile = { weightKg: 75, heightCm: 175, bikeWeightKg: 10 };
