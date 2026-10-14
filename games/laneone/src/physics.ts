/**
 * The two bits of exercise maths the console needs, as pure functions.
 *
 * 1. Calories. Mirrored field-for-field on the Dandyhorse server's `_energy_rate`
 *    (servers/api-flask/dandyhorse/sessions/metrics.py), so the number on screen standalone is the number
 *    History will show after integration: ACSM gross VO2 on a treadmill, measured power ÷ 0.24 on a bike,
 *    and the Keytel heart-rate formula when a machine reports nothing. On the platform the server's own
 *    `getstate.energy` takes over (INTEGRATION.md §6); this is the standalone stand-in and the tie-breaker
 *    for a machine that reports neither.
 *
 * 2. Bike speed from power. A trainer measures watts; a console has to show a speed, so we solve
 *    P = (Crr·m·g + m·g·grade)·v + ½·ρ·CdA·v³ for v. Lifted from dandyhorse/games/mockgame/src/physics.ts.
 *
 * `treadmillWatts` is the third: bike-equivalent watts for a belt, which is how the platform's EffortMeter
 * compares a walk with a ride. The console uses it to size heart-rate-program adjustments and to place a
 * treadmill workload on the same scale as a bike's.
 */

export type DeviceType = 'treadmill' | 'bike'

export const DEFAULT_WEIGHT_KG = 75
export const DEFAULT_AGE = 40
/** Mechanical efficiency of pedalling: the server's `config.efficiency`. */
export const EFFICIENCY = 0.24
export const J_PER_KCAL = 4184

// --- calories ---------------------------------------------------------------------------------------

export interface Body {
  weight: number
  age: number
  sex: 'm' | 'f'
}

export const DEFAULT_BODY: Body = { weight: DEFAULT_WEIGHT_KG, age: DEFAULT_AGE, sex: 'm' }

export interface EnergyReadings {
  speed: number | null
  incline: number | null
  power: number | null
  heartRate: number | null
}

export type EnergySource = 'acsm' | 'power' | 'hr' | 'none'

export interface EnergyRate {
  /** Metabolic energy rate, J/s. */
  watts: number
  source: EnergySource
}

/**
 * Gross ACSM oxygen cost of walking or running, ml/kg/min, resting term included (the server's formula, so
 * the same switch at 1.8 m/s). A decline counts as flat: the formulas are not valid below zero.
 */
export function acsmVo2(speed: number, inclinePercent: number | null): number {
  const g = Math.max(0, (inclinePercent ?? 0) / 100)
  const v = Math.max(0, speed) * 60 // m/min
  return speed < 1.8 ? 3.5 + 0.1 * v + 1.8 * v * g : 3.5 + 0.2 * v + 0.9 * v * g
}

/** How fast the body is burning energy right now, J/s, by the best reading available. */
export function energyRate(device: DeviceType, r: EnergyReadings, body: Body = DEFAULT_BODY): EnergyRate {
  if (device === 'bike' && r.power !== null) return { watts: r.power / EFFICIENCY, source: 'power' }
  if (device === 'treadmill' && r.speed !== null) {
    const kcalPerMin = (acsmVo2(r.speed, r.incline) * body.weight) / 200
    return { watts: (kcalPerMin * J_PER_KCAL) / 60, source: 'acsm' }
  }
  if (r.heartRate !== null) {
    const hr = r.heartRate
    const kcalPerMin =
      body.sex === 'f'
        ? (-20.4022 + 0.4472 * hr - 0.1263 * body.weight + 0.074 * body.age) / 4.184
        : (-55.0969 + 0.6309 * hr + 0.1988 * body.weight + 0.2017 * body.age) / 4.184
    return { watts: (Math.max(0, kcalPerMin) * J_PER_KCAL) / 60, source: 'hr' }
  }
  return { watts: 0, source: 'none' }
}

// --- a belt on the bike's scale ------------------------------------------------------------------------

/** Pure walking up to this speed, pure running from RUN_FROM, blended between (m/s). */
const WALK_UP_TO = 1.6
const RUN_FROM = 2.2

/**
 * A treadmill reading as bike-equivalent watts, so one number compares a walk with a ride: the ACSM net cost
 * (no resting term, so a stopped belt reads 0) × 20.9 J/ml × 0.24. Lifted from gamekit's `effort.ts`, which
 * blends the two formulas over 1.6–2.2 m/s rather than stepping at 1.8:
 *
 *   walking  W = m · v · (0.50 + 9.0 · g)      running  W = m · v · (1.00 + 4.5 · g)
 */
export function treadmillWatts(speed: number | null, inclinePercent: number | null, weightKg = DEFAULT_WEIGHT_KG): number | null {
  if (speed === null) return null
  const v = Math.max(0, speed)
  const g = Math.max(0, (inclinePercent ?? 0) / 100)
  const m = weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG
  const walk = m * v * (0.5 + 9.0 * g)
  const run = m * v * (1.0 + 4.5 * g)
  if (v <= WALK_UP_TO) return walk
  if (v >= RUN_FROM) return run
  const f = (v - WALK_UP_TO) / (RUN_FROM - WALK_UP_TO)
  return walk * (1 - f) + run * f
}

/** The inverse: the belt speed that costs `watts` at this incline. Used to turn a bike program into a pace. */
export function speedForTreadmillWatts(watts: number, inclinePercent: number, weightKg = DEFAULT_WEIGHT_KG): number {
  const m = weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG
  const g = Math.max(0, inclinePercent / 100)
  // Solve on each branch and take the one that lands in its own range; between them, interpolate by bisection.
  const walkV = watts / (m * (0.5 + 9.0 * g))
  if (walkV <= WALK_UP_TO) return walkV
  const runV = watts / (m * (1.0 + 4.5 * g))
  if (runV >= RUN_FROM) return runV
  let lo = WALK_UP_TO
  let hi = RUN_FROM
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if ((treadmillWatts(mid, inclinePercent, m) ?? 0) < watts) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// --- bike speed from power ---------------------------------------------------------------------------

export interface BikeParams {
  /** Rider + bike mass, kg. */
  mass: number
  crr: number
  cdA: number
  rho: number
  g: number
}

export const BIKE_MASS_KG = 8
export const DEFAULT_BIKE: Omit<BikeParams, 'mass'> = { crr: 0.004, cdA: 0.32, rho: 1.226, g: 9.81 }

export function bikeParams(riderWeight: number | null | undefined, base = DEFAULT_BIKE): BikeParams {
  const w = typeof riderWeight === 'number' && riderWeight > 0 ? riderWeight : DEFAULT_WEIGHT_KG
  return { ...base, mass: w + BIKE_MASS_KG }
}

/**
 * Steady-state speed (m/s) for `power` watts on `gradePercent`.
 * f(v) = a·v + b·v³ − P with a = m·g·(Crr + grade/100), b = ½·ρ·CdA. Since b > 0, f is convex for v > 0 and
 * has exactly one positive root when P > 0 or a < 0 (coasting downhill); otherwise 0.
 */
export function bikeSpeedFromPower(power: number, gradePercent: number, p: BikeParams): number {
  const a = p.mass * p.g * (p.crr + gradePercent / 100)
  const b = 0.5 * p.rho * p.cdA
  if (power <= 0 && a >= 0) return 0
  // Start to the right of the inflection so f' > 0 all the way down to the root.
  let v = Math.max(5, a < 0 ? Math.sqrt(-a / b) + 1 : 0)
  for (let i = 0; i < 40; i++) {
    const f = a * v + b * v * v * v - power
    const df = a + 3 * b * v * v
    if (df <= 0) break
    const next = v - f / df
    if (!Number.isFinite(next)) break
    if (Math.abs(next - v) < 1e-6) {
      v = next
      break
    }
    v = Math.max(0, next)
  }
  return Math.max(0, v)
}
