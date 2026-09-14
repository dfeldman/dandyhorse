import type { Biome } from '../content/types.ts'
import type { Engine } from '../engine/engine.ts'
import { Rng, hashString } from '../engine/rng.ts'
import { PALETTES } from './palette.ts'
import type { Rect } from './stage.ts'
import { emoji, label, rgba } from './stage.ts'

export interface MapOptions {
  /** Draw this road in gold (the gate's highlighted destination). */
  highlightRoute?: string | null
  compact?: boolean
  labels?: boolean
  t?: number
}

/** Painted parchment per game and size: drawn once, then reused every frame. */
const backgrounds = new Map<string, HTMLCanvasElement>()

/** The region on parchment: painted land and map symbols, roads, towns, the crisis, and where the hero is. */
export function drawRegionMap(c: CanvasRenderingContext2D, r: Rect, e: Engine, o: MapOptions = {}): void {
  const w = e.world
  const s = e.save
  const g = w.game.region
  const compact = o.compact ?? false
  const pad = compact ? 16 : 40
  const sx = (x: number): number => r.x + pad + (x / g.width) * (r.w - pad * 2)
  const sy = (y: number): number => r.y + pad + (y / g.height) * (r.h - pad * 2)
  const t = o.t ?? performance.now() / 1000

  c.save()
  const k = Math.max(1, c.getTransform().a)
  const key = `${w.game.id}|${Math.round(r.w)}x${Math.round(r.h)}|${compact ? 1 : 0}|${k}`
  let bg = backgrounds.get(key)
  if (!bg) {
    bg = document.createElement('canvas')
    bg.width = Math.ceil(r.w * k)
    bg.height = Math.ceil(r.h * k)
    const b = bg.getContext('2d')!
    b.scale(k, k)
    paintParchment(b, r.w, r.h, e, compact, pad)
    if (backgrounds.size > 16) backgrounds.clear()
    backgrounds.set(key, bg)
  }
  c.drawImage(bg, r.x, r.y, r.w, r.h)

  const trip = s.where.kind === 'travel' ? s.where : null
  for (const rt of w.game.routes) {
    const a = w.town(rt.a)
    const b = w.town(rt.b)
    const hl = rt.id === o.highlightRoute || rt.id === trip?.route
    c.save()
    c.lineCap = 'round'
    if (hl) {
      c.strokeStyle = 'rgba(255,200,40,0.95)'
      c.lineWidth = compact ? 5 : 8
      c.shadowColor = 'rgba(232,137,12,0.9)'
      c.shadowBlur = 10
    } else {
      c.strokeStyle = 'rgba(122,90,48,0.7)'
      c.lineWidth = compact ? 2 : 3
      c.setLineDash(compact ? [4, 5] : [7, 7])
    }
    c.beginPath()
    c.moveTo(sx(a.x), sy(a.y))
    c.lineTo(sx(b.x), sy(b.y))
    c.stroke()
    c.restore()
  }

  // A small map (a phone's gate) names only the towns that matter now: here, the highlighted road's far end, and
  // the crisis. Otherwise eight names pile on top of each other.
  const small = !compact && r.w < 460
  const focus = new Set<string>()
  if (s.where.kind === 'town') focus.add(s.where.town)
  const hl = o.highlightRoute ? w.routes.get(o.highlightRoute) : undefined
  if (hl) {
    focus.add(hl.a)
    focus.add(hl.b)
  }
  for (const town of w.game.towns) {
    const x = sx(town.x)
    const y = sy(town.y)
    const seen = s.visited.includes(town.id)
    const rad = compact ? 5 : small ? 7 : 10
    c.beginPath()
    c.arc(x, y, rad, 0, Math.PI * 2)
    c.fillStyle = seen ? '#fffaf0' : '#d8c59a'
    c.fill()
    c.lineWidth = 2
    c.strokeStyle = '#6b4a22'
    c.stroke()
    if (town.crisis) emoji(c, '🔥', x, y - rad - (compact ? 8 : 16), compact || small ? 15 : 26)
    else if (!compact && !small) emoji(c, seen ? '🏰' : '❔', x, y - rad - 13, seen ? 22 : 16)
    if (o.labels !== false && !compact && (!small || focus.has(town.id) || town.crisis)) {
      label(c, town.name, x, y + rad + (small ? 10 : 13), { size: small ? 12 : 15, color: seen ? '#4a2c10' : '#8a7458', stroke: 'rgba(255,248,230,0.9)' })
    }
  }

  let hero: { x: number; y: number } | null = null
  if (s.where.kind === 'town') {
    const town = w.town(s.where.town)
    hero = { x: sx(town.x), y: sy(town.y) }
  } else if (trip) {
    const rt = w.route(trip.route)
    const a = w.town(rt.a)
    const b = w.town(rt.b)
    hero = { x: sx(a.x + (b.x - a.x) * trip.pos), y: sy(a.y + (b.y - a.y) * trip.pos) }
  }
  if (hero) {
    const pulse = 1 + 0.25 * Math.sin(t * 4)
    c.beginPath()
    c.arc(hero.x, hero.y, (compact ? 7 : 12) * pulse, 0, Math.PI * 2)
    c.fillStyle = 'rgba(255,212,42,0.35)'
    c.fill()
    c.beginPath()
    c.arc(hero.x, hero.y, compact ? 4 : 6, 0, Math.PI * 2)
    c.fillStyle = '#e8342a'
    c.fill()
    c.lineWidth = 2
    c.strokeStyle = '#fff'
    c.stroke()
  }
  c.restore()
}

/** Old paper, the sea off the coast, land tinted by biome, and little ink symbols for forests, peaks and so on. */
function paintParchment(b: CanvasRenderingContext2D, W: number, H: number, e: Engine, compact: boolean, pad: number): void {
  const w = e.world
  const g = w.game.region
  const sx = (x: number): number => pad + (x / g.width) * (W - pad * 2)
  const sy = (y: number): number => pad + (y / g.height) * (H - pad * 2)
  const rng = new Rng(hashString(`map:${w.game.id}`))
  const radius = compact ? 12 : 18
  const land = W * (compact ? 0.2 : 0.17)

  b.beginPath()
  b.roundRect(0, 0, W, H, radius)
  const paper = b.createLinearGradient(0, 0, 0, H)
  paper.addColorStop(0, '#f8eed2')
  paper.addColorStop(1, '#e7d3a2')
  b.fillStyle = paper
  b.fill()
  b.save()
  b.clip()

  const blob = (x: number, y: number, rad: number, color: string, alpha: number): void => {
    const grd = b.createRadialGradient(x, y, 0, x, y, rad)
    grd.addColorStop(0, rgba(color, alpha))
    grd.addColorStop(1, rgba(color, 0))
    b.fillStyle = grd
    b.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // Stains and fibres, so it reads as old paper.
  for (let i = 0; i < 14; i++) blob(rng.range(0, W), rng.range(0, H), rng.range(30, 120), '#a07838', rng.range(0.04, 0.09))
  for (let i = 0; i < (W * H) / 240; i++) {
    b.fillStyle = `rgba(120,90,40,${rng.range(0.06, 0.16)})`
    b.fillRect(rng.range(0, W), rng.range(0, H), rng.range(0.6, 1.6), rng.range(0.6, 1.6))
  }

  // The sea beyond the coast towns, on the side away from the middle of the map.
  const cx = W / 2
  const cy = H / 2
  for (const town of w.game.towns) {
    if (town.biome !== 'coast') continue
    const dx = sx(town.x) - cx
    const dy = sy(town.y) - cy
    const len = Math.hypot(dx, dy) || 1
    const wx = sx(town.x) + (dx / len) * land * 0.95
    const wy = sy(town.y) + (dy / len) * land * 0.95
    blob(wx, wy, land * 1.15, '#6aa8cf', 0.6)
    b.strokeStyle = 'rgba(58,110,160,0.55)'
    b.lineWidth = 1.2
    for (let i = 0; i < (compact ? 3 : 7); i++) wave(b, wx + rng.range(-land * 0.5, land * 0.5), wy + rng.range(-land * 0.5, land * 0.5), compact ? 4 : 6)
  }
  // Land tinted by each town's biome, and a band of each road's terrain.
  for (const town of w.game.towns) blob(sx(town.x), sy(town.y), land, PALETTES[town.biome].ground[0], 0.75)
  b.lineCap = 'round'
  for (const rt of w.game.routes) {
    const a = w.town(rt.a)
    const z = w.town(rt.b)
    b.strokeStyle = rgba(PALETTES[rt.terrain].ground[0], 0.2)
    b.lineWidth = land * 0.45
    b.beginPath()
    b.moveTo(sx(a.x), sy(a.y))
    b.lineTo(sx(z.x), sy(z.y))
    b.stroke()
  }

  // Ink symbols around each town and beside each road, kept clear of the town markers and names.
  const size = W * (compact ? 0.024 : 0.017)
  const clear = (x: number, y: number): boolean => w.game.towns.every((t) => {
    const dx = Math.abs(x - sx(t.x))
    const dy = y - sy(t.y)
    return Math.hypot(dx, dy) > land * 0.28 && !(dx < land * 0.5 && dy > -land * 0.2 && dy < land * 0.32)
  })
  for (const town of w.game.towns) {
    for (let i = 0; i < (compact ? 4 : 10); i++) {
      const a = rng.range(0, Math.PI * 2)
      const d = rng.range(land * 0.3, land * 0.85)
      const x = sx(town.x) + Math.cos(a) * d
      const y = sy(town.y) + Math.sin(a) * d * 0.8
      const s = size * rng.range(0.8, 1.2)
      if (clear(x, y)) symbol(b, town.biome, x, y, s, rng.chance(0.5))
    }
  }
  for (const rt of w.game.routes) {
    const a = w.town(rt.a)
    const z = w.town(rt.b)
    const nx = -(sy(z.y) - sy(a.y))
    const ny = sx(z.x) - sx(a.x)
    const nl = Math.hypot(nx, ny) || 1
    for (let i = 0; i < (compact ? 1 : 3); i++) {
      const f = rng.range(0.3, 0.7)
      const off = rng.range(10, 22) * (rng.chance(0.5) ? 1 : -1) * (compact ? 0.6 : 1)
      const x = sx(a.x + (z.x - a.x) * f) + (nx / nl) * off
      const y = sy(a.y + (z.y - a.y) * f) + (ny / nl) * off
      const s = size * rng.range(0.8, 1.1)
      if (clear(x, y)) symbol(b, rt.terrain, x, y, s, rng.chance(0.5))
    }
  }

  // Darker, burnt edges.
  const vg = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72)
  vg.addColorStop(0, 'rgba(120,80,30,0)')
  vg.addColorStop(1, 'rgba(120,80,30,0.3)')
  b.fillStyle = vg
  b.fillRect(0, 0, W, H)
  if (!compact) compass(b, W - 46, 50, 22)
  b.restore()

  b.lineWidth = 2
  b.strokeStyle = '#b8914a'
  b.beginPath()
  b.roundRect(1, 1, W - 2, H - 2, radius)
  b.stroke()
  if (!compact) {
    b.lineWidth = 1
    b.strokeStyle = 'rgba(184,145,74,0.55)'
    b.beginPath()
    b.roundRect(7, 7, W - 14, H - 14, radius - 5)
    b.stroke()
  }
}

function wave(b: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  b.beginPath()
  b.moveTo(x - s * 1.5, y)
  b.quadraticCurveTo(x - s * 0.75, y - s * 0.7, x, y)
  b.quadraticCurveTo(x + s * 0.75, y + s * 0.7, x + s * 1.5, y)
  b.stroke()
}

const INK = 'rgba(92,64,32,0.8)'

/** One map symbol for a biome, `s` px tall. `alt` picks the second look where there is one. */
function symbol(b: CanvasRenderingContext2D, biome: Biome, x: number, y: number, s: number, alt: boolean): void {
  b.save()
  b.lineWidth = Math.max(1, s * 0.1)
  b.lineJoin = 'round'
  b.lineCap = 'round'
  b.strokeStyle = INK
  const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, fill: string): void => {
    b.fillStyle = fill
    b.beginPath()
    b.moveTo(x0, y0)
    b.lineTo(x1, y1)
    b.lineTo(x2, y2)
    b.closePath()
    b.fill()
  }
  const pine = (fill: string, snow: boolean): void => {
    b.beginPath()
    b.moveTo(x, y + s * 0.2)
    b.lineTo(x, y + s * 0.5)
    b.stroke()
    tri(x, y - s * 0.7, x - s * 0.42, y + s * 0.25, x + s * 0.42, y + s * 0.25, fill)
    b.beginPath()
    b.moveTo(x, y - s * 0.7)
    b.lineTo(x - s * 0.42, y + s * 0.25)
    b.lineTo(x + s * 0.42, y + s * 0.25)
    b.closePath()
    b.stroke()
    if (snow) tri(x, y - s * 0.7, x - s * 0.18, y - s * 0.3, x + s * 0.18, y - s * 0.3, '#ffffff')
  }
  const round = (fill: string): void => {
    b.beginPath()
    b.moveTo(x, y)
    b.lineTo(x, y + s * 0.5)
    b.stroke()
    b.fillStyle = fill
    b.beginPath()
    b.arc(x, y - s * 0.2, s * 0.38, 0, Math.PI * 2)
    b.fill()
    b.stroke()
  }
  const peak = (snow: boolean): void => {
    tri(x, y - s * 0.9, x - s * 0.7, y + s * 0.35, x, y + s * 0.35, '#cfc5ad')
    tri(x, y - s * 0.9, x + s * 0.7, y + s * 0.35, x, y + s * 0.35, '#a0957f')
    if (snow) tri(x, y - s * 0.9, x - s * 0.24, y - s * 0.45, x + s * 0.24, y - s * 0.45, '#ffffff')
    b.beginPath()
    b.moveTo(x - s * 0.7, y + s * 0.35)
    b.lineTo(x, y - s * 0.9)
    b.lineTo(x + s * 0.7, y + s * 0.35)
    b.stroke()
  }
  const tufts = (color: string): void => {
    b.strokeStyle = color
    for (const dx of [-0.3, 0, 0.3]) {
      b.beginPath()
      b.moveTo(x + dx * s, y + s * 0.3)
      b.lineTo(x + dx * s * 1.6, y - s * 0.3)
      b.stroke()
    }
  }
  switch (biome) {
    case 'forest': alt ? round('#5f8a3f') : pine('#4f7a3a', false); break
    case 'plains': alt ? round('#7aa04a') : tufts('rgba(90,120,50,0.8)'); break
    case 'hills':
      b.fillStyle = 'rgba(150,180,90,0.7)'
      for (const [dx, r] of [[-0.3, 0.42], [0.32, 0.34]] as const) {
        b.beginPath()
        b.arc(x + dx * s, y + s * 0.2, r * s, Math.PI, Math.PI * 2)
        b.fill()
        b.stroke()
      }
      break
    case 'mountain': peak(alt); break
    case 'snow': alt ? peak(true) : pine('#7fa8a0', true); break
    case 'swamp':
      b.fillStyle = 'rgba(110,150,130,0.7)'
      b.beginPath()
      b.ellipse(x, y + s * 0.35, s * 0.45, s * 0.14, 0, 0, Math.PI * 2)
      b.fill()
      tufts('rgba(70,100,50,0.85)')
      break
    case 'coast':
      b.strokeStyle = 'rgba(58,110,160,0.7)'
      wave(b, x, y - s * 0.15, s * 0.35)
      wave(b, x + s * 0.25, y + s * 0.2, s * 0.35)
      break
    case 'desert':
      b.strokeStyle = 'rgba(170,120,60,0.8)'
      b.beginPath()
      b.arc(x - s * 0.2, y + s * 0.3, s * 0.45, Math.PI * 1.15, Math.PI * 1.85)
      b.stroke()
      b.beginPath()
      b.arc(x + s * 0.35, y + s * 0.45, s * 0.35, Math.PI * 1.15, Math.PI * 1.85)
      b.stroke()
      break
    case 'volcano':
      b.fillStyle = '#7a5a4a'
      b.beginPath()
      b.moveTo(x - s * 0.75, y + s * 0.35)
      b.lineTo(x - s * 0.18, y - s * 0.6)
      b.lineTo(x + s * 0.18, y - s * 0.6)
      b.lineTo(x + s * 0.75, y + s * 0.35)
      b.closePath()
      b.fill()
      b.stroke()
      b.fillStyle = '#ff6a2a'
      b.beginPath()
      b.ellipse(x, y - s * 0.6, s * 0.2, s * 0.08, 0, 0, Math.PI * 2)
      b.fill()
      b.fillStyle = 'rgba(110,100,95,0.45)'
      for (const [dx, dy, r] of [[0.05, -0.85, 0.16], [0.2, -1.05, 0.2]] as const) {
        b.beginPath()
        b.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2)
        b.fill()
      }
      break
  }
  b.restore()
}

function compass(b: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  b.save()
  b.lineWidth = 1
  b.strokeStyle = INK
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const len = i % 2 ? r * 0.5 : r
    const side = a + Math.PI / 2
    const w = r * 0.18
    for (const [half, fill] of [[1, '#8a5a2a'], [-1, '#f1e2b8']] as const) {
      b.fillStyle = fill
      b.beginPath()
      b.moveTo(x, y)
      b.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
      b.lineTo(x + Math.cos(side) * w * half, y + Math.sin(side) * w * half)
      b.closePath()
      b.fill()
      b.stroke()
    }
  }
  label(b, 'N', x, y - r - 9, { size: 12, color: '#6b4a22', font: 'title', weight: 900 })
  b.restore()
}
