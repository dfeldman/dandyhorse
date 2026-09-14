/**
 * Scenery drawn in code rather than emoji: a seamless ground texture per biome, and plants, rocks and critters
 * that vary in shape, tint and size. Everything is painted once into offscreen canvases and then blitted, so
 * a frame costs about the same as drawing emoji. Items and people stay emoji; this is only the landscape.
 */
import type { Biome } from '../content/types.ts'
import { Rng, hashString } from '../engine/rng.ts'
import { PALETTES } from './palette.ts'

type RGB = [number, number, number]

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = ([r, g, b]: RGB, a = 1): string => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
/** Lighten (amt > 0) or darken (amt < 0). */
const tone = (c: RGB, amt: number): RGB => (amt >= 0 ? mix(c, [255, 255, 255], amt) : mix(c, [0, 0, 0], -amt))

/** Per-biome colours for things the palette doesn't cover. */
const LOOK: Record<Biome, { rock: RGB; bush: string[]; snowy?: boolean }> = {
  plains: { rock: [146, 140, 128], bush: ['#4f9a3a', '#5aa845', '#478f3a'] },
  forest: { rock: [128, 126, 112], bush: ['#3d7d33', '#357330', '#4a8a3a'] },
  hills: { rock: [150, 144, 128], bush: ['#5a9a40', '#4f8f3a', '#68a848'] },
  coast: { rock: [196, 178, 146], bush: ['#6aa84a', '#5a9a42', '#7ab050'] },
  mountain: { rock: [152, 149, 142], bush: ['#557a45', '#4a6f40'] },
  swamp: { rock: [112, 116, 96], bush: ['#4a6a35', '#56753a', '#3f5e30'] },
  snow: { rock: [150, 156, 168], bush: ['#3f6a4a', '#46724f'], snowy: true },
  volcano: { rock: [84, 66, 60], bush: ['#5a5040', '#4f4638'] },
  desert: { rock: [200, 164, 112], bush: ['#8a9a4a', '#7f8f45'] },
}

// --- ground ------------------------------------------------------------------------------------

const TILE = 256
const tiles = new Map<string, HTMLCanvasElement>()
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>()

/**
 * A seamless ground pattern for `biome`. (ox, oy) is where the tile's corner lands on screen: move it with
 * the land (the road view passes the distance walked) and the texture scrolls.
 */
export function groundPattern(c: CanvasRenderingContext2D, biome: Biome, dpr: number, ox: number, oy: number): CanvasPattern {
  const key = `${biome}@${dpr}`
  let byCtx = patterns.get(c)
  if (!byCtx) patterns.set(c, (byCtx = new Map()))
  let p = byCtx.get(key)
  if (!p) {
    let tile = tiles.get(key)
    if (!tile) {
      tile = document.createElement('canvas')
      tile.width = tile.height = TILE * dpr
      const g = tile.getContext('2d')!
      g.scale(dpr, dpr)
      paintGround(g, biome)
      tiles.set(key, tile)
    }
    p = c.createPattern(tile, 'repeat')!
    byCtx.set(key, p)
  }
  const mod = (v: number): number => ((v % TILE) + TILE) % TILE
  p.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, mod(ox), mod(oy)]))
  return p
}

function paintGround(g: CanvasRenderingContext2D, biome: Biome): void {
  const pal = PALETTES[biome]
  const look = LOOK[biome]
  const rng = new Rng(hashString(`ground:${biome}`))
  const base = mix(hex(pal.ground[0]), hex(pal.ground[1]), 0.5)
  const grass = hex(pal.grass)
  g.fillStyle = css(base)
  g.fillRect(0, 0, TILE, TILE)

  // Draw at (x, y) and at the wrapped copies near the edges, so the tile repeats without seams. Random
  // numbers are drawn before `wrap`, never inside `draw` (which may run up to four times).
  const wrap = (x: number, y: number, r: number, draw: (x: number, y: number) => void): void => {
    for (const dx of [-TILE, 0, TILE]) {
      for (const dy of [-TILE, 0, TILE]) {
        const px = x + dx
        const py = y + dy
        if (px > -r && px < TILE + r && py > -r && py < TILE + r) draw(px, py)
      }
    }
  }
  const at = (): [number, number] => [rng.range(0, TILE), rng.range(0, TILE)]

  const blots = (n: number, rMin: number, rMax: number, lo: number, hi: number, alpha: number, color = base): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const r = rng.range(rMin, rMax)
      const col = tone(color, rng.range(lo, hi))
      wrap(x0, y0, r, (x, y) => {
        const rg = g.createRadialGradient(x, y, 0, x, y, r)
        rg.addColorStop(0, css(col, alpha))
        rg.addColorStop(1, css(col, 0))
        g.fillStyle = rg
        g.beginPath()
        g.arc(x, y, r, 0, Math.PI * 2)
        g.fill()
      })
    }
  }
  const tufts = (n: number, color: RGB, hMin = 4, hMax = 9): void => {
    g.lineCap = 'round'
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const blades = rng.int(3, 5)
      const h = rng.range(hMin, hMax)
      const lean = rng.range(-2, 2)
      const col = css(tone(color, rng.range(-0.18, 0.3)), 0.85)
      wrap(x0, y0, 12, (x, y) => {
        g.strokeStyle = col
        g.lineWidth = 1.3
        for (let b = 0; b < blades; b++) {
          const ox = (b - (blades - 1) / 2) * 2
          const bh = h * (0.7 + 0.15 * ((b * 7) % 3))
          g.beginPath()
          g.moveTo(x + ox, y)
          g.quadraticCurveTo(x + ox * 1.4, y - bh * 0.6, x + ox * 2 + lean, y - bh)
          g.stroke()
        }
      })
    }
  }
  const flowers = (n: number, colors: string[]): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const col = rng.pick(colors)
      const r = rng.range(1.1, 1.9)
      wrap(x0, y0, 6, (x, y) => {
        g.fillStyle = col
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2
          g.beginPath()
          g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.8, 0, Math.PI * 2)
          g.fill()
        }
        g.fillStyle = '#ffd23a'
        g.beginPath()
        g.arc(x, y, r * 0.6, 0, Math.PI * 2)
        g.fill()
      })
    }
  }
  const pebbles = (n: number, color: RGB, rMin = 1.2, rMax = 3.5): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const rx = rng.range(rMin, rMax)
      const ry = rx * rng.range(0.55, 0.8)
      const rot = rng.range(0, Math.PI)
      const col = tone(color, rng.range(-0.2, 0.2))
      wrap(x0, y0, rMax + 2, (x, y) => {
        g.fillStyle = 'rgba(0,0,0,0.18)'
        g.beginPath()
        g.ellipse(x + 0.6, y + 0.8, rx, ry, rot, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = css(col)
        g.beginPath()
        g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = css(tone(col, 0.35), 0.8)
        g.beginPath()
        g.ellipse(x - rx * 0.25, y - ry * 0.35, rx * 0.45, ry * 0.35, rot, 0, Math.PI * 2)
        g.fill()
      })
    }
  }
  const ripples = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const len = rng.range(30, 80)
      const amp = rng.range(1.5, 3)
      const phase = rng.range(0, 6)
      wrap(x0, y0, len, (x, y) => {
        for (const [dy, col] of [[0, css(tone(base, 0.28), 0.55)], [1.6, css(tone(base, -0.16), 0.35)]] as const) {
          g.strokeStyle = col
          g.lineWidth = 1.2
          g.beginPath()
          for (let s = 0; s <= len; s += 4) {
            const px = x - len / 2 + s
            const py = y + dy + Math.sin(s / 9 + phase) * amp
            if (s === 0) g.moveTo(px, py)
            else g.lineTo(px, py)
          }
          g.stroke()
        }
      })
    }
  }
  const cracks = (n: number, color: string, glow: boolean): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const pts: [number, number][] = [[0, 0]]
      for (let s = 0; s < 5; s++) {
        const [px, py] = pts[pts.length - 1]
        pts.push([px + rng.range(-10, 10), py + rng.range(6, 14)])
      }
      wrap(x0, y0, 70, (x, y) => {
        g.save()
        if (glow) {
          g.shadowColor = color
          g.shadowBlur = 6
        }
        g.strokeStyle = color
        g.lineWidth = glow ? 1.8 : 1.2
        g.beginPath()
        pts.forEach(([px, py], k) => (k ? g.lineTo(x + px, y + py) : g.moveTo(x + px, y + py)))
        g.stroke()
        g.restore()
      })
    }
  }
  const sparkles = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const r = rng.range(0.7, 1.7)
      wrap(x0, y0, 4, (x, y) => {
        g.fillStyle = 'rgba(255,255,255,0.95)'
        g.beginPath()
        g.moveTo(x, y - r * 2)
        g.lineTo(x + r * 0.5, y)
        g.lineTo(x, y + r * 2)
        g.lineTo(x - r * 0.5, y)
        g.moveTo(x - r * 2, y)
        g.lineTo(x, y + r * 0.5)
        g.lineTo(x + r * 2, y)
        g.lineTo(x, y - r * 0.5)
        g.fill()
      })
    }
  }
  const litter = (n: number, colors: string[], rx = 2.6, ry = 1.3): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const col = rng.pick(colors)
      const rot = rng.range(0, Math.PI)
      wrap(x0, y0, 5, (x, y) => {
        g.fillStyle = col
        g.beginPath()
        g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
        g.fill()
      })
    }
  }
  const puddles = (n: number, water: RGB): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const rx = rng.range(8, 18)
      const ry = rx * rng.range(0.4, 0.6)
      wrap(x0, y0, rx + 2, (x, y) => {
        g.fillStyle = css(tone(water, -0.1), 0.85)
        g.beginPath()
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = css(tone(water, 0.45), 0.55)
        g.lineWidth = 1
        g.beginPath()
        g.ellipse(x - rx * 0.2, y - ry * 0.2, rx * 0.5, ry * 0.4, 0, Math.PI * 1.1, Math.PI * 1.8)
        g.stroke()
      })
    }
  }
  const speckle = (n: number, lo: number, hi: number, alpha: number): void => {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = at()
      const col = css(tone(base, rng.range(lo, hi)), alpha)
      const r = rng.range(0.6, 1.5)
      wrap(x0, y0, 2, (x, y) => {
        g.fillStyle = col
        g.fillRect(x - r / 2, y - r / 2, r, r)
      })
    }
  }

  blots(28, 26, 72, -0.12, 0.1, 0.45)
  switch (biome) {
    case 'plains':
      tufts(120, grass)
      flowers(16, ['#ffffff', '#fff3a0', '#ff9ec7', '#c9a8ff'])
      speckle(500, -0.22, 0.22, 0.25)
      break
    case 'hills':
      tufts(90, grass)
      pebbles(24, look.rock)
      flowers(6, ['#ffffff', '#fff3a0'])
      speckle(420, -0.22, 0.22, 0.25)
      break
    case 'forest':
      blots(14, 16, 36, -0.24, -0.08, 0.5)
      tufts(70, grass)
      litter(60, ['#8a5a2a', '#b8742e', '#6b8a2e', '#c9953a', '#7a4a24'])
      pebbles(8, look.rock)
      speckle(420, -0.25, 0.2, 0.25)
      break
    case 'coast':
      ripples(18)
      pebbles(22, [232, 222, 200], 1, 2.5)
      litter(14, ['#ffffff', '#ffd8cf', '#f3e9d8'], 1.8, 1.2)
      speckle(700, -0.16, 0.2, 0.35)
      break
    case 'desert':
      ripples(24)
      pebbles(12, look.rock)
      speckle(700, -0.16, 0.2, 0.35)
      break
    case 'mountain':
      pebbles(110, look.rock, 1, 4)
      cracks(8, 'rgba(60,55,50,0.35)', false)
      tufts(18, grass, 3, 6)
      speckle(500, -0.22, 0.22, 0.3)
      break
    case 'swamp':
      blots(16, 14, 34, -0.26, -0.1, 0.55)
      puddles(7, hex(pal.water ?? '#4e6e4a'))
      tufts(80, grass, 5, 11)
      speckle(420, -0.22, 0.2, 0.25)
      break
    case 'snow':
      blots(18, 20, 50, 0, 0.05, 0.4, [178, 202, 232])
      sparkles(70)
      pebbles(6, look.rock)
      break
    case 'volcano':
      pebbles(70, look.rock, 1, 3.5)
      cracks(7, '#ff7a2f', true)
      speckle(600, -0.3, 0.3, 0.35)
      break
  }
}

// --- scenery sprites -----------------------------------------------------------------------------

export type SceneryKind =
  | 'tree' | 'autumn' | 'pine' | 'snowpine' | 'palm' | 'bush' | 'rock' | 'boulder' | 'peak'
  | 'cactus' | 'deadtree' | 'reeds' | 'mushroom' | 'stump' | 'crab' | 'sheep'

/** Painters work in a 96-unit box, ground line at y = 88, centred on x = 48. */
const BOX = 96
const GROUND = 88
const MID = 48
/** Cached sprite resolution: device pixels per box unit. */
const RES = 2.6
export const VARIANTS = 4

/** On-screen box height, in CSS px, for each kind (the drawing fills most of its box). */
export const SCENERY_SIZE: Record<SceneryKind, [number, number]> = {
  tree: [72, 108], autumn: [72, 104], pine: [76, 112], snowpine: [76, 112], palm: [84, 112], bush: [30, 44],
  rock: [24, 38], boulder: [52, 72], peak: [130, 180], cactus: [52, 72], deadtree: [64, 92], reeds: [36, 52],
  mushroom: [20, 28], stump: [22, 30], crab: [22, 28], sheep: [28, 36],
}

type Weighted = [SceneryKind, number][]

/** What grows by the road in each biome. `big` is the share of trees and other tall things. */
export const SCENERY: Record<Biome, { big: number; tall: Weighted; low: Weighted }> = {
  plains: { big: 0.5, tall: [['tree', 6], ['autumn', 1], ['pine', 1]], low: [['bush', 5], ['rock', 1], ['sheep', 2], ['stump', 1]] },
  forest: { big: 0.8, tall: [['pine', 5], ['tree', 4], ['autumn', 1]], low: [['bush', 3], ['mushroom', 2], ['stump', 2], ['rock', 1]] },
  hills: { big: 0.45, tall: [['tree', 3], ['pine', 2]], low: [['rock', 3], ['bush', 3], ['sheep', 2]] },
  coast: { big: 0.45, tall: [['palm', 5], ['tree', 1]], low: [['rock', 2], ['crab', 2], ['bush', 1], ['reeds', 1]] },
  mountain: { big: 0.5, tall: [['pine', 4], ['boulder', 3]], low: [['rock', 5], ['bush', 1]] },
  swamp: { big: 0.45, tall: [['deadtree', 3], ['tree', 2]], low: [['reeds', 4], ['mushroom', 2], ['bush', 1]] },
  snow: { big: 0.6, tall: [['snowpine', 6], ['pine', 1]], low: [['rock', 2], ['bush', 1]] },
  volcano: { big: 0.4, tall: [['deadtree', 3], ['boulder', 2]], low: [['rock', 4], ['stump', 1]] },
  desert: { big: 0.4, tall: [['cactus', 4], ['palm', 1]], low: [['rock', 3], ['bush', 1]] },
}

export interface Scenery { kind: SceneryKind; variant: number; size: number; flip: boolean }

function weighted(rng: Rng, list: Weighted): SceneryKind {
  let r = rng.range(0, list.reduce((n, [, w]) => n + w, 0))
  for (const [k, w] of list) if ((r -= w) < 0) return k
  return list[list.length - 1][0]
}

/** One random piece of scenery for a biome. `tallShare` overrides the biome's share of tall things. */
export function pickScenery(rng: Rng, biome: Biome, tallShare?: number): Scenery {
  const s = SCENERY[biome]
  const kind = weighted(rng, rng.chance(tallShare ?? s.big) ? s.tall : s.low)
  const [lo, hi] = SCENERY_SIZE[kind]
  return { kind, variant: rng.int(0, VARIANTS - 1), size: rng.range(lo, hi), flip: rng.chance(0.5) }
}

const sprites = new Map<string, HTMLCanvasElement>()

/** Draw a piece of scenery standing on (x, y), `size` px tall (its box). */
export function drawScenery(c: CanvasRenderingContext2D, biome: Biome, s: Scenery, x: number, y: number, size = s.size): void {
  const key = `${s.kind}:${s.variant}:${biome}`
  let img = sprites.get(key)
  if (!img) {
    img = document.createElement('canvas')
    img.width = img.height = Math.round(BOX * RES)
    const g = img.getContext('2d')!
    g.scale(RES, RES)
    paintScenery(g, s.kind, new Rng(hashString(key)), biome)
    sprites.set(key, img)
  }
  const k = size / BOX
  c.save()
  c.translate(x, y)
  if (s.flip) c.scale(-1, 1)
  c.drawImage(img, -MID * k, -GROUND * k, BOX * k, BOX * k)
  c.restore()
}

function paintScenery(g: CanvasRenderingContext2D, kind: SceneryKind, rng: Rng, biome: Biome): void {
  const look = LOOK[biome]
  switch (kind) {
    case 'tree': return paintTree(g, rng, ['#4f9a3a', '#5aa845', '#3f8a3a', '#6bb04a', '#4a9440'])
    case 'autumn': return paintTree(g, rng, ['#e0892c', '#d9a02a', '#c8612a', '#e3b53a'])
    case 'pine': return paintPine(g, rng, !!look.snowy && rng.chance(0.5))
    case 'snowpine': return paintPine(g, rng, true)
    case 'palm': return paintPalm(g, rng)
    case 'bush': return paintBush(g, rng, look.bush, !!look.snowy)
    case 'rock': return paintRock(g, rng, look.rock, 0.62, !!look.snowy)
    case 'boulder': return paintRock(g, rng, look.rock, 0.92, !!look.snowy)
    case 'peak': return paintPeak(g, rng)
    case 'cactus': return paintCactus(g, rng)
    case 'deadtree': return paintDeadTree(g, rng, biome === 'swamp' ? [74, 72, 56] : [78, 62, 54])
    case 'reeds': return paintReeds(g, rng)
    case 'mushroom': return paintMushrooms(g, rng)
    case 'stump': return paintStump(g, rng)
    case 'crab': return paintCrab(g, rng)
    case 'sheep': return paintSheep(g, rng)
  }
}

function groundShadow(g: CanvasRenderingContext2D, x: number, rx: number, alpha = 0.22): void {
  g.fillStyle = `rgba(0,0,0,${alpha})`
  g.beginPath()
  g.ellipse(x, GROUND, rx, rx * 0.24, 0, 0, Math.PI * 2)
  g.fill()
}

/** A ball lit from the upper left. */
function ball(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB, light = 0.3, dark = -0.22): void {
  const rg = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
  rg.addColorStop(0, css(tone(col, light)))
  rg.addColorStop(0.7, css(col))
  rg.addColorStop(1, css(tone(col, dark)))
  g.fillStyle = rg
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.fillStyle = fill
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}

function paintTree(g: CanvasRenderingContext2D, rng: Rng, colors: string[]): void {
  const trunkH = rng.range(22, 30)
  const trunkW = rng.range(7, 10)
  const R = rng.range(25, 30)
  const cy = GROUND - trunkH - R * 0.5
  groundShadow(g, MID + 4, R * 0.95)
  const tg = g.createLinearGradient(MID - trunkW / 2, 0, MID + trunkW / 2, 0)
  tg.addColorStop(0, '#8a5a34')
  tg.addColorStop(1, '#553620')
  g.fillStyle = tg
  g.beginPath()
  g.moveTo(MID - trunkW / 2, GROUND)
  g.lineTo(MID - trunkW * 0.3, cy)
  g.lineTo(MID + trunkW * 0.3, cy)
  g.lineTo(MID + trunkW / 2, GROUND)
  g.closePath()
  g.fill()
  const col = hex(rng.pick(colors))
  const blobs: [number, number, number][] = [[0, 0, 1], [-0.55, 0.22, 0.68], [0.55, 0.22, 0.68], [-0.28, -0.42, 0.62], [0.3, -0.36, 0.6]]
  const placed = blobs.map(([ox, oy, s]): [number, number, number] => [MID + ox * R + rng.range(-2, 2), cy + oy * R + rng.range(-2, 2), R * s * rng.range(0.92, 1.05)])
  for (const [x, y, r] of placed) dot(g, x, y + 3, r, css(tone(col, -0.4)))
  for (const [x, y, r] of placed) ball(g, x, y, r, col)
  for (let i = 0; i < 7; i++) dot(g, MID + rng.range(-R * 0.75, R * 0.45), cy + rng.range(-R * 0.75, R * 0.1), rng.range(1.4, 2.8), css(tone(col, 0.45), 0.7))
  if (rng.chance(0.3)) for (let i = 0; i < 5; i++) dot(g, MID + rng.range(-R * 0.6, R * 0.6), cy + rng.range(-R * 0.4, R * 0.5), 2.2, '#e0443a')
}

function paintPine(g: CanvasRenderingContext2D, rng: Rng, snowy: boolean): void {
  const tiers = rng.int(3, 4)
  const H = rng.range(70, 82)
  const W = rng.range(30, 38)
  groundShadow(g, MID + 3, W * 0.8)
  g.fillStyle = '#5a3a22'
  g.fillRect(MID - 3, GROUND - 13, 6, 13)
  const col = hex(rng.pick(['#2f6b3a', '#2a5e36', '#3a7a40', '#24583a']))
  const span = H - 14
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers
    const yb = GROUND - 9 - span * f * 0.85
    const ya = yb - span * (0.55 - f * 0.12)
    const w = W * (1 - f * 0.55)
    const gr = g.createLinearGradient(MID - w, 0, MID + w, 0)
    gr.addColorStop(0, css(tone(col, 0.2)))
    gr.addColorStop(0.55, css(col))
    gr.addColorStop(1, css(tone(col, -0.32)))
    g.fillStyle = gr
    g.beginPath()
    g.moveTo(MID - w, yb)
    g.quadraticCurveTo(MID, yb + 5, MID + w, yb)
    g.lineTo(MID, ya)
    g.closePath()
    g.fill()
    if (snowy) {
      const my = ya + (yb - ya) * 0.45
      g.fillStyle = 'rgba(255,255,255,0.94)'
      g.beginPath()
      g.moveTo(MID, ya)
      g.lineTo(MID - w * 0.46, my)
      g.quadraticCurveTo(MID - w * 0.2, my + 3, MID, my - 1)
      g.quadraticCurveTo(MID + w * 0.2, my + 4, MID + w * 0.46, my)
      g.closePath()
      g.fill()
    }
  }
}

function paintPalm(g: CanvasRenderingContext2D, rng: Rng): void {
  const lean = rng.range(-10, 10)
  const topX = MID + lean
  const topY = GROUND - rng.range(58, 66)
  groundShadow(g, MID + lean * 0.6, 20)
  const cx = MID + lean * 0.1
  const cy = GROUND - 30
  const along = (t: number): [number, number] => [
    (1 - t) * (1 - t) * MID + 2 * (1 - t) * t * cx + t * t * topX,
    (1 - t) * (1 - t) * GROUND + 2 * (1 - t) * t * cy + t * t * topY,
  ]
  for (let i = 0; i <= 11; i++) {
    const [x, y] = along(i / 11)
    g.fillStyle = i % 2 ? '#8d6a3f' : '#a47c4a'
    g.beginPath()
    g.ellipse(x, y, 5 - i * 0.2, 3.6, 0, 0, Math.PI * 2)
    g.fill()
  }
  const col = hex(rng.pick(['#3f9a3a', '#4aa843', '#378a3a']))
  const n = rng.int(6, 7)
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * ((Math.PI * 1.3) / (n - 1)) + rng.range(-0.1, 0.1)
    const len = rng.range(22, 30)
    const ex = topX + Math.cos(a) * len
    const ey = topY + Math.sin(a) * len * 0.6 + len * 0.4
    const mx = topX + Math.cos(a) * len * 0.55
    const my = topY + Math.sin(a) * len * 0.55 - 5
    g.fillStyle = css(tone(col, i % 2 ? 0.12 : -0.06))
    g.beginPath()
    g.moveTo(topX, topY)
    g.quadraticCurveTo(mx, my - 6, ex, ey)
    g.quadraticCurveTo(mx, my + 5, topX, topY)
    g.fill()
    g.strokeStyle = css(tone(col, -0.3))
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(topX, topY)
    g.quadraticCurveTo(mx, my, ex, ey)
    g.stroke()
  }
  for (let i = 0; i < rng.int(2, 3); i++) dot(g, topX - 3 + i * 3.4, topY + 3, 2.6, '#6a4a2a')
}

function paintBush(g: CanvasRenderingContext2D, rng: Rng, colors: string[], snowy: boolean): void {
  const col = hex(rng.pick(colors))
  const w = rng.range(26, 34)
  groundShadow(g, MID + 2, w * 1.05)
  const n = rng.int(4, 6)
  const blobs: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const r = rng.range(13, 19)
    blobs.push([MID + (i / (n - 1) - 0.5) * w * 1.4 + rng.range(-3, 3), GROUND - r * 0.9 - rng.range(0, 14), r])
  }
  blobs.sort((a, b) => a[1] - b[1])
  for (const [x, y, r] of blobs) dot(g, x, y + 3, r, css(tone(col, -0.4)))
  for (const [x, y, r] of blobs) ball(g, x, y, r, col)
  if (snowy) for (const [x, y, r] of blobs) {
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.beginPath()
    g.ellipse(x - r * 0.1, y - r * 0.55, r * 0.7, r * 0.35, 0, Math.PI, Math.PI * 2)
    g.fill()
  }
  const berries = rng.chance(0.4) ? rng.pick(['#e0443a', '#5a4ad8', '#ffffff', '#ff9ec7']) : null
  if (berries) for (let i = 0; i < 9; i++) dot(g, MID + rng.range(-w * 0.8, w * 0.8), GROUND - rng.range(10, 36), 2.2, berries)
}

function paintRock(g: CanvasRenderingContext2D, rng: Rng, color: RGB, tall: number, snowy: boolean): void {
  const r = rng.range(36, 42)
  const cy = GROUND - r * tall * 0.75
  groundShadow(g, MID + 3, r * 1.05, 0.26)
  const col = tone(color, rng.range(-0.1, 0.1))
  const k = rng.int(7, 9)
  const pts: [number, number][] = []
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 + rng.range(-0.15, 0.15)
    const rr = r * rng.range(0.78, 1.04)
    pts.push([MID + Math.cos(a) * rr, Math.min(GROUND, cy + Math.sin(a) * rr * tall)])
  }
  const path = (): void => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
  }
  const lg = g.createLinearGradient(MID - r, cy - r * tall, MID + r, GROUND)
  lg.addColorStop(0, css(tone(col, 0.28)))
  lg.addColorStop(0.55, css(col))
  lg.addColorStop(1, css(tone(col, -0.35)))
  g.fillStyle = lg
  path()
  g.fill()
  // A lit facet and a crack or two.
  g.save()
  path()
  g.clip()
  g.fillStyle = css(tone(col, 0.35), 0.55)
  g.beginPath()
  g.moveTo(MID - r * 0.9, cy - r * tall * 0.1)
  g.lineTo(MID - r * 0.15, cy - r * tall * 1.1)
  g.lineTo(MID + r * 0.25, cy - r * tall * 0.2)
  g.lineTo(MID - r * 0.3, cy + r * tall * 0.15)
  g.closePath()
  g.fill()
  g.strokeStyle = css(tone(col, -0.45), 0.6)
  g.lineWidth = 1.2
  for (let i = 0; i < rng.int(1, 2); i++) {
    let x = MID + rng.range(-r * 0.4, r * 0.4)
    let y = cy - r * tall * 0.3
    g.beginPath()
    g.moveTo(x, y)
    for (let s = 0; s < 3; s++) g.lineTo((x += rng.range(-6, 6)), (y += rng.range(6, 10)))
    g.stroke()
  }
  if (snowy) {
    g.fillStyle = 'rgba(255,255,255,0.95)'
    g.beginPath()
    g.ellipse(MID - r * 0.1, cy - r * tall * 0.85, r * 0.9, r * tall * 0.45, 0, 0, Math.PI * 2)
    g.fill()
  } else if (rng.chance(0.35)) {
    for (let i = 0; i < 6; i++) dot(g, MID + rng.range(-r * 0.6, r * 0.2), cy - rng.range(0, r * tall * 0.8), rng.range(1.5, 3), 'rgba(90,140,60,0.7)')
  }
  g.restore()
}

function paintPeak(g: CanvasRenderingContext2D, rng: Rng): void {
  const h = rng.range(70, 82)
  const w = rng.range(38, 44)
  const tipX = MID + rng.range(-6, 6)
  const tipY = GROUND - h
  const footX = tipX + rng.range(-4, 6)
  groundShadow(g, MID, w, 0.18)
  g.fillStyle = '#a19b8e'
  g.beginPath()
  g.moveTo(MID - w, GROUND)
  g.lineTo(tipX, tipY)
  g.lineTo(footX, GROUND)
  g.closePath()
  g.fill()
  g.fillStyle = '#716b61'
  g.beginPath()
  g.moveTo(tipX, tipY)
  g.lineTo(MID + w, GROUND)
  g.lineTo(footX, GROUND)
  g.closePath()
  g.fill()
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.moveTo(tipX, tipY)
  const sy = tipY + h * 0.3
  g.lineTo(tipX - w * 0.32, sy)
  g.lineTo(tipX - w * 0.16, sy - 4)
  g.lineTo(tipX - w * 0.02, sy + 3)
  g.lineTo(tipX + w * 0.14, sy - 3)
  g.lineTo(tipX + w * 0.3, sy + 1)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgba(160,180,210,0.35)'
  g.beginPath()
  g.moveTo(tipX, tipY)
  g.lineTo(tipX + w * 0.3, sy + 1)
  g.lineTo(tipX + w * 0.14, sy - 3)
  g.closePath()
  g.fill()
}

function paintCactus(g: CanvasRenderingContext2D, rng: Rng): void {
  const h = rng.range(66, 78)
  const w = rng.range(12, 15)
  const col = hex(rng.pick(['#4f8f3f', '#5a9a45', '#46843a']))
  groundShadow(g, MID + 2, 16)
  const limb = (x: number, y: number, lw: number, lh: number): void => {
    const lg = g.createLinearGradient(x, 0, x + lw, 0)
    lg.addColorStop(0, css(tone(col, 0.2)))
    lg.addColorStop(1, css(tone(col, -0.3)))
    g.fillStyle = lg
    g.beginPath()
    g.roundRect(x, y, lw, lh, lw / 2)
    g.fill()
    g.strokeStyle = css(tone(col, -0.35), 0.5)
    g.lineWidth = 0.8
    for (let i = 1; i < 3; i++) {
      g.beginPath()
      g.moveTo(x + (lw * i) / 3, y + lw * 0.4)
      g.lineTo(x + (lw * i) / 3, y + lh - lw * 0.3)
      g.stroke()
    }
  }
  const arms = rng.int(1, 2)
  for (let i = 0; i < arms; i++) {
    const side = i === 0 ? (rng.chance(0.5) ? -1 : 1) : -1
    const ay = GROUND - h * rng.range(0.4, 0.6)
    const reach = rng.range(12, 18)
    const x0 = side < 0 ? MID - w / 2 - reach : MID + w / 2
    limb(x0, ay - w * 0.4, reach + w * 0.3, w * 0.8)
    limb(side < 0 ? x0 : x0 + reach - w * 0.5, ay - rng.range(18, 26), w * 0.8, rng.range(22, 30))
  }
  limb(MID - w / 2, GROUND - h, w, h)
  if (rng.chance(0.5)) dot(g, MID, GROUND - h + 2, 3.2, '#ff7ab0')
}

function paintDeadTree(g: CanvasRenderingContext2D, rng: Rng, color: RGB): void {
  const h = rng.range(44, 54)
  groundShadow(g, MID + 3, 18)
  const col = css(tone(color, rng.range(-0.1, 0.1)))
  g.strokeStyle = col
  g.lineCap = 'round'
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    const ex = x + Math.cos(a) * len
    const ey = y + Math.sin(a) * len
    g.lineWidth = w
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + Math.cos(a + 0.3) * len * 0.5, y + Math.sin(a + 0.3) * len * 0.5, ex, ey)
    g.stroke()
    if (depth <= 0) return
    const kids = rng.int(2, 3)
    for (let i = 0; i < kids; i++) branch(ex, ey, a + rng.range(-0.8, 0.8), len * rng.range(0.55, 0.75), w * 0.6, depth - 1)
  }
  g.fillStyle = col
  g.beginPath()
  g.moveTo(MID - 6, GROUND)
  g.quadraticCurveTo(MID - 2, GROUND - h * 0.5, MID - 2, GROUND - h)
  g.lineTo(MID + 2, GROUND - h)
  g.quadraticCurveTo(MID + 3, GROUND - h * 0.5, MID + 6, GROUND)
  g.closePath()
  g.fill()
  branch(MID, GROUND - h, -Math.PI / 2 + rng.range(-0.3, 0.3), rng.range(14, 20), 3.2, 2)
  branch(MID, GROUND - h * 0.7, -Math.PI / 2 - rng.range(0.6, 1), rng.range(12, 18), 2.6, 1)
  branch(MID, GROUND - h * 0.6, -Math.PI / 2 + rng.range(0.6, 1), rng.range(12, 18), 2.6, 1)
}

function paintReeds(g: CanvasRenderingContext2D, rng: Rng): void {
  groundShadow(g, MID, 16, 0.15)
  g.lineCap = 'round'
  const n = rng.int(7, 10)
  for (let i = 0; i < n; i++) {
    const x = MID + rng.range(-16, 16)
    const h = rng.range(46, 78)
    const bend = rng.range(-8, 8)
    g.strokeStyle = css(tone([106, 138, 58], rng.range(-0.2, 0.15)))
    g.lineWidth = rng.range(1.4, 2.2)
    g.beginPath()
    g.moveTo(x, GROUND)
    g.quadraticCurveTo(x + bend * 0.3, GROUND - h * 0.5, x + bend, GROUND - h)
    g.stroke()
    if (rng.chance(0.45)) {
      g.fillStyle = '#7a4a2a'
      g.beginPath()
      g.ellipse(x + bend * 0.92, GROUND - h + 9, 2.6, 7, bend * 0.02, 0, Math.PI * 2)
      g.fill()
    }
  }
}

function paintMushrooms(g: CanvasRenderingContext2D, rng: Rng): void {
  const red = rng.chance(0.6)
  const n = rng.int(1, 3)
  groundShadow(g, MID, 26, 0.18)
  const list = Array.from({ length: n }, (_, i) => ({
    x: MID + (n === 1 ? 0 : (i / (n - 1) - 0.5) * 44) + rng.range(-4, 4),
    h: i === Math.floor(n / 2) ? rng.range(44, 58) : rng.range(26, 40),
    r: rng.range(15, 22),
  })).sort((a, b) => a.h - b.h)
  for (const m of list) {
    g.fillStyle = '#f2e6cf'
    g.beginPath()
    g.roundRect(m.x - 5, GROUND - m.h, 10, m.h, 4)
    g.fill()
    const cap = hex(red ? '#d8412f' : '#a0683a')
    const cg = g.createRadialGradient(m.x - m.r * 0.3, GROUND - m.h - m.r * 0.4, 1, m.x, GROUND - m.h, m.r)
    cg.addColorStop(0, css(tone(cap, 0.3)))
    cg.addColorStop(1, css(tone(cap, -0.2)))
    g.fillStyle = cg
    g.beginPath()
    g.ellipse(m.x, GROUND - m.h + 2, m.r, m.r * 0.75, 0, Math.PI, Math.PI * 2)
    g.fill()
    if (red) for (let i = 0; i < 4; i++) dot(g, m.x + rng.range(-m.r * 0.6, m.r * 0.6), GROUND - m.h - rng.range(2, m.r * 0.55), rng.range(1.8, 3), '#fff')
  }
}

function paintStump(g: CanvasRenderingContext2D, rng: Rng): void {
  const w = rng.range(44, 56)
  const h = rng.range(26, 34)
  const top = GROUND - h
  groundShadow(g, MID + 2, w * 0.6)
  const bg = g.createLinearGradient(MID - w / 2, 0, MID + w / 2, 0)
  bg.addColorStop(0, '#8a5a34')
  bg.addColorStop(1, '#4f321e')
  g.fillStyle = bg
  g.beginPath()
  g.moveTo(MID - w / 2 - 4, GROUND)
  g.lineTo(MID - w / 2, top)
  g.lineTo(MID + w / 2, top)
  g.lineTo(MID + w / 2 + 4, GROUND)
  g.closePath()
  g.fill()
  g.fillStyle = '#d6b47c'
  g.beginPath()
  g.ellipse(MID, top, w / 2, w * 0.16, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(120,80,40,0.55)'
  g.lineWidth = 1
  for (let r = 0.25; r < 1; r += 0.25) {
    g.beginPath()
    g.ellipse(MID, top, (w / 2) * r, w * 0.16 * r, 0, 0, Math.PI * 2)
    g.stroke()
  }
}

function paintCrab(g: CanvasRenderingContext2D, rng: Rng): void {
  const col = hex(rng.pick(['#e2553b', '#d9442f', '#ef6a3c']))
  const y = GROUND - 24
  groundShadow(g, MID, 36)
  g.strokeStyle = css(tone(col, -0.25))
  g.lineCap = 'round'
  g.lineWidth = 3.4
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      g.beginPath()
      g.moveTo(MID + side * 18, y + 4 + k * 3)
      g.quadraticCurveTo(MID + side * (32 + k * 3), y + k * 4, MID + side * (38 + k * 2), GROUND - 2 - k)
      g.stroke()
    }
    // Arm and claw.
    const cx = MID + side * 34
    const cy = y - 30 - rng.range(0, 6)
    g.beginPath()
    g.moveTo(MID + side * 20, y - 6)
    g.quadraticCurveTo(MID + side * 30, y - 10, cx, cy + 8)
    g.stroke()
    ball(g, cx, cy, 10, col)
    g.fillStyle = css(tone(col, -0.45))
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(cx + side * 12, cy - 9)
    g.lineTo(cx + side * 12, cy - 1)
    g.closePath()
    g.fill()
  }
  g.fillStyle = css(tone(col, -0.2))
  g.beginPath()
  g.ellipse(MID, y + 3, 28, 17, 0, 0, Math.PI * 2)
  g.fill()
  const bg = g.createRadialGradient(MID - 8, y - 8, 2, MID, y, 28)
  bg.addColorStop(0, css(tone(col, 0.3)))
  bg.addColorStop(1, css(col))
  g.fillStyle = bg
  g.beginPath()
  g.ellipse(MID, y, 27, 16, 0, 0, Math.PI * 2)
  g.fill()
  g.lineWidth = 2
  for (const side of [-1, 1]) {
    g.beginPath()
    g.moveTo(MID + side * 6, y - 12)
    g.lineTo(MID + side * 8, y - 22)
    g.stroke()
    dot(g, MID + side * 8, y - 23, 4, '#fff')
    dot(g, MID + side * 8.6, y - 23, 2, '#1a1a1a')
  }
  g.strokeStyle = css(tone(col, -0.4))
  g.lineWidth = 1.6
  g.beginPath()
  g.arc(MID, y + 2, 6, 0.2, Math.PI - 0.2)
  g.stroke()
}

function paintSheep(g: CanvasRenderingContext2D, rng: Rng): void {
  const wool = tone([246, 244, 236], rng.range(-0.08, 0))
  const y = GROUND - 34
  groundShadow(g, MID, 34)
  g.strokeStyle = '#3a3230'
  g.lineCap = 'round'
  g.lineWidth = 4
  for (const x of [-18, -8, 10, 20]) {
    g.beginPath()
    g.moveTo(MID + x, y + 10)
    g.lineTo(MID + x, GROUND - 2)
    g.stroke()
  }
  const puffs: [number, number, number][] = [[-22, 2, 13], [-10, -8, 15], [6, -9, 15], [20, -1, 13], [-12, 8, 13], [8, 8, 14], [0, 0, 16]]
  for (const [ox, oy, r] of puffs) dot(g, MID + ox, y + oy + 3, r, css(tone(wool, -0.25)))
  for (const [ox, oy, r] of puffs) ball(g, MID + ox, y + oy, r, wool, 0.4, -0.12)
  const hx = MID + 32
  const hy = y - 8
  g.fillStyle = '#3a3230'
  g.beginPath()
  g.ellipse(hx, hy, 9, 12, 0.3, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.ellipse(hx - 6, hy - 9, 6, 3, -0.5, 0, Math.PI * 2)
  g.fill()
  dot(g, hx + 3, hy - 3, 2, '#fff')
  dot(g, MID + 22, y - 14, 7, css(wool))
}
