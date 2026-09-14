/** Indoor and close-up scenes: the shop, the mayor's hall, a townsperson, the throne room, the title. */
import type { Town } from '../content/types.ts'
import type { Engine } from '../engine/engine.ts'
import type { MayorMode, NpcMode } from '../engine/modes/people.ts'
import type { ShopMode } from '../engine/modes/shop.ts'
import { CONFIG, KINGDOM } from '../config.ts'
import { STATS } from '../content/types.ts'
import type { CreatorMode } from '../engine/modes/creator.ts'
import { Rng, hashString } from '../engine/rng.ts'
import { STAT_INFO } from '../engine/text.ts'
import { drawHero, styleOf } from './hero.ts'
import { VARIANTS, drawScenery, pickScenery } from './nature.ts'
import type { Scenery } from './nature.ts'
import { PALETTES } from './palette.ts'
import type { Stage } from './stage.ts'
import { clamp, emoji, label, rgba, shade, shadow } from './stage.ts'

interface Confetti { x: number; y: number; vx: number; vy: number; rot: number; vr: number; color: string; life: number }

const BANNERS = ['#8f2a2a', '#2a4f8f', '#2f7a3a', '#7a2a8f', '#8f6a1a', '#1a6f7a']

export class RoomView {
  private confetti: Confetti[] = []

  celebrate(stage: Stage): void {
    const colors = ['#ffd42a', '#e8890c', '#ff6b5b', '#7fe0ff', '#8ff08f', '#ffffff']
    for (let i = 0; i < 180; i++) {
      this.confetti.push({
        x: Math.random() * stage.w, y: stage.view.y - Math.random() * 300, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 120,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, color: colors[i % colors.length], life: 6 + Math.random() * 4,
      })
    }
  }

  shop(stage: Stage, e: Engine, m: ShopMode, highlight: string | null, t: number): void {
    const c = stage.ctx
    const V = stage.view
    const wall = c.createLinearGradient(0, 0, 0, stage.h)
    wall.addColorStop(0, '#9a6840')
    wall.addColorStop(1, '#5a3a22')
    c.fillStyle = wall
    c.fillRect(0, 0, stage.w, stage.h)
    c.strokeStyle = 'rgba(0,0,0,0.14)'
    c.lineWidth = 2
    for (let x = 0; x < stage.w; x += 64) {
      c.beginPath()
      c.moveTo(x, 0)
      c.lineTo(x, stage.h)
      c.stroke()
    }
    const unit = Math.min(V.w, V.h)
    const shelfW = V.w * 0.56
    const sx = V.x + V.w * 0.05
    const stock = m.town.shop.stock
    const perShelf = Math.ceil(stock.length / 3)
    for (let row = 0; row < 3; row++) {
      const y = V.y + V.h * (0.2 + row * 0.16)
      c.fillStyle = '#4a2c16'
      c.fillRect(sx, y + unit * 0.045, shelfW, unit * 0.022)
      c.fillStyle = 'rgba(0,0,0,0.25)'
      c.fillRect(sx, y + unit * 0.067, shelfW, unit * 0.012)
      stock.slice(row * perShelf, (row + 1) * perShelf).forEach((entry, i) => {
        const x = sx + (i + 0.5) * (shelfW / perShelf)
        const item = e.world.item(entry.item)
        const on = highlight === `buy:${item.id}` || highlight === `sell:${item.id}`
        if (on) {
          const glow = c.createRadialGradient(x, y, 2, x, y, unit * 0.09)
          glow.addColorStop(0, 'rgba(255,230,120,0.9)')
          glow.addColorStop(1, 'rgba(255,230,120,0)')
          c.fillStyle = glow
          c.fillRect(x - unit * 0.1, y - unit * 0.1, unit * 0.2, unit * 0.2)
        }
        emoji(c, item.emoji, x, y + (on ? Math.sin(t * 6) * 3 : 0), unit * (on ? 0.085 : 0.07))
      })
    }
    for (const lx of [0.08, 0.64]) {
      const x = V.x + V.w * lx
      const glow = c.createRadialGradient(x, V.y + 40, 4, x, V.y + 40, 120)
      glow.addColorStop(0, `rgba(255,200,100,${0.35 + 0.08 * Math.sin(t * 7 + lx * 9)})`)
      glow.addColorStop(1, 'rgba(255,200,100,0)')
      c.fillStyle = glow
      c.fillRect(x - 120, V.y - 80, 240, 240)
      emoji(c, '🏮', x, V.y + 40, 36)
    }
    const keeperX = V.x + V.w * 0.8
    const counterY = V.y + V.h * 0.66
    emoji(c, m.town.shop.keeper.emoji, keeperX, counterY - unit * 0.14 + Math.sin(t * 1.8) * 3, unit * 0.3)
    const counter = c.createLinearGradient(0, counterY, 0, counterY + unit * 0.2)
    counter.addColorStop(0, '#7a4a26')
    counter.addColorStop(1, '#4a2c16')
    c.fillStyle = counter
    c.fillRect(0, counterY, stage.w, stage.h - counterY)
    c.fillStyle = '#9a6840'
    c.fillRect(0, counterY, stage.w, 8)
    signboard(c, m.town.shop.name, V.x + V.w * 0.36, V.y + V.h * 0.07, unit)
  }

  hall(stage: Stage, e: Engine, m: MayorMode, t: number): void {
    const c = stage.ctx
    const V = stage.view
    const unit = Math.min(V.w, V.h)
    const wall = c.createLinearGradient(0, 0, 0, stage.h)
    wall.addColorStop(0, '#7d8599')
    wall.addColorStop(1, '#4a5064')
    c.fillStyle = wall
    c.fillRect(0, 0, stage.w, stage.h)
    c.strokeStyle = 'rgba(0,0,0,0.12)'
    c.lineWidth = 2
    for (let y = 0, row = 0; y < stage.h; y += 40, row++) {
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(stage.w, y)
      c.stroke()
      for (let x = (row % 2) * 45; x < stage.w; x += 90) {
        c.beginPath()
        c.moveTo(x, y)
        c.lineTo(x, y + 40)
        c.stroke()
      }
    }
    for (const wx of [0.18, 0.82]) {
      const x = V.x + V.w * wx
      c.fillStyle = '#ffe9a8'
      c.beginPath()
      c.roundRect(x - unit * 0.05, V.y + V.h * 0.06, unit * 0.1, unit * 0.26, [unit * 0.05, unit * 0.05, 0, 0])
      c.fill()
      c.fillStyle = 'rgba(255,240,180,0.1)'
      c.beginPath()
      c.moveTo(x - unit * 0.05, V.y + V.h * 0.06 + unit * 0.26)
      c.lineTo(x + unit * 0.05, V.y + V.h * 0.06 + unit * 0.26)
      c.lineTo(x + unit * 0.2, stage.h)
      c.lineTo(x - unit * 0.1, stage.h)
      c.closePath()
      c.fill()
    }
    const color = BANNERS[hashString(m.town.id) % BANNERS.length]
    for (const bx of [0.34, 0.66]) {
      const x = V.x + V.w * bx
      const w = unit * 0.1
      const top = V.y + V.h * 0.04
      const h = unit * 0.34
      c.fillStyle = color
      c.beginPath()
      c.moveTo(x - w / 2, top)
      c.lineTo(x + w / 2, top)
      c.lineTo(x + w / 2, top + h)
      c.lineTo(x, top + h - w * 0.4)
      c.lineTo(x - w / 2, top + h)
      c.closePath()
      c.fill()
      c.fillStyle = '#ffd42a'
      c.fillRect(x - w / 2, top, w, 5)
      emoji(c, '👑', x, top + h * 0.35, w * 0.6)
    }
    const floorY = V.y + V.h * 0.62
    c.fillStyle = '#5a4a3a'
    c.fillRect(0, floorY, stage.w, stage.h - floorY)
    c.fillStyle = '#9a2a2a'
    c.beginPath()
    c.moveTo(V.x + V.w * 0.43, floorY)
    c.lineTo(V.x + V.w * 0.57, floorY)
    c.lineTo(V.x + V.w * 0.72, stage.h)
    c.lineTo(V.x + V.w * 0.28, stage.h)
    c.closePath()
    c.fill()
    c.fillStyle = '#6b5a48'
    c.fillRect(V.x + V.w * 0.3, floorY - unit * 0.04, V.w * 0.4, unit * 0.05)
    emoji(c, m.town.mayor.emoji, V.x + V.w * 0.5, floorY - unit * 0.16 + Math.sin(t * 1.6) * 3, unit * 0.3)
    signboard(c, `${m.town.name} Hall`, V.x + V.w * 0.5, V.y + V.h * 0.07, unit)
  }

  portrait(stage: Stage, e: Engine, m: NpcMode, t: number): void {
    this.closeUp(stage, m.town, m.npc.emoji, `${m.npc.name}, ${m.npc.role}`, t)
  }

  /** A townsperson against a soft view of their town. */
  closeUp(stage: Stage, town: Town, who: string, caption: string, t: number): void {
    const c = stage.ctx
    const V = stage.view
    const pal = PALETTES[town.biome]
    const unit = Math.min(V.w, V.h)
    const bg = c.createLinearGradient(0, 0, 0, stage.h)
    bg.addColorStop(0, pal.sky[0])
    bg.addColorStop(0.45, pal.sky[1])
    bg.addColorStop(0.46, pal.ground[0])
    bg.addColorStop(1, pal.ground[1])
    c.fillStyle = bg
    c.fillRect(0, 0, stage.w, stage.h)
    const rng = new Rng(hashString(`closeup:${town.id}`))
    for (let i = 0; i < 9; i++) {
      const x = V.x + ((i * 173 + hashString(town.id)) % V.w)
      const y = V.y + V.h * 0.42 + ((i * 37) % 30)
      if (i % 3) drawScenery(c, town.biome, pickScenery(rng, town.biome, 1), x, y + unit * 0.04, unit * 0.15)
      else emoji(c, '🏠', x, y, unit * 0.09)
    }
    for (let i = 0; i < 7; i++) {
      c.fillStyle = `rgba(255,255,255,${0.08 + 0.05 * Math.sin(t + i)})`
      c.beginPath()
      c.arc(V.x + ((i * 211) % V.w), V.y + ((i * 97) % (V.h * 0.5)), 30 + i * 6, 0, Math.PI * 2)
      c.fill()
    }
    const cx = V.x + V.w * 0.5
    const cy = V.y + V.h * 0.38
    const r = unit * 0.22
    c.save()
    c.shadowColor = 'rgba(0,0,0,0.35)'
    c.shadowBlur = 24
    const disk = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
    disk.addColorStop(0, '#fffaf0')
    disk.addColorStop(1, '#e9cf8f')
    c.fillStyle = disk
    c.beginPath()
    c.arc(cx, cy, r, 0, Math.PI * 2)
    c.fill()
    c.restore()
    c.lineWidth = 6
    c.strokeStyle = '#c9a24a'
    c.stroke()
    emoji(c, who, cx, cy + Math.sin(t * 1.8) * 3, r * 1.3)
    label(c, caption, cx, cy + r + 26, { size: clamp(unit * 0.035, 16, 26), font: 'title', color: '#fff8e6', stroke: '#2a1a00', weight: 700 })
  }

  throne(stage: Stage, e: Engine, t: number, dt: number, victory: boolean): void {
    const c = stage.ctx
    const V = stage.view
    const unit = Math.min(V.w, V.h)
    const bg = c.createLinearGradient(0, 0, 0, stage.h)
    bg.addColorStop(0, '#2a1440')
    bg.addColorStop(0.6, '#5a1f3a')
    bg.addColorStop(1, '#2a0f1f')
    c.fillStyle = bg
    c.fillRect(0, 0, stage.w, stage.h)
    for (const px of [0.1, 0.3, 0.7, 0.9]) {
      const x = V.x + V.w * px
      const g = c.createLinearGradient(x - 24, 0, x + 24, 0)
      g.addColorStop(0, '#8a6a2a')
      g.addColorStop(0.5, '#e8c46a')
      g.addColorStop(1, '#8a6a2a')
      c.fillStyle = g
      c.fillRect(x - 22, V.y, 44, V.h)
      emoji(c, '🕯️', x, V.y + V.h * 0.52 + Math.sin(t * 9 + px * 20) * 1.5, 30)
    }
    for (const bx of [0.2, 0.8]) {
      const x = V.x + V.w * bx
      c.fillStyle = '#8f1f2a'
      c.fillRect(x - unit * 0.05, V.y, unit * 0.1, unit * 0.36)
      emoji(c, '⚜️', x, V.y + unit * 0.14, unit * 0.07)
    }
    const floorY = V.y + V.h * 0.66
    c.fillStyle = '#3a1a2a'
    c.fillRect(0, floorY, stage.w, stage.h - floorY)
    c.fillStyle = '#b01e2e'
    c.beginPath()
    c.moveTo(V.x + V.w * 0.44, floorY)
    c.lineTo(V.x + V.w * 0.56, floorY)
    c.lineTo(V.x + V.w * 0.74, stage.h)
    c.lineTo(V.x + V.w * 0.26, stage.h)
    c.closePath()
    c.fill()
    const tx = V.x + V.w * 0.5
    const ty = floorY - unit * 0.02
    c.fillStyle = '#c9a24a'
    c.beginPath()
    c.roundRect(tx - unit * 0.13, ty - unit * 0.42, unit * 0.26, unit * 0.44, [unit * 0.12, unit * 0.12, 8, 8])
    c.fill()
    c.fillStyle = '#9a1e2e'
    c.beginPath()
    c.roundRect(tx - unit * 0.1, ty - unit * 0.37, unit * 0.2, unit * 0.37, [unit * 0.09, unit * 0.09, 4, 4])
    c.fill()
    emoji(c, '👑', tx, ty - unit * 0.46 + Math.sin(t * 2) * 2, unit * 0.07)
    emoji(c, KINGDOM.monarch.emoji, tx, ty - unit * 0.18 + Math.sin(t * 1.5) * 2, unit * 0.28)
    drawHero(c, V.x + V.w * 0.26, V.y + V.h * 0.86, unit * 0.2, t, { style: styleOf(e.save) })

    if (victory) {
      if (Math.random() < dt * 1.5) this.celebrate(stage)
      label(c, `Level ${e.save.level}!`, tx, V.y + V.h * 0.1, { size: clamp(unit * 0.09, 36, 80), font: 'title', color: '#ffd42a', stroke: '#3a1400', weight: 900 })
    }
    this.confetti = this.confetti.filter((p) => (p.life -= dt) > 0 && p.y < stage.h + 20)
    for (const p of this.confetti) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      c.save()
      c.translate(p.x, p.y)
      c.rotate(p.rot)
      c.fillStyle = p.color
      c.fillRect(-5, -3, 10, 6)
      c.restore()
    }
  }

  /** The character creator: a dressing room with a mirror, and the hero as they would look. */
  creator(stage: Stage, m: CreatorMode, highlight: string | null, t: number): void {
    const c = stage.ctx
    const V = stage.view
    const unit = Math.min(V.w, V.h)
    const bg = c.createLinearGradient(0, 0, 0, stage.h)
    bg.addColorStop(0, '#3a2440')
    bg.addColorStop(0.62, '#6a3a3a')
    bg.addColorStop(1, '#2a1620')
    c.fillStyle = bg
    c.fillRect(0, 0, stage.w, stage.h)
    c.strokeStyle = 'rgba(255,220,160,0.12)'
    c.lineWidth = 3
    for (let i = 0; i < 6; i++) c.strokeRect(V.x + V.w * (0.04 + i * 0.16), V.y + V.h * 0.1, V.w * 0.12, V.h * 0.48)
    const floorY = V.y + V.h * 0.74
    c.fillStyle = '#4a2a22'
    c.fillRect(0, floorY, stage.w, stage.h - floorY)
    const mx = V.x + V.w * 0.36
    c.fillStyle = '#9a2a3a'
    c.beginPath()
    c.ellipse(mx, floorY + V.h * 0.08, V.w * 0.24, V.h * 0.07, 0, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#e8c46a'
    c.lineWidth = 3
    c.stroke()
    // A tall gilt mirror behind the hero.
    const mw = unit * 0.44
    const mTop = V.y + V.h * 0.08
    const mh = floorY - mTop + V.h * 0.02
    c.fillStyle = '#c9a24a'
    c.beginPath()
    c.roundRect(mx - mw / 2 - 12, mTop - 12, mw + 24, mh + 12, [mw / 2 + 12, mw / 2 + 12, 10, 10])
    c.fill()
    const glassFill = c.createLinearGradient(mx - mw / 2, mTop, mx + mw / 2, mTop + mh)
    glassFill.addColorStop(0, '#5a6a9a')
    glassFill.addColorStop(1, '#2a2a4a')
    c.fillStyle = glassFill
    c.beginPath()
    c.roundRect(mx - mw / 2, mTop, mw, mh, [mw / 2, mw / 2, 4, 4])
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.12)'
    c.beginPath()
    c.moveTo(mx - mw * 0.35, mTop + mh * 0.2)
    c.lineTo(mx - mw * 0.1, mTop + mh * 0.12)
    c.lineTo(mx - mw * 0.3, mTop + mh * 0.75)
    c.lineTo(mx - mw * 0.45, mTop + mh * 0.8)
    c.closePath()
    c.fill()
    const spot = c.createRadialGradient(mx, floorY - unit * 0.2, 10, mx, floorY - unit * 0.2, unit * 0.4)
    spot.addColorStop(0, 'rgba(255,230,170,0.35)')
    spot.addColorStop(1, 'rgba(255,230,170,0)')
    c.fillStyle = spot
    c.fillRect(0, 0, stage.w, stage.h)

    const p = m.preview(highlight)
    drawHero(c, mx, floorY + V.h * 0.06, unit * 0.46, t, { style: { cls: p.cls, look: p.look } })
    if (m.price === null) label(c, p.name, mx, floorY + V.h * 0.15, { size: clamp(unit * 0.045, 16, 34), font: 'title', color: '#fff8e6', stroke: '#2a1400', weight: 900 })

    label(c, m.price === null ? 'Make your hero' : 'A new look', V.x + V.w * 0.5, V.y + V.h * 0.06, {
      size: clamp(unit * 0.05, 18, 40), font: 'title', color: '#ffd42a', stroke: '#2a1400', weight: 900,
    })
    if (p.cls) {
      const def = CONFIG.classes[p.cls]
      const tx = V.x + V.w * 0.76
      emoji(c, def.emoji, tx, V.y + V.h * 0.3, unit * 0.12)
      label(c, def.name, tx, V.y + V.h * 0.44, { size: clamp(unit * 0.06, 20, 44), font: 'title', color: '#ffd42a', stroke: '#2a1400', weight: 900 })
      label(c, def.blurb, tx, V.y + V.h * 0.52, { size: clamp(unit * 0.026, 12, 19), color: '#fff8e6', maxWidth: V.w * 0.4 })
      const nudges = STATS.filter((k) => def.stats[k]).map((k) => `${def.stats[k] > 0 ? '+' : '−'}${Math.abs(def.stats[k])} ${STAT_INFO[k].name}`)
      label(c, nudges.join(' · '), tx, V.y + V.h * 0.58, { size: clamp(unit * 0.024, 11, 17), color: '#e8c46a', maxWidth: V.w * 0.4 })
    }
  }

  title(stage: Stage, t: number): void {
    const c = stage.ctx
    const V = stage.view
    const W = stage.w
    const H = stage.h
    const unit = Math.min(V.w, V.h)
    const sky = c.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#5aa8f0')
    sky.addColorStop(0.55, '#ffd0a0')
    sky.addColorStop(1, '#ff9f6b')
    c.fillStyle = sky
    c.fillRect(0, 0, W, H)
    const sun = c.createRadialGradient(V.x + V.w * 0.72, V.y + V.h * 0.45, 10, V.x + V.w * 0.72, V.y + V.h * 0.45, unit * 0.5)
    sun.addColorStop(0, 'rgba(255,240,180,1)')
    sun.addColorStop(0.2, 'rgba(255,220,140,0.7)')
    sun.addColorStop(1, 'rgba(255,200,120,0)')
    c.fillStyle = sun
    c.fillRect(0, 0, W, H)
    for (let i = 0; i < 5; i++) {
      const x = ((i * 260 + t * (12 + i * 3)) % (W + 300)) - 150
      const y = V.y + 40 + i * 34
      c.fillStyle = 'rgba(255,255,255,0.8)'
      for (const [dx, dy, r] of [[0, 0, 26], [28, -10, 32], [60, 0, 24], [30, 8, 26]]) {
        c.beginPath()
        c.arc(x + dx, y + dy, r, 0, Math.PI * 2)
        c.fill()
      }
    }
    const hills: [string, number, number, number][] = [['#7fb35a', 0.62, 50, 0.004], ['#5f9e48', 0.72, 40, 0.007], ['#3f7f36', 0.84, 30, 0.011]]
    hills.forEach(([col, base, amp, freq], i) => {
      c.fillStyle = col
      c.beginPath()
      c.moveTo(0, H)
      for (let x = 0; x <= W; x += 16) c.lineTo(x, V.y + V.h * base - amp * Math.sin(x * freq + i * 2 + t * 0.05 * (i + 1)))
      c.lineTo(W, H)
      c.closePath()
      c.fill()
    })
    emoji(c, '🏰', V.x + V.w * 0.72, V.y + V.h * 0.52, unit * 0.32)
    for (let i = 0; i < 6; i++) {
      const s: Scenery = { kind: i % 2 ? 'tree' : 'pine', variant: i % VARIANTS, size: 0, flip: i % 3 === 0 }
      drawScenery(c, 'plains', s, V.x + V.w * (0.08 + i * 0.1), V.y + V.h * (0.79 + (i % 3) * 0.04), unit * 0.15)
    }
    drawHero(c, V.x + V.w * 0.28, V.y + V.h * 0.84, unit * 0.2, t)
    label(c, 'Kingdom Trek', V.x + V.w * 0.5, V.y + V.h * 0.2, {
      size: clamp(V.w * 0.085, 24, 120), font: 'title', color: '#ffd42a', stroke: '#5a2a00', weight: 900, shadow: true, maxWidth: V.w * 0.92,
    })
    label(c, 'Pedal · Explore · Save the kingdom', V.x + V.w * 0.5, V.y + V.h * 0.2 + clamp(V.w * 0.06, 22, 80), {
      size: clamp(V.w * 0.024, 12, 30), color: '#fff8e6', stroke: 'rgba(60,30,0,0.6)', weight: 700, maxWidth: V.w * 0.92,
    })
  }
}

function signboard(c: CanvasRenderingContext2D, text: string, x: number, y: number, unit: number): void {
  const size = clamp(unit * 0.04, 16, 30)
  c.save()
  c.font = `700 ${size}px Cinzel, Georgia, serif`
  const w = c.measureText(text).width + size * 2
  const h = size * 1.9
  c.strokeStyle = '#3a2410'
  c.lineWidth = 3
  for (const dx of [-w * 0.35, w * 0.35]) {
    c.beginPath()
    c.moveTo(x + dx, y - h)
    c.lineTo(x + dx, y - h / 2)
    c.stroke()
  }
  shadow(c, x, y + h * 0.6, w * 0.4, 6, 0.2)
  const g = c.createLinearGradient(0, y - h / 2, 0, y + h / 2)
  g.addColorStop(0, '#b07a44')
  g.addColorStop(1, '#7a4a22')
  c.fillStyle = g
  c.beginPath()
  c.roundRect(x - w / 2, y - h / 2, w, h, 10)
  c.fill()
  c.strokeStyle = shade('#7a4a22', -0.3)
  c.stroke()
  c.restore()
  label(c, text, x, y + 2, { size, font: 'title', color: '#ffe9b0', stroke: rgba('#3a2410', 0.8) })
}
