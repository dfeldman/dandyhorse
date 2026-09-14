/**
 * Bosses, drawn in code: one design for each kind of boss (by family, and by attack for the two giants), tinted by
 * a colour word in its name where that suits the design ("the Red", "the Black", "the Gold"). They breathe, sway
 * and strike, facing left toward the hero. Ordinary enemies stay emoji.
 *
 * Painters work in units of the boss's height: (0, 0) is the ground under it, y = -1 the top of its head.
 */
import type { EnemyDef } from '../content/types.ts'
import { rgba, shade } from './stage.ts'

export interface BossPose {
  /** 0–1, fading: it just attacked (it lunges, and its attack shows: fire, lightning, a swing). */
  attack?: number
  /** 0–1, fading: it was just hit. */
  flash?: number
}

type Kind = 'dragon' | 'kraken' | 'sorcerer' | 'witch' | 'pirate' | 'warlord' | 'giant' | 'titan' | 'lich' | 'goblin'
type Pt = [number, number]
type Ctx = CanvasRenderingContext2D

/** Which design a boss gets, or null if its family has none (it stays an emoji). */
export function bossKind(e: EnemyDef): Kind | null {
  switch (e.family) {
    case 'dragon': return 'dragon'
    case 'sea': return 'kraken'
    case 'wizard': return 'sorcerer'
    case 'witch': return 'witch'
    case 'pirate': return 'pirate'
    case 'soldier': return 'warlord'
    case 'undead': return 'lich'
    case 'goblin': return 'goblin'
    case 'giant': return e.attack === 'ice' ? 'titan' : 'giant'
    default: return null
  }
}

const COLOURS: [RegExp, string][] = [
  [/\b(red|crimson|scarlet)\b/i, '#b8322a'], [/\b(black|dark)\b/i, '#3a3440'], [/\bgold(en)?\b/i, '#d4a02a'],
  [/\bgreen\b/i, '#3f8a4a'], [/\bblue\b/i, '#3a6ab0'], [/\b(grey|gray)\b/i, '#7c7c88'], [/\bwhite\b/i, '#d8d8e0'],
]

function tint(e: EnemyDef, fallback: string): string {
  for (const [re, col] of COLOURS) if (re.test(e.name)) return col
  return fallback
}

/**
 * Draw a boss at (x, y), the ground under it, `s` tall, at time `t`. Returns false if this boss has no design, so
 * the caller can draw its emoji instead.
 */
export function drawBoss(c: Ctx, e: EnemyDef, x: number, y: number, s: number, t: number, pose: BossPose = {}): boolean {
  const kind = bossKind(e)
  if (!kind) return false
  const a = pose.attack ?? 0
  c.save()
  c.translate(x - a * s * 0.05, y)
  c.scale(s, s)
  c.lineJoin = 'round'
  c.lineCap = 'round'
  switch (kind) {
    case 'dragon': dragon(c, t, a, tint(e, '#b8322a')); break
    case 'kraken': kraken(c, t, a, tint(e, '#5f8474')); break
    case 'sorcerer': sorcerer(c, t, a, tint(e, '#5a3a8a')); break
    case 'witch': witch(c, t, a); break
    case 'pirate': pirate(c, t, a); break
    case 'warlord': warlord(c, t, a); break
    case 'giant': giant(c, t, a, false); break
    case 'titan': giant(c, t, a, true); break
    case 'lich': lich(c, t, a); break
    case 'goblin': goblin(c, t, a); break
  }
  c.restore()
  if (pose.flash) {
    const g = c.createRadialGradient(x, y - s * 0.5, 0, x, y - s * 0.5, s * 0.6)
    g.addColorStop(0, `rgba(255,255,255,${0.55 * pose.flash})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(x - s * 0.6, y - s * 1.1, s * 1.2, s * 1.2)
  }
  return true
}

// --- drawing helpers (all in height units) ---------------------------------------------------------

function ell(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, rot = 0): void {
  c.fillStyle = fill
  c.beginPath()
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
  c.fill()
}

function poly(c: Ctx, pts: Pt[], fill: string | CanvasGradient): void {
  c.fillStyle = fill
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.closePath()
  c.fill()
}

function line(c: Ctx, pts: Pt[], width: number, color: string): void {
  c.strokeStyle = color
  c.lineWidth = width
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.stroke()
}

function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1)
  for (const [o, col] of stops) g.addColorStop(o, col)
  return g
}

function glow(c: Ctx, x: number, y: number, r: number, inner: string, outer: string): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  c.fillStyle = g
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fill()
}

/** Points along a smooth curve through `pts` (Catmull-Rom), `n` per segment. */
function curve(pts: Pt[], n = 8): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let k = 0; k < n; k++) {
      const t = k / n
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, cc: number, d: number): number =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** A limb, neck, tail or tentacle: a band along a smooth curve through `pts`, `w0` wide at the start, `w1` at the end. */
function limb(c: Ctx, pts: Pt[], w0: number, w1: number, fill: string | CanvasGradient): void {
  const path = curve(pts)
  const left: Pt[] = []
  const right: Pt[] = []
  path.forEach(([x, y], i) => {
    const [px, py] = path[Math.max(0, i - 1)]
    const [nx, ny] = path[Math.min(path.length - 1, i + 1)]
    const len = Math.hypot(nx - px, ny - py) || 1
    const w = (w0 + (w1 - w0) * (i / (path.length - 1))) / 2
    left.push([x - ((ny - py) / len) * w, y + ((nx - px) / len) * w])
    right.push([x + ((ny - py) / len) * w, y - ((nx - px) / len) * w])
  })
  c.fillStyle = fill
  c.beginPath()
  left.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  for (const [x, y] of right.reverse()) c.lineTo(x, y)
  c.closePath()
  c.fill()
  // Round ends, so joints look solid.
  ell(c, path[0][0], path[0][1], w0 / 2, w0 / 2, fill)
  ell(c, path[path.length - 1][0], path[path.length - 1][1], w1 / 2, w1 / 2, fill)
}

/** A jagged lightning bolt from a to b that flickers with time. */
function bolt(c: Ctx, a: Pt, b: Pt, t: number, width: number, color: string): void {
  const seed = Math.floor(t * 14)
  const jitter = (i: number): number => ((Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1) - 0.5
  const pts: Pt[] = []
  for (let i = 0; i <= 7; i++) {
    const k = i / 7
    const off = i === 0 || i === 7 ? 0 : jitter(i) * 0.08
    pts.push([a[0] + (b[0] - a[0]) * k - (b[1] - a[1]) * off, a[1] + (b[1] - a[1]) * k + (b[0] - a[0]) * off])
  }
  c.save()
  c.shadowColor = color
  c.shadowBlur = 12
  line(c, pts, width * 2.2, rgba('#9fdcff', 0.5))
  line(c, pts, width, color)
  c.restore()
}

function star(c: Ctx, x: number, y: number, r: number, fill: string): void {
  const pts: Pt[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push([x + Math.cos(a) * (i % 2 ? r * 0.45 : r), y + Math.sin(a) * (i % 2 ? r * 0.45 : r)])
  }
  poly(c, pts, fill)
}

/** A breath or a cloud blown toward the hero from `from`, `len` long. */
function breath(c: Ctx, from: Pt, len: number, spread: number, t: number, core: string, mid: string, tip: string): void {
  const [x, y] = from
  const g = c.createLinearGradient(x, y, x - len, y)
  g.addColorStop(0, core)
  g.addColorStop(0.35, mid)
  g.addColorStop(1, tip)
  c.fillStyle = g
  c.beginPath()
  c.moveTo(x, y - 0.01)
  c.quadraticCurveTo(x - len * 0.5, y - spread, x - len, y - spread * 0.4 + Math.sin(t * 30) * 0.02)
  c.quadraticCurveTo(x - len * 0.55, y + spread * 1.3, x, y + 0.03)
  c.fill()
}

function shadowUnder(c: Ctx, rx: number): void {
  ell(c, 0, 0, rx, rx * 0.12, 'rgba(0,0,0,0.25)')
}

// --- the bosses ---------------------------------------------------------------------------------

/** A dragon on all fours, neck raised toward the hero, wings half open, smoke curling from its nose. */
function dragon(c: Ctx, t: number, a: number, col: string): void {
  const dark = shade(col, -0.5)
  const deep = shade(col, -0.25)
  const light = shade(col, 0.3)
  const belly = '#f2c46a'
  const b = Math.sin(t * 2) * 0.012
  const flap = Math.sin(t * 1.7) * 0.12
  shadowUnder(c, 0.55)

  dragonWing(c, [0.14, -0.56 + b], -0.3 + flap, deep, dark)
  limb(c, [[0.3, -0.34 + b], [0.52, -0.3], [0.62, -0.14], [0.56, -0.03], [0.45, -0.05]], 0.17, 0.03, col)
  poly(c, [[0.46, -0.05], [0.37, -0.1], [0.36, 0.0], [0.43, 0.03]], dark)
  limb(c, [[0.24, -0.34 + b], [0.34, -0.16], [0.26, -0.02]], 0.15, 0.07, deep)
  claws(c, 0.26, 0, dark)

  ell(c, 0.1, -0.37 + b, 0.3, 0.2, lin(c, 0, -0.57, 0, -0.17, [[0, light], [0.5, col], [1, dark]]))
  ell(c, 0.02, -0.28 + b, 0.2, 0.085, belly)
  for (let i = 0; i < 5; i++) line(c, [[-0.13 + i * 0.07, -0.34 + b], [-0.11 + i * 0.07, -0.21 + b]], 0.006, shade(belly, -0.3))
  const top = (px: number): number => -0.37 + b - 0.2 * Math.sqrt(Math.max(0, 1 - ((px - 0.1) / 0.3) ** 2))
  for (let i = 0; i < 6; i++) {
    const px = -0.02 + i * 0.07
    const py = top(px)
    poly(c, [[px - 0.025, py + 0.015], [px + 0.02, py - 0.05], [px + 0.03, py + 0.015]], dark)
  }
  limb(c, [[-0.06, -0.3 + b], [-0.12, -0.14], [-0.16, -0.02]], 0.13, 0.07, col)
  claws(c, -0.17, 0, dark)

  // The neck rises toward the hero; the head dips a little to breathe fire.
  const hx = -0.42
  const hy = -0.8 + b * 2 + a * 0.04
  limb(c, [[-0.02, -0.45 + b], [-0.2, -0.56], [-0.32, -0.7], [hx + 0.05, hy + 0.02]], 0.2, 0.11, col)
  limb(c, [[-0.1, -0.36 + b], [-0.24, -0.5], [-0.35, -0.64], [hx, hy + 0.05]], 0.06, 0.035, belly)
  dragonWing(c, [0.18, -0.52 + b], -0.62 + flap * 1.3, col, dark)

  limb(c, [[hx + 0.03, hy - 0.05], [hx + 0.11, hy - 0.13], [hx + 0.19, hy - 0.12]], 0.035, 0.004, '#efe2c0')
  limb(c, [[hx + 0.06, hy - 0.03], [hx + 0.15, hy - 0.07], [hx + 0.21, hy - 0.03]], 0.03, 0.004, '#d9c9a0')
  // Lower jaw, opening to breathe.
  c.save()
  c.translate(hx - 0.02, hy + 0.025)
  c.rotate(-(0.08 + a * 0.35))
  poly(c, [[0.02, 0], [-0.16, 0.012], [-0.15, 0.04], [0.02, 0.045]], deep)
  for (let i = 0; i < 4; i++) poly(c, [[-0.14 + i * 0.035, 0.012], [-0.13 + i * 0.035, -0.006], [-0.12 + i * 0.035, 0.012]], '#fffbe8')
  c.restore()
  ell(c, hx + 0.03, hy, 0.09, 0.07, lin(c, 0, hy - 0.07, 0, hy + 0.07, [[0, light], [1, col]]))
  poly(c, [[hx - 0.02, hy - 0.055], [hx - 0.19, hy - 0.02], [hx - 0.2, hy + 0.02], [hx - 0.02, hy + 0.03]], col)
  ell(c, hx - 0.17, hy - 0.012, 0.009, 0.005, dark)
  poly(c, [[hx - 0.04, hy - 0.05], [hx + 0.05, hy - 0.065], [hx + 0.03, hy - 0.035]], dark)
  ell(c, hx + 0.005, hy - 0.025, 0.022, 0.014, '#ffd42a')
  ell(c, hx + 0.005, hy - 0.025, 0.004, 0.012, '#2a1000')
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.6 + i / 3) % 1
    ell(c, hx - 0.19 - k * 0.05, hy - 0.04 - k * 0.22, 0.014 + k * 0.035, 0.014 + k * 0.035, `rgba(120,110,110,${0.45 * (1 - k)})`)
  }
  if (a > 0.05) breath(c, [hx - 0.19, hy + 0.02], 0.2 + 0.75 * a, 0.14 * a + 0.03, t, 'rgba(255,250,200,0.95)', 'rgba(255,170,40,0.9)', 'rgba(255,70,20,0)')
}

function dragonWing(c: Ctx, [x, y]: Pt, angle: number, fill: string, bone: string): void {
  c.save()
  c.translate(x, y)
  c.rotate(angle)
  const wrist: Pt = [0.18, -0.34]
  const tips: Pt[] = [[0.62, -0.46], [0.6, -0.22], [0.46, -0.06]]
  c.fillStyle = fill
  c.beginPath()
  c.moveTo(0, 0)
  c.lineTo(...wrist)
  c.lineTo(...tips[0])
  c.quadraticCurveTo(0.52, -0.3, ...tips[1])
  c.quadraticCurveTo(0.44, -0.16, ...tips[2])
  c.quadraticCurveTo(0.24, -0.02, 0, 0)
  c.fill()
  c.strokeStyle = bone
  c.lineWidth = 0.022
  c.beginPath()
  c.moveTo(0, 0)
  c.lineTo(...wrist)
  for (const tip of tips) {
    c.moveTo(...wrist)
    c.lineTo(...tip)
  }
  c.stroke()
  poly(c, [[wrist[0] - 0.01, wrist[1]], [wrist[0] - 0.05, wrist[1] - 0.05], [wrist[0] + 0.02, wrist[1] - 0.01]], bone)
  c.restore()
}

function claws(c: Ctx, x: number, y: number, fill: string): void {
  for (let i = 0; i < 3; i++) poly(c, [[x - 0.05 + i * 0.03, y], [x - 0.07 + i * 0.03, y + 0.012], [x - 0.035 + i * 0.03, y + 0.01]], fill)
}

/** A great squid rising from a pool, tentacles swaying, two reaching for the hero. */
function kraken(c: Ctx, t: number, a: number, col: string): void {
  const dark = shade(col, -0.45)
  const light = shade(col, 0.3)
  const sway = (k: number): number => Math.sin(t * 1.6 + k) * 0.05
  ell(c, 0, 0, 0.6, 0.075, 'rgba(30,90,150,0.9)')
  for (const [k, side] of [[0, -1], [1.3, 1], [2.1, 1], [3.7, -1]] as const) {
    const w = sway(k)
    limb(c, [[side * 0.12, -0.12], [side * 0.34, -0.26 + w], [side * 0.46, -0.52 - w], [side * 0.4 + w, -0.74], [side * 0.3, -0.72]], 0.11, 0.015, dark)
  }
  const b = Math.sin(t * 1.4) * 0.015
  c.beginPath()
  c.moveTo(-0.2, -0.12)
  c.bezierCurveTo(-0.32, -0.6 + b, -0.16, -1.0 + b, 0.02, -1.0 + b)
  c.bezierCurveTo(0.2, -1.0 + b, 0.32, -0.6 + b, 0.2, -0.12)
  c.closePath()
  c.fillStyle = lin(c, -0.25, 0, 0.25, 0, [[0, dark], [0.4, light], [1, dark]])
  c.fill()
  for (const [sx, sy, r] of [[-0.08, -0.78, 0.03], [0.1, -0.7, 0.022], [0.02, -0.88, 0.02], [-0.14, -0.6, 0.018], [0.14, -0.55, 0.025]] as const) {
    ell(c, sx, sy + b, r, r * 0.8, shade(col, -0.2))
  }
  const blink = (t % 4.3) < 0.12 ? 0.15 : 1
  for (const ex of [-0.09, 0.09]) {
    ell(c, ex, -0.42 + b, 0.058, 0.048 * blink, '#ffe27a')
    ell(c, ex, -0.42 + b, 0.036, 0.009 * blink, '#1a1000')
  }
  poly(c, [[-0.16, -0.5 + b], [-0.03, -0.47 + b], [-0.04, -0.5 + b]], dark)
  poly(c, [[0.16, -0.5 + b], [0.03, -0.47 + b], [0.04, -0.5 + b]], dark)
  const reach = a * 0.25
  for (const [k, y0] of [[0.5, -0.1], [2.6, -0.06]] as const) {
    const w = sway(k)
    const pts: Pt[] = [[-0.05, y0], [-0.28 - reach * 0.5, y0 - 0.04 + w], [-0.48 - reach, -0.2 - w], [-0.55 - reach, -0.4], [-0.47 - reach, -0.47]]
    limb(c, pts, 0.1, 0.016, col)
    const path = curve(pts, 3)
    for (let i = 1; i < path.length - 2; i++) ell(c, path[i][0], path[i][1] + 0.022, 0.012 * (1 - i / path.length) + 0.005, 0.009, '#f0c8c0')
  }
  ell(c, 0, -0.02, 0.62, 0.05, 'rgba(60,140,200,0.55)')
  c.strokeStyle = 'rgba(255,255,255,0.7)'
  c.lineWidth = 0.012
  for (let i = 0; i < 6; i++) {
    const wx = -0.5 + i * 0.2 + Math.sin(t * 2 + i) * 0.02
    c.beginPath()
    c.arc(wx, 0.0, 0.05, Math.PI * 1.15, Math.PI * 1.85)
    c.stroke()
  }
  if (a > 0.05) for (let i = 0; i < 6; i++) ell(c, -0.55 - reach + Math.sin(i * 2) * 0.08, -0.5 - i * 0.04 * a, 0.02, 0.02, `rgba(200,235,255,${0.8 * a})`)
}

/** A floating sorcerer in a starry robe, lightning crackling around the orb of his staff. */
function sorcerer(c: Ctx, t: number, a: number, col: string): void {
  const dark = shade(col, -0.45)
  const light = shade(col, 0.25)
  const skin = '#e9d6c4'
  const f = -0.05 + Math.sin(t * 1.3) * 0.015
  ell(c, 0, 0, 0.26, 0.035, 'rgba(0,0,0,0.22)')
  glow(c, 0, -0.55 + f, 0.62, rgba(col, 0.35), rgba(col, 0))
  c.translate(0, f)
  const sw = Math.sin(t * 2) * 0.02
  c.beginPath()
  c.moveTo(-0.13, -0.62)
  c.lineTo(0.13, -0.62)
  c.quadraticCurveTo(0.2, -0.3, 0.27 + sw, -0.04)
  for (let i = 1; i <= 6; i++) c.lineTo(0.27 + sw - i * 0.09, -0.04 + (i % 2) * 0.035)
  c.quadraticCurveTo(-0.2, -0.3, -0.13, -0.62)
  c.fillStyle = lin(c, -0.27, 0, 0.27, 0, [[0, dark], [0.45, light], [1, dark]])
  c.fill()
  line(c, [[0, -0.6], [0.02, -0.05]], 0.03, '#e8c46a')
  for (const [sx, sy] of [[-0.12, -0.3], [0.1, -0.2], [-0.05, -0.15], [0.14, -0.42], [-0.16, -0.12]] as const) star(c, sx, sy, 0.018, 'rgba(255,240,170,0.85)')
  limb(c, [[0.11, -0.58], [0.2, -0.44], [0.16, -0.34]], 0.09, 0.09, dark)
  // The staff arm, raised toward the hero; it lifts to cast.
  const lift = a * 0.08
  limb(c, [[-0.1, -0.58], [-0.22, -0.5], [-0.27, -0.6 - lift]], 0.09, 0.075, col)
  line(c, [[-0.28, -0.05 - lift], [-0.27, -1.0 - lift]], 0.024, '#6b4a2a')
  ell(c, -0.27, -0.61 - lift, 0.03, 0.03, skin)
  const pulse = 0.06 + Math.sin(t * 5) * 0.008
  glow(c, -0.27, -1.04 - lift, pulse * 2.2, 'rgba(210,245,255,0.9)', 'rgba(120,180,255,0)')
  ell(c, -0.27, -1.04 - lift, pulse * 0.7, pulse * 0.7, '#f4fcff')
  if (Math.sin(t * 7) > 0.6) bolt(c, [-0.27, -1.04 - lift], [-0.18, -1.14 - lift], t, 0.008, '#e8f8ff')
  if (a > 0.05) bolt(c, [-0.27, -1.04 - lift], [-0.95 - a * 0.3, -0.55], t, 0.016 + a * 0.01, '#e8f8ff')
  ell(c, 0, -0.7, 0.07, 0.075, skin)
  ell(c, -0.027, -0.715, 0.013, 0.007, '#bff4ff')
  ell(c, 0.027, -0.715, 0.013, 0.007, '#bff4ff')
  poly(c, [[-0.07, -0.69], [0.07, -0.69], [0.04, -0.52], [0.005 + sw, -0.4], [-0.035, -0.52]], '#dcdce4')
  poly(c, [[-0.05, -0.75], [0.05, -0.75], [0.03, -0.735], [-0.03, -0.735]], '#dcdce4')
  ell(c, 0, -0.765, 0.17, 0.035, dark)
  c.beginPath()
  c.moveTo(-0.11, -0.775)
  c.quadraticCurveTo(-0.02, -0.98, 0.14 + sw, -1.12)
  c.quadraticCurveTo(0.04, -0.95, 0.11, -0.775)
  c.closePath()
  c.fillStyle = dark
  c.fill()
  star(c, 0.0, -0.87, 0.022, '#ffd42a')
  star(c, 0.05, -0.96, 0.014, '#ffd42a')
}

/** A hunched witch stirring a bubbling green cauldron. */
function witch(c: Ctx, t: number, a: number): void {
  const cloak = '#2e2238'
  const skin = '#86b04a'
  const hat = '#221a2a'
  const stir = t * 2.2
  shadowUnder(c, 0.42)
  c.beginPath()
  c.moveTo(-0.05, -0.64)
  c.quadraticCurveTo(0.2, -0.66, 0.22, -0.3)
  c.lineTo(0.26, -0.02)
  c.lineTo(-0.16, -0.02)
  c.quadraticCurveTo(-0.14, -0.4, -0.05, -0.64)
  c.fillStyle = lin(c, -0.16, 0, 0.26, 0, [[0, '#3e3050'], [1, '#1a1224']])
  c.fill()
  const hx = -0.24 + Math.cos(stir) * 0.03
  const hy = -0.44 + Math.sin(stir) * 0.015
  limb(c, [[-0.02, -0.56], [-0.14, -0.52], [hx, hy]], 0.07, 0.05, cloak)
  line(c, [[hx, hy], [hx - 0.03, hy + 0.17]], 0.018, '#7a5230')
  ell(c, hx, hy, 0.026, 0.022, skin)
  const hdx = -0.04
  const hdy = -0.72
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1
    c.strokeStyle = '#b8b8c0'
    c.lineWidth = 0.012
    c.beginPath()
    c.moveTo(hdx + side * 0.05, hdy - 0.04)
    c.quadraticCurveTo(hdx + side * (0.09 + (i % 3) * 0.01), hdy + 0.04, hdx + side * (0.07 + (i % 3) * 0.02), hdy + 0.14)
    c.stroke()
  }
  ell(c, hdx, hdy, 0.07, 0.075, skin)
  poly(c, [[hdx - 0.05, hdy - 0.015], [hdx - 0.17, hdy + 0.035], [hdx - 0.05, hdy + 0.03]], shade(skin, -0.12))
  ell(c, hdx - 0.12, hdy + 0.02, 0.008, 0.008, shade(skin, -0.35))
  ell(c, hdx - 0.03, hdy - 0.02, 0.012, 0.012, '#ffe04a')
  ell(c, hdx + 0.025, hdy - 0.02, 0.012, 0.012, '#ffe04a')
  c.strokeStyle = '#2a1a10'
  c.lineWidth = 0.01
  c.beginPath()
  c.arc(hdx, hdy + 0.025, 0.035 + a * 0.01, 0.15 * Math.PI, 0.85 * Math.PI)
  c.stroke()
  ell(c, hdx + 0.01, hdy - 0.06, 0.16, 0.03, hat, -0.1)
  c.beginPath()
  c.moveTo(hdx - 0.08, hdy - 0.07)
  c.lineTo(hdx + 0.02, hdy - 0.3)
  c.quadraticCurveTo(hdx + 0.1, hdy - 0.36, hdx + 0.16, hdy - 0.42)
  c.quadraticCurveTo(hdx + 0.08, hdy - 0.28, hdx + 0.1, hdy - 0.08)
  c.closePath()
  c.fillStyle = hat
  c.fill()
  poly(c, [[hdx - 0.075, hdy - 0.09], [hdx + 0.095, hdy - 0.11], [hdx + 0.092, hdy - 0.14], [hdx - 0.065, hdy - 0.12]], '#6a3a8a')
  ell(c, hdx + 0.01, hdy - 0.115, 0.018, 0.015, '#e8c46a')
  // The cauldron, in front.
  line(c, [[-0.4, -0.02], [-0.38, -0.08]], 0.02, '#1a1a22')
  line(c, [[-0.16, -0.02], [-0.18, -0.08]], 0.02, '#1a1a22')
  ell(c, -0.28, -0.15, 0.18, 0.14, lin(c, -0.46, 0, -0.1, 0, [[0, '#2a2a34'], [0.4, '#4a4a58'], [1, '#141418']]))
  ell(c, -0.28, -0.26, 0.18, 0.04, '#3a3a46')
  ell(c, -0.28, -0.26, 0.155, 0.03, '#5ce04a')
  for (let i = 0; i < 6; i++) {
    const k = (t * 0.8 + i * 0.17) % 1
    const bx = -0.28 + Math.sin(i * 2.3) * 0.1
    ell(c, bx, -0.27 - k * 0.22, 0.012 * (1 - k) + 0.008, 0.012 * (1 - k) + 0.008, `rgba(130,240,100,${1 - k})`)
  }
  glow(c, -0.28, -0.34, 0.2, 'rgba(120,255,90,0.25)', 'rgba(120,255,90,0)')
  if (a > 0.05) for (let i = 0; i < 5; i++) ell(c, -0.42 - i * 0.12 * (0.5 + a), -0.42 - Math.sin(i + t * 3) * 0.04, 0.05 + i * 0.02, 0.04 + i * 0.015, `rgba(110,220,80,${0.45 * a})`)
}

/** A pirate king in a red coat, cutlass raised, with a peg leg and a parrot. */
function pirate(c: Ctx, t: number, a: number): void {
  const coat = '#a82a2a'
  const trim = '#e8b33a'
  const skin = '#e2ad86'
  const beard = '#2a1e18'
  const b = Math.sin(t * 2.2) * 0.01
  shadowUnder(c, 0.3)
  poly(c, [[-0.12, -0.2], [-0.04, -0.2], [-0.04, 0], [-0.15, 0], [-0.15, -0.04]], '#1e1a18')
  line(c, [[0.07, -0.2], [0.07, -0.01]], 0.035, '#8a5a34')
  poly(c, [[-0.16, -0.62 + b], [0.16, -0.62 + b], [0.21, -0.17], [-0.21, -0.17]], lin(c, -0.21, 0, 0.21, 0, [[0, shade(coat, -0.3)], [0.5, coat], [1, shade(coat, -0.35)]]))
  line(c, [[-0.16, -0.62 + b], [-0.21, -0.17], [0.21, -0.17], [0.16, -0.62 + b]], 0.014, trim)
  line(c, [[0, -0.6 + b], [0, -0.18]], 0.01, shade(coat, -0.45))
  for (let i = 0; i < 4; i++) ell(c, -0.03, -0.55 + i * 0.09 + b, 0.012, 0.012, trim)
  poly(c, [[-0.05, -0.62 + b], [0.05, -0.62 + b], [0, -0.52 + b]], '#f4efe6')
  poly(c, [[-0.19, -0.38], [0.19, -0.38], [0.2, -0.33], [-0.2, -0.33]], '#2a1a12')
  ell(c, 0, -0.355, 0.03, 0.022, trim)
  limb(c, [[0.14, -0.58 + b], [0.23, -0.46], [0.13, -0.38]], 0.08, 0.065, coat)
  limb(c, [[-0.14, -0.58 + b], [-0.25, -0.5], [-0.29, -0.64]], 0.08, 0.065, coat)
  c.save()
  c.translate(-0.29, -0.65)
  c.rotate(-0.45 + a * 1.1)
  c.beginPath()
  c.moveTo(-0.012, 0)
  c.quadraticCurveTo(-0.07, -0.18, -0.02, -0.36)
  c.quadraticCurveTo(0.0, -0.2, 0.012, 0)
  c.closePath()
  c.fillStyle = lin(c, -0.05, 0, 0.02, 0, [[0, '#f4f6fb'], [1, '#9aa3b5']])
  c.fill()
  ell(c, 0, 0, 0.035, 0.014, trim)
  c.restore()
  ell(c, -0.29, -0.64, 0.03, 0.03, skin)
  ell(c, 0, -0.72 + b, 0.075, 0.075, skin)
  ell(c, 0, -0.655 + b, 0.085, 0.068, beard)
  for (const bx of [-0.04, 0.04]) {
    line(c, [[bx, -0.62 + b], [bx * 1.2, -0.54 + b]], 0.018, beard)
    ell(c, bx * 1.2, -0.535 + b, 0.012, 0.012, trim)
  }
  ell(c, -0.03, -0.735 + b, 0.011, 0.011, '#1a1a1a')
  line(c, [[-0.075, -0.765 + b], [0.075, -0.715 + b]], 0.008, '#1a1a1a')
  ell(c, 0.028, -0.73 + b, 0.022, 0.018, '#1a1a1a')
  ell(c, -0.005, -0.7 + b, 0.014, 0.012, shade(skin, -0.15))
  poly(c, [[-0.18, -0.77 + b], [-0.1, -0.85 + b], [0, -0.92 + b], [0.1, -0.85 + b], [0.18, -0.77 + b], [0, -0.8 + b]], '#1a1418')
  line(c, [[-0.18, -0.77 + b], [0, -0.8 + b], [0.18, -0.77 + b]], 0.012, trim)
  ell(c, 0, -0.855 + b, 0.02, 0.018, '#f4efe6')
  line(c, [[-0.025, -0.83 + b], [0.025, -0.81 + b]], 0.007, '#f4efe6')
  line(c, [[0.025, -0.83 + b], [-0.025, -0.81 + b]], 0.007, '#f4efe6')
  // The parrot on his shoulder.
  const pb = Math.abs(Math.sin(t * 3)) * 0.01
  ell(c, 0.16, -0.66 + b - pb, 0.035, 0.05, '#2eaa4a')
  poly(c, [[0.17, -0.62 + b], [0.22, -0.52 + b], [0.15, -0.61 + b]], '#1f8a3a')
  ell(c, 0.15, -0.72 + b - pb, 0.028, 0.028, '#e8342a')
  poly(c, [[0.125, -0.725 + b - pb], [0.1, -0.71 + b - pb], [0.125, -0.705 + b - pb]], '#ffd42a')
  ell(c, 0.148, -0.728 + b - pb, 0.006, 0.006, '#111')
}

/** A warlord in black plate: horned helm, glowing visor, greatsword and shield. */
function warlord(c: Ctx, t: number, a: number): void {
  const steel = '#6c7480'
  const dark = '#2c3038'
  const cape = '#8a1f1f'
  const gold = '#c9a24a'
  const plate = (x0: number, x1: number): CanvasGradient => lin(c, x0, 0, x1, 0, [[0, dark], [0.45, steel], [1, dark]])
  const sway = Math.sin(t * 1.4) * 0.03
  shadowUnder(c, 0.34)
  c.beginPath()
  c.moveTo(-0.13, -0.62)
  c.lineTo(0.16, -0.62)
  c.quadraticCurveTo(0.3, -0.3, 0.34 + sway, -0.02)
  c.lineTo(-0.02 + sway * 0.5, -0.02)
  c.closePath()
  c.fillStyle = lin(c, 0, -0.6, 0.3, 0, [[0, cape], [1, shade(cape, -0.4)]])
  c.fill()
  for (const lx of [-0.1, 0.03]) {
    poly(c, [[lx, -0.3], [lx + 0.08, -0.3], [lx + 0.08, -0.02], [lx, -0.02]], plate(lx, lx + 0.08))
    ell(c, lx + 0.04, -0.17, 0.045, 0.03, steel)
    poly(c, [[lx - 0.01, -0.02], [lx + 0.1, -0.02], [lx + 0.1, 0], [lx - 0.03, 0]], dark)
  }
  poly(c, [[-0.15, -0.62], [0.15, -0.62], [0.12, -0.3], [-0.12, -0.3]], plate(-0.15, 0.15))
  line(c, [[0, -0.6], [0, -0.32]], 0.01, shade(steel, 0.4))
  poly(c, [[-0.13, -0.34], [0.13, -0.34], [0.13, -0.3], [-0.13, -0.3]], gold)
  for (let i = 0; i < 4; i++) poly(c, [[-0.14 + i * 0.07, -0.3], [-0.08 + i * 0.07, -0.3], [-0.085 + i * 0.07, -0.2], [-0.135 + i * 0.07, -0.2]], plate(-0.14 + i * 0.07, -0.08 + i * 0.07))
  // The shield on the far arm.
  c.beginPath()
  c.moveTo(0.14, -0.58)
  c.lineTo(0.3, -0.58)
  c.quadraticCurveTo(0.31, -0.35, 0.22, -0.24)
  c.quadraticCurveTo(0.13, -0.35, 0.14, -0.58)
  c.fillStyle = lin(c, 0.14, 0, 0.3, 0, [[0, '#3a3e48'], [1, '#1a1c22']])
  c.fill()
  c.strokeStyle = gold
  c.lineWidth = 0.012
  c.stroke()
  star(c, 0.22, -0.46, 0.035, gold)
  ell(c, -0.15, -0.6, 0.08, 0.06, plate(-0.23, -0.07))
  ell(c, 0.15, -0.6, 0.08, 0.06, plate(0.07, 0.23))
  // The sword arm: the greatsword comes down when he strikes.
  limb(c, [[-0.14, -0.58], [-0.26, -0.5], [-0.28, -0.66]], 0.085, 0.07, steel)
  c.save()
  c.translate(-0.28, -0.67)
  c.rotate(-0.35 + a * 1.3)
  poly(c, [[-0.018, 0], [0.018, 0], [0.013, -0.5], [0, -0.56], [-0.013, -0.5]], lin(c, -0.02, 0, 0.02, 0, [[0, '#f4f6fb'], [1, '#8a93a5']]))
  poly(c, [[-0.06, 0.005], [0.06, 0.005], [0.06, 0.025], [-0.06, 0.025]], gold)
  line(c, [[0, 0.025], [0, 0.08]], 0.022, '#3a2a1a')
  ell(c, 0, 0.09, 0.018, 0.018, gold)
  c.restore()
  ell(c, 0, -0.72, 0.075, 0.085, lin(c, 0, -0.8, 0, -0.64, [[0, shade(steel, 0.3)], [1, dark]]))
  for (const side of [-1, 1]) limb(c, [[side * 0.06, -0.77], [side * 0.14, -0.84], [side * 0.15, -0.95]], 0.035, 0.005, '#e8dcc0')
  glow(c, 0, -0.72, 0.07, 'rgba(255,90,40,0.5)', 'rgba(255,90,40,0)')
  poly(c, [[-0.05, -0.735], [0.05, -0.735], [0.045, -0.715], [-0.045, -0.715]], '#ff5a2a')
  line(c, [[0, -0.715], [0, -0.66]], 0.008, '#1a1c22')
}

/** A giant with a club: a storm giant (thundercloud beard, lightning) or a frost titan (ice, icicles, cold breath). */
function giant(c: Ctx, t: number, a: number, frost: boolean): void {
  const skin = frost ? '#a8d8f0' : '#8e9aa6'
  const skinDark = shade(skin, -0.35)
  const cloth = frost ? '#eaf6fc' : '#6a4a2a'
  const b = Math.sin(t * 1.6) * 0.012
  shadowUnder(c, 0.36)
  limb(c, [[-0.1, -0.36], [-0.12, -0.18], [-0.12, -0.03]], 0.12, 0.1, skinDark)
  limb(c, [[0.1, -0.36], [0.12, -0.18], [0.13, -0.03]], 0.12, 0.1, skinDark)
  ell(c, -0.14, -0.02, 0.08, 0.03, frost ? '#d8eef8' : '#4a3a2a')
  ell(c, 0.15, -0.02, 0.08, 0.03, frost ? '#d8eef8' : '#4a3a2a')
  ell(c, 0, -0.5 + b, 0.22, 0.24, lin(c, -0.22, 0, 0.22, 0, [[0, skinDark], [0.45, shade(skin, 0.15)], [1, skinDark]]))
  poly(c, [[-0.2, -0.4], [0.2, -0.4], [0.17, -0.25], [0.08, -0.22], [0, -0.26], [-0.08, -0.22], [-0.17, -0.25]], cloth)
  poly(c, [[-0.21, -0.43], [0.21, -0.43], [0.21, -0.39], [-0.21, -0.39]], frost ? '#7ab8d8' : '#3a2a1a')
  if (frost) {
    for (const [sx, sy] of [[-0.18, -0.64], [0.18, -0.64]] as const) {
      for (let i = 0; i < 3; i++) poly(c, [[sx - 0.05 + i * 0.04, sy + 0.02], [sx - 0.035 + i * 0.04, sy - 0.08 - (i % 2) * 0.03], [sx - 0.015 + i * 0.04, sy + 0.02]], i % 2 ? '#e8f8ff' : '#bfe6fa')
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const bx = -0.1 + i * 0.1
      ell(c, bx, -0.36, 0.022, 0.026, '#e0b83a')
      ell(c, bx, -0.335, 0.008, 0.008, '#8a6414')
    }
  }
  // The club arm, raised over the shoulder toward the hero; it slams down when the giant strikes.
  limb(c, [[-0.16, -0.64 + b], [-0.28, -0.62], [-0.3, -0.76]], 0.1, 0.085, skin)
  c.save()
  c.translate(-0.3, -0.78)
  c.rotate(0.55 - a * 1.4)
  if (frost) {
    poly(c, [[-0.03, 0.04], [0.03, 0.04], [0.07, -0.3], [0.02, -0.42], [-0.05, -0.34]], lin(c, -0.05, 0, 0.07, 0, [[0, '#dff4ff'], [1, '#7ab8e0']]))
    for (let i = 0; i < 4; i++) star(c, -0.02 + (i % 2) * 0.06, -0.08 - i * 0.08, 0.012, 'rgba(255,255,255,0.9)')
  } else {
    limb(c, [[0, 0.05], [0.01, -0.18], [0.03, -0.4]], 0.07, 0.11, '#6a4a2a')
    for (const ky of [-0.12, -0.26]) ell(c, 0.01, ky, 0.02, 0.015, '#4a3220')
    if (Math.sin(t * 6) > 0.3 || a > 0.05) bolt(c, [0.03, -0.42], [-0.02, -0.1], t, 0.008, '#e8f8ff')
  }
  c.restore()
  ell(c, -0.3, -0.76, 0.045, 0.04, skin)
  limb(c, [[0.16, -0.64 + b], [0.26, -0.48], [0.24, -0.34]], 0.1, 0.085, skin)
  ell(c, 0.24, -0.33, 0.045, 0.045, skin)
  const hy = -0.84 + b
  if (!frost) for (let i = 0; i < 5; i++) ell(c, -0.06 + i * 0.03, hy - 0.07 - (i % 2) * 0.02, 0.035, 0.03, '#8a8a92')
  ell(c, 0, hy, 0.085, 0.08, skin)
  poly(c, [[-0.07, hy - 0.03], [0.07, hy - 0.03], [0.06, hy - 0.05], [-0.06, hy - 0.05]], skinDark)
  const eye = frost ? '#e8fbff' : '#ffd42a'
  ell(c, -0.03, hy - 0.015, 0.012, 0.009, eye)
  ell(c, 0.03, hy - 0.015, 0.012, 0.009, eye)
  ell(c, -0.005, hy + 0.012, 0.018, 0.022, shade(skin, -0.15))
  if (frost) {
    for (let i = 0; i < 7; i++) poly(c, [[-0.075 + i * 0.022, hy + 0.035], [-0.064 + i * 0.022, hy + 0.13 + (i % 2) * 0.05], [-0.053 + i * 0.022, hy + 0.035]], i % 2 ? '#e8f8ff' : '#bfe6fa')
    for (let i = 0; i < 5; i++) poly(c, [[-0.06 + i * 0.03, hy - 0.06], [-0.045 + i * 0.03, hy - 0.14 - (i % 2) * 0.04], [-0.03 + i * 0.03, hy - 0.06]], '#e8f8ff')
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.7 + i / 3) % 1
      ell(c, -0.08 - k * 0.12, hy + 0.03 - k * 0.04, 0.02 + k * 0.03, 0.015 + k * 0.02, `rgba(240,250,255,${0.6 * (1 - k)})`)
    }
    if (a > 0.05) breath(c, [-0.08, hy + 0.03], 0.25 + 0.7 * a, 0.12 * a + 0.03, t, 'rgba(255,255,255,0.95)', 'rgba(190,235,255,0.85)', 'rgba(150,210,255,0)')
  } else {
    for (let i = 0; i < 7; i++) ell(c, -0.08 + (i % 4) * 0.055, hy + 0.06 + Math.floor(i / 4) * 0.05, 0.045, 0.04, i % 2 ? '#4a4e5a' : '#5a5e6a')
    if (Math.sin(t * 4.3) > 0.7) bolt(c, [-0.04, hy + 0.05], [0.02, hy + 0.13], t, 0.006, '#fff6a0')
    if (a > 0.05) bolt(c, [-0.36, -1.15], [-0.85, -0.02], t, 0.018, '#e8f8ff')
  }
}

/** A lich in a tattered robe, a crowned skull with cold blue fire for eyes, floating on mist. */
function lich(c: Ctx, t: number, a: number): void {
  const robe = '#3e2450'
  const bone = '#e8e2d0'
  const f = -0.06 + Math.sin(t * 1.2) * 0.02
  for (let i = 0; i < 5; i++) ell(c, -0.24 + i * 0.12 + Math.sin(t + i) * 0.02, -0.02, 0.12, 0.035, 'rgba(170,210,230,0.22)')
  c.translate(0, f)
  const sw = Math.sin(t * 1.8) * 0.02
  c.beginPath()
  c.moveTo(-0.14, -0.64)
  c.lineTo(0.14, -0.64)
  c.quadraticCurveTo(0.2, -0.3, 0.24 + sw, -0.08)
  for (let i = 1; i <= 8; i++) c.lineTo(0.24 + sw - i * 0.06, (i % 2 ? 0.0 : -0.08) + Math.sin(t * 3 + i) * 0.01)
  c.quadraticCurveTo(-0.2, -0.3, -0.14, -0.64)
  c.fillStyle = lin(c, -0.24, 0, 0.24, 0, [[0, '#24142e'], [0.5, robe], [1, '#1c1024']])
  c.fill()
  poly(c, [[-0.05, -0.62], [0.05, -0.62], [0.03, -0.34], [-0.03, -0.34]], '#140a1a')
  for (let i = 0; i < 4; i++) {
    c.strokeStyle = bone
    c.lineWidth = 0.01
    c.beginPath()
    c.arc(0, -0.6 + i * 0.06, 0.04, 0.15 * Math.PI, 0.85 * Math.PI)
    c.stroke()
  }
  // The raised hand, holding cold fire.
  limb(c, [[0.12, -0.6], [0.22, -0.52], [0.24, -0.66]], 0.07, 0.05, robe)
  line(c, [[0.24, -0.66], [0.24, -0.72]], 0.02, bone)
  glow(c, 0.24, -0.76, 0.06 + Math.sin(t * 6) * 0.01, 'rgba(160,240,255,0.9)', 'rgba(80,160,255,0)')
  // The staff arm and its glowing skull.
  limb(c, [[-0.12, -0.6], [-0.22, -0.5], [-0.26, -0.62]], 0.07, 0.05, robe)
  line(c, [[-0.27, -0.06], [-0.26, -0.96]], 0.02, '#2a1a2a')
  for (let i = 0; i < 3; i++) line(c, [[-0.28 + i * 0.012, -0.6], [-0.285 + i * 0.012, -0.64]], 0.009, bone)
  glow(c, -0.26, -1.0, 0.1, 'rgba(140,255,200,0.55)', 'rgba(80,200,180,0)')
  ell(c, -0.26, -1.0, 0.035, 0.035, bone)
  ell(c, -0.272, -1.0, 0.009, 0.01, '#1a2a2a')
  ell(c, -0.248, -1.0, 0.009, 0.01, '#1a2a2a')
  if (a > 0.05) {
    const k = 1 - a
    glow(c, -0.3 - k * 0.6, -0.95 + k * 0.35, 0.07, 'rgba(200,250,255,0.95)', 'rgba(80,180,255,0)')
    ell(c, -0.3 - k * 0.6, -0.95 + k * 0.35, 0.03, 0.03, 'rgba(240,250,255,0.9)')
  }
  // The skull, hooded and crowned.
  ell(c, 0, -0.73, 0.1, 0.1, '#1c1024')
  ell(c, 0, -0.72, 0.068, 0.075, bone)
  poly(c, [[-0.045, -0.67], [0.045, -0.67], [0.035, -0.63], [-0.035, -0.63]], shade(bone, -0.1))
  for (let i = 0; i < 4; i++) line(c, [[-0.03 + i * 0.02, -0.67], [-0.03 + i * 0.02, -0.64]], 0.006, '#6a6258')
  for (const ex of [-0.027, 0.027]) {
    ell(c, ex, -0.735, 0.02, 0.018, '#140a1a')
    glow(c, ex, -0.735, 0.022 + Math.sin(t * 9 + ex * 40) * 0.004, 'rgba(140,230,255,1)', 'rgba(60,140,255,0)')
  }
  ell(c, 0, -0.705, 0.008, 0.01, '#3a3028')
  poly(c, [[-0.07, -0.79], [-0.06, -0.85], [-0.035, -0.81], [0, -0.87], [0.035, -0.81], [0.06, -0.85], [0.07, -0.79]], '#d4a02a')
  ell(c, 0, -0.81, 0.012, 0.012, '#e8342a')
}

/** A fat goblin king in three stolen crowns and a curtain cape, waving a ladle for a sceptre. */
function goblin(c: Ctx, t: number, a: number): void {
  const skin = '#72b04a'
  const dark = shade(skin, -0.35)
  const wob = Math.sin(t * 3) * 0.02
  shadowUnder(c, 0.34)
  c.beginPath()
  c.moveTo(-0.16, -0.54)
  c.lineTo(0.16, -0.54)
  c.quadraticCurveTo(0.34, -0.3, 0.3, -0.03)
  c.lineTo(-0.26, -0.03)
  c.quadraticCurveTo(-0.3, -0.3, -0.16, -0.54)
  c.fillStyle = lin(c, -0.3, 0, 0.3, 0, [[0, '#8a1a2a'], [0.5, '#c0283a'], [1, '#7a1424']])
  c.fill()
  for (let i = 0; i < 6; i++) ell(c, -0.24 + i * 0.1, -0.03, 0.014, 0.02, '#e8c46a')
  limb(c, [[-0.1, -0.2], [-0.11, -0.04]], 0.08, 0.07, dark)
  limb(c, [[0.1, -0.2], [0.11, -0.04]], 0.08, 0.07, dark)
  ell(c, -0.14, -0.02, 0.07, 0.03, dark)
  ell(c, 0.15, -0.02, 0.07, 0.03, dark)
  ell(c, 0, -0.34, 0.24, 0.25, lin(c, -0.24, 0, 0.24, 0, [[0, dark], [0.45, shade(skin, 0.2)], [1, dark]]))
  ell(c, -0.02, -0.3, 0.14, 0.15, shade(skin, 0.3))
  poly(c, [[-0.23, -0.28], [0.23, -0.28], [0.22, -0.23], [-0.22, -0.23]], '#4a2a1a')
  ell(c, 0, -0.255, 0.04, 0.03, '#e8c46a')
  limb(c, [[0.2, -0.44], [0.3, -0.36], [0.22, -0.3]], 0.075, 0.06, skin)
  limb(c, [[-0.18, -0.46], [-0.3, -0.42], [-0.33, -0.55]], 0.075, 0.06, skin)
  c.save()
  c.translate(-0.33, -0.56)
  c.rotate(-0.3 + a * 1.2)
  line(c, [[0, 0.03], [0, -0.3]], 0.018, '#b8c0cc')
  ell(c, 0, -0.33, 0.045, 0.035, '#b8c0cc')
  ell(c, 0, -0.335, 0.032, 0.022, '#6a7280')
  c.restore()
  ell(c, -0.33, -0.55, 0.03, 0.03, skin)
  const hy = -0.7
  poly(c, [[-0.12, hy - 0.04], [-0.33, hy - 0.08], [-0.13, hy + 0.04]], skin)
  poly(c, [[0.12, hy - 0.04], [0.33, hy - 0.08], [0.13, hy + 0.04]], skin)
  poly(c, [[-0.13, hy - 0.02], [-0.27, hy - 0.06], [-0.13, hy + 0.02]], '#e89a9a')
  poly(c, [[0.13, hy - 0.02], [0.27, hy - 0.06], [0.13, hy + 0.02]], '#e89a9a')
  ell(c, 0, hy, 0.16, 0.14, lin(c, 0, hy - 0.14, 0, hy + 0.14, [[0, shade(skin, 0.15)], [1, dark]]))
  ell(c, -0.06, hy - 0.035, 0.028, 0.022, '#ffe04a')
  ell(c, 0.05, hy - 0.035, 0.028, 0.022, '#ffe04a')
  ell(c, -0.06, hy - 0.035, 0.009, 0.012, '#c01a1a')
  ell(c, 0.05, hy - 0.035, 0.009, 0.012, '#c01a1a')
  ell(c, -0.01, hy + 0.01, 0.04, 0.032, dark)
  c.strokeStyle = '#2a1a0a'
  c.lineWidth = 0.012
  c.beginPath()
  c.arc(-0.005, hy + 0.035, 0.07, 0.12 * Math.PI, 0.88 * Math.PI)
  c.stroke()
  poly(c, [[0.02, hy + 0.1], [0.045, hy + 0.1], [0.035, hy + 0.14]], '#fffbe8')
  crown(c, wob, hy - 0.14, 0.11)
  crown(c, 0.01 - wob, hy - 0.22, 0.085)
  crown(c, wob * 1.5, hy - 0.285, 0.065)
}

function crown(c: Ctx, x: number, y: number, w: number): void {
  poly(c, [[x - w, y + 0.03], [x - w, y - 0.04], [x - w * 0.5, y], [x, y - 0.06], [x + w * 0.5, y], [x + w, y - 0.04], [x + w, y + 0.03]], '#e0b83a')
  ell(c, x, y + 0.005, 0.012, 0.012, '#3a8ae8')
  ell(c, x - w * 0.6, y + 0.01, 0.009, 0.009, '#e8342a')
  ell(c, x + w * 0.6, y + 0.01, 0.009, 0.009, '#2ecc5a')
}
