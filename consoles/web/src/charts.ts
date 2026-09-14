// Pure SVG path builders for the session detail page. No DOM access.
import type { TimelineRow } from './types'

export interface Box {
  w: number
  h: number
  pad: number
}

export interface Pt {
  x: number
  y: number
}

/** Build an SVG path for a series of points, starting a new subpath after every null gap. */
export function polyline(points: (Pt | null)[], digits = 1): string {
  const parts: string[] = []
  let pen = false
  for (const p of points) {
    if (p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false
      continue
    }
    parts.push(`${pen ? 'L' : 'M'}${p.x.toFixed(digits)} ${p.y.toFixed(digits)}`)
    pen = true
  }
  return parts.join(' ')
}

export interface Extent {
  min: number
  max: number
}

export function extent(values: (number | null)[]): Extent | null {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return min === Infinity ? null : { min, max }
}

/** Linear scale; a degenerate domain maps to the middle of the range. */
export function scale(dom: Extent, r0: number, r1: number): (v: number) => number {
  const span = dom.max - dom.min
  if (span === 0) return () => (r0 + r1) / 2
  return (v) => r0 + ((v - dom.min) / span) * (r1 - r0)
}

/** "Nice" tick values for an axis. */
export function ticks(dom: Extent, count = 4): number[] {
  const span = dom.max - dom.min
  if (span === 0) return [dom.min]
  const rough = span / count
  const mag = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / mag
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(dom.min / step) * step; v <= dom.max + 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

export interface Minimap {
  path: string
  start: Pt | null
  end: Pt | null
  /** Ground-plane extent in meters. */
  xExtent: Extent
  zExtent: Extent
}

/** 2-D top-down path of position.x vs position.z, equal aspect, centered in the box. */
export function minimap(rows: TimelineRow[], box: Box): Minimap | null {
  const xs = rows.map((r) => (r.position ? r.position.x : null))
  const zs = rows.map((r) => (r.position ? r.position.z : null))
  const xe = extent(xs)
  const ze = extent(zs)
  if (!xe || !ze) return null
  const inner = { w: box.w - 2 * box.pad, h: box.h - 2 * box.pad }
  const spanX = Math.max(xe.max - xe.min, 1e-9)
  const spanZ = Math.max(ze.max - ze.min, 1e-9)
  const s = Math.min(inner.w / spanX, inner.h / spanZ)
  const cx = (xe.min + xe.max) / 2
  const cz = (ze.min + ze.max) / 2
  // Map x → right, z → up (SVG y grows downward, so invert z).
  const toPt = (x: number, z: number): Pt => ({
    x: box.w / 2 + (x - cx) * s,
    y: box.h / 2 - (z - cz) * s,
  })
  const pts = rows.map((r) => (r.position ? toPt(r.position.x, r.position.z) : null))
  const valid = pts.filter((p): p is Pt => p !== null)
  return {
    path: polyline(pts),
    start: valid[0] ?? null,
    end: valid.length > 1 ? valid[valid.length - 1] : null,
    xExtent: xe,
    zExtent: ze,
  }
}

export interface Series {
  path: string
  xDomain: Extent
  yDomain: Extent
  xTicks: number[]
  yTicks: number[]
  /** Pixel position of a tick value. */
  sx: (v: number) => number
  sy: (v: number) => number
  count: number
}

/** Generic x/y line: pairs with null y start a gap. Y domain is padded to include zero when asked. */
export function series(xs: number[], ys: (number | null)[], box: Box, opts: { zeroBase?: boolean } = {}): Series | null {
  const ye = extent(ys)
  const xe = extent(xs)
  if (!ye || !xe || ys.every((v) => v === null)) return null
  const yDomain: Extent = opts.zeroBase ? { min: Math.min(0, ye.min), max: Math.max(0, ye.max) } : { ...ye }
  if (yDomain.max === yDomain.min) {
    yDomain.min -= 1
    yDomain.max += 1
  }
  const sx = scale(xe, box.pad, box.w - box.pad)
  const sy = scale(yDomain, box.h - box.pad, box.pad)
  const pts = xs.map((x, i) => {
    const y = ys[i]
    return y === null || y === undefined ? null : { x: sx(x), y: sy(y) }
  })
  return {
    path: polyline(pts),
    xDomain: xe,
    yDomain,
    xTicks: ticks(xe),
    yTicks: ticks(yDomain),
    sx,
    sy,
    count: pts.filter((p) => p !== null).length,
  }
}

/** Profile: cumulative distance (m) vs position.y (m). Uses the timeline's running distance; none if it never moved. */
export function profile(rows: TimelineRow[], box: Box): Series | null {
  const xs = rows.map((r) => r.distance ?? 0)
  if (xs.every((x) => x === xs[0])) return null
  const ys = rows.map((r) => (r.position ? r.position.y : null))
  return series(xs, ys, box)
}

export type GraphKey = 'speed' | 'power' | 'heartRate' | 'grade'

export interface GraphSpec {
  key: GraphKey
  label: string
  /** Extract the plotted SI value from a row. */
  pick: (r: TimelineRow) => number | null
}

/** Which of the standard graphs have any data. Grade prefers incline.commanded, falls back to grade.commanded. */
export function graphSpecs(rows: TimelineRow[]): GraphSpec[] {
  const specs: GraphSpec[] = [
    { key: 'speed', label: 'Speed', pick: (r) => r.speed?.actual ?? r.speed?.requested ?? null },
    { key: 'power', label: 'Power', pick: (r) => r.power?.actual ?? null },
    { key: 'heartRate', label: 'Heart rate', pick: (r) => r.heartRate?.actual ?? null },
  ]
  const hasIncline = rows.some((r) => r.incline?.commanded !== null && r.incline?.commanded !== undefined)
  const hasGrade = rows.some((r) => r.grade?.commanded !== null && r.grade?.commanded !== undefined)
  if (hasIncline) specs.push({ key: 'grade', label: 'Incline (commanded)', pick: (r) => r.incline?.commanded ?? null })
  else if (hasGrade) specs.push({ key: 'grade', label: 'Grade (commanded)', pick: (r) => r.grade?.commanded ?? null })
  return specs.filter((s) => rows.some((r) => s.pick(r) !== null))
}

/** Build a graph of one metric vs elapsed seconds. Returns null if all values are null. */
export function graph(rows: TimelineRow[], spec: GraphSpec, box: Box, convert: (v: number) => number = (v) => v): Series | null {
  const xs = rows.map((r) => r.elapsed)
  const ys = rows.map((r) => {
    const v = spec.pick(r)
    return v === null ? null : convert(v)
  })
  return series(xs, ys, box, { zeroBase: true })
}
