/**
 * The geography a real route needs: true ground distance, a local metric frame, resampling to a fixed
 * step, and the smoothing that turns a 30 m elevation model into a profile a road actually has.
 *
 * Nothing here touches Babylon or the DOM: the bake tool (tools/bake.ts) and the game both import it,
 * so the numbers the game rides are the numbers the tool verified.
 *
 * Frame: x is east, z is north, y is up, all in metres from the route's origin. A sinusoidal projection
 * (per-point cos(lat)) keeps north-south and east-west lengths honest over the few hundred kilometres a
 * route can span; along-track distance is measured on the sphere before projecting, so the route's length
 * is the real one rather than the projection's.
 */

export const EARTH_R = 6378137

export interface LatLon {
  lat: number
  lon: number
}

export interface Vec2 {
  x: number
  z: number
}

const RAD = Math.PI / 180

/** Great-circle distance in metres. Used for every length this game reports. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const la = a.lat * RAD
  const lb = b.lat * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Lat/lon to local metres. Sinusoidal about `origin`: north-south and east-west lengths stay true. */
export function project(p: LatLon, origin: LatLon): Vec2 {
  return {
    x: (p.lon - origin.lon) * RAD * EARTH_R * Math.cos(p.lat * RAD),
    z: (p.lat - origin.lat) * RAD * EARTH_R,
  }
}

/** The inverse of `project`, for putting a local point back on the map (attribution links, debug). */
export function unproject(v: Vec2, origin: LatLon): LatLon {
  const lat = origin.lat + v.z / (RAD * EARTH_R)
  return { lat, lon: origin.lon + v.x / (RAD * EARTH_R * Math.cos(lat * RAD)) }
}

/** Cumulative along-track distance, in metres, one entry per input point (the first is 0). */
export function cumulative(points: LatLon[]): number[] {
  const out = new Array<number>(points.length)
  out[0] = 0
  for (let i = 1; i < points.length; i++) out[i] = out[i - 1] + haversine(points[i - 1], points[i])
  return out
}

/**
 * Resample a polyline to an exact `step` along the ground, interpolating lat/lon. The last sample lands on
 * the final point, so a resampled route ends where the real one does even when the length is not a whole
 * number of steps.
 */
export function resample(points: LatLon[], step: number): { points: LatLon[]; length: number } {
  if (points.length < 2) return { points: points.slice(), length: 0 }
  const s = cumulative(points)
  const length = s[s.length - 1]
  const n = Math.max(1, Math.round(length / step))
  const out: LatLon[] = []
  let j = 0
  for (let i = 0; i <= n; i++) {
    const target = Math.min(length, (i / n) * length)
    while (j < points.length - 2 && s[j + 1] < target) j++
    const span = Math.max(1e-9, s[j + 1] - s[j])
    const f = Math.min(1, Math.max(0, (target - s[j]) / span))
    out.push({ lat: points[j].lat + (points[j + 1].lat - points[j].lat) * f, lon: points[j].lon + (points[j + 1].lon - points[j].lon) * f })
  }
  return { points: out, length }
}

/**
 * Boxcar smoothing, clamped at the ends (a route is open, not a loop — the first and last metres must not
 * wrap into each other). Run twice it approximates a Gaussian, which is what the profile wants.
 */
export function boxcar(values: ArrayLike<number>, half: number): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  if (half < 1 || n === 0) { for (let i = 0; i < n; i++) out[i] = values[i]; return out }
  // running sum over the clamped window
  const at = (i: number): number => values[Math.min(n - 1, Math.max(0, i))]
  let sum = 0
  for (let d = -half; d <= half; d++) sum += at(d)
  const w = 2 * half + 1
  for (let i = 0; i < n; i++) {
    out[i] = sum / w
    sum += at(i + half + 1) - at(i - half)
  }
  return out
}

/**
 * The elevation profile a rider actually feels. A 30 m elevation model sampled along a road is spiky: it
 * sees the hillside the road is cut into, not the road, and a single bad post becomes a 20% wall. Two
 * boxcar passes over `windowMetres` of along-track distance take that out while leaving the climb intact.
 */
export function smoothProfile(elevations: ArrayLike<number>, step: number, windowMetres: number): Float64Array {
  const half = Math.max(1, Math.round(windowMetres / step / 2))
  return boxcar(boxcar(elevations, half), half)
}

/** Grade (rise/run) at each sample, by central difference; the ends use the one-sided slope. */
export function grades(elevations: ArrayLike<number>, step: number): Float64Array {
  const n = elevations.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 1, i + 1)
    out[i] = b === a ? 0 : (elevations[b] - elevations[a]) / ((b - a) * step)
  }
  return out
}

export interface ProfileStats {
  length: number
  gain: number
  loss: number
  minElevation: number
  maxElevation: number
  maxGrade: number
  minGrade: number
  /** gain / length, as a fraction — the number a climb is usually quoted by */
  averageGrade: number
}

/**
 * What a route is worth knowing by. `gain` and `loss` are summed on the smoothed profile: on a raw one
 * every DEM wobble counts as a climb and a flat rail trail reports a thousand metres of ascent.
 */
export function profileStats(elevations: ArrayLike<number>, step: number): ProfileStats {
  let gain = 0
  let loss = 0
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < elevations.length; i++) {
    const e = elevations[i]
    if (e < lo) lo = e
    if (e > hi) hi = e
    if (i > 0) {
      const d = e - elevations[i - 1]
      if (d > 0) gain += d
      else loss -= d
    }
  }
  const g = grades(elevations, step)
  let maxG = -Infinity
  let minG = Infinity
  for (const v of g) {
    if (v > maxG) maxG = v
    if (v < minG) minG = v
  }
  const length = Math.max(0, (elevations.length - 1) * step)
  return {
    length,
    gain,
    loss,
    minElevation: lo === Infinity ? 0 : lo,
    maxElevation: hi === -Infinity ? 0 : hi,
    maxGrade: maxG === -Infinity ? 0 : maxG,
    minGrade: minG === Infinity ? 0 : minG,
    averageGrade: length > 0 ? (elevations[elevations.length - 1] - elevations[0]) / length : 0,
  }
}
