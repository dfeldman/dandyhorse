/**
 * A baked route, loaded and answerable.
 *
 * Everything the game wants to know about where it is comes from here: where the trail goes, how steeply, what
 * it is made of, what grows beside it, and how high the ground is anywhere nearby. All of it was written by
 * tools/bake.ts from OpenStreetMap and the open elevation models; the three files are static and the game
 * fetches nothing else.
 *
 * The route is open, not a loop. `s` runs from 0 to `length` and stops there. That is the whole reason this
 * game exists: a real route is as long as it is, a session is as long as the rider has, and the two are not
 * the same thing.
 *
 * Coordinates are world metres from the route's own origin, which for the Katy Trail means x reaches 300,000.
 * Float32 cannot hold that and draw centimetres, so the renderer keeps a floating origin (see render/frame.ts)
 * and nothing in this file knows about it.
 */
import type { BiomeName, RouteManifest, SurfaceName } from './package.ts'

export interface Pose {
  /** metres along the route */
  s: number
  x: number
  y: number
  z: number
  /** unit horizontal heading */
  hx: number
  hz: number
  /** rise over run */
  grade: number
  /** horizontal curvature, 1/m — signed, and what sets how fast a bend can be taken */
  curvature: number
}

const NEAREST_CELL = 40
/** the second, coarser index: one point every so many metres, bucketed this big */
const COARSE_EVERY = 200
const COARSE_CELL = 400
/**
 * How far along the route two pieces of trail have to be apart before they count as different legs. Alpe
 * d'Huez's tightest hairpins put two legs thirty metres apart on the ground and four hundred apart along the
 * road, so this has to be well under that and well over the sample step.
 */
const LEG_GAP = 150

export class Route {
  readonly manifest: RouteManifest
  readonly length: number
  readonly step: number
  private readonly track: Float32Array
  private readonly samples: number
  private readonly dem: Int16Array
  private readonly demIndex: Map<number, number>
  private readonly cells: Map<number, number[]>
  /** sample indices every COARSE_EVERY metres, and a coarse grid over them */
  private readonly coarse: number[] = []
  private readonly coarseCells: Map<number, number[]>

  private constructor(manifest: RouteManifest, track: Float32Array, dem: Int16Array) {
    this.manifest = manifest
    this.length = manifest.length
    this.step = manifest.step
    this.track = track
    this.samples = manifest.samples
    this.dem = dem
    this.demIndex = new Map(manifest.dem.tiles.map((t, i) => [Route.tileKey(t.col, t.row), i]))
    // a coarse grid over the track, for asking what part of the route a point in the world is near
    this.cells = new Map()
    for (let i = 0; i < this.samples; i++) {
      const k = Route.cellKey(Math.floor(this.track[i * 3] / NEAREST_CELL), Math.floor(this.track[i * 3 + 1] / NEAREST_CELL))
      let list = this.cells.get(k)
      if (!list) { list = []; this.cells.set(k, list) }
      list.push(i)
    }
    // A second index, thinned out. "Which part of the route is this hillside near?" is asked once per terrain
    // chunk and once per scatter cell, over hundreds of metres, and answering that from the fine grid means
    // scanning thousands of cells. Every 200 m is plenty when the answer only picks a biome.
    this.coarseCells = new Map()
    const stride = Math.max(1, Math.round(COARSE_EVERY / this.step))
    for (let i = 0; i < this.samples; i += stride) {
      this.coarse.push(i)
      const k = Route.cellKey(Math.floor(this.track[i * 3] / COARSE_CELL), Math.floor(this.track[i * 3 + 1] / COARSE_CELL))
      let list = this.coarseCells.get(k)
      if (!list) { list = []; this.coarseCells.set(k, list) }
      list.push(i)
    }
  }

  /** Load a route's three files from `base` (the game's own folder; no API is involved). */
  static async load(id: string, base = './routes/'): Promise<Route> {
    const [manifest, track, dem] = await Promise.all([
      fetch(`${base}${id}.json`).then((r) => Route.ok(r, `${id}.json`).json() as Promise<RouteManifest>),
      fetch(`${base}${id}.track.bin`).then((r) => Route.ok(r, `${id}.track.bin`).arrayBuffer()),
      fetch(`${base}${id}.dem.bin`).then((r) => Route.ok(r, `${id}.dem.bin`).arrayBuffer()),
    ])
    if (manifest.schemaVersion !== 1) throw new Error(`${id}: route package version ${manifest.schemaVersion}, expected 1`)
    const expected = manifest.samples * 3 * 4
    if (track.byteLength !== expected) throw new Error(`${id}: track.bin is ${track.byteLength} bytes, expected ${expected}`)
    return new Route(manifest, new Float32Array(track), new Int16Array(dem))
  }

  /**
   * Build a route from bytes already in hand. The browser uses `load`; tests and tools read the same three
   * files off disk and come in here, so what they check is what ships.
   */
  static fromParts(manifest: RouteManifest, track: ArrayBuffer, dem: ArrayBuffer): Route {
    return new Route(manifest, new Float32Array(track), new Int16Array(dem))
  }

  private static ok(r: Response, what: string): Response {
    if (!r.ok) throw new Error(`could not load ${what}: ${r.status} ${r.statusText}`)
    return r
  }

  private static tileKey(col: number, row: number): number {
    return (col + 32768) * 65536 + (row + 32768)
  }

  private static cellKey(cx: number, cz: number): number {
    return (cx + 1048576) * 2097152 + (cz + 1048576)
  }

  /**
   * Where the trail is at `s` metres along it. `s` is clamped: the route has two ends and they are real.
   *
   * Heading, grade and curvature are interpolated between samples, not read off the nearest one. That sounds
   * like a refinement and is not: with the heading taken from integer indices it is piecewise constant, so on
   * Alpe d'Huez's tightest hairpin it holds 63° for ten metres and then snaps to −2°, and the camera — which
   * points wherever the heading points — jerks sixty-five degrees in a single frame. Interpolating costs one
   * extra tangent and makes the bends continuous.
   */
  poseAt(s: number): Pose {
    const clamped = Math.min(this.length, Math.max(0, s))
    const t = clamped / this.step
    const i = Math.min(this.samples - 2, Math.floor(t))
    const f = t - i
    const j = i + 1

    /**
     * Position and heading from ONE curve, so a rider always faces the way they are going.
     *
     * The old pair did not agree, and on a hairpin the disagreement was the whole story. Position was read off
     * the straight line between two samples, so the direction of travel was piecewise constant and snapped at
     * every sample; heading came from a chord spanning i−1 to i+2, three steps wide and centred half a step
     * AHEAD of the position it was given to. So through a bend the bike was pointed at where the road would be
     * a moment later while being carried along the road it was actually on — which is exactly what skating
     * through a corner looks like. No amount of lean hid it, because lean is about the roll axis and this was
     * yaw.
     *
     * Both now come from the same cubic Hermite through the samples, with each sample's tangent the centred
     * difference of its neighbours — a Catmull-Rom spline. The heading is that curve's own derivative, so it is
     * the direction of travel by construction, at every point and not just at the samples, and it is
     * continuous through a bend instead of stepping. The curve passes through every sample, so nothing about
     * where the trail goes has changed; only the path between samples, which is now an arc rather than a
     * corner.
     */
    const ax = this.track[i * 3]
    const az = this.track[i * 3 + 1]
    const ay = this.track[i * 3 + 2]
    const bx = this.track[j * 3]
    const bz = this.track[j * 3 + 1]
    const by = this.track[j * 3 + 2]
    const max = this.samples - 1
    const h = Math.max(0, i - 1)
    const k = Math.min(max, j + 1)
    // the tangent at each end of this span, as a centred difference over one step either side
    const mx0 = (bx - this.track[h * 3]) * 0.5
    const mz0 = (bz - this.track[h * 3 + 1]) * 0.5
    const my0 = (by - this.track[h * 3 + 2]) * 0.5
    const mx1 = (this.track[k * 3] - ax) * 0.5
    const mz1 = (this.track[k * 3 + 1] - az) * 0.5
    const my1 = (this.track[k * 3 + 2] - ay) * 0.5

    const f2 = f * f
    const f3 = f2 * f
    const h00 = 2 * f3 - 3 * f2 + 1
    const h10 = f3 - 2 * f2 + f
    const h01 = -2 * f3 + 3 * f2
    const h11 = f3 - f2
    const x = h00 * ax + h10 * mx0 + h01 * bx + h11 * mx1
    const z = h00 * az + h10 * mz0 + h01 * bz + h11 * mz1
    const y = h00 * ay + h10 * my0 + h01 * by + h11 * my1

    // the same curve differentiated, which is the direction of travel at this exact point
    const d00 = 6 * f2 - 6 * f
    const d10 = 3 * f2 - 4 * f + 1
    const d01 = -6 * f2 + 6 * f
    const d11 = 3 * f2 - 2 * f
    const dx = d00 * ax + d10 * mx0 + d01 * bx + d11 * mx1
    const dz = d00 * az + d10 * mz0 + d01 * bz + d11 * mz1
    const dy = d00 * ay + d10 * my0 + d01 * by + d11 * my1
    const flat = Math.hypot(dx, dz) || 1
    const curvature = this.curvatureAt(i) + (this.curvatureAt(j) - this.curvatureAt(i)) * f
    return { s: clamped, x, y, z, hx: dx / flat, hz: dz / flat, grade: dy / flat, curvature }
  }

  /**
   * Menger curvature from three samples about 10 m apart; positive turns one way, negative the other.
   *
   * The span used to be twenty metres and that is wider than the bends it has to measure: Alpe d'Huez's
   * tightest hairpins turn inside a ten-metre radius, so a chord pair spanning forty metres reached past both
   * ends of the turn and reported a curvature two or three times too small. Everything downstream is scaled by
   * it — how far the rider leans, and the speed the corner is taken at — so a hairpin was ridden through
   * upright and far too fast. Ten metres is about as tight as a road bend gets and still two samples either
   * side of the middle, so it is not reading one sample's GPS wobble as a corner.
   */
  private curvatureAt(i: number): number {
    const span = Math.max(1, Math.round(10 / this.step))
    const a = Math.max(0, i - span)
    const c = Math.min(this.samples - 1, i + span)
    if (c - a < 2) return 0
    const ax = this.track[a * 3]
    const az = this.track[a * 3 + 1]
    const bx = this.track[i * 3]
    const bz = this.track[i * 3 + 1]
    const cx = this.track[c * 3]
    const cz = this.track[c * 3 + 1]
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    const d = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)
    return d > 1e-6 ? (2 * cross) / d : 0
  }

  /** The sharpest bend within `ahead` metres — what a descending rider actually brakes for. */
  worstCurvatureAhead(s: number, ahead: number): number {
    let worst = 0
    for (let d = 0; d <= ahead; d += 5) {
      const k = Math.abs(this.poseAt(s + d).curvature)
      if (k > worst) worst = k
    }
    return worst
  }

  /**
   * The nearest point of the trail to a place in the world, or null if it is nowhere near.
   *
   * The answer is refined onto the segment rather than left at the nearest sample. The ground beside the trail
   * is pulled onto the trail's height, and a height that jumps from one sample to the next builds the corridor
   * as a staircase — which then pokes up through the smoothly interpolated road surface every ten metres. The
   * projection costs two dot products and makes the road a road.
   */
  nearest(x: number, z: number, within = 60): { distance: number; s: number; y: number } | null {
    const best = this.bestSample(x, z, within)
    return best < 0 ? null : this.project(best, x, z, within)
  }

  /**
   * The nearest point of the trail AND the nearest point on some other part of it — the other leg of a
   * hairpin, the next switchback up the hillside.
   *
   * The ground beside the trail is carved down to the trail's own height (see render/ground.ts), and if that
   * carve only ever knows about the single nearest leg then somewhere between two legs the answer switches
   * from one to the other in the space of one vertex. On Alpe d'Huez that was measured as a 24 metre cliff
   * across 2.5 metres of ground, one for every pair of hairpins, which is why the hillside was a staircase.
   * Knowing both legs lets the carve cross from one to the other smoothly.
   *
   * "Some other part" means at least `LEG_GAP` further along the route, so the second answer is a genuinely
   * different piece of road rather than the next sample along the same one.
   */
  nearestPair(x: number, z: number, within = 60): {
    a: { distance: number; s: number; y: number }
    b: { distance: number; s: number; y: number } | null
  } | null {
    const first = this.bestSample(x, z, within)
    if (first < 0) return null
    const a = this.project(first, x, z, within)
    if (!a) return null
    const second = this.bestSample(x, z, within, first)
    const b = second < 0 ? null : this.project(second, x, z, within)
    return { a, b }
  }

  /** The index of the nearest sample, optionally ignoring everything near `awayFrom`. */
  private bestSample(x: number, z: number, within: number, awayFrom = -1): number {
    const cx = Math.floor(x / NEAREST_CELL)
    const cz = Math.floor(z / NEAREST_CELL)
    const reach = Math.ceil(within / NEAREST_CELL)
    const skip = awayFrom >= 0 ? Math.round(LEG_GAP / this.step) : 0
    let best = -1
    let bd = Infinity
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const i of this.cells.get(Route.cellKey(cx + dx, cz + dz)) ?? []) {
          if (skip > 0 && Math.abs(i - awayFrom) < skip) continue
          const d = (this.track[i * 3] - x) ** 2 + (this.track[i * 3 + 1] - z) ** 2
          if (d < bd) { bd = d; best = i }
        }
      }
    }
    return best
  }

  /** Refine a sample index onto the segments either side of it. */
  private project(best: number, x: number, z: number, within: number): { distance: number; s: number; y: number } | null {
    const bd = (this.track[best * 3] - x) ** 2 + (this.track[best * 3 + 1] - z) ** 2
    // project onto the two segments meeting at the nearest sample and keep whichever is closer
    let bestS = best * this.step
    let bestY = this.track[best * 3 + 2]
    let bestD2 = bd
    for (const j of [best - 1, best + 1]) {
      if (j < 0 || j >= this.samples) continue
      const ax = this.track[best * 3]
      const az = this.track[best * 3 + 1]
      const ay = this.track[best * 3 + 2]
      const ex = this.track[j * 3] - ax
      const ez = this.track[j * 3 + 1] - az
      const len2 = ex * ex + ez * ez
      if (len2 < 1e-9) continue
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2))
      const px = ax + ex * t
      const pz = az + ez * t
      const d2 = (px - x) ** 2 + (pz - z) ** 2
      if (d2 < bestD2) {
        bestD2 = d2
        bestS = (best + (j - best) * t) * this.step
        bestY = ay + (this.track[j * 3 + 2] - ay) * t
      }
    }
    const distance = Math.sqrt(bestD2)
    return distance > within ? null : { distance, s: bestS, y: bestY }
  }

  /**
   * Roughly which part of the route a distant point belongs to — good to about 100 m, which is all a biome or a
   * tree needs. Use `nearest` when the answer has to be exact, and this when it has to be quick.
   */
  nearestCoarse(x: number, z: number, within = 1200): { distance: number; s: number; y: number } | null {
    const cx = Math.floor(x / COARSE_CELL)
    const cz = Math.floor(z / COARSE_CELL)
    const reach = Math.ceil(within / COARSE_CELL)
    let best = -1
    let bd = Infinity
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const i of this.coarseCells.get(Route.cellKey(cx + dx, cz + dz)) ?? []) {
          const d = (this.track[i * 3] - x) ** 2 + (this.track[i * 3 + 1] - z) ** 2
          if (d < bd) { bd = d; best = i }
        }
      }
    }
    if (best < 0) return null
    const distance = Math.sqrt(bd)
    return distance > within + COARSE_EVERY ? null : { distance, s: best * this.step, y: this.track[best * 3 + 2] }
  }

  /** One grid post of the elevation model, or NaN where the model has nothing. */
  private post(col: number, row: number): number {
    const { tile, noData, scale } = this.manifest.dem
    const t = this.demIndex.get(Route.tileKey(Math.floor(col / tile), Math.floor(row / tile)))
    if (t === undefined) return NaN
    const lc = col - Math.floor(col / tile) * tile
    const lr = row - Math.floor(row / tile) * tile
    const v = this.dem[t * tile * tile + lr * tile + lc]
    return v === noData ? NaN : v / scale
  }

  /**
   * The height of the ground at a point in the world, from the elevation model — the hillsides, not the trail.
   * Returns NaN outside the baked corridor, which is the terrain builder's cue to stop drawing.
   */
  heightAt(x: number, z: number): number {
    const step = this.manifest.dem.step
    const c = x / step
    const r = z / step
    const c0 = Math.floor(c)
    const r0 = Math.floor(r)
    const fx = c - c0
    const fz = r - r0
    const h00 = this.post(c0, r0)
    const h10 = this.post(c0 + 1, r0)
    const h01 = this.post(c0, r0 + 1)
    const h11 = this.post(c0 + 1, r0 + 1)
    // a corner missing at the edge of the baked area should not punch a hole in the mesh
    let sum = 0
    let weight = 0
    const add = (h: number, w: number): void => { if (Number.isFinite(h)) { sum += h * w; weight += w } }
    add(h00, (1 - fx) * (1 - fz))
    add(h10, fx * (1 - fz))
    add(h01, (1 - fx) * fz)
    add(h11, fx * fz)
    return weight > 0.001 ? sum / weight : NaN
  }

  private bandValue<T>(bands: Array<{ start: number; value: T }>, s: number, fallback: T): T {
    let value = fallback
    for (const b of bands) {
      if (b.start > s) break
      value = b.value
    }
    return value
  }

  surfaceAt(s: number): SurfaceName {
    return this.bandValue(this.manifest.surfaces, s, 'paved')
  }

  biomeAt(s: number): BiomeName {
    return this.bandValue(this.manifest.biomes, s, 'prairie')
  }

  /** Landmarks in [from, to), in order — what the signs beside the trail say. */
  landmarksBetween(from: number, to: number): RouteManifest['landmarks'] {
    return this.manifest.landmarks.filter((m) => m.s >= from && m.s < to)
  }
}
