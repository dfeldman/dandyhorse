/**
 * Where the water is: `npm run water -- katy-trail alpe-dhuez`.
 *
 * The Katy Trail runs two hundred kilometres along the Missouri and the Alpe starts on the Romanche, and until
 * now both rivers were a dry green trough. Water is the one thing in these landscapes that the elevation model
 * cannot supply: a river reads as a flat strip in a DEM only if the DEM happens to be fine enough, and at
 * thirty metres the Missouri is three pixels of noise. What a river IS, though — its bank, its width, its
 * islands — is in OpenStreetMap, which the baker already reads.
 *
 * **This is a sidecar, not part of the route package.** It writes `public/routes/<id>.water.json` beside the
 * three files the game already loads, and the renderer treats it as optional. Water could have been folded
 * into the manifest instead, and then adding it would have meant bumping the package's schema version and
 * re-baking every route from scratch — which means re-downloading a DEM the size of Missouri to add a river
 * that was always there. A route with no water file simply has no water, which is the truth for most of them.
 *
 * What is written is in the route's own world metres, so the game does no projection and knows nothing about
 * latitude: polygons for lakes and river banks, centrelines for anything too narrow to have been mapped as an
 * area, and one surface height for each, taken from the elevation model the route already carries.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { project, type LatLon } from '../src/route/geo.ts'
import type { RouteManifest } from '../src/route/package.ts'

const DIR = resolve(import.meta.dirname, '..', 'public', 'routes')
const CACHE = resolve(import.meta.dirname, 'cache')
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const UA = 'trailtrainer/0.1 (Dandyhorse exergame route baker; https://openstreetmap.org/copyright)'

/** How far either side of the route water is worth having. Beyond this it is a blue smear in the haze. */
const CORRIDOR = 1400
/** Points closer together than this along a bank are dropped: the game does not need centimetres of coastline. */
const SIMPLIFY = 8

interface OsmElement {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
  members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>
}

/** What the renderer reads. Everything is in route world metres; `y` is the surface height. */
export interface WaterPackage {
  schemaVersion: 1
  id: string
  /** lakes, ponds, and the mapped banks of big rivers, as closed rings */
  areas: Array<{ y: number; points: number[]; kind: 'lake' | 'river' }>
  /** rivers and streams that are only a line on the map, with the width to draw them */
  lines: Array<{ width: number; kind: 'river' | 'stream'; points: number[]; heights: number[] }>
  attribution: string
}

async function overpass(query: string): Promise<OsmElement[]> {
  mkdirSync(CACHE, { recursive: true })
  const file = resolve(CACHE, `water-${createHash('sha1').update(query).digest('hex').slice(0, 16)}.json`)
  let text: string
  if (existsSync(file)) {
    text = readFileSync(file, 'utf8')
  } else {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams({ data: query }),
    })
    if (!res.ok) throw new Error(`overpass ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`)
    text = await res.text()
    if (!text.trimStart().startsWith('{')) throw new Error(`overpass returned non-JSON: ${text.slice(0, 200)}`)
    writeFileSync(file, text)
  }
  return (JSON.parse(text) as { elements: OsmElement[] }).elements
}

/**
 * The elevation model, read back exactly as the game reads it.
 *
 * Water has to sit at the height the ground around it is drawn at, and that ground comes from this same
 * model — so the only way to be sure they agree is to ask the same question of the same bytes. A river given
 * a level from anywhere else would either flood its banks or run in a trench.
 */
function demReader(manifest: RouteManifest, dem: Int16Array): (x: number, z: number) => number {
  const { step, tile, tiles, noData, scale } = manifest.dem
  const index = new Map(tiles.map((t, i) => [`${t.col},${t.row}`, i]))
  return (x: number, z: number): number => {
    const gx = x / step
    const gz = z / step
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const at = (ii: number, jj: number): number => {
      const col = Math.floor(ii / tile)
      const row = Math.floor(jj / tile)
      const slot = index.get(`${col},${row}`)
      if (slot === undefined) return Number.NaN
      const lx = ii - col * tile
      const lz = jj - row * tile
      const v = dem[slot * tile * tile + lz * tile + lx]
      return v === noData ? Number.NaN : v / scale
    }
    const a = at(i, j)
    const b = at(i + 1, j)
    const c = at(i, j + 1)
    const d = at(i + 1, j + 1)
    if (![a, b, c, d].every(Number.isFinite)) return Number.NaN
    const tx = gx - i
    const tz = gz - j
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }
}

/** The lowest ground a water body covers, which is the level the water itself must be at. */
function levelOf(points: number[], height: (x: number, z: number) => number): number {
  const samples: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    const h = height(points[i], points[i + 1])
    if (Number.isFinite(h)) samples.push(h)
  }
  if (!samples.length) return Number.NaN
  samples.sort((a, b) => a - b)
  /**
   * A low quantile rather than the minimum.
   *
   * The elevation model is noisy, and one bad post — a spike off a bridge deck, a hole in the void mask —
   * would put a whole lake a few metres out. The tenth percentile of a ring that follows the bank is a good
   * estimate of the level the water is actually at, because most of a bank IS at water level.
   */
  return samples[Math.floor(samples.length * 0.1)]
}

function bake(id: string, invent: boolean, inventAbove: number): Promise<void> {
  return (async () => {
    const manifest = JSON.parse(readFileSync(resolve(DIR, `${id}.json`), 'utf8')) as RouteManifest
    const trackBuf = readFileSync(resolve(DIR, `${id}.track.bin`))
    const track = new Float32Array(trackBuf.buffer, trackBuf.byteOffset, trackBuf.byteLength / 4)
    const demBuf = readFileSync(resolve(DIR, `${id}.dem.bin`))
    const height = demReader(manifest, new Int16Array(demBuf.buffer, demBuf.byteOffset, demBuf.byteLength / 2))
    const origin = manifest.origin as LatLon

    // the bounding box of the route, with room for the corridor
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
    const RAD = Math.PI / 180
    for (let i = 0; i < manifest.samples; i++) {
      const x = track[i * 3]
      const z = track[i * 3 + 1]
      const lat = origin.lat + z / (RAD * 6371000)
      const lon = origin.lon + x / (RAD * 6371000 * Math.cos(lat * RAD))
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
    }
    const pad = CORRIDOR / 111000
    const bbox = `${(minLat - pad).toFixed(4)},${(minLon - pad * 1.4).toFixed(4)},${(maxLat + pad).toFixed(4)},${(maxLon + pad * 1.4).toFixed(4)}`

    /**
     * Areas and lines, in one query.
     *
     * `natural=water` covers lakes, ponds and reservoirs; `waterway=riverbank` is the older tagging for the
     * banks of a big river and is still most of the Missouri. Relations are asked for as well, because a river
     * with an island in it is a multipolygon and the Missouri has a great many islands — `out geom` gives
     * their member ways' geometry directly, so nothing has to be stitched from node ids.
     */
    const query = `[out:json][timeout:180];
(
  way["natural"="water"](${bbox});
  way["waterway"="riverbank"](${bbox});
  relation["natural"="water"](${bbox});
  way["waterway"~"^(river|stream|canal)$"](${bbox});
);
out geom;`

    process.stdout.write(`  ${id}: asking Overpass for water in ${bbox}\n`)
    const elements = await overpass(query)

    // a coarse index over the route, to reject anything far from it without testing every sample
    const cell = 2000
    const grid = new Map<string, number[]>()
    for (let i = 0; i < manifest.samples; i += 3) {
      const k = `${Math.floor(track[i * 3] / cell)},${Math.floor(track[i * 3 + 1] / cell)}`
      let list = grid.get(k)
      if (!list) { list = []; grid.set(k, list) }
      list.push(i)
    }
    const nearRoute = (x: number, z: number): boolean => {
      const cx = Math.floor(x / cell)
      const cz = Math.floor(z / cell)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (Math.hypot(track[i * 3] - x, track[i * 3 + 1] - z) < CORRIDOR) return true
          }
        }
      }
      return false
    }

    const toWorld = (ring: Array<{ lat: number; lon: number }>): number[] => {
      const out: number[] = []
      let lastX = Infinity
      let lastZ = Infinity
      for (const p of ring) {
        const v = project(p, origin)
        if (Math.hypot(v.x - lastX, v.z - lastZ) < SIMPLIFY) continue
        out.push(v.x, v.z)
        lastX = v.x
        lastZ = v.z
      }
      return out
    }

    const areas: WaterPackage['areas'] = []
    const lines: WaterPackage['lines'] = []

    /**
     * Rings have to be STITCHED, and a way that is not closed is not an area.
     *
     * This is the trap in reading areas out of OpenStreetMap, and it was expensive: a big river is a
     * multipolygon relation whose outer boundary is split into a dozen member ways, none of them closed — each
     * one is a stretch of bank, and only end to end do they make a ring. Treating each fragment as a polygon in
     * its own right and running a crossing-count test on it does not fail loudly. It answers nonsense, and the
     * nonsense it answered was "yes, inside" for half of Missouri: every tree and every blade of grass within a
     * kilometre of the Missouri was deleted for standing in the river, and the river covered the horizon.
     *
     * So members are joined on shared endpoints until they close, and anything that will not close is dropped.
     * A bare way is only taken as an area if it closes on itself.
     */
    const close = (ring: number[]): boolean =>
      ring.length >= 8 && Math.hypot(ring[0] - ring[ring.length - 2], ring[1] - ring[ring.length - 1]) < 30

    const stitch = (parts: number[][]): number[][] => {
      const rings: number[][] = []
      const pool = parts.filter((p) => p.length >= 4)
      while (pool.length) {
        let ring = pool.shift() as number[]
        let joined = true
        while (joined && !close(ring)) {
          joined = false
          for (let i = 0; i < pool.length; i++) {
            const part = pool[i]
            const ex = ring[ring.length - 2], ez = ring[ring.length - 1]
            const headGap = Math.hypot(part[0] - ex, part[1] - ez)
            const tailGap = Math.hypot(part[part.length - 2] - ex, part[part.length - 1] - ez)
            if (headGap > 30 && tailGap > 30) continue
            const piece = headGap <= tailGap ? part : part.slice().reverse().reduce<number[]>((acc, _v, k, arr) => {
              // reverse in pairs: the array is x, z, x, z and must stay that way
              if (k % 2 === 0) acc.push(arr[k + 1], arr[k])
              return acc
            }, [])
            ring = ring.concat(piece.slice(2))
            pool.splice(i, 1)
            joined = true
            break
          }
        }
        if (close(ring)) rings.push(ring)
      }
      return rings
    }

    for (const el of elements) {
      const tags = el.tags ?? {}
      const waterway = tags.waterway
      const isArea = tags.natural === 'water' || waterway === 'riverbank'

      if (el.type === 'relation') {
        const parts = (el.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => toWorld(m.geometry as Array<{ lat: number; lon: number }>))
        for (const ring of stitch(parts)) {
          let near = false
          for (let i = 0; i < ring.length && !near; i += 2) near = nearRoute(ring[i], ring[i + 1])
          if (!near) continue
          const y = levelOf(ring, height)
          if (!Number.isFinite(y)) continue
          areas.push({ y: Math.round(y * 100) / 100, points: ring.map((v) => Math.round(v * 10) / 10), kind: 'river' })
        }
        continue
      }

      if (!el.geometry) continue
      const points = toWorld(el.geometry)
      if (points.length < 4) continue
      let near = false
      for (let i = 0; i < points.length && !near; i += 2) near = nearRoute(points[i], points[i + 1])
      if (!near) continue

      if (isArea && close(points)) {
        const y = levelOf(points, height)
        if (!Number.isFinite(y)) continue
        areas.push({ y: Math.round(y * 100) / 100, points: points.map((v) => Math.round(v * 10) / 10), kind: waterway === 'riverbank' ? 'river' : 'lake' })
      } else if (waterway) {
        /**
         * A line, with a height at every point — because a stream is the one water surface that is NOT level.
         * It runs down the hill it is in, and drawing it flat would put it under the ground at one end and
         * hanging over the valley at the other. The heights are forced to fall along the line, since water does
         * not run uphill and the elevation model does not know that.
         */
        const heights: number[] = []
        for (let i = 0; i < points.length; i += 2) heights.push(height(points[i], points[i + 1]))
        if (!heights.every(Number.isFinite)) continue
        const forward = heights[0] >= heights[heights.length - 1]
        for (let i = 1; i < heights.length; i++) {
          const a = forward ? i : heights.length - 1 - i
          const b = forward ? i - 1 : heights.length - i
          heights[a] = Math.min(heights[a], heights[b])
        }
        const width = Number(tags.width)
        lines.push({
          kind: waterway === 'stream' ? 'stream' : 'river',
          width: Number.isFinite(width) ? Math.max(1.5, width) : waterway === 'stream' ? 3 : 14,
          points: points.map((v) => Math.round(v * 10) / 10),
          heights: heights.map((v) => Math.round(v * 100) / 100),
        })
      }
    }

    /**
     * Tarns and torrents that are not on the map, for a mountain that ought to have them.
     *
     * Above the tree line the Alpe has almost no mapped water: a few culverted torrents, and nothing standing.
     * That is true to the place and dull to ride through, and the one thing a high pasture reliably does have
     * is meltwater — a pool in every hollow and a thread of water down every gully. So they are invented, but
     * not arbitrarily: the elevation model is asked where the hollows ARE. A pond goes wherever a point is
     * lower than everything around it and the ground about it is nearly level, and a stream is dropped from a
     * point above the tree line and allowed to run down the steepest way it can find, which is what water does
     * and why torrents pick out the gullies of a face rather than crossing them.
     *
     * Deterministic, like everything else placed in this world: the same hollow has the same tarn in it every
     * session, because the hollow is what put it there.
     */
    if (invent) {
      const hash = (a: number, b: number): number => {
        let h = (a | 0) * 374761393 + (b | 0) * 668265263
        h = (h ^ (h >>> 13)) * 1274126177
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296
      }
      const step = 40
      const ponds: Array<{ x: number; z: number; y: number }> = []
      // the corridor around the route, walked on a coarse lattice
      for (let i = 0; i < manifest.samples; i += Math.max(1, Math.round(120 / manifest.step))) {
        const tx = track[i * 3]
        const tz = track[i * 3 + 1]
        for (let dz = -10; dz <= 10; dz++) {
          for (let dx = -10; dx <= 10; dx++) {
            const x = Math.round((tx + dx * step * 2) / step) * step
            const z = Math.round((tz + dz * step * 2) / step) * step
            const h = height(x, z)
            if (!Number.isFinite(h)) continue
            if (h < inventAbove) continue
            /**
             * A hollow, judged gently.
             *
             * Demanding a strict minimum of all eight neighbours found NOTHING on a thirty-metre model of a
             * mountain: a real basin is wider than one post, and the model's own noise is enough to put a
             * slightly lower reading somewhere on its rim. What a tarn actually needs is ground that is nearly
             * level and a little dished — lower than most of what surrounds it — so that is what is asked for.
             */
            let above = 0
            let rim = Infinity
            let ok = true
            for (let a = -1; a <= 1 && ok; a++) {
              for (let b = -1; b <= 1; b++) {
                if (!a && !b) continue
                const n = height(x + a * step, z + b * step)
                if (!Number.isFinite(n)) { ok = false; break }
                if (n > h) { above++; rim = Math.min(rim, n) }
              }
            }
            if (!ok || above < 6) continue
            const fall = Math.abs(height(x + step, z) - height(x - step, z)) + Math.abs(height(x, z + step) - height(x, z - step))
            // nothing stands on a slope: a fifth of a metre per metre and the water is already a waterfall
            if (!(fall / (4 * step) < 0.15)) continue
            const depth = rim - h
            if (depth < 0.25 || depth > 12) continue
            // Most hollows that pass all of that get water. They are rare enough already — of twenty thousand
            // points along this corridor, eight are a dished, level, high hollow — and thinning them further
            // (the first attempt kept one in six) left a mountain with no standing water on it at all.
            if (hash(x, z) > 0.8) continue
            if (ponds.some((q) => Math.hypot(q.x - x, q.z - z) < 150)) continue
            ponds.push({ x, z, y: h + Math.max(0.45, Math.min(depth * 0.6, 1.8)) })
          }
        }
      }

      for (const pond of ponds) {
        // an irregular ring about the hollow, cut back wherever the ground has already risen through it
        const points: number[] = []
        const r0 = 14 + hash(pond.x + 11, pond.z + 7) * 26
        const sides = 18
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2
          const wobble = 0.62 + hash(pond.x + k * 31, pond.z - k * 17) * 0.72
          let r = r0 * wobble
          // walk in until the rim is above the surface, so the tarn fills the hollow and does not spill
          for (let tries = 0; tries < 6 && r > 5; tries++) {
            const hx = pond.x + Math.cos(a) * r
            const hz = pond.z + Math.sin(a) * r
            const hh = height(hx, hz)
            if (Number.isFinite(hh) && hh > pond.y) break
            r *= 0.82
          }
          points.push(Math.round((pond.x + Math.cos(a) * r) * 10) / 10, Math.round((pond.z + Math.sin(a) * r) * 10) / 10)
        }
        points.push(points[0], points[1])
        areas.push({ y: Math.round(pond.y * 100) / 100, points, kind: 'lake' })
      }

      // and the torrents: from the high ground, downhill, until they leave the baked corridor
      let seeds = 0
      for (let i = 0; i < manifest.samples && seeds < 60; i += Math.max(1, Math.round(90 / manifest.step))) {
        for (const side of [-1, 1]) {
          const ax = track[Math.max(0, i - 2) * 3]
          const az = track[Math.max(0, i - 2) * 3 + 1]
          const bx = track[Math.min(manifest.samples - 1, i + 2) * 3]
          const bz = track[Math.min(manifest.samples - 1, i + 2) * 3 + 1]
          const len = Math.hypot(bx - ax, bz - az) || 1
          const nx = (-(bz - az) / len) * side
          const nz = ((bx - ax) / len) * side
          const sx = track[i * 3] + nx * 320
          const sz = track[i * 3 + 1] + nz * 320
          if (hash(Math.round(sx), Math.round(sz)) > 0.28) continue
          const h0 = height(sx, sz)
          if (!Number.isFinite(h0) || h0 < inventAbove - 250) continue

          const points: number[] = []
          const heights: number[] = []
          let x = sx
          let z = sz
          let y = h0
          for (let s2 = 0; s2 < 40; s2++) {
            points.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10)
            heights.push(Math.round(y * 100) / 100)
            // the steepest way down, looked for on a circle rather than a lattice so it does not stairstep
            let bestA = 0
            let bestH = Infinity
            for (let k = 0; k < 12; k++) {
              const a = (k / 12) * Math.PI * 2
              const hh = height(x + Math.cos(a) * step, z + Math.sin(a) * step)
              if (Number.isFinite(hh) && hh < bestH) { bestH = hh; bestA = a }
            }
            if (!Number.isFinite(bestH) || bestH >= y) break
            x += Math.cos(bestA) * step
            z += Math.sin(bestA) * step
            y = bestH
          }
          if (points.length >= 8) {
            // wider than a real torrent, deliberately: at this distance a two-metre thread is not water, it is
            // a scratch, and the one that can be seen from the road is the one worth having
            lines.push({ kind: 'stream', width: 3.4 + hash(Math.round(sx), Math.round(sz) + 3) * 4.2, points, heights })
            seeds++
          }
        }
      }
      process.stdout.write(`  ${id}: invented ${ponds.length} tarns and ${seeds} torrents\n`)
    }

    const pkg: WaterPackage = {
      schemaVersion: 1,
      id,
      areas,
      lines,
      attribution: 'Water from www.openstreetmap.org, under ODbL.',
    }
    const file = resolve(DIR, `${id}.water.json`)
    writeFileSync(file, JSON.stringify(pkg))
    const size = (readFileSync(file).byteLength / 1024).toFixed(0)
    process.stdout.write(`  ${id}: ${areas.length} areas, ${lines.length} watercourses, ${size} kB\n`)
  })()
}

/**
 * `--invent` adds the tarns and torrents described above, and `--above=<metres>` is the height they start at.
 * It is off by default: a route through farmland wants the water that is actually there and nothing else. The
 * Alpe is baked with it, from about the tree line up.
 */
const args = process.argv.slice(2)
const invent = args.includes('--invent')
const above = Number((args.find((a) => a.startsWith('--above=')) ?? '--above=1450').slice(8))
const wanted = args.filter((a) => !a.startsWith('--'))
for (const id of wanted.length ? wanted : ['katy-trail', 'alpe-dhuez']) {
  await bake(id, invent, above)
}
