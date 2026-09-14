/** Physics and estimation formulas games need. Constants follow docs/devices/qz-base-behavior.md. */
import { clamp } from '../core/bytes.ts';
import type { Range } from '../core/types.ts';

export const G = 9.80665;
export const AIR_DENSITY = 1.204;

/** Running power on a treadmill (Couzens model, as QZ): 0.2625*w*v + 0.098*w*grade. Never negative. */
export function treadmillPowerW(speedKmh: number, inclinePct: number, weightKg: number): number {
  if (speedKmh <= 0) return 0;
  return Math.max(0, 0.2625 * weightKg * speedKmh + 0.098 * weightKg * inclinePct);
}

/** QZ's treadmill calorie rate. */
export function treadmillKcalPerMin(watts: number, weightKg: number): number {
  return ((0.048 * watts + 1.19) * weightKg * 3.5) / 200;
}

/** Mechanical work to food energy, assuming ~24 % efficiency (1 kJ of work ~ 1 kcal burned). */
export function kcalFromWork(joules: number): number {
  return joules / 4184 / 0.24;
}

export interface RoadModel {
  massKg: number;
  crr: number;
  /** Drag area Cd*A, m^2. */
  cdA: number;
  windMps?: number;
  airDensity?: number;
}

/** Power to hold speed v (m/s) on a grade. */
export function bikePowerForSpeed(vMps: number, gradePct: number, m: RoadModel): number {
  const s = gradePct / 100;
  const cos = 1 / Math.sqrt(1 + s * s);
  const sin = s * cos;
  const air = v2(vMps + (m.windMps ?? 0));
  return m.massKg * G * vMps * (sin + m.crr * cos) + 0.5 * (m.airDensity ?? AIR_DENSITY) * m.cdA * air * vMps;
}

function v2(v: number): number {
  return v * Math.abs(v);
}

/** Steady-state speed (m/s) for a power, by bisection. */
export function bikeSpeedForPower(powerW: number, gradePct: number, m: RoadModel): number {
  if (powerW <= 0) return 0;
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (bikePowerForSpeed(mid, gradePct, m) > powerW) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Map a road grade to a resistance level for bikes that cannot simulate (console bikes).
 * Flat road sits at `flatFraction` of the range; `spanPct` of grade covers the whole range.
 */
export function gradeToLevel(gradePct: number, range: Range, flatFraction = 0.3, spanPct = 20): number {
  const f = clamp(flatFraction + gradePct / spanPct, 0, 1);
  return Math.round(range.min + f * (range.max - range.min));
}

/** The inverse of gradeToLevel, for resistance requests on trainers that only simulate grade. */
export function levelToGrade(level: number, range: Range, flatFraction = 0.3, spanPct = 20): number {
  const f = (level - range.min) / Math.max(1e-9, range.max - range.min);
  return (f - flatFraction) * spanPct;
}

/** QZ's running cadence estimate from speed and height, steps per minute. */
export function estimateRunCadence(speedKmh: number, heightCm: number): number {
  if (speedKmh <= 0) return 0;
  const strideM = (heightCm / 100) * 0.414;
  return (speedKmh / 3.6 / strideM) * 60;
}
