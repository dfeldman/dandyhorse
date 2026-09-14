/**
 * The workshop: the hero at a cauldron, an anvil or a grindstone, working as hard as the player pedals (the fire,
 * the bubbles, the hammer blows and the wheel all keep pace). Above the work, the thing being made fills in as the
 * meter fills; each one made jumps onto the shelf.
 */
import type { ItemDef, PotionSpec, Recipe } from '../content/types.ts'
import type { Engine } from '../engine/engine.ts'
import type { CraftMode } from '../engine/modes/craft.ts'
import * as R from '../engine/rules.ts'
import { STATION_VERB, craftTime, station } from '../engine/text.ts'
import type { Station } from '../engine/text.ts'
import { drawHero, styleOf } from './hero.ts'
import type { Rect, Stage } from './stage.ts'
import { bar, clamp, emoji, glass, label, rgba } from './stage.ts'

interface Spark { x: number; y: number; vx: number; vy: number; g: number; life: number; color: string; size: number }
interface Pop { emoji: string; life: number; burst: boolean }

const POP_LIFE = 1.1
/** Odds and ends on the wall shelf, by station. */
const TOOLS: Record<Station, string[]> = { brew: ['🌿', '🍄', '🫙', '🧂'], forge: ['🔨', '⛓️', '🪝', '🔩'], make: ['🧵', '🪵', '🪚', '📐'] }

/** The brew's colour, by what the potion does. */
function brewColor(p: PotionSpec | undefined): string {
  if (p?.effect === 'damage') return { fire: '#ff8a2a', ice: '#7fd8ff', storm: '#b58cff', holy: '#fff2a8', poison: '#6fdc4a' }[p.element ?? 'fire']
  const by: Partial<Record<string, string>> = { heal: '#ff5a6e', might: '#ff7a3a', shield: '#8fd0ff', haste: '#8fffcf', travel: '#a8d86a', stat: '#c9a0ff' }
  return (p && by[p.effect]) ?? '#8fd0ff'
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fill()
}

export class CraftView {
  private sparks: Spark[] = []
  private pops: Pop[] = []
  /** Counts hammer blows, which come faster the harder the player pedals. */
  private beat = 0
  private spin = 0
  private swing = 0

  /** One was made: it jumps from the work onto the shelf. */
  made(item: ItemDef): void {
    this.pops.push({ emoji: item.emoji, life: POP_LIFE, burst: false })
  }

  draw(stage: Stage, e: Engine, m: CraftMode, highlight: string | null, t: number, dt: number): void {
    const c = stage.ctx
    const V = stage.view
    const compact = V.w < 520 || V.h < 360
    const shown = highlight?.startsWith('make:') ? R.recipeFor(e.world, highlight.slice(5)) : undefined
    const recipe = m.recipe ?? shown ?? R.recipes(e.world)[0]
    const item = recipe ? e.world.item(recipe.item) : null
    const kind: Station = item ? station(item) : 'make'
    const working = m.recipe !== null
    const effort = working ? Math.max(0, e.effort) : 0

    const floor = V.y + V.h * (compact ? 0.86 : 0.76)
    const s = compact ? clamp(V.h * 0.3, 44, 140) : clamp(V.h * 0.28, 100, 220)
    const sx = V.x + V.w * 0.54
    this.room(c, stage, V, floor, sx, kind, effort, compact)

    const before = Math.floor(this.beat)
    this.beat += dt * (0.5 + effort * 1.4)
    this.spin += dt * effort * 7
    this.swing = Math.max(0, this.swing - dt * 5)
    if (kind === 'brew') this.cauldron(c, sx, floor, s, t, effort, brewColor(item?.potion))
    else if (kind === 'forge') {
      if (working && effort > 0.05 && Math.floor(this.beat) > before) {
        this.swing = 1
        this.burst(sx, floor - s * 0.5, 12, ['#ffd42a', '#ff8a2a', '#fff2c0'], s)
      }
      this.anvil(c, sx, floor, s, effort)
    } else {
      if (working && Math.random() < dt * effort * 18) this.burst(sx + s * 0.23, floor - s * 0.88, 1, ['#fff2c0', '#ffd42a'], s)
      this.grindstone(c, sx, floor, s)
    }
    drawHero(c, sx - s * 0.95, floor, s * 1.1, t, {
      walking: effort > 0.05, speed: 3 + effort * 5, lunge: kind === 'forge' ? this.swing * s * 0.1 : 0, style: styleOf(e.save),
    })
    // The keeper looks on from beside the shelf.
    const keeper = m.town.workshop?.keeper
    if (keeper) emoji(c, keeper.emoji, V.x + V.w * (compact ? 0.88 : 0.86), floor - s * 0.36 + Math.sin(t * 1.8) * 2, s * 0.62)
    if (!compact) this.sign(c, m.name, V.x + V.w * 0.16, V.y + V.h * 0.17 + 34, s)

    // The thing being made, above the work: faint at first, solid when done, in a ring that fills with the meter.
    const iy = floor - s * 1.3
    if (item && recipe) {
      const k = working ? m.progress : 0
      const r = s * 0.34
      c.save()
      c.lineWidth = Math.max(3, s * 0.045)
      c.strokeStyle = 'rgba(255,255,255,0.22)'
      c.beginPath()
      c.arc(sx, iy, r, 0, Math.PI * 2)
      c.stroke()
      if (working) {
        c.strokeStyle = '#ffd42a'
        c.lineCap = 'round'
        c.beginPath()
        c.arc(sx, iy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k)
        c.stroke()
      }
      c.globalAlpha = working ? 0.3 + 0.7 * k : R.canCraft(e.save, recipe) ? 0.95 : 0.45
      emoji(c, item.emoji, sx, iy + Math.sin(t * 2) * 3, s * (working ? 0.3 + 0.2 * k : 0.42))
      c.restore()
    }

    // What has been made, on a shelf to the right.
    const shelfX = V.x + V.w * (compact ? 0.87 : 0.84)
    const shelfY = V.y + V.h * (compact ? 0.52 : 0.46)
    this.shelf(c, m.lastMade ? e.world.item(m.lastMade).emoji : null, m.made, shelfX, shelfY, s, compact)
    this.pops = this.pops.filter((p) => (p.life -= dt) > 0)
    for (const p of this.pops) {
      if (!p.burst) {
        p.burst = true
        this.burst(sx, iy, 18, ['#ffd42a', '#ffffff', '#8ff08f'], s)
      }
      const k = 1 - p.life / POP_LIFE
      emoji(c, p.emoji, sx + (shelfX - sx) * k, iy + (shelfY - iy) * k - Math.sin(k * Math.PI) * s * 0.5, s * 0.42 * (1 + 0.35 * Math.sin(k * Math.PI)))
    }
    this.drawSparks(c, dt)

    this.plate(c, V, e, recipe, item, working, compact)
    if (working && recipe && item) this.meter(c, V, m, recipe, item, effort, compact)
    else if (m.message && !compact) {
      const y = V.y + V.h - 36
      c.save()
      c.font = '700 18px "Baloo 2", sans-serif'
      const w = Math.min(V.w - 40, c.measureText(m.message).width + 40)
      c.restore()
      glass(c, V.x + (V.w - w) / 2, y - 20, w, 40, 20)
      label(c, m.message, V.x + V.w / 2, y, { size: 18, color: '#fff8e6', maxWidth: w - 24 })
    }
  }

  /** A timber-framed workshop with a window, a shelf of odds and ends, and warm light from the work. */
  private room(c: CanvasRenderingContext2D, stage: Stage, V: Rect, floor: number, sx: number, kind: Station, effort: number, compact: boolean): void {
    const wall = c.createLinearGradient(0, 0, 0, floor)
    wall.addColorStop(0, '#4a3428')
    wall.addColorStop(1, '#86624a')
    c.fillStyle = wall
    c.fillRect(0, 0, stage.w, floor)
    const wx = V.x + V.w * 0.12
    const wy = V.y + V.h * 0.2
    const ww = Math.min(V.w * 0.13, 140)
    const sky = c.createLinearGradient(0, wy, 0, wy + ww * 1.1)
    sky.addColorStop(0, '#9fd4ff')
    sky.addColorStop(1, '#e8f4ff')
    c.fillStyle = sky
    c.fillRect(wx, wy, ww, ww * 1.1)
    c.fillStyle = '#3a2618'
    c.fillRect(wx + ww / 2 - 3, wy, 6, ww * 1.1)
    c.fillRect(wx, wy + ww * 0.55 - 3, ww, 6)
    c.strokeStyle = '#3a2618'
    c.lineWidth = 6
    c.strokeRect(wx, wy, ww, ww * 1.1)
    c.fillStyle = 'rgba(255,245,210,0.07)'
    c.beginPath()
    c.moveTo(wx, wy + ww * 1.1)
    c.lineTo(wx + ww, wy + ww * 1.1)
    c.lineTo(wx + ww * 2.4, floor)
    c.lineTo(wx + ww * 0.6, floor)
    c.closePath()
    c.fill()
    c.fillStyle = '#34200f'
    for (let i = 0; i <= 4; i++) c.fillRect(V.x + (V.w * i) / 4 - 6, 0, 12, floor)
    c.fillRect(0, V.y + V.h * 0.1, stage.w, 12)
    if (!compact) {
      const shY = V.y + V.h * 0.44
      c.fillStyle = '#4a2c16'
      c.fillRect(V.x + V.w * 0.05, shY, V.w * 0.2, 8)
      TOOLS[kind].forEach((em, i) => emoji(c, em, V.x + V.w * (0.075 + i * 0.05), shY - 14, Math.min(26, V.w * 0.035)))
    }
    c.fillStyle = '#4a3222'
    c.fillRect(0, floor, stage.w, stage.h - floor)
    c.strokeStyle = 'rgba(0,0,0,0.25)'
    c.lineWidth = 2
    for (let y = floor + 12, i = 0; y < stage.h; y += 16 + i * 6, i++) {
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(stage.w, y)
      c.stroke()
    }
    const glow = c.createRadialGradient(sx, floor - V.h * 0.15, 10, sx, floor - V.h * 0.15, V.h * 0.6)
    glow.addColorStop(0, `rgba(255,170,80,${0.1 + 0.2 * Math.min(1.5, effort)})`)
    glow.addColorStop(1, 'rgba(255,170,80,0)')
    c.fillStyle = glow
    c.fillRect(0, 0, stage.w, stage.h)
  }

  /** A pot on a fire that burns higher, and bubbles faster, the harder you pedal. */
  private cauldron(c: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, effort: number, color: string): void {
    c.fillStyle = '#5a3a22'
    for (const a of [-0.25, 0.25]) {
      c.save()
      c.translate(x, y - s * 0.03)
      c.rotate(a)
      c.fillRect(-s * 0.3, -s * 0.03, s * 0.6, s * 0.06)
      c.restore()
    }
    const flame = s * (0.1 + 0.2 * Math.min(2, effort))
    for (let i = -2; i <= 2; i++) {
      const fx = x + i * s * 0.1
      const fh = flame * (0.75 + 0.25 * Math.sin(t * 13 + i * 2.1))
      const g = c.createLinearGradient(0, y, 0, y - fh * 1.3)
      g.addColorStop(0, 'rgba(255,200,70,0.95)')
      g.addColorStop(1, 'rgba(255,70,20,0)')
      c.fillStyle = g
      c.beginPath()
      c.moveTo(fx - s * 0.06, y - s * 0.02)
      c.quadraticCurveTo(fx, y - fh * 1.3, fx + s * 0.06, y - s * 0.02)
      c.closePath()
      c.fill()
    }
    const py = y - s * 0.36
    c.fillStyle = '#1a1a20'
    for (const dx of [-0.28, 0.28]) c.fillRect(x + dx * s - s * 0.03, py + s * 0.18, s * 0.06, s * 0.14)
    const body = c.createRadialGradient(x - s * 0.15, py - s * 0.1, s * 0.05, x, py, s * 0.5)
    body.addColorStop(0, '#5a5a68')
    body.addColorStop(1, '#141418')
    c.fillStyle = body
    c.beginPath()
    c.ellipse(x, py, s * 0.46, s * 0.33, 0, 0, Math.PI * 2)
    c.fill()
    const ry = py - s * 0.25
    c.fillStyle = '#2a2a34'
    c.beginPath()
    c.ellipse(x, ry, s * 0.44, s * 0.1, 0, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = color
    c.beginPath()
    c.ellipse(x, ry + s * 0.012, s * 0.37, s * 0.07, 0, 0, Math.PI * 2)
    c.fill()
    const sheen = c.createRadialGradient(x, ry, 1, x, ry, s * 0.5)
    sheen.addColorStop(0, rgba(color, 0.45))
    sheen.addColorStop(1, rgba(color, 0))
    c.fillStyle = sheen
    c.fillRect(x - s * 0.5, ry - s * 0.5, s, s * 0.6)
    const rate = 0.5 + Math.min(2, effort)
    const n = 3 + Math.round(Math.min(2, effort) * 5)
    for (let i = 0; i < n; i++) {
      const cycle = t * rate + i * 0.37
      const ph = cycle % 1
      c.fillStyle = rgba(color, 0.9 * (1 - ph))
      dot(c, x + Math.sin(i * 12.9 + Math.floor(cycle) * 4.1) * s * 0.28, ry - ph * s * 0.45, s * (0.018 + 0.012 * (i % 3)))
    }
  }

  /** An anvil with hot metal on it, before a forge whose coals glow brighter the harder you pedal. */
  private anvil(c: CanvasRenderingContext2D, x: number, y: number, s: number, effort: number): void {
    const fx = x + s * 0.62
    c.fillStyle = '#6a3a2a'
    c.beginPath()
    c.roundRect(fx - s * 0.32, y - s * 0.95, s * 0.64, s * 0.95, [s * 0.1, s * 0.1, 0, 0])
    c.fill()
    c.strokeStyle = 'rgba(0,0,0,0.25)'
    c.lineWidth = 2
    for (let i = 1; i < 6; i++) {
      const by = y - (s * 0.95 * i) / 6
      c.beginPath()
      c.moveTo(fx - s * 0.32, by)
      c.lineTo(fx + s * 0.32, by)
      c.stroke()
    }
    const heat = Math.min(1, 0.25 + effort * 0.5)
    const mouth = c.createRadialGradient(fx, y - s * 0.3, 2, fx, y - s * 0.3, s * 0.3)
    mouth.addColorStop(0, `rgba(255,220,120,${heat})`)
    mouth.addColorStop(0.6, `rgba(255,90,20,${heat * 0.8})`)
    mouth.addColorStop(1, 'rgba(60,10,0,0.9)')
    c.fillStyle = mouth
    c.beginPath()
    c.roundRect(fx - s * 0.2, y - s * 0.5, s * 0.4, s * 0.36, [s * 0.18, s * 0.18, 4, 4])
    c.fill()
    const top = y - s * 0.46
    c.fillStyle = '#343842'
    c.beginPath()
    c.moveTo(x - s * 0.26, y)
    c.lineTo(x + s * 0.26, y)
    c.lineTo(x + s * 0.14, y - s * 0.12)
    c.lineTo(x - s * 0.14, y - s * 0.12)
    c.closePath()
    c.fill()
    c.fillRect(x - s * 0.09, y - s * 0.34, s * 0.18, s * 0.23)
    c.beginPath()
    c.moveTo(x - s * 0.5, top + s * 0.04)
    c.quadraticCurveTo(x - s * 0.36, top + s * 0.02, x - s * 0.28, top)
    c.lineTo(x + s * 0.32, top)
    c.lineTo(x + s * 0.32, top + s * 0.13)
    c.lineTo(x - s * 0.24, top + s * 0.13)
    c.quadraticCurveTo(x - s * 0.34, top + s * 0.1, x - s * 0.5, top + s * 0.04)
    c.fill()
    c.fillStyle = '#6a7282'
    c.fillRect(x - s * 0.28, top, s * 0.6, s * 0.025)
    const hot = c.createRadialGradient(x, top - s * 0.03, 1, x, top - s * 0.03, s * 0.2)
    hot.addColorStop(0, `rgba(255,200,90,${0.5 + 0.4 * heat})`)
    hot.addColorStop(1, 'rgba(255,120,30,0)')
    c.fillStyle = hot
    c.fillRect(x - s * 0.2, top - s * 0.23, s * 0.4, s * 0.4)
    c.fillStyle = '#ffb347'
    c.beginPath()
    c.roundRect(x - s * 0.13, top - s * 0.05, s * 0.26, s * 0.05, s * 0.02)
    c.fill()
  }

  /** A workbench with a treadle grindstone that turns as fast as you pedal. */
  private grindstone(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const benchY = y - s * 0.4
    c.fillStyle = '#6a4424'
    for (const dx of [-0.5, 0.46]) c.fillRect(x + dx * s, benchY, s * 0.06, s * 0.4)
    c.fillStyle = '#8a5a30'
    c.fillRect(x - s * 0.56, benchY - s * 0.06, s * 1.1, s * 0.08)
    c.fillStyle = '#a8703c'
    c.fillRect(x - s * 0.56, benchY - s * 0.06, s * 1.1, s * 0.02)
    const wx = x + s * 0.05
    const wy = benchY - s * 0.3
    const r = s * 0.26
    c.fillStyle = '#5a4630'
    c.fillRect(wx - s * 0.03, wy, s * 0.06, s * 0.26)
    const g = c.createRadialGradient(wx - r * 0.3, wy - r * 0.3, 2, wx, wy, r)
    g.addColorStop(0, '#c9c2b2')
    g.addColorStop(1, '#7a7466')
    c.fillStyle = g
    dot(c, wx, wy, r)
    c.strokeStyle = '#4a463e'
    c.lineWidth = Math.max(2, s * 0.02)
    for (let i = 0; i < 4; i++) {
      const a = this.spin + (i * Math.PI) / 2
      c.beginPath()
      c.moveTo(wx, wy)
      c.lineTo(wx + Math.cos(a) * r * 0.85, wy + Math.sin(a) * r * 0.85)
      c.stroke()
    }
    c.beginPath()
    c.arc(wx, wy, r, 0, Math.PI * 2)
    c.stroke()
    c.fillStyle = '#3a342a'
    dot(c, wx, wy, s * 0.035)
    emoji(c, '🪵', x - s * 0.38, benchY - s * 0.12, s * 0.16)
    emoji(c, '🧵', x + s * 0.42, benchY - s * 0.1, s * 0.14)
  }

  /** The workshop's name on a plank hung on the wall. */
  private sign(c: CanvasRenderingContext2D, name: string, x: number, y: number, s: number): void {
    const size = clamp(s * 0.1, 13, 22)
    c.save()
    c.font = `700 ${size}px Cinzel, Georgia, serif`
    const w = c.measureText(name).width + size * 1.6
    c.restore()
    const h = size * 1.8
    c.strokeStyle = '#2a1a0c'
    c.lineWidth = 2
    for (const dx of [-w * 0.3, w * 0.3]) {
      c.beginPath()
      c.moveTo(x + dx, y - h * 1.1)
      c.lineTo(x + dx, y - h / 2)
      c.stroke()
    }
    const g = c.createLinearGradient(0, y - h / 2, 0, y + h / 2)
    g.addColorStop(0, '#b07a44')
    g.addColorStop(1, '#7a4a22')
    c.fillStyle = g
    c.beginPath()
    c.roundRect(x - w / 2, y - h / 2, w, h, 8)
    c.fill()
    label(c, name, x, y + 1, { size, font: 'title', color: '#ffe9b0', stroke: 'rgba(58,36,16,0.8)' })
  }

  /** The things made so far, lined up on a shelf, with the count. */
  private shelf(c: CanvasRenderingContext2D, em: string | null, made: number, x: number, y: number, s: number, compact: boolean): void {
    const w = s * (compact ? 1.0 : 1.2)
    const h = Math.max(5, s * 0.05)
    c.fillStyle = '#4a2c16'
    c.fillRect(x - w / 2, y, w, h)
    c.fillStyle = 'rgba(0,0,0,0.25)'
    c.fillRect(x - w / 2, y + h, w, 4)
    if (!em || !made) return
    for (let i = 0; i < Math.min(made, 5); i++) emoji(c, em, x - w / 2 + (i + 0.5) * (w / 5), y - s * 0.1, s * 0.2)
    label(c, `×${made}`, x, y + s * 0.2, { size: clamp(s * 0.16, 12, 28), color: '#ffd42a', stroke: '#2a1400', weight: 900, font: 'title' })
  }

  /** Along the top: what is being made (or would be), and what each one uses, red where you are short. */
  private plate(c: CanvasRenderingContext2D, V: Rect, e: Engine, recipe: Recipe | undefined, item: ItemDef | null, working: boolean, compact: boolean): void {
    const w = compact ? V.w - 16 : Math.min(V.w * 0.8, 760)
    const x = V.x + (V.w - w) / 2
    const top = V.y + (compact ? 8 : 16)
    glass(c, x, top, w, compact ? 46 : 72, compact ? 12 : 16)
    const title = !item ? 'The workshop' : `${working ? STATION_VERB[station(item)] : 'Make'}: ${item.name}`
    label(c, `⚒️ ${title}`, x + w / 2, top + (compact ? 13 : 21), { size: compact ? 12 : 19, color: '#ffd42a', font: 'title', weight: 700, maxWidth: w - 20 })
    if (!recipe) return
    const y = top + (compact ? 32 : 50)
    const size = compact ? 11 : 16
    const needs = recipe.needs ?? []
    if (!needs.length) {
      label(c, `Pedaling alone makes it · ${craftTime(recipe.seconds)} each`, x + w / 2, y, { size, color: '#fff8e6', maxWidth: w - 20 })
      return
    }
    const chips = [
      ...needs.map((n) => {
        const have = R.count(e.save, n.item)
        return { text: `${e.world.item(n.item).emoji} ${have}/${n.qty}`, ok: have >= n.qty }
      }),
      { text: `⏱ ${craftTime(recipe.seconds)}`, ok: true },
    ]
    const step = Math.min(compact ? 72 : 120, (w - 20) / chips.length)
    chips.forEach((ch, i) => {
      label(c, ch.text, x + w / 2 + (i - (chips.length - 1) / 2) * step, y, { size, color: ch.ok ? '#fff8e6' : '#ff9a8a', maxWidth: step - 6 })
    })
  }

  /** The meter: this is what pedaling does. */
  private meter(c: CanvasRenderingContext2D, V: Rect, m: CraftMode, recipe: Recipe, item: ItemDef, effort: number, compact: boolean): void {
    if (compact) {
      bar(c, V.x + 12, V.y + V.h - 18, V.w - 24, 10, m.progress, '#ffd42a', '#e8890c')
      return
    }
    const mw = Math.min(V.w * 0.36, 420)
    const mx = V.x + V.w * 0.5 - mw / 2
    const my = V.y + V.h - 96
    glass(c, mx - 14, my - 12, mw + 28, 74, 14)
    label(c, `${item.emoji} Next ${item.name}`, mx, my + 2, { size: 15, color: '#ffd42a', align: 'left', maxWidth: mw * 0.65 })
    label(c, effort <= 0.05 ? 'Pedal!' : effort >= 1.25 ? 'Strong!' : 'Steady', mx + mw, my + 2, { size: 15, color: effort <= 0.05 ? '#ff6b5b' : '#e9dfc6', align: 'right' })
    bar(c, mx, my + 14, mw, 16, m.progress, '#ffd42a', '#e8890c')
    const left = ((1 - m.progress) * recipe.seconds) / Math.max(effort, 1e-6)
    label(c, effort > 0.05 ? `Done in about ${craftTime(Math.ceil(left))} at this pace` : 'Nothing happens until you pedal', mx + mw / 2, my + 46, { size: 13, color: '#e9dfc6' })
  }

  private burst(x: number, y: number, n: number, colors: string[], s: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = s * (0.6 + Math.random() * 1.4)
      this.sparks.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - s * 0.8, g: s * 5, life: 0.4 + Math.random() * 0.5,
        color: colors[i % colors.length], size: Math.max(1.5, s * 0.015),
      })
    }
  }

  private drawSparks(c: CanvasRenderingContext2D, dt: number): void {
    this.sparks = this.sparks.filter((p) => (p.life -= dt) > 0)
    for (const p of this.sparks) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.g * dt
      c.fillStyle = rgba(p.color, Math.min(1, p.life * 2))
      dot(c, p.x, p.y, p.size)
    }
  }
}
