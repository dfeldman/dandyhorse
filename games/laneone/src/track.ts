/**
 * The track: a standard 400 m athletics oval, to scale. Pure geometry, no drawing.
 *
 * World Athletics' "400 m Standard Track": two 84.39 m straights joined by two semicircles about a kerb of
 * radius 36.50 m, eight 1.22 m lanes. A lane is measured 30 cm outside the kerb (lane 1, which has a raised
 * kerb) or 20 cm outside its own inner line (lanes 2–8), which is what makes lane 1 exactly 400 m and lane 2
 * 407.04 m. Getting this right costs nothing and anyone who has run on a track will see it if it is wrong.
 *
 * Coordinates are metres in a right-handed 2-D frame: +x right, +y up, origin at the centre of the infield.
 * Running is counter-clockwise, as on every track. Arc length `d` is measured from the finish line, which sits
 * at the near end of the home straight, so a lap ends on it.
 *
 *          ┌──────── back straight (d: πr … πr+S) ────────┐
 *     left bend                                       right bend
 *          └──────── home straight ──── finish ◄─────────┘  d = 0
 *
 * On Dandyhorse the platform wants x/y/z with y up; the adapter sends (x, 0, −y) (INTEGRATION.md §7).
 */

/** Radius of the kerb at the inside of lane 1, metres. */
export const KERB_RADIUS = 36.5
/** Length of one straight, metres. */
export const STRAIGHT = 84.39
export const LANE_WIDTH = 1.22
export const LANES = 8
/** Lane 1 is measured 30 cm from the kerb; lanes 2–8, 20 cm from their own inner line. */
const LANE_1_OFFSET = 0.3
const LANE_N_OFFSET = 0.2

export interface TrackPoint {
  x: number
  y: number
  /** Direction of travel, radians, 0 = +x, counter-clockwise positive. */
  heading: number
  /** True on a bend (used to bank the marker a little). */
  bend: boolean
}

/** The radius of lane `n`'s measurement line (n = 1…8). */
export function laneRadius(n: number): number {
  const lane = Math.max(1, Math.min(LANES, Math.round(n)))
  return KERB_RADIUS + (lane - 1) * LANE_WIDTH + (lane === 1 ? LANE_1_OFFSET : LANE_N_OFFSET)
}

/** The inner edge of lane `n` (n = 1…9, where 9 is the outside of lane 8): what the renderer draws. */
export function laneLineRadius(n: number): number {
  return KERB_RADIUS + (Math.max(1, n) - 1) * LANE_WIDTH
}

/** One lap of lane `n`: 400.00 m in lane 1, 407.04 m in lane 2, … */
export function lapLength(n = 1): number {
  return 2 * STRAIGHT + 2 * Math.PI * laneRadius(n)
}

const HALF = STRAIGHT / 2
const mod = (a: number, m: number): number => ((a % m) + m) % m

/**
 * Where a runner in lane `n` is after `distance` metres from the finish line. Wraps, so any distance works and
 * lap `k` is `Math.floor(distance / lapLength(n))`.
 */
export function pointAt(distance: number, n = 1): TrackPoint {
  return ovalPoint(distance, laneRadius(n))
}

/**
 * The same oval at any radius, for things drawn around the track that are not lanes — the ring outside lane 8
 * that fills as the goal is met. `f` is the fraction of the way round, from the finish line.
 */
export function ovalAt(f: number, radius: number): TrackPoint {
  const lap = 2 * STRAIGHT + 2 * Math.PI * radius
  return ovalPoint(f * lap, radius)
}

function ovalPoint(distance: number, r: number): TrackPoint {
  const arc = Math.PI * r
  let d = mod(distance, 2 * STRAIGHT + 2 * arc)

  // 1. right bend, finish line → back straight, about (+HALF, 0), from −90° to +90°.
  if (d < arc) {
    const th = -Math.PI / 2 + d / r
    return { x: HALF + r * Math.cos(th), y: r * Math.sin(th), heading: th + Math.PI / 2, bend: true }
  }
  d -= arc
  // 2. back straight, right → left.
  if (d < STRAIGHT) return { x: HALF - d, y: r, heading: Math.PI, bend: false }
  d -= STRAIGHT
  // 3. left bend, about (−HALF, 0), from +90° to +270°.
  if (d < arc) {
    const th = Math.PI / 2 + d / r
    return { x: -HALF + r * Math.cos(th), y: r * Math.sin(th), heading: th + Math.PI / 2, bend: true }
  }
  d -= arc
  // 4. home straight, left → right, ending on the finish line.
  return { x: -HALF + d, y: -r, heading: 0, bend: false }
}

/** `count` evenly spaced points round lane `n`, for drawing a lane line. */
export function samples(count: number, n = 1): TrackPoint[] {
  const L = lapLength(n)
  return Array.from({ length: count }, (_, i) => pointAt((i / count) * L, n))
}

/** Half-width and half-height of the outside of the outermost lane, for fitting the track to a canvas. */
export function extent(): { halfWidth: number; halfHeight: number } {
  const r = laneLineRadius(LANES + 1)
  return { halfWidth: HALF + r, halfHeight: r }
}

/**
 * The classic marks painted on a track, as arc lengths along lane 1 from the finish line. The 200 m start and
 * the 100 m start are where lane 1's line crosses them; the renderer draws a tick and a label.
 */
export const MARKS: { d: number; label: string }[] = [
  { d: 0, label: 'FINISH' },
  { d: lapLength(1) / 4, label: '100' },
  { d: lapLength(1) / 2, label: '200' },
  { d: (3 * lapLength(1)) / 4, label: '300' },
]
