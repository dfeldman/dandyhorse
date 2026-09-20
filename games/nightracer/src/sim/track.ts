/**
 * The circuit: a closed, seeded, swoopy loop through a hilly city, stored as per-metre tables.
 *
 * Shape: a circle whose radius is modulated by a few big lobes, then pushed sideways by S-bend "swoops" in some
 * sections, resampled to one point per metre. Generation retries until every bend is wide enough and no two parts
 * of the loop come too close (Config.MIN_TURN_RADIUS, ROAD_CLEARANCE).
 * Hills: the road follows a rolling height field, smoothed and grade-limited (the same recipe as Rolling Hills).
 * The ground under the city is that height field, pulled down to the road near it (heightAt).
 *
 *   poseAt(s)            position, tangent, banked right/up vectors, grade, curvature at distance s
 *   pointAt(s, lat, up)  a point beside the road
 *   nearest(x, z)        the closest road sample within ~60 m
 */
import { Config, ROAD_HALF } from '../config.ts'
import { clamp, lerp, makeNoise2D, makeRng, smoothstep } from '../rng.ts'

export interface Pose {
  s: number
  x: number; y: number; z: number
  /** unit tangent */
  tx: number; ty: number; tz: number
  /** unit right vector, tilted by the bank */
  rx: number; ry: number; rz: number
  /** unit up vector (tangent × right) */
  ux: number; uy: number; uz: number
  /** rise per horizontal metre */
  grade: number
  /** signed curvature (1/m), positive turning right */
  k: number
  /** bank angle (rad), positive = right side lower */
  bank: number
}

export const newPose = (): Pose => ({ s: 0, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, grade: 0, k: 0, bank: 0 })

export interface Nearest { d: number; i: number; y: number; bank: number }

const CORRIDOR = 58
const CELL = 30

function boxcar(src: Float32Array, w: number, times = 1): Float32Array {
  const n = src.length
  let a = src
  for (let t = 0; t < times; t++) {
    const out = new Float32Array(n)
    let sum = 0
    for (let d = -w; d <= w; d++) sum += a[((d % n) + n) % n]!
    for (let i = 0; i < n; i++) {
      out[i] = sum / (2 * w + 1)
      sum += a[(i + w + 1) % n]! - a[((i - w) % n + n) % n]!
    }
    a = out
  }
  return a
}

/** Resample a closed polyline to one point per metre. */
function resample(px: Float64Array, pz: Float64Array): { X: Float32Array; Z: Float32Array } {
  const n = px.length
  const cum = new Float64Array(n + 1)
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1]! + Math.hypot(px[i % n]! - px[i - 1]!, pz[i % n]! - pz[i - 1]!)
  const len = Math.floor(cum[n]!)
  const X = new Float32Array(len), Z = new Float32Array(len)
  let j = 0
  const scale = cum[n]! / len // stretch slightly so the loop closes exactly
  for (let m = 0; m < len; m++) {
    const target = m * scale
    while (j < n - 1 && cum[j + 1]! < target) j++
    const f = (target - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!)
    const a = j, b = (j + 1) % n
    X[m] = px[a]! + (px[b]! - px[a]!) * f
    Z[m] = pz[a]! + (pz[b]! - pz[a]!) * f
  }
  return { X, Z }
}

/** Signed curvature at each sample from a chord of ±h metres (positive = turning right). */
function curvature(X: Float32Array, Z: Float32Array, h: number): Float32Array {
  const n = X.length
  const K = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - h + n) % n, b = (i + h) % n
    const ax = X[i]! - X[a]!, az = Z[i]! - Z[a]!
    const bx = X[b]! - X[i]!, bz = Z[b]! - Z[i]!
    // turning right = heading rotates toward right = (hz, -hx): cross = ax*bz - az*bx is + for left in this frame
    const cross = ax * bz - az * bx
    const d = Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(X[b]! - X[a]!, Z[b]! - Z[a]!)
    K[i] = d > 1e-9 ? (-2 * cross) / d : 0
  }
  return K
}

interface LoopShape { X: Float32Array; Z: Float32Array; attempt: number }

function generateShape(seed: number): LoopShape {
  const R = Config.TRACK_RADIUS
  let fallback: LoopShape | null = null
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = makeRng(seed, `track${attempt}`)
    const tame = 1 - Math.min(0.6, attempt * 0.015)
    const lobes = [
      { k: 2, a: rng.range(30, 85), p: rng.range(0, 6.283) },
      { k: 3, a: rng.range(25, 65), p: rng.range(0, 6.283) },
      { k: 4, a: rng.range(10, 40), p: rng.range(0, 6.283) },
      { k: 5, a: rng.range(0, 22), p: rng.range(0, 6.283) },
    ]
    const N = 8192
    const px = new Float64Array(N), pz = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      // clockwise seen from above, so most bends turn right
      const th = -(i / N) * Math.PI * 2
      let r = R
      for (const l of lobes) r += tame * l.a * Math.cos(l.k * th + l.p)
      px[i] = Math.cos(th) * r
      pz[i] = Math.sin(th) * r
    }
    const base = resample(px, pz)
    // swoops: sideways S-bends in a few sections, the rest stays as it is
    const L = base.X.length
    const m = rng.int(13, 20)
    const amp = rng.range(9, 15) * tame
    const env1 = rng.int(2, 4), envP = rng.range(0, 6.283)
    const sx = new Float64Array(L), sz = new Float64Array(L)
    for (let i = 0; i < L; i++) {
      const a = (i + L - 2) % L, b = (i + 2) % L
      const hx = base.X[b]! - base.X[a]!, hz = base.Z[b]! - base.Z[a]!
      const hl = Math.hypot(hx, hz) || 1
      const u = (i / L) * Math.PI * 2
      const env = smoothstep(0.1, 0.7, 0.5 + 0.5 * Math.sin(env1 * u + envP))
      const off = amp * env * Math.sin(m * u)
      sx[i] = base.X[i]! + (hz / hl) * off
      sz[i] = base.Z[i]! - (hx / hl) * off
    }
    const shape = resample(sx, sz)
    const ok = validateShape(shape.X, shape.Z)
    const candidate = { ...shape, attempt }
    if (ok) return candidate
    fallback ??= candidate
  }
  return fallback!
}

/** Every bend wide enough, and no two distant parts of the loop closer than the clearance. */
export function validateShape(X: Float32Array, Z: Float32Array): boolean {
  const n = X.length
  const K = boxcar(curvature(X, Z, 6), 2)
  for (let i = 0; i < n; i++) if (Math.abs(K[i]!) > 1 / Config.MIN_TURN_RADIUS) return false
  const C = Config.ROAD_CLEARANCE
  const cells = new Map<number, number[]>()
  const key = (cx: number, cz: number): number => (cx + 512) * 1024 + (cz + 512)
  for (let i = 0; i < n; i += 4) {
    const k = key(Math.floor(X[i]! / C), Math.floor(Z[i]! / C))
    let arr = cells.get(k)
    if (!arr) cells.set(k, (arr = []))
    arr.push(i)
  }
  const minAlong = C * 2.5
  for (let i = 0; i < n; i += 4) {
    const cx = Math.floor(X[i]! / C), cz = Math.floor(Z[i]! / C)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = cells.get(key(cx + dx, cz + dz))
      if (!arr) continue
      for (const j of arr) {
        if (j <= i) continue
        const along = Math.min(j - i, n - (j - i))
        if (along < minAlong) continue
        if ((X[i]! - X[j]!) ** 2 + (Z[i]! - Z[j]!) ** 2 < C * C) return false
      }
    }
  }
  return true
}

export class Track {
  readonly seed: number
  readonly length: number
  readonly X: Float32Array
  readonly Y: Float32Array
  readonly Z: Float32Array
  /** signed curvature (1/m) */
  readonly K: Float32Array
  /** bank (rad) */
  readonly B: Float32Array
  readonly valid: boolean
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  private readonly cells = new Map<number, number[]>()
  private readonly hills: ReturnType<typeof makeNoise2D>
  private readonly hillsBig: ReturnType<typeof makeNoise2D>

  constructor(seed: number) {
    this.seed = seed
    this.hills = makeNoise2D(seed, 'hills')
    this.hillsBig = makeNoise2D(seed, 'hillsBig')
    const shape = generateShape(seed)
    this.valid = validateShape(shape.X, shape.Z)
    const n = shape.X.length
    this.length = n

    // start line: the middle of the straightest stretch (the grid sits behind it)
    const K0 = boxcar(curvature(shape.X, shape.Z, 6), 2)
    let best = 0, bestScore = Infinity
    for (let i = 0; i < n; i += 5) {
      let worst = 0
      for (let d = -110; d <= 70; d += 5) worst = Math.max(worst, Math.abs(K0[(i + d + n) % n]!))
      if (worst < bestScore) { bestScore = worst; best = i }
    }
    const rot = (src: Float32Array): Float32Array => {
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = src[(i + best) % n]!
      return out
    }
    this.X = rot(shape.X)
    this.Z = rot(shape.Z)
    this.K = boxcar(curvature(this.X, this.Z, 6), 4, 2)

    // elevation: the height field along the road, smoothed, grade-limited both ways, smoothed again
    let Y: Float32Array = new Float32Array(n)
    for (let i = 0; i < n; i++) Y[i] = this.rawHeight(this.X[i]!, this.Z[i]!)
    Y = boxcar(Y, 20, 2)
    // rollers: crests and dips along the road itself (whole cycles, so the loop closes); the ground follows
    const hr = makeRng(seed, 'rollers')
    const rollers = [
      { c: hr.int(5, 8), a: Config.ROLLER_HEIGHT, p: hr.range(0, 6.283) },
      { c: hr.int(11, 15), a: Config.ROLLER_HEIGHT * 0.45, p: hr.range(0, 6.283) },
    ]
    for (let i = 0; i < n; i++) {
      const u = (i / n) * Math.PI * 2
      const calm = smoothstep(60, 220, Math.min(i, n - i))
      for (const r of rollers) Y[i] = Y[i]! + calm * r.a * Math.sin(r.c * u + r.p)
    }
    // the grid and the start line sit on a gentle straight slope (a line fitted to the ground there)
    const LOCK0 = -130, LOCK1 = 60
    {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
      for (let d = LOCK0; d <= LOCK1; d++) {
        const y = Y[(d + n) % n]!
        sw++; sx += d; sy += y; sxx += d * d; sxy += d * y
      }
      const slope = clamp((sw * sxy - sx * sy) / (sw * sxx - sx * sx), -0.02, 0.02)
      const y0 = (sy - slope * sx) / sw
      for (let d = LOCK0; d <= LOCK1; d++) Y[(d + n) % n] = y0 + slope * d
    }
    // grade limit, both ways, with the start window fixed: clamp every point into the cone the window's two ends
    // allow, then walk back from the window's start keeping each step within the limit
    const G = Config.MAX_GRADE * 0.92
    const ia = (LOCK1 + n) % n, ib = (LOCK0 + n) % n
    const La = Y[ia]!, Lb = Y[ib]!
    const free = n - (LOCK1 - LOCK0)
    for (let k = 1; k < free; k++) {
      const i = (ia + k) % n
      const lo = Math.max(La - G * k, Lb - G * (free - k))
      const hi = Math.min(La + G * k, Lb + G * (free - k))
      Y[i] = clamp(Y[i]!, lo, hi)
    }
    for (let k = 1; k < free; k++) {
      const i = (ib - k + n) % n, next = (i + 1) % n
      Y[i] = clamp(Y[i]!, Y[next]! - G, Y[next]! + G)
    }
    const locked = Y.slice()
    Y = boxcar(Y, 6, 2)
    for (let d = LOCK0 + 12; d <= LOCK1 - 12; d++) Y[(d + n) % n] = locked[(d + n) % n]!
    this.Y = Y

    const B = new Float32Array(n)
    for (let i = 0; i < n; i++) B[i] = clamp(this.K[i]! * Config.BANK_GAIN, -Config.BANK_MAX, Config.BANK_MAX)
    this.B = boxcar(B, 12, 2)

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      const x = this.X[i]!, z = this.Z[i]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
      const k = this.cellKey(Math.floor(x / CELL), Math.floor(z / CELL))
      let arr = this.cells.get(k)
      if (!arr) this.cells.set(k, (arr = []))
      arr.push(i)
    }
    this.bounds = { minX, maxX, minZ, maxZ }
  }

  private cellKey(cx: number, cz: number): number { return (cx + 2048) * 4096 + (cz + 2048) }

  /** Wrap a distance onto [0, length). */
  wrap(s: number): number { return ((s % this.length) + this.length) % this.length }

  /** Signed along-track gap from a to b, in (-length/2, length/2]. */
  gap(a: number, b: number): number {
    let d = this.wrap(b - a)
    if (d > this.length / 2) d -= this.length
    return d
  }

  /** The rolling ground, before it is pulled to the road. */
  rawHeight(x: number, z: number): number {
    const big = this.hillsBig.fbm(x / 900, z / 900, 2)
    const h = this.hills.fbm(x / 430, z / 430, 3)
    return Config.HILL_HEIGHT * (0.5 + 0.35 * h + 0.3 * big)
  }

  /** The ground: the height field, pulled to just under the road within the corridor. */
  heightAt(x: number, z: number): number { return this.groundAt(x, z).h }

  /** Ground height and distance to the road's centreline (Infinity when far). */
  groundAt(x: number, z: number): { h: number; d: number } {
    const h = this.rawHeight(x, z)
    const n = this.nearest(x, z)
    if (!n) return { h, d: Infinity }
    if (n.d >= CORRIDOR) return { h, d: n.d }
    const target = n.y - 0.5 - ROAD_HALF * Math.abs(Math.sin(n.bank))
    const w = 1 - smoothstep(ROAD_HALF + 12, CORRIDOR, n.d)
    return { h: lerp(h, target, w), d: n.d }
  }

  nearest(x: number, z: number): Nearest | null {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
    let best = -1, bd = Infinity
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const arr = this.cells.get(this.cellKey(cx + dx, cz + dz))
      if (!arr) continue
      for (const i of arr) {
        const d = (this.X[i]! - x) ** 2 + (this.Z[i]! - z) ** 2
        if (d < bd) { bd = d; best = i }
      }
    }
    if (best < 0) return null
    return { d: Math.sqrt(bd), i: best, y: this.Y[best]!, bank: this.B[best]! }
  }

  poseAt(s: number, out: Pose = newPose()): Pose {
    const n = this.length
    const m = this.wrap(s)
    const i = Math.floor(m), f = m - i, j = (i + 1) % n
    const { X, Y, Z } = this
    out.s = m
    out.x = X[i]! + (X[j]! - X[i]!) * f
    out.y = Y[i]! + (Y[j]! - Y[i]!) * f
    out.z = Z[i]! + (Z[j]! - Z[i]!) * f
    const a = (i - 2 + n) % n, b = (i + 3) % n
    let tx = X[b]! - X[a]!, ty = Y[b]! - Y[a]!, tz = Z[b]! - Z[a]!
    const hl = Math.hypot(tx, tz) || 1
    out.grade = ty / hl
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl; ty /= tl; tz /= tl
    out.tx = tx; out.ty = ty; out.tz = tz
    out.k = this.K[i]! + (this.K[j]! - this.K[i]!) * f
    const bank = this.B[i]! + (this.B[j]! - this.B[i]!) * f
    out.bank = bank
    // horizontal right (hz, 0, -hx), tilted down by the bank
    const hx = (X[b]! - X[a]!) / hl, hz = (Z[b]! - Z[a]!) / hl
    const cb = Math.cos(bank), sb = Math.sin(bank)
    let rx = hz * cb, ry = -sb, rz = -hx * cb
    // up = t × r, then r = up × t so the frame is orthonormal on slopes
    let ux = ty * rz - tz * ry, uy = tz * rx - tx * rz, uz = tx * ry - ty * rx
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    rx = uy * tz - uz * ty; ry = uz * tx - ux * tz; rz = ux * ty - uy * tx
    out.ux = ux; out.uy = uy; out.uz = uz
    out.rx = rx; out.ry = ry; out.rz = rz
    return out
  }

  /** A point `lateral` metres right of the centreline and `lift` metres above the road surface. */
  pointAt(s: number, lateral: number, lift: number, pose: Pose = newPose()): { x: number; y: number; z: number } {
    const p = this.poseAt(s, pose)
    return {
      x: p.x + p.rx * lateral + p.ux * lift,
      y: p.y + p.ry * lateral + p.uy * lift,
      z: p.z + p.rz * lateral + p.uz * lift,
    }
  }

  /** Mean grade over the next `ahead` metres (for a trainer or treadmill that can't follow every bump). */
  gradeAhead(s: number, ahead: number): number {
    const a = this.wrap(s), b = this.wrap(s + ahead)
    return (this.Y[Math.floor(b)]! - this.Y[Math.floor(a)]!) / ahead
  }

  /** Curvature at s (1/m). */
  curvatureAt(s: number): number { return this.K[Math.floor(this.wrap(s))]! }
}
