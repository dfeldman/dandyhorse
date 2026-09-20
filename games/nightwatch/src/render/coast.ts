/**
 * The coast's layout, in metres: x east, z north (out to sea), y up. The camera looks north from the land.
 * The lighthouse stands on an island at the left; ships come in from the horizon, through a channel between the
 * island's spurs (west) and the reef (east), and turn right into the harbour.
 *
 * ShipPath turns a ship's progress u (0 horizon, 1 watch starts, 2 channel, 3 channel's end, 4 moored) into a pose.
 */
import { clamp, lerp, smoothstep } from '../rng.ts'

export interface XZ { x: number; z: number }

export const LIGHTHOUSE = { x: -108, z: 40, ground: 18 }
export const TOWER_HEIGHT = 40
/** Where the lamp burns. */
export const LAMP = { x: LIGHTHOUSE.x, y: LIGHTHOUSE.ground + TOWER_HEIGHT + 3.2, z: LIGHTHOUSE.z }
/** Channel half-width (m): drift 1 puts a ship's side on the rocks. */
export const CHANNEL_HALF = 30
/** Ships are drawn this much bigger than their nominal size, so they read from the far camera. */
export const SHIP_SCALE = 1.5

const ENTRANCE: XZ = { x: -34, z: 490 }
const MID: XZ = { x: -52, z: 345 }
const EXIT: XZ = { x: -26, z: 215 }
const TURN: XZ = { x: 12, z: 168 }

/** The town's quay faces north across the harbour; ships berth bow-in along it, between short finger piers. */
export const QUAY = { z: 100, x0: -8, x1: 262, top: 3.2 }
/** A breakwater closes the harbour's east side, with the harbour light at its end. */
export const MOLE = { x: 238, z0: 100, z1: 215 }

/** Berths along the quay (x of each; a ship lies with its bow at the quay, so its centre depends on its length). */
export const MOORINGS: XZ[] = [30, 56, 82, 108, 134, 160].map((x) => ({ x, z: QUAY.z }))
export const MOORING_HEADING = Math.PI / 2 // facing −z, bow to the quay
/** Where a ship of this half-length lies at a berth. */
export const berthCentre = (berth: XZ, halfLen: number): XZ => ({ x: berth.x, z: QUAY.z + 4 + halfLen })
/** A ship with no berth free waits here. */
export const ANCHORAGE: XZ = { x: 60, z: 250 }
export const HARBOR_CENTER: XZ = { x: 110, z: 140 }

/** Catmull-Rom through points, sampled densely, with arc length; u knots map onto the samples. */
export class Polyline {
  readonly xs: number[] = []
  readonly zs: number[] = []
  readonly s: number[] = []
  private readonly knotS: number[] = []
  private readonly knotU: number[]

  constructor(points: XZ[], knots: number[], perSegment = 24) {
    this.knotU = knots
    const n = points.length
    const get = (i: number): XZ => points[clamp(i, 0, n - 1)]!
    let acc = 0
    for (let i = 0; i < n - 1; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
      this.knotS[i] = acc
      for (let k = i === 0 ? 0 : 1; k <= perSegment; k++) {
        const t = k / perSegment
        const t2 = t * t, t3 = t2 * t
        const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
        const z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
        if (this.xs.length) acc += Math.hypot(x - this.xs[this.xs.length - 1]!, z - this.zs[this.zs.length - 1]!)
        this.xs.push(x)
        this.zs.push(z)
        this.s.push(acc)
      }
    }
    this.knotS[n - 1] = acc
  }

  get length(): number { return this.s[this.s.length - 1]! }

  /** Arc length at progress u (piecewise linear between knots). */
  sAt(u: number): number {
    const k = this.knotU
    if (u <= k[0]!) return 0
    for (let i = 1; i < k.length; i++) {
      if (u <= k[i]!) return lerp(this.knotS[i - 1]!, this.knotS[i]!, (u - k[i - 1]!) / (k[i]! - k[i - 1]!))
    }
    return this.length
  }

  /** Position and unit tangent at arc length s. */
  at(s: number, out: Pose): Pose {
    const n = this.s.length
    s = clamp(s, 0, this.length)
    let lo = 0, hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.s[mid]! <= s) lo = mid
      else hi = mid
    }
    const seg = this.s[hi]! - this.s[lo]! || 1
    const f = (s - this.s[lo]!) / seg
    out.x = lerp(this.xs[lo]!, this.xs[hi]!, f)
    out.z = lerp(this.zs[lo]!, this.zs[hi]!, f)
    const dx = this.xs[hi]! - this.xs[lo]!, dz = this.zs[hi]! - this.zs[lo]!
    const l = Math.hypot(dx, dz) || 1
    out.tx = dx / l
    out.tz = dz / l
    return out
  }
}

export interface Pose { x: number; z: number; tx: number; tz: number }
export const newPose = (): Pose => ({ x: 0, z: 0, tx: 0, tz: 1 })

/** Heading (radians, Babylon rotation.y) for a model whose bow is +x, travelling along (tx, tz). */
export const headingOf = (tx: number, tz: number): number => Math.atan2(-tz, tx)

/** A ship's route from the horizon to its mooring. */
export class ShipPath {
  readonly line: Polyline
  private readonly pose = newPose()

  constructor(lane: number, mooring: XZ | null) {
    const spawn = { x: lane * 650 + 40, z: 1900 }
    const far = { x: lane * 170 + 10, z: 820 }
    const lead = { x: lane * 30 - 12, z: 540 }
    const pts: XZ[] = [spawn, far, lead, ENTRANCE, MID, EXIT]
    const knots = [0, 1, 1.55, 2, 2.5, 3]
    if (mooring) {
      pts.push(...berthApproach(mooring))
      knots.push(3.45, 3.8, 4)
    } else {
      pts.push(TURN, ANCHORAGE)
      knots.push(3.4, 4)
    }
    this.line = new Polyline(pts, knots)
  }

  /** Pose at progress u, pushed sideways by `lateral` metres (+ = to the right of travel... see lateralDir). */
  poseAt(u: number, lateral: number, out: Pose): Pose {
    this.line.at(this.line.sAt(u), out)
    if (lateral !== 0) {
      // right-hand normal while heading south = east; side +1 means toward the reef (east)
      out.x += -out.tz * lateral
      out.z += out.tx * lateral
    }
    return out
  }

  /** How much of a ship's drift shows as sideways offset at u: some on the approach, all in the channel. */
  static driftWeight(u: number): number {
    return lerp(0.55, 1, smoothstep(1.2, 2, u)) * smoothstep(0.7, 1.1, u) * (1 - smoothstep(3.0, 3.35, u))
  }

  /** Straight-ish route between arbitrary points (tows and departures). */
  static through(points: XZ[]): Polyline {
    return new Polyline(points, points.map((_, i) => i / (points.length - 1)))
  }

  get scratch(): Pose { return this.pose }
}

/** The last three points into a berth (given the ship's centre there): swing in from the north-west, bow to the quay. */
export function berthApproach(dock: XZ): XZ[] {
  return [{ x: dock.x - 34, z: dock.z + 58 }, { x: dock.x, z: dock.z + 22 }, dock]
}

/**
 * Where a ship leaving the harbour goes: it backs out north, turns, and heads out past the breakwater and round the
 * far side of the reef. Returns the points and how much of the route is backing out.
 */
export function departure(from: XZ): { points: XZ[]; backing: number } {
  const backing = 60
  const points = [from, { x: from.x, z: from.z + backing }, { x: from.x + 50, z: 262 }, { x: 330, z: 300 }, { x: 760, z: 900 }, { x: 1300, z: 1900 }]
  return { points, backing }
}

/** The channel's centreline, for placing rocks and buoys: samples with the east-pointing side normal. */
export function channelSamples(step = 12): { x: number; z: number; nx: number; nz: number; t: number }[] {
  const line = new Polyline([{ x: ENTRANCE.x + 4, z: ENTRANCE.z + 70 }, ENTRANCE, MID, EXIT, { x: EXIT.x + 6, z: EXIT.z - 25 }], [0, 0.1, 0.5, 0.9, 1])
  const out: { x: number; z: number; nx: number; nz: number; t: number }[] = []
  const p = newPose()
  for (let s = 0; s <= line.length; s += step) {
    line.at(s, p)
    out.push({ x: p.x, z: p.z, nx: -p.tz, nz: p.tx, t: s / line.length })
  }
  return out
}

export const CHANNEL = { ENTRANCE, MID, EXIT, TURN }
