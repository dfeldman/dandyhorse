/**
 * Bakes a real route into the three files the game loads. Run it as `npm run bake` (all routes) or
 * `npm run bake -- alpe-dhuez`.
 *
 *   OpenStreetMap ways ──► graph ──► shortest path between the route's two ends
 *                                        │
 *                             resample to a fixed step on the sphere
 *                                        │
 *   terrain tiles ──► elevation along the route ──► smoothed profile ──► stats, checked against tools/routes.ts
 *                └──► a sparse grid of the ground either side ──► <id>.dem.bin
 *
 * The check at the end is the point of the whole file: a route whose length or climbing disagrees with the
 * published figures has been stitched or smoothed wrong, and baking it quietly would put a lie in the game.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cumulative, haversine, profileStats, project, resample, smoothProfile, unproject, type LatLon } from '../src/route/geo.ts'
import type { Band, BiomeName, Landmark, RouteManifest, SurfaceName } from '../src/route/package.ts'
import { buildGraph, overpass, shortestPath, type OsmWay } from './overpass.ts'
import { ATTRIBUTION as TILE_ATTRIBUTION, Elevation } from './terrarium.ts'
import { ATTRIBUTION as PROFILE_ATTRIBUTION, sampleProfile } from './profiles.ts'
import { PLACES_QUERY, ROUTES, routeById, type RouteSpec } from './routes.ts'

const OUT = resolve(import.meta.dirname, '..', 'public', 'routes')
const TILE = 64 // grid posts per side of a terrain tile
const NO_DATA = -32768

/** OSM's surface vocabulary, reduced to the three the game can draw. */
function surfaceOf(way: OsmWay | undefined): SurfaceName {
  const t = way?.tags ?? {}
  const s = t.surface ?? ''
  if (/^(asphalt|paved|concrete|chipseal|paving_stones|sett|cobblestone)/.test(s)) return 'paved'
  if (/^(gravel|fine_gravel|compacted|limestone|pebblestone|crushed|ground;gravel)/.test(s)) return 'gravel'
  if (/^(ground|dirt|earth|unpaved|grass|sand|mud|woodchips)/.test(s)) return 'dirt'
  // no surface tag: guess from what kind of way it is
  if (t.highway === 'track' || t.highway === 'path' || t.highway === 'bridleway') return 'dirt'
  if (t.highway === 'cycleway' || t.highway === 'footway') return 'gravel'
  return 'paved'
}

/** Run-length encode per-sample values into bands, dropping runs too short to be worth a change of scenery. */
function bands<T>(values: T[], step: number, minLength: number): Array<Band<T>> {
  const out: Array<Band<T>> = []
  for (let i = 0; i < values.length; i++) {
    const last = out[out.length - 1]
    if (!last || last.value !== values[i]) out.push({ start: i * step, value: values[i] })
  }
  // merge anything shorter than minLength back into the band before it
  const merged: Array<Band<T>> = []
  for (let i = 0; i < out.length; i++) {
    const end = i + 1 < out.length ? out[i + 1].start : values.length * step
    if (merged.length && end - out[i].start < minLength) continue
    if (merged.length && merged[merged.length - 1].value === out[i].value) continue
    merged.push(out[i])
  }
  if (!merged.length && out.length) merged.push(out[0])
  if (merged.length) merged[0].start = 0
  return merged
}

/** Towns, peaks and viewpoints within `within` metres of the route, placed at the point they are nearest. */
async function landmarks(spec: RouteSpec, track: LatLon[], step: number, within: number): Promise<Landmark[]> {
  const lat = track.map((p) => p.lat)
  const lon = track.map((p) => p.lon)
  const bbox = `${Math.min(...lat) - 0.02},${Math.min(...lon) - 0.02},${Math.max(...lat) + 0.02},${Math.max(...lon) + 0.02}`
  const query = PLACES_QUERY(bbox)
  try {
    await overpass(query) // fetches and caches; its own return value is ways, and this query asks for nodes
  } catch (e) {
    process.stderr.write(`  landmarks: skipped (${String(e)})\n`)
    return []
  }
  const places = await overpassNodes(query)

  // a coarse grid over the track keeps this from being O(places × samples)
  const origin = track[0]
  const cell = 2000
  const grid = new Map<string, number[]>()
  const xz = track.map((p) => project(p, origin))
  for (let i = 0; i < xz.length; i += 5) {
    const k = `${Math.floor(xz[i].x / cell)},${Math.floor(xz[i].z / cell)}`
    let list = grid.get(k)
    if (!list) { list = []; grid.set(k, list) }
    list.push(i)
  }
  const found: Landmark[] = []
  const seen = new Set<string>()
  for (const p of places) {
    const name = p.tags?.name
    if (!name || p.lat === undefined || p.lon === undefined) continue
    const q = project({ lat: p.lat, lon: p.lon }, origin)
    let best = -1
    let bd = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const i of grid.get(`${Math.floor(q.x / cell) + dx},${Math.floor(q.z / cell) + dz}`) ?? []) {
          const d = (xz[i].x - q.x) ** 2 + (xz[i].z - q.z) ** 2
          if (d < bd) { bd = d; best = i }
        }
      }
    }
    if (best < 0 || Math.sqrt(bd) > within) continue
    if (seen.has(name)) continue
    seen.add(name)
    const kind: Landmark['kind'] = p.tags?.natural === 'peak' ? 'summit' : p.tags?.tourism === 'viewpoint' ? 'viewpoint' : 'town'
    const ele = Number(p.tags?.ele)
    found.push({ s: Math.round(best * step), name, kind, ...(Number.isFinite(ele) ? { elevation: Math.round(ele) } : {}) })
  }
  found.sort((a, b) => a.s - b.s)
  return found
}

/** The node half of an Overpass answer (tools/overpass.ts keeps only ways). */
async function overpassNodes(query: string): Promise<Array<{ lat?: number; lon?: number; tags?: Record<string, string> }>> {
  const { readFileSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  const file = resolve(import.meta.dirname, 'cache', `overpass-${createHash('sha1').update(query).digest('hex').slice(0, 16)}.json`)
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { elements: Array<{ type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> }
    return data.elements
      .filter((e) => e.type === 'node')
      .map((e) => ({ lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags }))
  } catch {
    return []
  }
}

async function bake(spec: RouteSpec): Promise<void> {
  process.stderr.write(`\n${spec.name} (${spec.id})\n`)

  // --- 1. the line on the ground -----------------------------------------------------------------
  const osm = await overpass(spec.query)
  if (!osm.ways.length) throw new Error('the Overpass query returned no ways')
  process.stderr.write(`  osm: ${osm.ways.length} ways\n`)
  const graph = buildGraph(osm.ways)
  const path = shortestPath(graph, spec.from, spec.to)
  process.stderr.write(`  path: ${(path.length / 1000).toFixed(2)} km over ${path.steps.length} nodes\n`)

  const raw = path.steps.map((s) => s.point)
  const { points: track, length } = resample(raw, spec.step)
  const origin = track[0]

  // --- 2. surfaces, carried across the resample -----------------------------------------------------
  const rawS = cumulative(raw)
  const perSample: SurfaceName[] = []
  {
    let j = 0
    for (let i = 0; i < track.length; i++) {
      const s = i * spec.step
      while (j < rawS.length - 2 && rawS[j + 1] < s) j++
      perSample.push(surfaceOf(graph.ways.get(path.steps[Math.min(j, path.steps.length - 1)].way)))
    }
  }
  const surfaces = bands(perSample, spec.step, 200)

  // --- 3. the ground, near and far ------------------------------------------------------------------
  const dem = new Elevation(12)
  const xz = track.map((p) => project(p, origin))
  const posts = spec.demStep
  const span = Math.ceil(spec.demHalfWidth / posts)
  const wanted = new Set<string>()
  const colRow = (v: { x: number; z: number }): { col: number; row: number } => ({ col: Math.round(v.x / posts), row: Math.round(v.z / posts) })
  // every DEM tile the corridor touches, found by walking the centreline
  const stride = Math.max(1, Math.floor(posts / spec.step))
  for (let i = 0; i < xz.length; i += stride) {
    const c = colRow(xz[i])
    for (let dc = -span; dc <= span; dc += 1) {
      for (let dr = -span; dr <= span; dr += 1) {
        if (dc * dc + dr * dr > span * span) continue
        wanted.add(`${Math.floor((c.col + dc) / TILE)},${Math.floor((c.row + dr) / TILE)}`)
      }
    }
  }
  const tiles = [...wanted].map((k) => { const [col, row] = k.split(',').map(Number); return { col, row } })
  tiles.sort((a, b) => a.row - b.row || a.col - b.col)
  process.stderr.write(`  terrain: ${tiles.length} tiles of ${TILE}x${TILE} posts at ${posts} m\n`)

  for (const t of tiles) {
    const a = unproject({ x: t.col * TILE * posts, z: t.row * TILE * posts }, origin)
    const b = unproject({ x: (t.col + 1) * TILE * posts, z: (t.row + 1) * TILE * posts }, origin)
    dem.require({ minLat: Math.min(a.lat, b.lat), maxLat: Math.max(a.lat, b.lat), minLon: Math.min(a.lon, b.lon), maxLon: Math.max(a.lon, b.lon) })
  }
  for (const p of track) dem.require({ minLat: p.lat, maxLat: p.lat, minLon: p.lon, maxLon: p.lon })
  await dem.load()

  // --- 4. the profile -------------------------------------------------------------------------------
  // the centreline comes from the best model covering the route (metres, not tens of metres); the terrain
  // tiles only stand in where that model has no coverage, so a route never has a hole in it
  const sampled = await sampleProfile(spec.profileSource, track)
  let filled = 0
  const rawElevation = sampled.map((v, i) => { if (v !== null) return v; filled++; return dem.at(track[i]) })
  if (filled) process.stderr.write(`  profile: ${filled} point(s) outside ${spec.profileSource}, filled from the terrain tiles\n`)
  const elevation = smoothProfile(rawElevation, spec.step, spec.smoothing)
  const stats = profileStats(elevation, spec.step)

  // --- 5. the check ---------------------------------------------------------------------------------
  const lengthErr = Math.abs(length - spec.expect.length) / spec.expect.length
  const gainErr = Math.abs(stats.gain - spec.expect.gain) / spec.expect.gain
  const verdict = (name: string, got: number, want: number, err: number): string =>
    `${err <= spec.expect.tolerance ? 'ok  ' : 'OFF '} ${name}: ${got.toFixed(0)} vs ${want.toFixed(0)} published (${(err * 100).toFixed(1)}%)`
  process.stderr.write(`  ${verdict('length m', length, spec.expect.length, lengthErr)}\n`)
  process.stderr.write(`  ${verdict('gain m  ', stats.gain, spec.expect.gain, gainErr)}\n`)
  process.stderr.write(`  profile: ${stats.minElevation.toFixed(0)}–${stats.maxElevation.toFixed(0)} m, grade ${(stats.minGrade * 100).toFixed(1)}%…${(stats.maxGrade * 100).toFixed(1)}%, mean ${(stats.averageGrade * 100).toFixed(1)}%\n`)
  if (lengthErr > spec.expect.tolerance || gainErr > spec.expect.tolerance) {
    throw new Error(`${spec.id}: the bake disagrees with the published figures — fix the query, the end points or the smoothing before shipping it`)
  }

  // --- 6. biomes and landmarks ----------------------------------------------------------------------
  const perBiome: BiomeName[] = track.map((_, i) => spec.biome({ s: i * spec.step, fraction: i / (track.length - 1), elevation: elevation[i], length }))
  const biomes = bands(perBiome, spec.step, 400)
  const marks = await landmarks(spec, track, spec.step, spec.kind === 'road' ? 900 : 1800)
  marks.unshift({ s: 0, name: spec.direction.split('→')[0].trim(), kind: 'start', elevation: Math.round(elevation[0]) })
  marks.push({ s: Math.round(length), name: spec.direction.split('→').pop()!.trim(), kind: 'finish', elevation: Math.round(elevation[elevation.length - 1]) })
  process.stderr.write(`  landmarks: ${marks.length}\n`)

  // --- 7. write -------------------------------------------------------------------------------------
  mkdirSync(OUT, { recursive: true })
  const trackBin = new Float32Array(track.length * 3)
  for (let i = 0; i < track.length; i++) {
    trackBin[i * 3] = xz[i].x
    trackBin[i * 3 + 1] = xz[i].z
    trackBin[i * 3 + 2] = elevation[i]
  }
  writeFileSync(resolve(OUT, `${spec.id}.track.bin`), Buffer.from(trackBin.buffer))

  const minCol = Math.min(...tiles.map((t) => t.col)) * TILE
  const minRow = Math.min(...tiles.map((t) => t.row)) * TILE
  const demBin = new Int16Array(tiles.length * TILE * TILE)
  let o = 0
  for (const t of tiles) {
    for (let r = 0; r < TILE; r++) {
      for (let c = 0; c < TILE; c++) {
        const p = unproject({ x: (t.col * TILE + c) * posts, z: (t.row * TILE + r) * posts }, origin)
        let v = NO_DATA
        try { v = Math.max(-16000, Math.min(16000, Math.round(dem.at(p) * 2))) } catch { /* outside the fetched tiles */ }
        demBin[o++] = v
      }
    }
  }
  writeFileSync(resolve(OUT, `${spec.id}.dem.bin`), Buffer.from(demBin.buffer))

  const manifest: RouteManifest = {
    schemaVersion: 1,
    id: spec.id,
    name: spec.name,
    direction: spec.direction,
    region: spec.region,
    blurb: spec.blurb,
    kind: spec.kind,
    origin: { lat: origin.lat, lon: origin.lon },
    step: spec.step,
    length: Math.round(length),
    samples: track.length,
    stats: {
      gain: Math.round(stats.gain),
      loss: Math.round(stats.loss),
      minElevation: Math.round(stats.minElevation),
      maxElevation: Math.round(stats.maxElevation),
      maxGrade: Math.round(stats.maxGrade * 1e4) / 1e4,
      minGrade: Math.round(stats.minGrade * 1e4) / 1e4,
      averageGrade: Math.round(stats.averageGrade * 1e4) / 1e4,
    },
    biomes,
    surfaces,
    landmarks: marks,
    dem: { step: posts, tile: TILE, minCol, minRow, tiles, scale: 2, noData: NO_DATA },
    attribution: {
      geometry: osm.copyright,
      elevation: PROFILE_ATTRIBUTION[spec.profileSource],
      terrain: TILE_ATTRIBUTION,
      bakedAt: new Date().toISOString().slice(0, 10),
      recipe: `shortest path ${spec.from.lat.toFixed(5)},${spec.from.lon.toFixed(5)} → ${spec.to.lat.toFixed(5)},${spec.to.lon.toFixed(5)}; resampled to ${spec.step} m; profile from ${spec.profileSource} smoothed over ${spec.smoothing} m; terrain ${posts} m posts within ${spec.demHalfWidth} m`,
    },
  }
  writeFileSync(resolve(OUT, `${spec.id}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
  const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`
  process.stderr.write(`  wrote ${spec.id}.json, ${spec.id}.track.bin (${kb(trackBin.byteLength)}), ${spec.id}.dem.bin (${kb(demBin.byteLength)})\n`)
}

const wanted = process.argv.slice(2)
const list = wanted.length ? wanted.map((id) => { const r = routeById(id); if (!r) throw new Error(`no route "${id}"`); return r }) : ROUTES
for (const spec of list) await bake(spec)

// the index the game's route picker reads, so the list of routes lives in one place
mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'index.json'), `${JSON.stringify(ROUTES.map((r) => r.id))}\n`)
process.stderr.write('\ndone\n')
