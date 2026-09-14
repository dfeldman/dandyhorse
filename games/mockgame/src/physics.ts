/**
 * Minimal rider physics. Pure functions.
 *
 * Bike: the trainer measures power; the game turns it into a virtual speed against the route grade
 * by solving  P = (Crr·m·g + m·g·grade)·v + ½·ρ·CdA·v³  for v (Newton's method).
 * Treadmill: the belt speed is the truth; distance is simply speed × time.
 */

export interface BikeParams {
  /** Rider + bike mass, kg. */
  mass: number
  crr: number
  cdA: number
  rho: number
  g: number
}

export const BIKE_MASS_KG = 8
export const DEFAULT_RIDER_WEIGHT_KG = 75

export const DEFAULT_BIKE: Omit<BikeParams, 'mass'> = { crr: 0.004, cdA: 0.32, rho: 1.226, g: 9.81 }

/** Rider weight from bodyData (default 75 kg) plus the bike. */
export function bikeParams(riderWeight: number | null | undefined, base = DEFAULT_BIKE): BikeParams {
  const w = typeof riderWeight === 'number' && riderWeight > 0 ? riderWeight : DEFAULT_RIDER_WEIGHT_KG
  return { ...base, mass: w + BIKE_MASS_KG }
}

/**
 * Steady-state speed (m/s) for `power` watts on `gradePercent` grade.
 * f(v) = a·v + b·v³ − P with a = m·g·(Crr + grade/100), b = ½·ρ·CdA. Since b > 0, f is convex for
 * v > 0 and has exactly one positive root when P > 0 or a < 0 (coasting downhill); otherwise 0.
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

/** Treadmill: meters covered in `dt` seconds at belt speed `speed` (m/s). */
export function treadmillDistance(speed: number | null, dt: number): number {
  return speed && speed > 0 ? speed * dt : 0
}
