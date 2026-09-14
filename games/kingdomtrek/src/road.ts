/**
 * Where the hero is, for the platform: the grade of the road for the Hills option (INTEGRATION.md §3.3), and the
 * position and height on the kingdom map for the console's session map and elevation profile (§8). Pure.
 */
import type { Biome, Route, Town } from './content/types.ts'
import type { Engine } from './engine/engine.ts'

/** Map units to metres for the console's map: the region (1000 × 640 units) is 10 × 6.4 km. */
export const METRES_PER_UNIT = 10

/** The usual grade (%) of a road over each terrain. */
export const TERRAIN_GRADE: Record<Biome, number> = {
  plains: 1, forest: 1.5, hills: 3.5, coast: 0.5, mountain: 6, swamp: 0.5, snow: 4, volcano: 5, desert: 1.5,
}
/** Never steeper than this: Hills is for feel, not a wall. */
export const MAX_GRADE = 8
/** One rise every this many map units of road (about 3 minutes at a steady pace). */
const WAVE_UNITS = 70

/** How high a town stands (m), by its terrain: the coast low, the mountains and the snow high. */
export const TERRAIN_HEIGHT: Record<Biome, number> = {
  coast: 5, swamp: 15, plains: 40, desert: 70, forest: 90, hills: 220, volcano: 480, mountain: 520, snow: 650,
}
/** How far a road over each terrain rises and falls between its towns (m). */
const ROLL_HEIGHT: Record<Biome, number> = {
  coast: 4, swamp: 3, plains: 8, desert: 10, forest: 12, hills: 35, volcano: 45, mountain: 60, snow: 50,
}

function unit(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return (h >>> 0) / 4294967296
}

/** The road's rises: a wave over its length, the same every trip, with the rises where Hills puts them. */
function wave(routeId: string, distance: number, pos: number): number {
  const waves = Math.max(1, Math.round(distance / WAVE_UNITS))
  return Math.sin(unit(routeId) * Math.PI * 2 + pos * waves * Math.PI * 2)
}

/**
 * The grade in percent at `pos` (0–1) along a road: rolling ground around the terrain's usual grade, the same every
 * trip, easing to flat at both town gates. Never negative: not every treadmill has a decline, and the effort
 * estimate counts one as flat anyway.
 */
export function gradeAlong(routeId: string, terrain: Biome, distance: number, pos: number): number {
  const base = TERRAIN_GRADE[terrain] ?? 1
  const gates = Math.max(0, Math.min(1, pos * 8, (1 - pos) * 8))
  const g = base * gates * (1 + 0.6 * wave(routeId, distance, pos))
  return Math.round(Math.min(MAX_GRADE, Math.max(0, g)) * 10) / 10
}

/**
 * The ground's height (m) at `pos` along a road (0 at `route.a`), for the elevation profile: from one town's height
 * to the other's, rolling on the way, and exactly the towns' heights at the gates. It is a picture of the land, not
 * of Hills: Hills never asks a treadmill for a decline, and a climb from the coast to the mountains would be far too
 * steep to ride.
 */
export function heightAlong(route: Route, a: Town, b: Town, pos: number): number {
  const p = Math.max(0, Math.min(1, pos))
  const ha = TERRAIN_HEIGHT[a.biome] ?? 40
  const hb = TERRAIN_HEIGHT[b.biome] ?? 40
  const roll = (ROLL_HEIGHT[route.terrain] ?? 8) * Math.sin(Math.PI * p) * wave(route.id, route.distance, p)
  return Math.round((ha + (hb - ha) * p + roll) * 10) / 10
}

/** What Hills asks of the machine now: the road's grade while on the road, flat anywhere else. */
export function roadGrade(e: Engine): number {
  const w = e.save.where
  if (w.kind !== 'travel') return 0
  const route = e.world.routes.get(w.route)
  return route ? gradeAlong(route.id, route.terrain, route.distance, w.pos) : 0
}

/**
 * The hero on the kingdom map in metres (x east, z south, y the height of the ground): a town, or a point along the
 * road. Null in the throne room.
 */
export function mapPosition(e: Engine): { x: number; y: number; z: number } | null {
  const w = e.save.where
  const at = (x: number, y: number, h: number) => ({
    x: Math.round(x * METRES_PER_UNIT * 10) / 10, y: h, z: Math.round(y * METRES_PER_UNIT * 10) / 10,
  })
  if (w.kind === 'town') {
    const t = e.world.towns.get(w.town)
    return t ? at(t.x, t.y, TERRAIN_HEIGHT[t.biome] ?? 40) : null
  }
  if (w.kind === 'travel') {
    const r = e.world.routes.get(w.route)
    const a = r && e.world.towns.get(r.a)
    const b = r && e.world.towns.get(r.b)
    if (!r || !a || !b) return null
    return at(a.x + (b.x - a.x) * w.pos, a.y + (b.y - a.y) * w.pos, heightAlong(r, a, b, w.pos))
  }
  return null
}
