/**
 * On the road: a winding track through the route's terrain, scrolling as the hero walks. The next enemy
 * is visible up ahead, roadside finds sparkle, and the destination's walls appear near the end.
 */
import type { Engine } from '../engine/engine.ts'
import type { TravelMode } from '../engine/modes/travel.ts'
import { Rng, hashString } from '../engine/rng.ts'
import * as R from '../engine/rules.ts'
import { TERRAIN_NAME, cap, dangerWord, minutes } from '../engine/text.ts'
import { drawHero, styleOf } from './hero.ts'
import { drawRegionMap } from './map.ts'
import { SCENERY_SIZE, VARIANTS, drawScenery, groundPattern, pickScenery } from './nature.ts'
import type { Scenery } from './nature.ts'
import { PALETTES } from './palette.ts'
import type { Stage } from './stage.ts'
import { bar, clamp, emoji, glass, label, rgba, shade, shadow } from './stage.ts'

/** Screen pixels per Energy walked: at a steady pace the land scrolls by at 24 px/s. */
const PXE = 24
const CHUNK = 180

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }

export class TravelView {
  private weather: Particle[] = []
  private dust: Particle[] = []

  draw(stage: Stage, e: Engine, m: TravelMode, t: number, dt: number): void {
    const c = stage.ctx
    const V = stage.view
    const W = stage.w
    const H = stage.h
    const trip = m.trip
    const route = m.route
    const pal = PALETTES[route.terrain]
    const L = trip.cost * PXE
    const frac = trip.dir > 0 ? trip.pos : 1 - trip.pos
    const d = frac * L
    // Small views (a phone): no route card or minimap, a slimmer progress bar.
    const compact = V.w < 520 || V.h < 360
    const heroY = V.y + V.h * (compact ? 0.5 : 0.64)
    const seed = hashString(route.id)
    const sy = (D: number): number => heroY - (D - d)
    const cx = (D: number): number => V.x + V.w * 0.5 + V.w * 0.12 * Math.sin(D / 560 + (seed % 7)) + V.w * 0.05 * Math.sin(D / 210 + (seed % 5))
    const tripD = (at: number): number => (trip.dir > 0 ? at : 1 - at) * L
    const Dmin = d - (H - heroY) - 80
    const Dmax = d + (heroY - V.y) + 160

    // The ground: a seamless texture that scrolls with the land, broken up by big soft patches so it never
    // looks tiled.
    c.fillStyle = groundPattern(c, route.terrain, stage.dpr, 0, heroY + d)
    c.fillRect(0, 0, W, H)

    const decor: { D: number; x: number; s: Scenery }[] = []
    for (let k = Math.floor(Dmin / CHUNK); k <= Math.floor(Dmax / CHUNK); k++) {
      const rng = new Rng((seed ^ Math.imul(k + 7919, 2654435761)) >>> 0)
      for (let i = 0; i < 2; i++) {
        const x = rng.range(0, W)
        const y = sy(k * CHUNK + rng.range(0, CHUNK))
        const r = rng.range(90, 170)
        const patch = c.createRadialGradient(x, y, 0, x, y, r)
        patch.addColorStop(0, rng.chance(0.5) ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)')
        patch.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = patch
        c.fillRect(x - r, y - r, r * 2, r * 2)
      }
      if ((route.terrain === 'plains' || route.terrain === 'hills') && rng.chance(0.45)) {
        const D = k * CHUNK + rng.range(0, CHUNK)
        const side = rng.chance(0.5) ? -1 : 1
        const x = cx(D) + side * rng.range(110, V.w * 0.35)
        const fw = rng.range(90, 160)
        const fh = rng.range(60, 110)
        c.save()
        c.translate(x, sy(D))
        c.fillStyle = rng.chance(0.5) ? '#d9c46a' : '#78b04a'
        c.beginPath()
        c.roundRect(-fw / 2, -fh / 2, fw, fh, 8)
        c.fill()
        c.strokeStyle = 'rgba(0,0,0,0.12)'
        c.lineWidth = 2
        for (let yy = -fh / 2 + 8; yy < fh / 2; yy += 10) {
          c.beginPath()
          c.moveTo(-fw / 2 + 4, yy)
          c.lineTo(fw / 2 - 4, yy)
          c.stroke()
        }
        c.restore()
      }
      if (route.terrain === 'swamp' && pal.water && rng.chance(0.6)) {
        const D = k * CHUNK + rng.range(0, CHUNK)
        const x = cx(D) + (rng.chance(0.5) ? -1 : 1) * rng.range(100, V.w * 0.35)
        c.fillStyle = rgba(pal.water, 0.9)
        c.beginPath()
        c.ellipse(x, sy(D), rng.range(40, 80), rng.range(18, 32), 0, 0, Math.PI * 2)
        c.fill()
        // A lily pad with a flower.
        c.fillStyle = '#5f9a45'
        c.beginPath()
        c.arc(x + 12, sy(D), 8, 0.4, Math.PI * 2 - 0.4)
        c.lineTo(x + 12, sy(D))
        c.fill()
        c.fillStyle = '#ff9ec7'
        c.beginPath()
        c.arc(x + 14, sy(D) - 2, 3.5, 0, Math.PI * 2)
        c.fill()
      }
      if (route.terrain === 'volcano' && rng.chance(0.6)) {
        c.save()
        c.strokeStyle = '#ff7a2f'
        c.shadowColor = '#ff5a00'
        c.shadowBlur = 12
        c.lineWidth = 3
        let x = cx(k * CHUNK) + (rng.chance(0.5) ? -1 : 1) * rng.range(90, V.w * 0.4)
        let D = k * CHUNK
        c.beginPath()
        c.moveTo(x, sy(D))
        for (let j = 0; j < 4; j++) {
          x += rng.range(-30, 30)
          D += rng.range(20, 50)
          c.lineTo(x, sy(D))
        }
        c.stroke()
        c.restore()
      }
      for (let i = 0; i < 6; i++) {
        const D = k * CHUNK + rng.range(0, CHUNK)
        const side = rng.chance(0.5) ? -1 : 1
        if (route.terrain === 'coast' && side > 0) continue
        const x = cx(D) + side * (75 + rng.range(0, V.w * 0.5))
        decor.push({ D, x, s: pickScenery(rng, route.terrain) })
      }
      if (route.terrain === 'mountain' && rng.chance(0.5)) {
        const [lo, hi] = SCENERY_SIZE.peak
        const s: Scenery = { kind: 'peak', variant: rng.int(0, VARIANTS - 1), size: rng.range(lo, hi), flip: rng.chance(0.5) }
        decor.push({ D: k * CHUNK, x: rng.chance(0.5) ? V.x + rng.range(20, 90) : V.x + V.w - rng.range(20, 90), s })
      }
    }

    if (route.terrain === 'coast' && pal.water) {
      c.beginPath()
      c.moveTo(W, sy(Dmax))
      for (let D = Dmax; D >= Dmin; D -= 16) c.lineTo(cx(D) + 150 + 26 * Math.sin(D / 110), sy(D))
      c.lineTo(W, sy(Dmin))
      c.closePath()
      const sea = c.createLinearGradient(V.x + V.w * 0.6, 0, W, 0)
      sea.addColorStop(0, pal.water)
      sea.addColorStop(1, shade(pal.water, -0.3))
      c.fillStyle = sea
      c.fill()
      c.strokeStyle = 'rgba(255,255,255,0.7)'
      c.lineWidth = 4
      c.stroke()
      c.strokeStyle = 'rgba(255,255,255,0.35)'
      c.lineWidth = 2
      for (let D = Math.floor(Dmin / 60) * 60; D < Dmax; D += 60) {
        const x = cx(D) + 230 + ((D * 7) % 200) + Math.sin(t + D) * 6
        c.beginPath()
        c.arc(x, sy(D), 12, Math.PI * 1.1, Math.PI * 1.9)
        c.stroke()
      }
    }

    const roadPts: { x: number; y: number }[] = []
    for (let D = Dmin; D <= Dmax; D += 12) roadPts.push({ x: cx(D), y: sy(D) })
    for (const [col, wid] of [[pal.pathEdge, 70], [pal.path, 56]] as const) {
      c.strokeStyle = col
      c.lineWidth = wid
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.beginPath()
      roadPts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
      c.stroke()
    }
    c.strokeStyle = 'rgba(0,0,0,0.08)'
    c.lineWidth = 3
    for (const off of [-14, 14]) {
      c.beginPath()
      roadPts.forEach((p, i) => (i ? c.lineTo(p.x + off, p.y) : c.moveTo(p.x + off, p.y)))
      c.stroke()
    }

    const drawTownEnd = (D: number, name: string): void => {
      const y = sy(D)
      if (y < V.y - 160 || y > H + 60) return
      c.fillStyle = '#9c9486'
      c.fillRect(0, y - 16, W, 30)
      c.fillStyle = '#b4ab9b'
      for (let x = 0; x < W; x += 28) c.fillRect(x, y - 26, 16, 12)
      const gx = cx(D)
      c.fillStyle = '#3a2a1e'
      c.beginPath()
      c.roundRect(gx - 34, y - 30, 68, 50, [34, 34, 0, 0])
      c.fill()
      for (let i = 0; i < 5; i++) emoji(c, i % 2 ? '🏠' : '🏡', gx - 200 + i * 100 + (i > 1 ? 60 : 0), y - 60, 42)
      label(c, name, gx, y - 94, { size: 22, font: 'title', color: '#ffd42a', stroke: '#2a1a00', weight: 900 })
    }
    drawTownEnd(0, m.from.name)
    drawTownEnd(L, m.to.name)

    for (const f of route.finds ?? []) {
      if (e.isTaken(`find:${f.id}`)) continue
      const D = tripD(f.at)
      if (sy(D) < V.y - 40 || sy(D) > H + 40) continue
      const x = cx(D) + 40
      emoji(c, e.world.item(f.item).emoji, x, sy(D), 24)
      emoji(c, '✨', x + 12 * Math.sin(t * 3), sy(D) - 18, 18 + 4 * Math.sin(t * 5))
    }

    decor.sort((a, b) => b.D - a.D)
    for (const { D, x, s } of decor) {
      const y = sy(D)
      if (y < V.y - 20 || y - s.size > H) continue
      drawScenery(c, route.terrain, s, x, y)
    }

    const next = trip.plan.find((p) => !p.done)
    if (next) {
      const D = tripD(next.at)
      const y = sy(D)
      if (y > V.y - 60 && y < heroY - 10) {
        const en = e.world.enemy(next.enemy)
        const size = next.fixed ? 84 : 60
        const bob = Math.sin(t * 4) * 4
        shadow(c, cx(D), y + size * 0.42, size * 0.35, size * 0.1, 0.3)
        emoji(c, en.emoji, cx(D), y + bob, size)
        if (D - d < 320) emoji(c, '❗', cx(D) + size * 0.45, y - size * 0.5 + bob, 28)
        if (next.fixed) label(c, en.name, cx(D), y - size * 0.72, { size: 16, color: '#fff', stroke: '#5a0000' })
      }
    }

    const hs = compact ? clamp(V.h * 0.16, 30, 60) : clamp(V.h * 0.11, 50, 96)
    const hx = cx(d)
    if (m.boosting && Math.random() < dt * 30) {
      this.dust.push({ x: hx + (Math.random() - 0.5) * 20, y: heroY, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 20, life: 0.7, max: 0.7, size: 6 + Math.random() * 6, color: pal.pathEdge })
    }
    this.dust = this.dust.filter((p) => (p.life -= dt) > 0)
    for (const p of this.dust) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      c.fillStyle = rgba(p.color.startsWith('#') ? p.color : '#c9b07a', (p.life / p.max) * 0.6)
      c.beginPath()
      c.arc(p.x, p.y, p.size * (1.4 - p.life / p.max), 0, Math.PI * 2)
      c.fill()
    }
    drawHero(c, hx, heroY, hs, t, { walking: m.rate > 0.05, back: true, speed: 4 + m.rate * 2.2, style: styleOf(e.save) })
    this.drawWeather(c, stage, route.terrain, dt)

    if (!compact) {
      // Where we are going.
      const cardW = Math.min(V.w * 0.46, 430)
      glass(c, V.x + 16, V.y + 14, cardW, 70)
      label(c, `${m.from.name}  →  ${m.to.name}`, V.x + 34, V.y + 38, { size: 22, font: 'title', color: '#ffd42a', align: 'left', weight: 900, maxWidth: cardW - 36 })
      label(c, `${cap(TERRAIN_NAME[route.terrain])} · ${dangerWord(route.danger)}`, V.x + 34, V.y + 66, { size: 15, color: '#e9dfc6', align: 'left' })
      const mw = clamp(V.w * 0.26, 170, 300)
      const region = e.world.game.region
      drawRegionMap(c, { x: V.x + V.w - mw - 16, y: V.y + 14, w: mw, h: (mw * region.height) / region.width }, e, { compact: true, t })
    }

    // Progress and the energy situation.
    const eta = R.etaSeconds(m.remaining, e.save.energy, Math.max(0.05, e.effort))
    const status = m.boosting
      ? { long: '⚡ Banked Energy boost: faster than your legs!', short: '⚡ Boosting!', color: '#7fe0ff' }
      : m.rate > 0.05
        ? { long: '🚴 Out of banked Energy: keep pedaling!', short: '🚴 Keep pedaling!', color: '#ffb35b' }
        : { long: '💤 Pedal to move!', short: '💤 Pedal!', color: '#ff6b5b' }
    if (compact) {
      const bw = V.w - 40
      const bx = V.x + 20
      const by = V.y + V.h - 34
      glass(c, bx - 12, by - 22, bw + 24, 52, 14)
      label(c, `${m.from.name} → ${m.to.name}`, bx, by - 10, { size: 12, color: '#ffd42a', align: 'left', maxWidth: bw * 0.66 })
      label(c, minutes(eta), bx + bw, by - 10, { size: 12, color: '#e9dfc6', align: 'right' })
      bar(c, bx, by + 1, bw, 9, frac, '#7fe0ff', '#ffd42a')
      drawHeroPip(c, bx + bw * frac, by + 5, 7)
      label(c, status.short, bx, by + 20, { size: 12, color: status.color, align: 'left', weight: 800 })
      label(c, `${Math.round(frac * 100)}%`, bx + bw, by + 20, { size: 12, color: '#e9dfc6', align: 'right' })
      return
    }
    const bw = V.w * 0.72
    const bx = V.x + (V.w - bw) / 2
    const by = V.y + V.h - 62
    glass(c, bx - 20, by - 40, bw + 40, 96, 20)
    label(c, m.from.name, bx, by - 20, { size: 15, color: '#e9dfc6', align: 'left' })
    label(c, m.to.name, bx + bw, by - 20, { size: 15, color: '#ffd42a', align: 'right' })
    bar(c, bx, by - 6, bw, 16, frac, '#7fe0ff', '#ffd42a')
    drawHeroPip(c, bx + bw * frac, by + 2)
    label(c, status.long, bx, by + 32, { size: 17, color: status.color, align: 'left', weight: 800 })
    label(c, `${Math.round(frac * 100)}% · ${minutes(eta)} to ${m.to.name}`, bx + bw, by + 32, { size: 15, color: '#e9dfc6', align: 'right' })
  }

  private drawWeather(c: CanvasRenderingContext2D, stage: Stage, terrain: string, dt: number): void {
    const kind = terrain === 'snow' ? 'snow' : terrain === 'volcano' ? 'ash' : terrain === 'forest' ? 'leaf' : ''
    if (!kind) return
    const want = kind === 'leaf' ? 14 : 90
    while (this.weather.length < want) {
      this.weather.push({
        x: Math.random() * stage.w, y: stage.view.y + Math.random() * stage.view.h, vx: (Math.random() - 0.5) * 30,
        vy: kind === 'leaf' ? 30 : 25 + Math.random() * 35, life: 1, max: 1, size: kind === 'leaf' ? 16 : 2,
        color: kind === 'snow' ? 'rgba(255,255,255,0.9)' : 'rgba(70,50,45,0.55)',
      })
    }
    for (const p of this.weather) {
      p.x += (p.vx + (kind === 'leaf' ? Math.sin(p.y / 30) * 30 : 0)) * dt
      p.y += p.vy * dt
      if (p.y > stage.h) {
        p.y = stage.view.y
        p.x = Math.random() * stage.w
      }
      if (kind === 'leaf') emoji(c, '🍂', p.x, p.y, p.size)
      else {
        c.fillStyle = p.color
        c.beginPath()
        c.arc(p.x, p.y, kind === 'snow' ? 2.3 : 1.6, 0, Math.PI * 2)
        c.fill()
      }
    }
    if (this.weather.length > want) this.weather.length = want
  }
}

function drawHeroPip(c: CanvasRenderingContext2D, x: number, y: number, r = 11): void {
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fillStyle = '#e8342a'
  c.fill()
  c.lineWidth = 3
  c.strokeStyle = '#fff'
  c.stroke()
}
