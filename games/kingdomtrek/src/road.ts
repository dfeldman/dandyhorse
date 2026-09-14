/**
 * Where the hero is, for the platform: the grade of the road for the Hills option (INTEGRATION.md §3.3) and the
 * position on the kingdom map for the console's session map (§8). Pure.
 */
import type { Biome } from './content/types.ts'
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

function unit(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * The grade in percent at `pos` (0–1) along a road: rolling ground around the terrain's usual grade, the same every
 * trip, easing to flat at both town gates. Never negative: not every treadmill has a decline, and the effort
 * estimate counts one as flat anyway.
 */
export function gradeAlong(routeId: string, terrain: Biome, distance: number, pos: number): number {
  const base = TERRAIN_GRADE[terrain] ?? 1
  const waves = Math.max(1, Math.round(distance / WAVE_UNITS))
  const phase = unit(routeId) * Math.PI * 2
  const gates = Math.max(0, Math.min(1, pos * 8, (1 - pos) * 8))
  const g = base * gates * (1 + 0.6 * Math.sin(phase + pos * waves * Math.PI * 2))
  return Math.round(Math.min(MAX_GRADE, Math.max(0, g)) * 10) / 10
}

/** What Hills asks of the machine now: the road's grade while on the road, flat anywhere else. */
export function roadGrade(e: Engine): number {
  const w = e.save.where
  if (w.kind !== 'travel') return 0
  const route = e.world.routes.get(w.route)
  return route ? gradeAlong(route.id, route.terrain, route.distance, w.pos) : 0
}

/** The hero on the kingdom map in metres (x east, z south): a town, or a point along the road. Null in the throne room. */
export function mapPosition(e: Engine): { x: number; z: number } | null {
  const w = e.save.where
  const at = (x: number, y: number) => ({ x: Math.round(x * METRES_PER_UNIT * 10) / 10, z: Math.round(y * METRES_PER_UNIT * 10) / 10 })
  if (w.kind === 'town') {
    const t = e.world.towns.get(w.town)
    return t ? at(t.x, t.y) : null
  }
  if (w.kind === 'travel') {
    const r = e.world.routes.get(w.route)
    const a = r && e.world.towns.get(r.a)
    const b = r && e.world.towns.get(r.b)
    if (!a || !b) return null
    return at(a.x + (b.x - a.x) * w.pos, a.y + (b.y - a.y) * w.pos)
  }
  return null
}
