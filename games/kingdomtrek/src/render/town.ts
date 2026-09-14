/**
 * The town seen from above: buildings along streets, laid out from the town's id and its `appearance`, so
 * every town looks different but always the same. The hero walks the streets to whatever the choice list
 * highlights.
 */
import type { Town } from '../content/types.ts'
import type { Engine } from '../engine/engine.ts'
import { Rng, hashString } from '../engine/rng.ts'
import { cap } from '../engine/text.ts'
import { drawHero, styleOf } from './hero.ts'
import { drawRegionMap } from './map.ts'
import { VARIANTS, drawScenery, groundPattern, pickScenery } from './nature.ts'
import type { Scenery } from './nature.ts'
import { PALETTES } from './palette.ts'
import type { Palette } from './palette.ts'
import type { Rect, Stage } from './stage.ts'
import { emoji, glass, label, pill, rgba, shade, shadow } from './stage.ts'

type Kind = 'mayor' | 'shop' | 'workshop' | 'npc' | 'spot' | 'lair' | 'gate' | 'house'
export interface Place { id: string; kind: Kind; rx: number; ry: number; icon: string; name: string; roof: string; w: number; h: number }
interface Pt { x: number; y: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number }

const ROOFS = ['#c0533a', '#9a4b2c', '#4f6fa8', '#5f8f3c', '#b07a38', '#7a4a8f', '#3f7f86']
const BANNERS = ['#8f2a2a', '#2a4f8f', '#d9a21a', '#2f7a3a']
/** The river's middle, as a fraction of the view's height. */
const RIVER_Y = 0.44

/** How a town is drawn. A game file may put any word in `appearance`; unknown words get the village. */
export type Look = 'village' | 'capital' | 'fortress' | 'port' | 'river' | 'hillside' | 'ruins'
export const LOOKS: readonly Look[] = ['village', 'capital', 'fortress', 'port', 'river', 'hillside', 'ruins']

export function townLook(town: Town): Look {
  const a = town.appearance?.trim().toLowerCase() ?? ''
  if ((LOOKS as readonly string[]).includes(a)) return a as Look
  return town.crisis ? 'ruins' : 'village'
}

/**
 * A town's plan in fractions of the view: its places, the streets as a small graph, and where each door
 * joins the streets. The hero walks the graph.
 */
export interface TownLayout {
  look: Look
  places: Place[]
  /** A city's other homes: drawn, never visited. */
  houses: Place[]
  nodes: [number, number][]
  edges: [number, number][]
  /** Place id → the street node its door joins. */
  attach: Record<string, number>
  /** Where the hero waits when nothing in town is highlighted. */
  center: number
}

/** A door's height below its building, in view fractions, before the view is measured (to join streets). */
const doorY = (p: Place): number => (p.kind === 'gate' ? p.ry - 0.075 : p.ry + 0.05 * p.h)
/** Buildings sit this far above the street their door opens onto. */
const ABOVE = 0.085

export function layoutTown(e: Engine, town: Town, look: Look = townLook(town)): TownLayout {
  const rng = new Rng(hashString(town.id))
  const roof = (): string => ROOFS[rng.int(0, ROOFS.length - 1)]
  const city = look === 'capital'
  const others: Place[] = [
    { id: 'shop', kind: 'shop', rx: 0, ry: 0, icon: '🛍️', name: town.shop.name, roof: '#b8452f', w: 1.3, h: 1.05 },
    // The workshop's id is the town's Craft choice, so highlighting it walks the hero there.
    ...(town.workshop && e.world.game.recipes?.length
      ? [{ id: 'craft', kind: 'workshop', rx: 0, ry: 0, icon: '⚒️', name: town.workshop.name, roof: '#56606e', w: 1.2, h: 1 } satisfies Place]
      : []),
    ...town.npcs.map((n): Place => ({ id: `npc:${n.id}`, kind: 'npc', rx: 0, ry: 0, icon: n.emoji, name: n.name, roof: roof(), w: 1, h: 0.9 })),
    ...town.spots.map((s): Place => ({ id: `spot:${s.id}`, kind: 'spot', rx: 0, ry: 0, icon: s.emoji, name: cap(s.name), roof: '', w: 0.7, h: 0.6 })),
  ]
  const shuffle = <T,>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.int(0, i)
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  shuffle(others)
  /** Rows of slots dealt out a row at a time (each row shuffled), so buildings spread over every street. */
  const deal = (rows: [number, number][][]): [number, number][] => {
    rows.forEach(shuffle)
    const out: [number, number][] = []
    for (let k = 0; rows.some((r) => k < r.length); k++) for (const r of rows) if (k < r.length) out.push(r[k])
    return out
  }

  const L: TownLayout = { look, places: [], houses: [], nodes: [], edges: [], attach: {}, center: 0 }
  const node = (x: number, y: number): number => {
    const i = L.nodes.findIndex(([nx, ny]) => Math.abs(nx - x) < 0.008 && Math.abs(ny - y) < 0.008)
    if (i >= 0) return i
    L.nodes.push([x, y])
    return L.nodes.length - 1
  }
  const street = (pts: [number, number][]): number[] => {
    const ids = pts.map(([x, y]) => node(x, y))
    for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[i - 1]) L.edges.push([ids[i - 1], ids[i]])
    return ids
  }
  const sorted = (v: number[]): number[] => [...new Set(v.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b)
  /** A street across at height y, with a node at every x in `stops` and every ~0.06 between. */
  const across = (y: number, x0: number, x1: number, stops: number[]): number[] => {
    const n = Math.max(1, Math.round((x1 - x0) / 0.06))
    const xs = [...stops, ...Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n)]
    return street(sorted(xs).map((x): [number, number] => [x, y]))
  }
  const updown = (x: number, ys: number[]): number[] => street(sorted(ys).map((y): [number, number] => [x, y]))

  let mayorX = 0.5
  const mayorY = city ? 0.2 : 0.17
  const mayorH = city ? 1.5 : 1.25
  const top = mayorY + 0.05 * mayorH + 0.02
  let slots: [number, number][] = []
  switch (look) {
    case 'capital':
    case 'fortress':
    case 'port': {
      // Straight streets: an avenue from the gate to the mayor, two cross streets, a lane by the gate.
      const port = look === 'port'
      const mid = port ? 0.58 : 0.5
      mayorX = mid
      const upper = port ? [0.38, 0.74, 0.86] : [0.2, 0.34, 0.66, 0.8]
      const lower = port ? [0.38, 0.74, 0.86] : [0.2, 0.36, 0.64, 0.8]
      const bottom = port ? [0.4, 0.78] : [0.26, 0.74]
      const x0 = port ? 0.25 : 0.12
      across(0.37, x0, 0.88, [...upper, mid])
      across(0.64, x0, 0.88, [...lower, mid])
      across(0.84, bottom[0], bottom[1], [...bottom, mid])
      const avenue = updown(mid, [top, 0.37, 0.5, 0.64, 0.84])
      if (port) updown(0.25, [0.37, 0.5, 0.64])
      L.center = avenue[2]
      slots = deal([
        upper.map((x): [number, number] => [x, 0.37 - ABOVE]),
        lower.map((x): [number, number] => [x, 0.64 - ABOVE]),
        bottom.map((x): [number, number] => [x, 0.84 - ABOVE]),
      ])
      break
    }
    case 'river': {
      // A lane on each bank, joined by the bridge on the main road.
      const xs = [0.2, 0.36, 0.64, 0.8]
      across(0.37, 0.12, 0.88, [...xs, 0.5])
      across(0.75, 0.12, 0.88, [...xs, 0.5])
      const main = updown(0.5, [top, 0.37, RIVER_Y, 0.52, 0.64, 0.75, 0.84])
      L.center = main[5]
      slots = deal([0.37, 0.75].map((y) => xs.map((x): [number, number] => [x, y - ABOVE])))
      break
    }
    case 'hillside': {
      // Three terraces; the lanes meet only at alternate ends, so the walk zigzags up the hill.
      const lanes = [0.35, 0.57, 0.79]
      const xs = [0.2, 0.36, 0.64, 0.8]
      const rows = lanes.map((y) => across(y, 0.12, 0.88, [...xs, 0.5]))
      street([[0.12, lanes[2]], [0.08, (lanes[1] + lanes[2]) / 2], [0.12, lanes[1]]])
      street([[0.88, lanes[1]], [0.92, (lanes[0] + lanes[1]) / 2], [0.88, lanes[0]]])
      updown(0.5, [top, lanes[0]])
      updown(0.5, [lanes[2], 0.86])
      L.center = rows[1][Math.floor(rows[1].length / 2)]
      slots = deal(lanes.map((y) => xs.map((x): [number, number] => [x, y - ABOVE])))
      break
    }
    default: {
      // A ring road round the plaza, with houses standing around it.
      const ring = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2
        return node(0.5 + Math.cos(a) * 0.17, 0.5 + Math.sin(a) * 0.21)
      })
      ring.forEach((id, i) => L.edges.push([id, ring[(i + 1) % ring.length]]))
      L.center = ring[6]
      slots = others.map((_, k): [number, number] => {
        const a = ((k + 0.5) / others.length) * 260
        const deg = a < 130 ? -65 + a : 115 + (a - 130)
        const rad = (deg * Math.PI) / 180
        return [0.5 + Math.cos(rad) * 0.37, 0.5 + Math.sin(rad) * 0.33]
      })
    }
  }
  if (others.length > slots.length) return layoutTown(e, town, 'village')

  others.forEach((p, k) => {
    p.rx = slots[k][0]
    p.ry = slots[k][1]
  })
  L.places = [{ id: 'mayor', kind: 'mayor', rx: mayorX, ry: mayorY, icon: '👑', name: town.mayor.name, roof: '#6d3aa8', w: city ? 2.1 : 1.55, h: mayorH }, ...others]
  if (town.crisis) {
    const lair = e.world.game.challenge.lair
    L.places.push({ id: 'lair', kind: 'lair', rx: 0.86, ry: 0.14, icon: lair.emoji, name: cap(lair.name), roof: '', w: 1.4, h: 1.2 })
  }
  L.places.push({ id: 'gate', kind: 'gate', rx: 0.5, ry: 0.93, icon: '🚪', name: 'Town gate', roof: '', w: 1.3, h: 0.9 })
  if (city) {
    L.houses = slots.slice(others.length).map((s, i): Place => ({ id: `house:${i}`, kind: 'house', rx: s[0], ry: s[1], icon: '', name: '', roof: roof(), w: 1, h: 0.9 }))
  }
  // Winding paths in the country; a city's streets stay straight.
  if (look === 'village' || look === 'ruins' || look === 'river' || look === 'hillside') {
    for (const n of L.nodes) {
      n[0] += rng.range(-0.005, 0.005)
      n[1] += rng.range(-0.005, 0.005)
    }
  }
  for (const p of [...L.places, ...L.houses]) L.attach[p.id] = nearestNode(L, p.rx, doorY(p))
  return L
}

function nearestNode(L: TownLayout, x: number, y: number): number {
  let best = 0
  L.nodes.forEach(([nx, ny], i) => {
    if (Math.hypot(nx - x, ny - y) < Math.hypot(L.nodes[best][0] - x, L.nodes[best][1] - y)) best = i
  })
  return best
}

/**
 * The walk from `from` to a place's door (or the town's centre) along the streets: the shortest way through
 * the street graph, starting at the point nearest `from`. Empty if the door can't be reached.
 */
export function streetPath(L: TownLayout, at: (i: number) => Pt, door: (p: Place) => Pt, from: Pt, placeId: string | null): Pt[] {
  const pts: Pt[] = L.nodes.map((_, i) => at(i))
  const adj: number[][] = pts.map(() => [])
  const join = (a: number, b: number): void => {
    adj[a].push(b)
    adj[b].push(a)
  }
  for (const [a, b] of L.edges) join(a, b)
  const doors = new Map<string, number>()
  for (const p of L.places) {
    doors.set(p.id, pts.length)
    pts.push(door(p))
    adj.push([])
    join(pts.length - 1, L.attach[p.id])
  }
  const d = (i: number, p: Pt): number => Math.hypot(pts[i].x - p.x, pts[i].y - p.y)
  let start = 0
  for (let i = 1; i < pts.length; i++) if (d(i, from) < d(start, from)) start = i
  const goal = placeId ? doors.get(placeId) ?? L.center : L.center
  const dist = pts.map(() => Infinity)
  const prev = pts.map(() => -1)
  const done = pts.map(() => false)
  dist[start] = 0
  for (;;) {
    let cur = -1
    for (let i = 0; i < pts.length; i++) if (!done[i] && dist[i] < Infinity && (cur < 0 || dist[i] < dist[cur])) cur = i
    if (cur < 0 || cur === goal) break
    done[cur] = true
    for (const v of adj[cur]) {
      const nd = dist[cur] + d(v, pts[cur])
      if (nd < dist[v]) {
        dist[v] = nd
        prev[v] = cur
      }
    }
  }
  if (dist[goal] === Infinity) return []
  const path: Pt[] = []
  for (let i = goal; i !== -1; i = prev[i]) path.unshift(pts[i])
  return path
}

/**
 * The place under (x, y) in a town drawn in view `V` with unit `u`: a building with its door and name, a spot not
 * yet searched (`taken` lists the searched spots' ids), the gate. Null anywhere else, and for a city's other homes.
 */
export function placeUnder(L: TownLayout, V: Rect, u: number, taken: string[], x: number, y: number): string | null {
  let best: { id: string; d: number } | null = null
  for (const p of L.places) {
    if (p.kind === 'spot' && taken.includes(p.id.slice(5))) continue
    const cx = V.x + p.rx * V.w
    const cy = V.y + p.ry * V.h
    const half = Math.max(u * p.w * 0.75, u * 0.6)
    const top = p.kind === 'gate' ? cy - u * 1.1 : cy - u * p.h * 0.9
    const bottom = p.kind === 'gate' ? cy + u * 0.5 : cy + u * p.h * 0.5 + u * 0.8
    if (Math.abs(x - cx) > half || y < top || y > bottom) continue
    const d = Math.hypot((x - cx) / half, (2 * y - top - bottom) / (bottom - top))
    if (!best || d < best.d) best = { id: p.id, d }
  }
  return best?.id ?? null
}

export class TownView {
  private layer: HTMLCanvasElement | null = null
  private layerKey = ''
  private townId = ''
  private layout: TownLayout | null = null
  private hero: Pt | null = null
  private path: Pt[] = []
  private target = ''
  private walking = false
  private particles: Particle[] = []
  /** The last frame's view, unit and searched spots, so a tap can be matched to a place. */
  private lastView: Rect | null = null
  private lastU = 0
  private taken: string[] = []

  /** Arriving puts the hero back at the gate. */
  arrive(): void {
    this.townId = ''
  }

  /**
   * The place under (x, y), in the canvas's CSS pixels, as drawn in the last frame: a building with its door and
   * name, a spot, the gate. Null anywhere else, and for the homes a city is full of.
   */
  placeAt(x: number, y: number): string | null {
    return this.layout && this.lastView ? placeUnder(this.layout, this.lastView, this.lastU, this.taken, x, y) : null
  }

  /** The hero has finished the walk to `id` and stands at its door. */
  arrivedAt(id: string): boolean {
    return this.target === id && !this.path.length && !this.walking
  }

  draw(stage: Stage, e: Engine, town: Town, target: string | null, t: number, dt: number, gateRoute?: string | null): void {
    const c = stage.ctx
    const V = stage.view
    const pal = PALETTES[town.biome]
    if (town.id !== this.townId || !this.layout) {
      this.townId = town.id
      this.layout = layoutTown(e, town)
      this.hero = null
      this.target = ''
      this.path = []
    }
    const L = this.layout
    const u = Math.min(V.w, V.h) * 0.1
    const pos = (p: Place): Pt => ({ x: V.x + p.rx * V.w, y: V.y + p.ry * V.h })
    const at = (i: number): Pt => ({ x: V.x + L.nodes[i][0] * V.w, y: V.y + L.nodes[i][1] * V.h })
    const door = (p: Place): Pt => {
      const q = pos(p)
      return p.kind === 'gate' ? { x: q.x, y: q.y - u * 0.75 } : { x: q.x, y: q.y + u * p.h * 0.5 }
    }

    const taken = town.spots.filter((s) => e.isTaken(`spot:${town.id}:${s.id}`)).map((s) => s.id)
    this.lastView = V
    this.lastU = u
    this.taken = taken
    const key = [town.id, stage.w, stage.h, V.w, V.y, stage.dpr, ...taken].join('|')
    if (key !== this.layerKey || !this.layer) {
      this.layer = this.paint(stage, town, pal, u, pos, at, door, taken)
      this.layerKey = key
    }
    c.drawImage(this.layer, 0, 0, stage.w, stage.h)

    // The hero walks the streets to whatever is highlighted.
    const gate = L.places.find((p) => p.kind === 'gate')!
    if (!this.hero) this.hero = door(gate)
    const want = target ?? this.target
    if (want && want !== this.target) {
      this.target = want
      this.path = streetPath(L, at, door, this.hero, L.places.some((p) => p.id === want) ? want : null)
    }
    this.walking = false
    let hero: Pt = this.hero
    let budget = u * 6 * dt
    while (this.path.length && budget > 0) {
      const next = this.path[0]
      const dx: number = next.x - hero.x
      const dy: number = next.y - hero.y
      const dist = Math.hypot(dx, dy)
      if (dist <= budget) {
        hero = { x: next.x, y: next.y }
        this.path.shift()
        budget -= dist
      } else {
        hero = { x: hero.x + (dx / dist) * budget, y: hero.y + (dy / dist) * budget }
        budget = 0
      }
      this.walking = true
    }
    this.hero = hero

    const focus = L.places.find((p) => p.id === this.target)
    if (focus && focus.kind !== 'gate') {
      const q = pos(focus)
      const pulse = 0.5 + 0.5 * Math.sin(t * 4)
      c.save()
      c.strokeStyle = `rgba(255,212,42,${0.55 + 0.4 * pulse})`
      c.lineWidth = 4
      c.shadowColor = 'rgba(255,190,40,0.9)'
      c.shadowBlur = 16
      c.beginPath()
      c.ellipse(q.x, q.y + u * focus.h * 0.28, u * focus.w * 0.9, u * focus.h * 0.5, 0, 0, Math.PI * 2)
      c.stroke()
      c.restore()
    }

    // Townsfolk at their doors, and the hero, drawn back to front.
    const actors: { y: number; draw: () => void }[] = []
    for (const p of L.places) {
      if (p.kind !== 'npc' && p.kind !== 'mayor' && p.kind !== 'shop' && p.kind !== 'workshop') continue
      const d = door(p)
      const who = p.kind === 'npc' ? p.icon : p.kind === 'mayor' ? town.mayor.emoji : p.kind === 'workshop' ? town.workshop!.keeper.emoji : town.shop.keeper.emoji
      const off = p.kind === 'npc' ? u * 0.55 : u * 0.75
      const bob = Math.sin(t * 2.2 + p.rx * 9) * u * 0.03
      actors.push({ y: d.y, draw: () => emoji(c, who, d.x + off, d.y - u * 0.25 + bob, u * 0.62) })
    }
    const h = this.hero
    actors.push({ y: h.y, draw: () => drawHero(c, h.x, h.y, u * 0.95, t, { walking: this.walking, style: styleOf(e.save) }) })
    actors.sort((a, b) => a.y - b.y).forEach((a) => a.draw())

    for (const p of L.places) {
      if (p.kind === 'spot' && taken.includes(p.id.slice(5))) continue
      const q = pos(p)
      const hl = p.id === this.target
      if (u < 30 && !hl) continue
      const y = p.kind === 'gate' ? q.y + u * 0.2 : q.y + u * p.h * 0.5 + u * 0.55
      if (hl) pill(c, p.name, q.x, y, Math.max(14, u * 0.24), 'rgba(255,212,42,0.95)', '#2a1a00', '#fff3b0')
      else pill(c, p.name, q.x, y, Math.max(11, u * 0.17), 'rgba(20,18,36,0.7)', '#fff8e6')
    }

    this.weather(c, stage, town.biome, dt)

    if (u >= 30) {
      glass(c, V.x + 16, V.y + 14, Math.min(V.w * 0.42, 420), u * 0.95)
      label(c, town.name, V.x + 34, V.y + 14 + u * 0.36, { size: u * 0.4, font: 'title', color: '#ffd42a', align: 'left', weight: 900 })
      label(c, town.blurb, V.x + 34, V.y + 14 + u * 0.72, { size: Math.max(11, u * 0.16), color: '#e9dfc6', align: 'left', maxWidth: Math.min(V.w * 0.42, 420) - 36 })
    }

    if (gateRoute !== undefined) {
      const mw = Math.min(V.w * 0.62, 620)
      const g = e.world.game.region
      const mh = (mw * g.height) / g.width
      drawRegionMap(c, { x: V.x + (V.w - mw) / 2, y: V.y + V.h * 0.18, w: mw, h: mh }, e, { highlightRoute: gateRoute, t })
    }
  }

  private weather(c: CanvasRenderingContext2D, stage: Stage, biome: Town['biome'], dt: number): void {
    const kind = biome === 'snow' ? 'snow' : biome === 'volcano' ? 'ash' : ''
    if (!kind) return
    while (this.particles.length < 90) {
      this.particles.push({ x: Math.random() * stage.w, y: Math.random() * stage.h, vx: (Math.random() - 0.5) * 20, vy: 20 + Math.random() * 30, life: 1 })
    }
    c.save()
    c.fillStyle = kind === 'snow' ? 'rgba(255,255,255,0.85)' : 'rgba(80,60,55,0.55)'
    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.y > stage.h) {
        p.y = stage.view.y - 5
        p.x = Math.random() * stage.w
      }
      c.beginPath()
      c.arc(p.x, p.y, kind === 'snow' ? 2.2 : 1.6, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
  }

  /** Everything that doesn't move: ground, water, streets, walls, trees, buildings. */
  private paint(
    stage: Stage, town: Town, pal: Palette, u: number,
    pos: (p: Place) => Pt, at: (i: number) => Pt, door: (p: Place) => Pt, taken: string[],
  ): HTMLCanvasElement {
    const L = this.layout!
    const look = L.look
    const walled = look === 'capital' || look === 'fortress'
    const cv = document.createElement('canvas')
    cv.width = stage.canvas.width
    cv.height = stage.canvas.height
    const c = cv.getContext('2d')!
    c.scale(stage.dpr, stage.dpr)
    const V = stage.view
    const W = stage.w
    const H = stage.h
    const rng = new Rng(hashString(town.id) ^ 0x51f15e)

    c.fillStyle = groundPattern(c, town.biome, stage.dpr, 0, 0)
    c.fillRect(0, 0, W, H)
    const light = c.createLinearGradient(0, V.y, 0, H)
    light.addColorStop(0, 'rgba(255,255,255,0.06)')
    light.addColorStop(1, 'rgba(0,0,0,0.08)')
    c.fillStyle = light
    c.fillRect(0, 0, W, H)

    // Distant peaks along the top of mountain towns.
    if (town.biome === 'mountain') {
      for (let i = 0; i < 6; i++) {
        const s: Scenery = { kind: 'peak', variant: i % VARIANTS, size: u * rng.range(2.2, 2.9), flip: i % 2 === 1 }
        drawScenery(c, town.biome, s, V.x + (i + 0.5) * (V.w / 6), V.y + u * 1.1)
      }
    }

    // Water and the lie of the land, under everything else.
    if (look === 'port') drawHarbor(c, V, H, u, rng)
    else if (town.biome === 'coast' && pal.water) {
      const sea = c.createLinearGradient(0, 0, V.x + V.w * 0.12, 0)
      sea.addColorStop(0, shade(pal.water, -0.2))
      sea.addColorStop(1, pal.water)
      c.fillStyle = sea
      c.beginPath()
      c.moveTo(0, V.y)
      for (let y = V.y; y <= H; y += 20) c.lineTo(V.x + V.w * 0.1 + Math.sin(y / 40) * 10, y)
      c.lineTo(0, H)
      c.closePath()
      c.fill()
      c.strokeStyle = 'rgba(255,255,255,0.6)'
      c.lineWidth = 3
      c.stroke()
      for (let i = 0; i < 3; i++) drawBoat(c, V.x + V.w * 0.045, V.y + V.h * (0.28 + i * 0.28), u * 0.7, rng)
    }
    if (look === 'river') drawRiver(c, V, W, u, town, rng)
    if (look === 'hillside') drawTerraces(c, V, W, u)
    if (town.biome === 'swamp' && pal.water) {
      for (let i = 0; i < 5; i++) {
        const x = rng.chance(0.5) ? rng.range(V.x + 20, V.x + V.w * 0.12) : rng.range(V.x + V.w * 0.88, V.x + V.w - 20)
        const y = rng.range(V.y + V.h * 0.2, V.y + V.h * 0.85)
        c.fillStyle = rgba(pal.water, 0.85)
        c.beginPath()
        c.ellipse(x, y, u * rng.range(0.6, 1.1), u * rng.range(0.3, 0.5), 0, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#5f9a45'
        c.beginPath()
        c.arc(x + u * 0.2, y, u * 0.14, 0.4, Math.PI * 2 - 0.4)
        c.lineTo(x + u * 0.2, y)
        c.fill()
        c.fillStyle = '#ff9ec7'
        c.beginPath()
        c.arc(x + u * 0.24, y - u * 0.04, u * 0.06, 0, Math.PI * 2)
        c.fill()
      }
    }
    if (look === 'ruins') drawScorch(c, V, W, H, u, rng)
    if (town.biome === 'volcano' || look === 'ruins') {
      c.save()
      c.strokeStyle = '#ff7a2f'
      c.shadowColor = '#ff5a00'
      c.shadowBlur = 12
      c.lineWidth = 3
      for (let i = 0; i < 6; i++) {
        let x = rng.range(0, W)
        let y = rng.range(V.y, H)
        c.beginPath()
        c.moveTo(x, y)
        for (let k = 0; k < 4; k++) {
          x += rng.range(-40, 40)
          y += rng.range(10, 40)
          c.lineTo(x, y)
        }
        c.stroke()
      }
      c.restore()
    }

    // Streets, the paths to each door, and the road out of the gate.
    const gate = L.places.find((p) => p.kind === 'gate')!
    const segs: [Pt, Pt, number][] = [
      ...L.edges.map(([a, b]): [Pt, Pt, number] => [at(a), at(b), u * 0.42]),
      ...[...L.places, ...L.houses].map((p): [Pt, Pt, number] => [door(p), at(L.attach[p.id]), u * (p.kind === 'gate' ? 0.45 : 0.28)]),
      [door(gate), { x: door(gate).x, y: H + 20 }, u * 0.5],
    ]
    const [edge, fill] = walled ? ['#8f887a', '#c9c1b0'] : [pal.pathEdge, pal.path]
    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const [col, k] of [[edge, 1.25], [fill, 1]] as const) {
      c.strokeStyle = col
      for (const [a, b, w] of segs) {
        c.lineWidth = w * k
        c.beginPath()
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
        c.stroke()
      }
    }
    if (walled) {
      // Cobbles.
      c.strokeStyle = 'rgba(90,80,70,0.22)'
      c.setLineDash([u * 0.1, u * 0.07])
      for (const [a, b, w] of segs) {
        c.lineWidth = w * 0.7
        c.beginPath()
        c.moveTo(a.x, a.y)
        c.lineTo(b.x, b.y)
        c.stroke()
      }
      c.setLineDash([])
    }
    if (look === 'river') drawBridge(c, V, u)

    // The square: a round plaza in a village, a paved square in a city or port.
    const square = look === 'village' || look === 'ruins' ? { x: V.x + V.w * 0.5, y: V.y + V.h * 0.5 } : look === 'river' || look === 'hillside' ? null : at(L.center)
    if (square && (look === 'village' || look === 'ruins')) {
      c.fillStyle = pal.pathEdge
      c.beginPath()
      c.arc(square.x, square.y, u * 1.2, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = pal.path
      c.beginPath()
      c.arc(square.x, square.y, u * 1.08, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = rgba('#000000', 0.08)
      c.lineWidth = 2
      for (const r of [0.45, 0.78]) {
        c.beginPath()
        c.arc(square.x, square.y, u * r, 0, Math.PI * 2)
        c.stroke()
      }
    } else if (square) {
      const [sw, sh] = [u * 2.4, u * 1.7]
      c.fillStyle = edge
      c.beginPath()
      c.roundRect(square.x - sw / 2 - 4, square.y - sh / 2 - 4, sw + 8, sh + 8, 10)
      c.fill()
      c.fillStyle = fill
      c.beginPath()
      c.roundRect(square.x - sw / 2, square.y - sh / 2, sw, sh, 8)
      c.fill()
      c.strokeStyle = 'rgba(90,80,70,0.18)'
      c.lineWidth = 1
      for (let x = square.x - sw / 2 + u * 0.2; x < square.x + sw / 2; x += u * 0.2) {
        c.beginPath()
        c.moveTo(x, square.y - sh / 2)
        c.lineTo(x, square.y + sh / 2)
        c.stroke()
      }
    }
    if (square) {
      shadow(c, square.x, square.y + u * 0.3, u * 0.45, u * 0.15, 0.2)
      emoji(c, town.biome === 'volcano' ? '🗿' : '⛲', square.x, square.y, u * 0.95)
    }
    if (walled) drawTownWalls(c, V, u, look === 'capital', rng)

    // Trees, rocks and the like wherever nothing else stands, back to front.
    const buildings = [...L.places, ...L.houses]
    const blocked = (x: number, y: number): boolean => {
      for (const p of buildings) {
        const q = pos(p)
        const half = u * (p.kind === 'gate' ? 3.4 : p.kind === 'mayor' && look === 'capital' ? 1.6 : p.w * 0.85)
        if (Math.abs(x - q.x) < half && y > q.y - u * p.h * 1.2 && y < q.y + u * p.h * 0.8) return true
      }
      for (const [a, b, w] of segs) if (distToSeg(x, y, a, b) < w * 0.8) return true
      if (square && Math.hypot(x - square.x, y - square.y) < u * 1.5) return true
      if (look === 'port' && x < V.x + V.w * 0.24) return true
      if (look === 'river' && Math.abs(y - (V.y + V.h * RIVER_Y)) < u * 0.8) return true
      if (town.biome === 'coast' && look !== 'port' && x < V.x + V.w * 0.13) return true
      if (walled) {
        const [x0, x1, y0, y1] = [V.x + V.w * 0.035, V.x + V.w * 0.965, V.y + V.h * 0.075, V.y + V.h * 0.93]
        if (Math.abs(x - x0) < u * 0.5 || Math.abs(x - x1) < u * 0.5 || Math.abs(y - y0) < u * 0.6 || Math.abs(y - y1) < u * 0.5) return true
      }
      return false
    }
    if (look === 'ruins') drawBrokenWalls(c, V, u, rng, blocked)
    const scenery: { x: number; y: number; s: Scenery }[] = []
    for (let i = 0; i < 140 && scenery.length < 60; i++) {
      const x = rng.range(-20, W + 20)
      const y = rng.range(V.y + u * 0.3, H + 10)
      const s = pickScenery(rng, town.biome, walled ? 0.5 : 0.7)
      if (!blocked(x, y)) scenery.push({ x, y, s: { ...s, size: (s.size * u) / 85 } })
    }
    scenery.sort((a, b) => a.y - b.y)
    for (const { x, y, s } of scenery) drawScenery(c, town.biome, s, x, y)

    for (const p of [...buildings].sort((a, b) => a.ry - b.ry)) {
      const q = pos(p)
      if (p.kind === 'gate') drawGate(c, q.x, q.y, u)
      else if (p.kind === 'lair') drawLair(c, q.x, q.y, u, p.icon)
      else if (p.kind === 'spot') {
        const gone = taken.includes(p.id.slice(5))
        c.fillStyle = rgba('#ffffff', 0.18)
        c.beginPath()
        c.ellipse(q.x, q.y + u * 0.2, u * 0.5, u * 0.22, 0, 0, Math.PI * 2)
        c.fill()
        c.globalAlpha = gone ? 0.35 : 1
        emoji(c, p.icon, q.x, q.y, u * 0.7)
        c.globalAlpha = 1
      } else if (p.kind === 'mayor' && look === 'capital') drawCastle(c, q.x, q.y, u, p.icon)
      else drawBuilding(c, q.x, q.y, u * p.w * 1.3, u * p.h * 1.45, p.roof, p.kind, p.icon)
    }
    return cv
  }
}

function distToSeg(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(x - (a.x + dx * k), y - (a.y + dy * k))
}

function drawBuilding(c: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number, roof: string, kind: Kind, icon: string): void {
  const wallTop = y - bh * 0.02
  const wallH = bh * 0.4
  const roofTop = y - bh * 0.6
  const over = bw * 0.08
  const timbered = kind === 'npc' || kind === 'house'
  shadow(c, x, wallTop + wallH, bw * 0.62, bh * 0.1, 0.22)

  c.fillStyle = kind === 'mayor' ? '#efe2c2' : kind === 'workshop' ? '#d6ccba' : '#f4e8cd'
  c.beginPath()
  c.roundRect(x - bw / 2, wallTop, bw, wallH, 4)
  c.fill()
  if (kind === 'workshop') {
    // Stone walls.
    c.strokeStyle = 'rgba(90,80,64,0.35)'
    c.lineWidth = 1.5
    for (let row = 1; row < 4; row++) {
      const yy = wallTop + (wallH * row) / 4
      c.beginPath()
      c.moveTo(x - bw / 2, yy)
      c.lineTo(x + bw / 2, yy)
      c.stroke()
      for (let k = (row % 2) * 0.5; k < 4; k++) {
        const xx = x - bw / 2 + (bw * k) / 4
        c.beginPath()
        c.moveTo(xx, yy - wallH / 4)
        c.lineTo(xx, yy)
        c.stroke()
      }
    }
  }
  c.fillStyle = 'rgba(0,0,0,0.1)'
  c.fillRect(x - bw / 2, wallTop + wallH * 0.82, bw, wallH * 0.18)
  if (timbered) {
    c.strokeStyle = '#8a5a36'
    c.lineWidth = 2
    for (const fx of [-0.5, -0.17, 0.17, 0.5]) {
      c.beginPath()
      c.moveTo(x + bw * fx, wallTop)
      c.lineTo(x + bw * fx, wallTop + wallH)
      c.stroke()
    }
  }
  if (kind === 'workshop') {
    // A wide door standing open on the forge's glow.
    const glow = c.createLinearGradient(0, wallTop + wallH * 0.3, 0, wallTop + wallH)
    glow.addColorStop(0, '#ffb347')
    glow.addColorStop(1, '#c8461e')
    c.fillStyle = glow
    c.beginPath()
    c.roundRect(x - bw * 0.13, wallTop + wallH * 0.3, bw * 0.26, wallH * 0.7, [bw * 0.13, bw * 0.13, 0, 0])
    c.fill()
  } else {
    c.fillStyle = '#6b4226'
    c.beginPath()
    c.roundRect(x - bw * 0.09, wallTop + wallH * 0.32, bw * 0.18, wallH * 0.68, [bw * 0.09, bw * 0.09, 0, 0])
    c.fill()
  }
  c.fillStyle = '#ffe9a8'
  c.strokeStyle = '#7a5230'
  c.lineWidth = 2
  for (const sx of [-0.3, 0.3]) {
    c.beginPath()
    c.roundRect(x + bw * sx - bw * 0.07, wallTop + wallH * 0.24, bw * 0.14, wallH * 0.32, 3)
    c.fill()
    c.stroke()
  }

  const rg = c.createLinearGradient(0, roofTop, 0, wallTop)
  rg.addColorStop(0, shade(roof, 0.25))
  rg.addColorStop(1, shade(roof, -0.1))
  c.fillStyle = rg
  c.beginPath()
  c.moveTo(x - bw / 2 - over, wallTop + 2)
  c.lineTo(x + bw / 2 + over, wallTop + 2)
  c.lineTo(x + bw * 0.36, roofTop)
  c.lineTo(x - bw * 0.36, roofTop)
  c.closePath()
  c.fill()
  c.save()
  c.clip()
  c.strokeStyle = 'rgba(0,0,0,0.13)'
  c.lineWidth = 1.5
  for (let yy = roofTop + 7; yy < wallTop; yy += 8) {
    c.beginPath()
    c.moveTo(x - bw, yy)
    c.lineTo(x + bw, yy)
    c.stroke()
  }
  c.restore()
  c.strokeStyle = 'rgba(255,255,255,0.4)'
  c.lineWidth = 3
  c.beginPath()
  c.moveTo(x - bw * 0.36, roofTop)
  c.lineTo(x + bw * 0.36, roofTop)
  c.stroke()

  if (kind === 'shop') {
    const n = 7
    const sw = (bw + over * 2) / n
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? '#fff4e6' : '#d9423a'
      c.beginPath()
      c.moveTo(x - bw / 2 - over + i * sw, wallTop)
      c.lineTo(x - bw / 2 - over + (i + 1) * sw, wallTop)
      c.arc(x - bw / 2 - over + (i + 0.5) * sw, wallTop, sw / 2, 0, Math.PI)
      c.fill()
    }
  }
  if (timbered) {
    c.fillStyle = '#7a5a4a'
    c.fillRect(x + bw * 0.18, roofTop - bh * 0.06, bw * 0.1, bh * 0.2)
  }
  if (kind === 'workshop') {
    // A tall brick chimney with a wisp of smoke.
    c.fillStyle = '#8a4a36'
    c.fillRect(x + bw * 0.16, roofTop - bh * 0.22, bw * 0.13, bh * 0.36)
    c.fillStyle = '#5e2e22'
    c.fillRect(x + bw * 0.14, roofTop - bh * 0.25, bw * 0.17, bh * 0.05)
    c.fillStyle = 'rgba(230,230,235,0.55)'
    for (const [dx, dy, r] of [[0.22, 0.34, 0.07], [0.27, 0.44, 0.09], [0.34, 0.55, 0.11]]) {
      c.beginPath()
      c.arc(x + bw * dx, roofTop - bh * dy, bw * r, 0, Math.PI * 2)
      c.fill()
    }
  }
  if (kind === 'mayor') {
    c.strokeStyle = '#5a4030'
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(x, roofTop)
    c.lineTo(x, roofTop - bh * 0.36)
    c.stroke()
    c.fillStyle = '#ffd42a'
    c.beginPath()
    c.moveTo(x, roofTop - bh * 0.36)
    c.lineTo(x + bw * 0.24, roofTop - bh * 0.29)
    c.lineTo(x, roofTop - bh * 0.22)
    c.closePath()
    c.fill()
  }
  if (kind === 'mayor' || kind === 'shop' || kind === 'workshop') {
    const r = bw * 0.14
    const cy = (roofTop + wallTop) / 2
    c.fillStyle = '#fff8e6'
    c.strokeStyle = '#c9a24a'
    c.lineWidth = 3
    c.beginPath()
    c.arc(x, cy, r, 0, Math.PI * 2)
    c.fill()
    c.stroke()
    emoji(c, icon, x, cy, r * 1.4)
  }
}

/** The mayor's seat in a capital: a keep between two towers, with banners. */
function drawCastle(c: CanvasRenderingContext2D, x: number, y: number, u: number, icon: string): void {
  const stone = '#bdb4a3'
  shadow(c, x, y + u * 0.62, u * 1.6, u * 0.22, 0.25)
  for (const s of [-1, 1]) {
    const tx = x + s * u * 1.05
    const tg = c.createLinearGradient(tx - u * 0.34, 0, tx + u * 0.34, 0)
    tg.addColorStop(0, shade(stone, 0.12))
    tg.addColorStop(1, shade(stone, -0.18))
    c.fillStyle = tg
    c.fillRect(tx - u * 0.34, y - u * 0.95, u * 0.68, u * 1.5)
    c.fillStyle = '#6d3aa8'
    c.beginPath()
    c.moveTo(tx - u * 0.44, y - u * 0.95)
    c.lineTo(tx, y - u * 1.5)
    c.lineTo(tx + u * 0.44, y - u * 0.95)
    c.closePath()
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.18)'
    c.beginPath()
    c.moveTo(tx - u * 0.44, y - u * 0.95)
    c.lineTo(tx, y - u * 1.5)
    c.lineTo(tx - u * 0.1, y - u * 0.95)
    c.closePath()
    c.fill()
    c.strokeStyle = '#4a3020'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(tx, y - u * 1.5)
    c.lineTo(tx, y - u * 1.8)
    c.stroke()
    c.fillStyle = '#ffd42a'
    c.beginPath()
    c.moveTo(tx, y - u * 1.8)
    c.lineTo(tx + s * u * 0.3, y - u * 1.73)
    c.lineTo(tx, y - u * 1.66)
    c.closePath()
    c.fill()
    c.fillStyle = '#ffe9a8'
    c.beginPath()
    c.roundRect(tx - u * 0.08, y - u * 0.6, u * 0.16, u * 0.26, [u * 0.08, u * 0.08, 0, 0])
    c.fill()
  }
  const kg = c.createLinearGradient(0, y - u * 0.8, 0, y + u * 0.55)
  kg.addColorStop(0, shade(stone, 0.1))
  kg.addColorStop(1, shade(stone, -0.12))
  c.fillStyle = kg
  c.fillRect(x - u * 0.78, y - u * 0.8, u * 1.56, u * 1.35)
  c.fillStyle = shade(stone, 0.2)
  for (let i = 0; i < 6; i++) c.fillRect(x - u * 0.78 + i * u * 0.28, y - u * 0.96, u * 0.18, u * 0.18)
  c.strokeStyle = 'rgba(60,50,40,0.18)'
  c.lineWidth = 1
  for (let yy = y - u * 0.6; yy < y + u * 0.5; yy += u * 0.2) {
    c.beginPath()
    c.moveTo(x - u * 0.78, yy)
    c.lineTo(x + u * 0.78, yy)
    c.stroke()
  }
  c.fillStyle = '#4a2e1c'
  c.beginPath()
  c.moveTo(x - u * 0.26, y + u * 0.55)
  c.lineTo(x - u * 0.26, y + u * 0.15)
  c.arc(x, y + u * 0.15, u * 0.26, Math.PI, 0)
  c.lineTo(x + u * 0.26, y + u * 0.55)
  c.closePath()
  c.fill()
  for (const s of [-1, 1]) {
    const bx = x + s * u * 0.52
    c.fillStyle = '#8f2a2a'
    c.beginPath()
    c.moveTo(bx - u * 0.12, y - u * 0.5)
    c.lineTo(bx + u * 0.12, y - u * 0.5)
    c.lineTo(bx + u * 0.12, y)
    c.lineTo(bx, y - u * 0.1)
    c.lineTo(bx - u * 0.12, y)
    c.closePath()
    c.fill()
  }
  const r = u * 0.22
  c.fillStyle = '#fff8e6'
  c.strokeStyle = '#c9a24a'
  c.lineWidth = 3
  c.beginPath()
  c.arc(x, y - u * 0.4, r, 0, Math.PI * 2)
  c.fill()
  c.stroke()
  emoji(c, icon, x, y - u * 0.4, r * 1.4)
}

/** Crenellated walls round a capital or fortress, with towers (and banners in a capital). */
function drawTownWalls(c: CanvasRenderingContext2D, V: Rect, u: number, banners: boolean, rng: Rng): void {
  const x0 = V.x + V.w * 0.035
  const x1 = V.x + V.w * 0.965
  const y0 = V.y + V.h * 0.075
  const y1 = V.y + V.h * 0.93
  const gx = V.x + V.w * 0.5
  const t = u * 0.28
  const stone = '#aaa192'
  const run = (ax: number, ay: number, bx: number, by: number): void => {
    if (ay === by) {
      c.fillStyle = shade(stone, -0.2)
      c.fillRect(ax, ay, bx - ax, t * 0.5)
      c.fillStyle = stone
      c.fillRect(ax, ay - t * 0.5, bx - ax, t * 0.55)
      c.fillStyle = shade(stone, 0.14)
      for (let x = ax; x < bx - t * 0.3; x += t * 0.7) c.fillRect(x, ay - t * 0.78, t * 0.4, t * 0.3)
    } else {
      c.fillStyle = shade(stone, -0.12)
      c.fillRect(ax - t * 0.5, ay, t, by - ay)
      c.fillStyle = stone
      c.fillRect(ax - t * 0.5, ay, t * 0.62, by - ay)
      c.fillStyle = shade(stone, 0.14)
      for (let y = ay; y < by - t * 0.3; y += t * 0.7) c.fillRect(ax - t * 0.62, y, t * 0.24, t * 0.4)
    }
  }
  run(x0, y0, x1, y0)
  run(x0, y0, x0, y1)
  run(x1, y0, x1, y1)
  run(x0, y1, gx - u * 3.2, y1)
  run(gx + u * 3.2, y1, x1, y1)
  const tower = (x: number, y: number): void => {
    shadow(c, x, y + u * 0.35, u * 0.5, u * 0.14, 0.25)
    c.fillStyle = shade(stone, -0.12)
    c.beginPath()
    c.arc(x, y, u * 0.44, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = stone
    c.beginPath()
    c.arc(x - u * 0.05, y - u * 0.05, u * 0.37, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = shade(stone, 0.16)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      c.fillRect(x + Math.cos(a) * u * 0.33 - u * 0.06, y + Math.sin(a) * u * 0.33 - u * 0.06, u * 0.12, u * 0.12)
    }
    if (banners) {
      c.strokeStyle = '#4a3020'
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x, y - u * 0.7)
      c.stroke()
      c.fillStyle = rng.pick(BANNERS)
      c.beginPath()
      c.moveTo(x, y - u * 0.7)
      c.lineTo(x + u * 0.36, y - u * 0.6)
      c.lineTo(x, y - u * 0.5)
      c.closePath()
      c.fill()
    }
  }
  for (const [x, y] of [[x0, y0], [x1, y0], [V.x + V.w * 0.28, y0], [V.x + V.w * 0.72, y0], [x0, y1], [x1, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]) tower(x, y)
}

function drawBoat(c: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng): void {
  shadow(c, x, y + s * 0.2, s * 0.55, s * 0.1, 0.25)
  c.fillStyle = rng.pick(['#7a4a2a', '#8a5a34', '#5a3a22'])
  c.beginPath()
  c.moveTo(x - s * 0.55, y - s * 0.05)
  c.lineTo(x + s * 0.55, y - s * 0.05)
  c.quadraticCurveTo(x + s * 0.45, y + s * 0.2, x, y + s * 0.2)
  c.quadraticCurveTo(x - s * 0.45, y + s * 0.2, x - s * 0.55, y - s * 0.05)
  c.fill()
  c.fillStyle = 'rgba(255,255,255,0.25)'
  c.fillRect(x - s * 0.5, y - s * 0.05, s, s * 0.04)
  c.strokeStyle = '#4a3020'
  c.lineWidth = Math.max(1.5, s * 0.04)
  c.beginPath()
  c.moveTo(x, y - s * 0.05)
  c.lineTo(x, y - s * 0.78)
  c.stroke()
  c.fillStyle = rng.pick(['#fff8e6', '#f3e3c0', '#ecdcd6'])
  c.beginPath()
  c.moveTo(x + s * 0.03, y - s * 0.74)
  c.lineTo(x + s * 0.44, y - s * 0.12)
  c.lineTo(x + s * 0.03, y - s * 0.12)
  c.closePath()
  c.fill()
  c.fillStyle = rng.pick(BANNERS)
  c.beginPath()
  c.moveTo(x, y - s * 0.78)
  c.lineTo(x - s * 0.18, y - s * 0.72)
  c.lineTo(x, y - s * 0.66)
  c.closePath()
  c.fill()
}

/** A harbour along the left: the sea, a stone quay, piers with boats, crates and barrels. */
function drawHarbor(c: CanvasRenderingContext2D, V: Rect, H: number, u: number, rng: Rng): void {
  const edge = V.x + V.w * 0.19
  const sea = c.createLinearGradient(0, 0, edge, 0)
  sea.addColorStop(0, '#2a74a8')
  sea.addColorStop(1, '#3a9fd3')
  c.fillStyle = sea
  c.fillRect(0, V.y, edge, H - V.y)
  c.strokeStyle = 'rgba(255,255,255,0.35)'
  c.lineWidth = 2
  for (let i = 0; i < 18; i++) {
    c.beginPath()
    c.arc(rng.range(0, edge - 20), rng.range(V.y, H), 10, Math.PI * 1.1, Math.PI * 1.9)
    c.stroke()
  }
  for (const f of [0.3, 0.55, 0.8]) {
    const y = V.y + V.h * f
    c.fillStyle = '#8a6440'
    c.fillRect(edge - u * 1.7, y - u * 0.16, u * 1.7, u * 0.32)
    c.strokeStyle = 'rgba(60,40,20,0.5)'
    c.lineWidth = 1
    for (let x = edge - u * 1.7; x < edge; x += u * 0.18) {
      c.beginPath()
      c.moveTo(x, y - u * 0.16)
      c.lineTo(x, y + u * 0.16)
      c.stroke()
    }
    c.fillStyle = '#5a3e24'
    for (const px of [edge - u * 1.65, edge - u * 0.9]) {
      for (const s of [-1, 1]) {
        c.beginPath()
        c.arc(px, y + s * u * 0.18, u * 0.06, 0, Math.PI * 2)
        c.fill()
      }
    }
    drawBoat(c, edge - u * 1.1, y + (f === 0.55 ? -u * 0.5 : u * 0.62), u * 0.9, rng)
  }
  c.fillStyle = '#9a9282'
  c.fillRect(edge - u * 0.1, V.y, u * 0.26, H - V.y)
  c.fillStyle = '#b8b0a0'
  c.fillRect(edge - u * 0.1, V.y, u * 0.1, H - V.y)
  c.strokeStyle = 'rgba(0,0,0,0.18)'
  c.lineWidth = 1
  for (let y = V.y; y < H; y += u * 0.3) {
    c.beginPath()
    c.moveTo(edge - u * 0.1, y)
    c.lineTo(edge + u * 0.16, y)
    c.stroke()
  }
  for (let i = 0; i < 6; i++) {
    const x = edge + u * rng.range(0.28, 0.42)
    const y = V.y + V.h * rng.range(0.2, 0.9)
    shadow(c, x, y + u * 0.12, u * 0.16, u * 0.05, 0.25)
    if (rng.chance(0.5)) {
      c.fillStyle = '#b5874f'
      c.fillRect(x - u * 0.13, y - u * 0.13, u * 0.26, u * 0.24)
      c.strokeStyle = '#6b4a2a'
      c.lineWidth = 1.5
      c.strokeRect(x - u * 0.13, y - u * 0.13, u * 0.26, u * 0.24)
      c.beginPath()
      c.moveTo(x - u * 0.13, y - u * 0.13)
      c.lineTo(x + u * 0.13, y + u * 0.11)
      c.stroke()
    } else {
      c.fillStyle = '#8a5a34'
      c.beginPath()
      c.ellipse(x, y, u * 0.12, u * 0.14, 0, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = '#4a3020'
      c.lineWidth = 1.5
      for (const dy of [-0.06, 0.06]) {
        c.beginPath()
        c.moveTo(x - u * 0.12, y + u * dy)
        c.lineTo(x + u * 0.12, y + u * dy)
        c.stroke()
      }
    }
  }
}

/** A river across the middle of the town, with sandy banks and reeds. */
function drawRiver(c: CanvasRenderingContext2D, V: Rect, W: number, u: number, town: Town, rng: Rng): void {
  const top = (x: number): number => V.y + V.h * (RIVER_Y - 0.045) + Math.sin(x / 80) * u * 0.1
  const bot = (x: number): number => V.y + V.h * (RIVER_Y + 0.045) + Math.sin(x / 80 + 1.6) * u * 0.1
  const band = (pad: number): void => {
    c.beginPath()
    c.moveTo(-10, top(-10) - pad)
    for (let x = -10; x <= W + 10; x += 12) c.lineTo(x, top(x) - pad)
    for (let x = W + 10; x >= -10; x -= 12) c.lineTo(x, bot(x) + pad)
    c.closePath()
  }
  c.fillStyle = '#d6c28c'
  band(u * 0.14)
  c.fill()
  const water = c.createLinearGradient(0, top(0), 0, bot(0))
  water.addColorStop(0, '#4aa3d6')
  water.addColorStop(1, '#3386bd')
  c.fillStyle = water
  band(0)
  c.fill()
  c.strokeStyle = 'rgba(255,255,255,0.4)'
  c.lineWidth = 2
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, W)
    const y = rng.range(top(x) + u * 0.1, bot(x) - u * 0.1)
    c.beginPath()
    c.arc(x, y, u * 0.14, Math.PI * 1.15, Math.PI * 1.85)
    c.stroke()
  }
  for (let i = 0; i < 8; i++) {
    const x = rng.range(V.x, V.x + V.w)
    if (Math.abs(x - (V.x + V.w * 0.5)) < u * 1.2) continue
    const s: Scenery = { kind: 'reeds', variant: i % VARIANTS, size: u * 0.55, flip: i % 2 === 0 }
    drawScenery(c, town.biome, s, x, i % 2 ? top(x) : bot(x) + u * 0.12)
  }
}

function drawBridge(c: CanvasRenderingContext2D, V: Rect, u: number): void {
  const x = V.x + V.w * 0.5
  const y0 = V.y + V.h * (RIVER_Y - 0.075)
  const y1 = V.y + V.h * (RIVER_Y + 0.075)
  c.fillStyle = 'rgba(0,0,0,0.2)'
  c.fillRect(x - u * 0.38, y0 + u * 0.12, u * 0.9, y1 - y0)
  c.fillStyle = '#a57c4c'
  c.fillRect(x - u * 0.45, y0, u * 0.9, y1 - y0)
  c.strokeStyle = 'rgba(70,45,25,0.45)'
  c.lineWidth = 1.5
  for (let y = y0 + u * 0.12; y < y1; y += u * 0.13) {
    c.beginPath()
    c.moveTo(x - u * 0.45, y)
    c.lineTo(x + u * 0.45, y)
    c.stroke()
  }
  c.fillStyle = '#6b4a2a'
  for (const s of [-1, 1]) {
    c.fillRect(x + s * u * 0.45 - u * 0.05, y0, u * 0.1, y1 - y0)
    for (let y = y0; y <= y1; y += (y1 - y0) / 3) c.fillRect(x + s * u * 0.45 - u * 0.08, y - u * 0.04, u * 0.16, u * 0.12)
  }
}

/** Retaining walls between the terraces of a hillside town; higher terraces catch more light. */
function drawTerraces(c: CanvasRenderingContext2D, V: Rect, W: number, u: number): void {
  c.fillStyle = 'rgba(255,255,255,0.07)'
  c.fillRect(0, V.y, W, V.h * 0.35 + u * 0.26)
  for (const f of [0.35, 0.57]) {
    const y = V.y + V.h * f + u * 0.26
    c.fillStyle = 'rgba(0,0,0,0.14)'
    c.fillRect(0, y + u * 0.22, W, u * 0.14)
    c.fillStyle = '#a89e8a'
    c.fillRect(0, y, W, u * 0.22)
    c.fillStyle = '#c4bba8'
    c.fillRect(0, y, W, u * 0.05)
    c.strokeStyle = 'rgba(60,50,40,0.3)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(0, y + u * 0.135)
    c.lineTo(W, y + u * 0.135)
    c.stroke()
    for (let row = 0; row < 2; row++) {
      for (let x = row ? u * 0.18 : 0; x < W; x += u * 0.36) {
        c.beginPath()
        c.moveTo(x, y + u * 0.05 + row * u * 0.085)
        c.lineTo(x, y + u * 0.05 + (row + 1) * u * 0.085)
        c.stroke()
      }
    }
  }
}

/** Scorched earth for a town under threat. */
function drawScorch(c: CanvasRenderingContext2D, V: Rect, W: number, H: number, u: number, rng: Rng): void {
  for (let i = 0; i < 12; i++) {
    const x = rng.range(0, W)
    const y = rng.range(V.y, H)
    const r = u * rng.range(0.8, 2.2)
    const g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(30,20,15,0.32)')
    g.addColorStop(1, 'rgba(30,20,15,0)')
    c.fillStyle = g
    c.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/** Broken walls and rubble where houses stood, wherever nothing else is. */
function drawBrokenWalls(c: CanvasRenderingContext2D, V: Rect, u: number, rng: Rng, blocked: (x: number, y: number) => boolean): void {
  for (let i = 0, made = 0; i < 40 && made < 6; i++) {
    const x = rng.range(V.x + V.w * 0.05, V.x + V.w * 0.95)
    const y = rng.range(V.y + V.h * 0.2, V.y + V.h * 0.88)
    const w = u * rng.range(0.8, 1.6)
    const heights = Array.from({ length: 7 }, () => u * rng.range(0.08, 0.3))
    const stones = Array.from({ length: 4 }, () => [rng.range(-w / 2, w / 2), u * rng.range(0.1, 0.25), u * rng.range(0.04, 0.08)])
    if (blocked(x, y) || blocked(x - w / 2, y) || blocked(x + w / 2, y)) continue
    made++
    c.fillStyle = 'rgba(0,0,0,0.2)'
    c.fillRect(x - w / 2, y + u * 0.05, w, u * 0.1)
    c.fillStyle = '#8f857a'
    c.beginPath()
    c.moveTo(x - w / 2, y + u * 0.08)
    heights.forEach((hgt, k) => c.lineTo(x - w / 2 + (w * k) / 6, y - hgt))
    c.lineTo(x + w / 2, y + u * 0.08)
    c.closePath()
    c.fill()
    c.fillStyle = '#6f675e'
    for (const [dx, dy, r] of stones) {
      c.beginPath()
      c.arc(x + dx, y + dy, r, 0, Math.PI * 2)
      c.fill()
    }
  }
}

function drawGate(c: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  const stone = '#a39a8a'
  c.fillStyle = shade(stone, -0.15)
  c.fillRect(x - u * 3.2, y - u * 0.3, u * 6.4, u * 0.45)
  c.fillStyle = stone
  c.fillRect(x - u * 3.2, y - u * 0.42, u * 6.4, u * 0.14)
  for (let i = -3.2; i < 3.2; i += 0.4) c.fillRect(x + u * i, y - u * 0.56, u * 0.22, u * 0.16)
  for (const s of [-1, 1]) {
    const tx = x + s * u * 0.78
    shadow(c, tx, y + u * 0.18, u * 0.4, u * 0.1, 0.25)
    c.fillStyle = shade(stone, 0.08)
    c.fillRect(tx - u * 0.32, y - u * 1.05, u * 0.64, u * 1.2)
    c.fillStyle = shade(stone, -0.1)
    for (let i = 0; i < 3; i++) c.fillRect(tx - u * 0.32 + i * u * 0.24, y - u * 1.2, u * 0.16, u * 0.17)
  }
  c.fillStyle = '#3a2a1e'
  c.beginPath()
  c.moveTo(x - u * 0.46, y + u * 0.15)
  c.lineTo(x - u * 0.46, y - u * 0.45)
  c.arc(x, y - u * 0.45, u * 0.46, Math.PI, 0)
  c.lineTo(x + u * 0.46, y + u * 0.15)
  c.closePath()
  c.fill()
  c.fillStyle = '#8a5a30'
  c.fillRect(x - u * 0.46, y - u * 0.4, u * 0.12, u * 0.55)
  c.fillRect(x + u * 0.34, y - u * 0.4, u * 0.12, u * 0.55)
}

function drawLair(c: CanvasRenderingContext2D, x: number, y: number, u: number, icon: string): void {
  const glow = c.createRadialGradient(x, y + u * 0.2, u * 0.1, x, y + u * 0.2, u * 1.6)
  glow.addColorStop(0, 'rgba(255,120,40,0.75)')
  glow.addColorStop(1, 'rgba(255,80,20,0)')
  c.fillStyle = glow
  c.fillRect(x - u * 1.8, y - u * 1.5, u * 3.6, u * 3.4)
  c.fillStyle = '#2a1712'
  c.beginPath()
  c.ellipse(x, y + u * 0.35, u * 0.75, u * 0.42, 0, 0, Math.PI * 2)
  c.fill()
  emoji(c, icon, x, y - u * 0.35, u * 1.5)
}
