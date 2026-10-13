/**
 * How high the ground is at a point in the world — the one answer the terrain mesh, the trees and the rocks
 * all have to agree on.
 *
 * It is not simply the elevation model. Near the trail the ground is pulled onto the trail's own profile,
 * because the profile comes from a metres-scale model and the hillsides from a thirty-metre one, and on a road
 * cut into a slope the two differ by ten or fifteen metres. The terrain mesh has always done that blend; when
 * the scatter did not, every tree and boulder within fifty metres of the road hung in the air by exactly the
 * size of the disagreement.
 *
 * The coarse distant ring has to do it too, and that is less obvious. It has a vertex every fifty metres, so
 * left alone it simply misses the road cut and sits ten metres above it — which puts opaque hillside in front
 * of a camera that is three metres above the tarmac. It carves the same corridor, only wider and softer, at a
 * resolution it can actually resolve: a broad valley rather than a road cut, which is what a hillside looks
 * like from three kilometres away anyway.
 *
 * Which part of the trail a far vertex belongs to has to be the EXACT answer, not the thinned one. The thinned
 * index is good to about a hundred metres, and on a mountain road a hundred metres of slop is the other leg of
 * the hairpin, ten or fifteen metres higher up the hillside. Carving the corridor to that height puts the
 * coarse ring six or seven metres ABOVE the tarmac the rider is on — measured all over Alpe d'Huez before this
 * was fixed. So the coarse lookup is kept, but only as a cheap gate: if the thinned index says this vertex is
 * nowhere near the trail it is left on the model, and if it might be near, the exact projection settles it.
 */
import { Config } from '../config.ts'
import type { Route } from '../route/route.ts'

/**
 * Deterministic value noise in world metres. The same point is the same height in every session and for every
 * rider, which is the rule everything placed in this world obeys — a hill that moves between sessions is
 * worse than no hill.
 */
function hash2(ix: number, iz: number): number {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  // smoothstep, so the surface has no creases along the lattice
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash2(x0, z0)
  const b = hash2(x0 + 1, z0)
  const c = hash2(x0, z0 + 1)
  const d = hash2(x0 + 1, z0 + 1)
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz - 0.5
}

/**
 * How rough the ground is here, in metres, before it is faded in near the trail.
 *
 * Three octaves, the shortest of them a little over three vertices long on the detailed ring, which is as fine
 * as a five-metre mesh can carry. Scaled by how steep the elevation model already is: a hillside gets ridges
 * and gullies because water and rock put them there, and the Missouri prairie stays flat because it is flat.
 * Inventing relief evenly everywhere would make the Katy Trail look like moorland.
 */
function relief(route: Route, x: number, z: number): number {
  const d = 15
  const a = route.heightAt(x - d, z)
  const b = route.heightAt(x + d, z)
  const c = route.heightAt(x, z - d)
  const e = route.heightAt(x, z + d)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(e)) return 0
  const slope = Math.hypot(b - a, e - c) / (2 * d)
  // nothing on the flat, full by the time the ground is at about one in four
  const t = Math.min(1, Math.max(0, (slope - 0.06) / 0.22))
  const steepness = t * t * (3 - 2 * t)
  if (steepness <= 0) return 0
  const n =
    valueNoise(x / 90, z / 90) +
    valueNoise(x / 36, z / 36) * 0.45 +
    valueNoise(x / 16, z / 16) * 0.2
  return n * Config.reliefMetres * steepness
}

/**
 * Where the trail is, as far as the ground is concerned — which is not simply the nearest bit of it.
 *
 * The ground is carved down to the trail's height, and with one answer per point that carve switches from one
 * leg of a hairpin to the next in the space of a single vertex. Measured at Alpe d'Huez, 7.5 km up: between
 * two points 2.5 metres apart the nearest leg changed from one 39 metres below the other, and the ground
 * stepped 24 metres. Every pair of hairpins had one, and the hillside was a flight of stairs. Flat colour hid
 * it; the moment the ground was textured it was the most obvious thing on screen.
 *
 * So both legs get a say, weighted by the cube of how far away each one is. The cube matters: it is sharp
 * enough that standing on the road the other leg contributes a centimetre, so the surface still meets the
 * ribbon exactly, and soft enough that crossing between the two is a ten-metre ramp instead of a cliff. The
 * ground between two hairpins is still very steep, which is correct — two roads forty metres apart in height
 * and thirty apart on the ground have something near a wall between them — but it is now a surface rather
 * than a discontinuity.
 */
function carve(route: Route, x: number, z: number, within: number): { distance: number; y: number } | null {
  const pair = route.nearestPair(x, z, within)
  if (!pair) return null
  const { a, b } = pair
  if (!b) return a
  const wa = 1 / (a.distance * a.distance * a.distance + 1)
  const wb = 1 / (b.distance * b.distance * b.distance + 1)
  const total = wa + wb
  return { distance: (a.distance * wa + b.distance * wb) / total, y: (a.y * wa + b.y * wb) / total }
}

/** How far past the flat corridor the detailed ground takes to return to the elevation model. */
export const RELEASE = 50
/** The same, for the coarse ring: broad enough that a mesh sampled every fifty metres can follow it. */
export const FAR_RELEASE = 260

export type Detail = 'near' | 'far'

/**
 * How far out the thinned index is asked whether a coarse vertex is worth an exact projection. It has to
 * cover the whole blend with room for the index's own hundred metres of slop, and being generous here costs
 * nothing: a vertex this close to the trail is a small minority of a two-kilometre chunk.
 */
const FAR_GATE = Config.corridor + FAR_RELEASE + 120

/**
 * Ground height in metres, or NaN outside the baked corridor.
 *
 * Both rings project onto the trail exactly. The coarse ring gates that on the thinned index first, which
 * rejects almost every vertex of a two-kilometre chunk for the price of nine bucket lookups.
 */
export function groundHeight(route: Route, x: number, z: number, detail: Detail = 'near'): number {
  const model = route.heightAt(x, z)
  const far = detail === 'far'
  const release = far ? FAR_RELEASE : RELEASE
  // the cheap test first: most of a coarse chunk is kilometres from the trail and never needs the exact one
  if (far && !route.nearestCoarse(x, z, FAR_GATE)) return model
  const near = carve(route, x, z, Config.corridor + release)
  // The invented relief is only ever on the detailed ring. The coarse one has a vertex every fifty metres,
  // which cannot carry a ninety-metre ridge — it would turn into random spikes rather than a landform. The
  // two rings differ by a metre or two at the outer edge of the detailed one, six hundred metres from the
  // rider, where a metre is a fraction of a degree and the air has half taken it anyway.
  const bumps = far || !Number.isFinite(model) ? 0 : relief(route, x, z)
  if (!near) return model + bumps
  // 0 on the trail, 1 once the ground is free of it again
  const t = Math.min(1, Math.max(0, (near.distance - Config.corridor) / release))
  const ease = t * t * (3 - 2 * t)
  if (!Number.isFinite(model)) return near.y - (far ? 0 : Config.roadInset)
  // faded in by the same easing that releases the ground from the trail's profile, so the road itself is
  // never roughened and the shoulder is not left standing on a lump
  const pulled = near.y + (model - near.y) * ease + bumps * ease
  // the near ring cuts a shallow bed for the road, full inside the corridor and gone by the time the ground
  // is free of it; the coarse ring is far enough away that the road is not drawn on it at all
  if (!far) return pulled - Config.roadInset * (1 - ease)
  // The coarse ring may sink toward the road but never rise toward it. Its blend is 260 m wide, so on the
  // downhill side of a mountain road it would otherwise lift a quarter-kilometre of hillside up to road level
  // and lay a flat green shelf over the valley — and over the road the rider is on.
  return far ? Math.min(model, pulled) : pulled
}

/**
 * How high the ground is *as drawn*, which is not quite how high it is.
 *
 * `groundHeight` is the exact surface; the terrain mesh is a lattice of samples of it every `terrainStep`
 * metres with flat triangles stretched between them. Those triangles chord across anything the surface does
 * between two samples — and the surface does a lot, because the invented relief has an octave only three
 * vertices long and is at its strongest exactly where the ground is steep. So a boulder placed on the exact
 * surface stands on nothing: on a steep hillside the mesh under it is up to a metre lower than the height it
 * was given, and it hangs in the air.
 *
 * This asks the question the way the mesh answers it: the four lattice corners around the point, split along
 * the same diagonal terrain.ts winds its two triangles on, and the plane of whichever triangle the point is
 * in. A rock placed at this height sits on the ground the rider can actually see, at any resolution and on any
 * slope.
 */
let latch: Map<number, number> | null = null

/**
 * Remember the lattice for the duration of one pass over it, and forget it afterwards.
 *
 * `groundHeight` is the expensive call in this renderer — it projects onto the trail twice and reads the
 * elevation model — and asking it on a lattice means asking it for the same corner again and again: four
 * corners per object, five points per footprint, and a hundred objects to a hundred-metre cell all landing in
 * the same few dozen five-metre squares. Cached across one sowing pass it is a handful of samples per square
 * instead of twenty; held any longer it would be wrong, because the answer depends on the route and the route
 * can change between rides.
 */
export function holdLattice<T>(work: () => T): T {
  const outer = latch
  latch = outer ?? new Map()
  try {
    return work()
  } finally {
    latch = outer
  }
}

export function meshHeight(route: Route, x: number, z: number, step = Config.terrainStep): number {
  const i = Math.floor(x / step)
  const j = Math.floor(z / step)
  const u = x / step - i
  const v = z / step - j
  const at = (di: number, dj: number): number => {
    const held = latch
    if (!held) return groundHeight(route, (i + di) * step, (j + dj) * step)
    // a key that stays an integer for any lattice point a route can reach: x runs to 300 km, so 2^20 apart
    const cached = held.get((i + di + 524288) * 1048576 + (j + dj + 524288))
    if (cached !== undefined) return cached
    const h = groundHeight(route, (i + di) * step, (j + dj) * step)
    held.set((i + di + 524288) * 1048576 + (j + dj + 524288), h)
    return h
  }
  const a = at(0, 0)
  const b = at(1, 0)
  const c = at(0, 1)
  // terrain.ts winds (a, b, c) and (b, d, c): the diagonal runs from (i+1, j) to (i, j+1)
  if (u + v <= 1) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return Number.NaN
    return a + (b - a) * u + (c - a) * v
  }
  const d = at(1, 1)
  if (!Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) return Number.NaN
  return d + (b - d) * (1 - v) + (c - d) * (1 - u)
}

/**
 * The lowest the drawn ground gets under a footprint of `radius` metres — where something wide has to stand.
 *
 * Not used by the scatter any more: it costs five ground samples per object, and on a scree slope that was
 * seventy milliseconds of standing pass. What it computes is a drop of slope × radius on ground that is
 * locally a plane, which the placement already knows the slope of, so it takes that instead. This is kept for
 * anything that has to stand on ground that is NOT locally a plane — a shelter across a gully, say — where the
 * lowest of several samples is the only honest answer.
 */
export function footingHeight(route: Route, x: number, z: number, radius: number): number {
  let low = meshHeight(route, x, z)
  if (!Number.isFinite(low)) return low
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2
    const h = meshHeight(route, x + Math.cos(a) * radius, z + Math.sin(a) * radius)
    if (Number.isFinite(h) && h < low) low = h
  }
  return low
}
