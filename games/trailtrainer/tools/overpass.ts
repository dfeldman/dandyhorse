/**
 * OpenStreetMap, the way a route needs it: ask Overpass for the ways around a route, treat them as a graph,
 * and walk the shortest path from the route's start to its end.
 *
 * Why a graph rather than stitching ways in order: OSM splits a road wherever a tag changes and stores the
 * pieces in no particular order and in no particular direction, and a route relation's member order is a
 * convention rather than a guarantee. Asking for the shortest path between two real points sidesteps all of
 * it — the answer is connected and pointed the right way by construction, and it fails loudly (no path)
 * instead of quietly producing a route with a gap in it.
 *
 * Responses are cached under tools/cache/, which is gitignored: a bake reruns offline until the query changes.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { haversine, type LatLon } from '../src/route/geo.ts'

const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
// Overpass turns away requests with no User-Agent, and asks that one identify the tool.
const UA = 'trailtrainer/0.1 (Dandyhorse exergame route baker; https://openstreetmap.org/copyright)'
const CACHE = resolve(import.meta.dirname, 'cache')

export interface OsmWay {
  id: number
  nodes: number[]
  geometry: LatLon[]
  tags: Record<string, string>
}

export interface OverpassResult {
  ways: OsmWay[]
  /** the copyright line Overpass returns; it goes into the package's attribution */
  copyright: string
  timestamp: string
}

/** Run an Overpass QL query, caching the raw JSON by query hash. */
export async function overpass(query: string): Promise<OverpassResult> {
  mkdirSync(CACHE, { recursive: true })
  const file = resolve(CACHE, `overpass-${createHash('sha1').update(query).digest('hex').slice(0, 16)}.json`)
  let text: string
  if (existsSync(file)) {
    text = readFileSync(file, 'utf8')
  } else {
    process.stderr.write(`  overpass: fetching (${query.length} chars of query)…\n`)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams({ data: query }),
    })
    if (!res.ok) throw new Error(`overpass ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 400)}`)
    text = await res.text()
    if (!text.trimStart().startsWith('{')) throw new Error(`overpass returned non-JSON: ${text.slice(0, 200)}`)
    writeFileSync(file, text)
  }
  const data = JSON.parse(text) as {
    elements: Array<{ type: string; id: number; nodes?: number[]; geometry?: LatLon[]; tags?: Record<string, string> }>
    osm3s?: { copyright?: string; timestamp_osm_base?: string }
  }
  const ways: OsmWay[] = []
  for (const e of data.elements) {
    if (e.type !== 'way' || !e.nodes || !e.geometry) continue
    // a way clipped by the query's bbox comes back with fewer geometry points than node refs; it cannot be
    // trusted to line up, so it is dropped rather than silently bent
    if (e.nodes.length !== e.geometry.length) continue
    ways.push({ id: e.id, nodes: e.nodes, geometry: e.geometry, tags: e.tags ?? {} })
  }
  return {
    ways,
    copyright: data.osm3s?.copyright ?? 'Data from OpenStreetMap, available under the ODbL.',
    timestamp: data.osm3s?.timestamp_osm_base ?? '',
  }
}

interface Edge {
  to: number
  cost: number
  way: number
  /** the node's own index inside that way, so the path can carry the way's tags */
  reverse: boolean
}

export interface Graph {
  pos: Map<number, LatLon>
  adj: Map<number, Edge[]>
  ways: Map<number, OsmWay>
}

/** Every way becomes a chain of undirected edges weighted by ground distance. Oneways are ignored: a game. */
export function buildGraph(ways: OsmWay[]): Graph {
  const pos = new Map<number, LatLon>()
  const adj = new Map<number, Edge[]>()
  const byId = new Map<number, OsmWay>()
  const link = (a: number, b: number, cost: number, way: number, reverse: boolean): void => {
    let list = adj.get(a)
    if (!list) { list = []; adj.set(a, list) }
    list.push({ to: b, cost, way, reverse })
  }
  for (const w of ways) {
    byId.set(w.id, w)
    for (let i = 0; i < w.nodes.length; i++) pos.set(w.nodes[i], w.geometry[i])
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      const a = w.nodes[i]
      const b = w.nodes[i + 1]
      if (a === b) continue
      const cost = haversine(w.geometry[i], w.geometry[i + 1])
      link(a, b, cost, w.id, false)
      link(b, a, cost, w.id, true)
    }
  }
  return { pos, adj, ways: byId }
}

/** The graph node closest to a point, and how far off it is (a large distance means the query missed). */
export function nearestNode(graph: Graph, at: LatLon): { id: number; distance: number } {
  let best = -1
  let bd = Infinity
  for (const [id, p] of graph.pos) {
    const d = haversine(p, at)
    if (d < bd) { bd = d; best = id }
  }
  if (best < 0) throw new Error('nearestNode: the graph is empty')
  return { id: best, distance: bd }
}

/** A minimal binary heap; the graphs here are tens of thousands of nodes, so this is plenty. */
class Heap {
  private readonly a: Array<{ k: number; v: number }> = []
  get size(): number { return this.a.length }
  push(k: number, v: number): void {
    this.a.push({ k, v })
    let i = this.a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.a[p].k <= this.a[i].k) break
      ;[this.a[p], this.a[i]] = [this.a[i], this.a[p]]
      i = p
    }
  }
  pop(): { k: number; v: number } | undefined {
    const top = this.a[0]
    const last = this.a.pop()
    if (this.a.length && last) {
      this.a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.a.length && this.a[l].k < this.a[m].k) m = l
        if (r < this.a.length && this.a[r].k < this.a[m].k) m = r
        if (m === i) break
        ;[this.a[m], this.a[i]] = [this.a[i], this.a[m]]
        i = m
      }
    }
    return top
  }
}

export interface PathStep {
  point: LatLon
  /** the way this point was reached along; the first point carries the way it leaves on */
  way: number
}

/** Dijkstra from the node nearest `from` to the node nearest `to`, as a point-by-point path. */
export function shortestPath(graph: Graph, from: LatLon, to: LatLon): { steps: PathStep[]; length: number } {
  const start = nearestNode(graph, from)
  const goal = nearestNode(graph, to)
  if (start.distance > 500) throw new Error(`shortestPath: the start point is ${start.distance.toFixed(0)} m from any way in the query — widen the query or move the point`)
  if (goal.distance > 500) throw new Error(`shortestPath: the end point is ${goal.distance.toFixed(0)} m from any way in the query — widen the query or move the point`)

  const dist = new Map<number, number>([[start.id, 0]])
  const prev = new Map<number, { node: number; way: number }>()
  const done = new Set<number>()
  const heap = new Heap()
  heap.push(0, start.id)
  while (heap.size) {
    const top = heap.pop()
    if (!top) break
    const node = top.v
    if (done.has(node)) continue
    done.add(node)
    if (node === goal.id) break
    for (const e of graph.adj.get(node) ?? []) {
      if (done.has(e.to)) continue
      const d = top.k + e.cost
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d)
        prev.set(e.to, { node, way: e.way })
        heap.push(d, e.to)
      }
    }
  }
  if (!done.has(goal.id)) throw new Error('shortestPath: no connected path between the two points — the query is missing a link between them')

  const chain: Array<{ node: number; way: number }> = []
  let cur = goal.id
  while (cur !== start.id) {
    const p = prev.get(cur)
    if (!p) throw new Error('shortestPath: broken predecessor chain')
    chain.push({ node: cur, way: p.way })
    cur = p.node
  }
  chain.reverse()
  const steps: PathStep[] = [{ point: graph.pos.get(start.id)!, way: chain[0]?.way ?? -1 }]
  for (const c of chain) steps.push({ point: graph.pos.get(c.node)!, way: c.way })
  return { steps, length: dist.get(goal.id) ?? 0 }
}
