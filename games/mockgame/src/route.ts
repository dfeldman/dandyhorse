/**
 * Deterministic loop route from the session seed.
 *
 * x/z: a rounded rectangle (~2 km perimeter) centred on the origin, y up (PLAN.md §6.3).
 * y: smoothed, periodic value noise so the loop closes without a step.
 * Pure functions only: same seed + same distance → same point, always.
 */
import { valueNoise1D } from './rng.ts'

export interface RoutePoint {
  x: number
  y: number
  z: number
  /** Percent, positive uphill. */
  grade: number
}

export interface Route {
  /** Loop length in meters. */
  length: number
  seed: number
  pointAt(distance: number): RoutePoint
  /** `count` evenly spaced points, handy for drawing. */
  samples(count: number): RoutePoint[]
}

// Rounded-rectangle geometry (meters).
const WIDTH = 750
const HEIGHT = 350
const RADIUS = 100
const STRAIGHT_X = WIDTH - 2 * RADIUS // horizontal straight length
const STRAIGHT_Z = HEIGHT - 2 * RADIUS // vertical straight length
const ARC = (Math.PI / 2) * RADIUS // one quarter-circle corner
export const LOOP_LENGTH = 2 * STRAIGHT_X + 2 * STRAIGHT_Z + 4 * ARC // ≈ 2028 m

// Elevation: two octaves of periodic noise. Amplitudes are chosen so grades stay within ~±12 %.
const OCTAVE_1 = { period: 8, amplitude: 10 }
const OCTAVE_2 = { period: 24, amplitude: 2.5 }
const BASE_ELEVATION = 20
const GRADE_STEP = 5 // meters each side for the finite-difference grade

const mod = (a: number, n: number) => ((a % n) + n) % n

/** Position on the rounded rectangle at arc length `d` (0 ≤ d < L), counter-clockwise from the bottom edge. */
function planar(d: number): { x: number; z: number } {
  const hx = STRAIGHT_X / 2
  const hz = STRAIGHT_Z / 2
  const R = RADIUS
  let s = d
  // 1. bottom edge, left → right
  if (s < STRAIGHT_X) return { x: -hx + s, z: -hz - R }
  s -= STRAIGHT_X
  // 2. bottom-right corner
  if (s < ARC) {
    const a = -Math.PI / 2 + s / R
    return { x: hx + R * Math.cos(a), z: -hz + R * Math.sin(a) }
  }
  s -= ARC
  // 3. right edge, bottom → top
  if (s < STRAIGHT_Z) return { x: hx + R, z: -hz + s }
  s -= STRAIGHT_Z
  // 4. top-right corner
  if (s < ARC) {
    const a = s / R
    return { x: hx + R * Math.cos(a), z: hz + R * Math.sin(a) }
  }
  s -= ARC
  // 5. top edge, right → left
  if (s < STRAIGHT_X) return { x: hx - s, z: hz + R }
  s -= STRAIGHT_X
  // 6. top-left corner
  if (s < ARC) {
    const a = Math.PI / 2 + s / R
    return { x: -hx + R * Math.cos(a), z: hz + R * Math.sin(a) }
  }
  s -= ARC
  // 7. left edge, top → bottom
  if (s < STRAIGHT_Z) return { x: -hx - R, z: hz - s }
  s -= STRAIGHT_Z
  // 8. bottom-left corner
  const a = Math.PI + s / R
  return { x: -hx + R * Math.cos(a), z: -hz + R * Math.sin(a) }
}

export function makeRoute(seed: number): Route {
  const L = LOOP_LENGTH
  const n1 = valueNoise1D(seed, OCTAVE_1.period)
  const n2 = valueNoise1D(seed ^ 0x9e3779b9, OCTAVE_2.period)
  const elevation = (d: number) => {
    const u = mod(d, L) / L
    return (
      BASE_ELEVATION +
      OCTAVE_1.amplitude * (n1(u * OCTAVE_1.period) * 2 - 1) +
      OCTAVE_2.amplitude * (n2(u * OCTAVE_2.period) * 2 - 1)
    )
  }
  const pointAt = (distance: number): RoutePoint => {
    const d = mod(distance, L)
    const { x, z } = planar(d)
    const y = elevation(d)
    const grade = ((elevation(d + GRADE_STEP) - elevation(d - GRADE_STEP)) / (2 * GRADE_STEP)) * 100
    return { x, y, z, grade }
  }
  return {
    length: L,
    seed,
    pointAt,
    samples: (count) => Array.from({ length: count }, (_, i) => pointAt((i / count) * L)),
  }
}
