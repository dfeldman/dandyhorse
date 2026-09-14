/**
 * The shape of a region: where the towns stand and which roads join them. The start is in the west, the
 * crisis in the east and six towns between. Roads are the shortest links that don't cross each other or run
 * through a town, each 185–320 map units (7–12 minutes at a steady pace), and every town has at least two.
 */
import type { Rng } from '../engine/rng.ts'

export const REGION = { width: 1000, height: 640 }

const TOWNS = 8
const MIN_GAP = 175
const ROAD: [number, number] = [185, 320]
const ROADS: [number, number] = [10, 13]
const MAX_DEGREE = 5
/** A road must pass at least this far from any town it doesn't serve. */
const CLEARANCE = 70

export interface Site { x: number; y: number }
export interface Link { a: number; b: number; distance: number }
/** `sites[0]` is the start, `sites[1]` the crisis. */
export interface Layout { sites: Site[]; links: Link[] }

export function layRegion(rng: Rng): Layout {
  for (let tries = 0; tries < 1000; tries++) {
    const sites = placeSites(rng)
    if (!sites) continue
    const links = linkSites(sites)
    if (acceptable(sites, links)) return { sites, links }
  }
  throw new Error('could not lay out a region')
}

const dist = (p: Site, q: Site): number => Math.hypot(p.x - q.x, p.y - q.y)

function placeSites(rng: Rng): Site[] | null {
  const sites: Site[] = [
    { x: rng.range(100, 170), y: rng.range(230, 410) },
    { x: rng.range(820, 890), y: rng.range(200, 450) },
  ]
  for (let n = 0; sites.length < TOWNS && n < 4000; n++) {
    const s = { x: rng.range(250, 730), y: rng.range(90, 560) }
    if (sites.every((o) => dist(o, s) >= MIN_GAP)) sites.push(s)
  }
  return sites.length === TOWNS ? sites.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y) })) : null
}

/** Shortest candidate roads first, skipping any that would cross a road already built. */
function linkSites(sites: Site[]): Link[] {
  const candidates: Link[] = []
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) {
      const d = dist(sites[a], sites[b])
      if (d >= ROAD[0] && d <= ROAD[1]) candidates.push({ a, b, distance: Math.round(d) })
    }
  }
  candidates.sort((p, q) => p.distance - q.distance)
  const links: Link[] = []
  const degree = sites.map(() => 0)
  for (const c of candidates) {
    if (links.length >= ROADS[1]) break
    if (degree[c.a] >= MAX_DEGREE || degree[c.b] >= MAX_DEGREE) continue
    if (links.some((l) => crosses(sites, l, c))) continue
    if (sites.some((s, i) => i !== c.a && i !== c.b && segmentDistance(s, sites[c.a], sites[c.b]) < CLEARANCE)) continue
    links.push(c)
    degree[c.a]++
    degree[c.b]++
  }
  return links
}

function acceptable(sites: Site[], links: Link[]): boolean {
  if (links.length < ROADS[0]) return false
  const degree = sites.map((_, i) => links.filter((l) => l.a === i || l.b === i).length)
  if (degree.some((d) => d < 2)) return false
  const reach = new Set([0])
  for (let grew = true; grew;) {
    grew = false
    for (const l of links) {
      if (reach.has(l.a) !== reach.has(l.b)) {
        reach.add(l.a)
        reach.add(l.b)
        grew = true
      }
    }
  }
  return reach.size === sites.length
}

function crosses(sites: Site[], l: Link, m: Link): boolean {
  if (l.a === m.a || l.a === m.b || l.b === m.a || l.b === m.b) return false
  const [p, q, r, s] = [sites[l.a], sites[l.b], sites[m.a], sites[m.b]]
  const side = (a: Site, b: Site, c: Site): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
  return side(p, q, r) !== side(p, q, s) && side(r, s, p) !== side(r, s, q)
}

function segmentDistance(p: Site, a: Site, b: Site): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
