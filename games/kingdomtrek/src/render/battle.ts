/**
 * The fight: hero left, enemy right, over the biome's backdrop. Then by style: HP bars and the strike meter, a
 * tug of war's rope, or a race's lanes, with a meter showing what pedaling does right now.
 */
import { CONFIG } from '../config.ts'
import type { Biome } from '../content/types.ts'
import { STYLE_TEXT } from '../engine/battle.ts'
import type { BattleEvent, BattleView as View } from '../engine/battle.ts'
import type { Engine } from '../engine/engine.ts'
import type { BattleMode } from '../engine/modes/battle.ts'
import { Rng, hashString } from '../engine/rng.ts'
import { cap } from '../engine/text.ts'
import { drawBoss } from './bosses.ts'
import { drawHero, styleOf } from './hero.ts'
import { drawScenery, groundPattern, pickScenery } from './nature.ts'
import { PALETTES } from './palette.ts'
import type { Rect, Stage } from './stage.ts'
import { bar, clamp, emoji, glass, label, shade, shadow } from './stage.ts'

interface Floater { rx: number; ry: number; text: string; color: string; size: number; life: number; max: number }
/** A puff of dust kicked up by someone pulling or running hard. */
interface Puff { x: number; y: number; vx: number; life: number }

const BUFF_ICON = { might: '💪', shield: '🫧', haste: '🌀' }

export class BattleView {
  private fx: Floater[] = []
  private puffs: Puff[] = []
  private dt = 0
  private shake = 0
  private heroLunge = 0
  private enemyLunge = 0
  private heroFlash = 0
  private enemyFlash = 0
  private slash = 0
  /** A boss's attack pose (fire, lightning, a swing): fades more slowly than a lunge, so it can be seen. */
  private enemyAttack = 0

  /** Add a floating text, stacked above any still rising from the same spot. */
  private float(rx: number, ry: number, text: string, color: string, size: number, life = 1.1): void {
    const near = this.fx.filter((f) => Math.abs(f.rx - rx) < 0.1 && f.life > f.max * 0.45).length
    this.fx.push({ rx, ry: ry - near * 0.055, text, color, size, life, max: life })
  }

  /** Kick up dust at (x, y), drifting the way `dir` says (−1 left, 1 right); a few puffs a second. */
  private puff(x: number, y: number, dir: number): void {
    if (Math.random() < this.dt * 14) this.puffs.push({ x, y, vx: dir * (30 + Math.random() * 40), life: 0.6 })
  }

  private drawPuffs(c: CanvasRenderingContext2D): void {
    this.puffs = this.puffs.filter((p) => (p.life -= this.dt) > 0)
    for (const p of this.puffs) {
      p.x += p.vx * this.dt
      c.fillStyle = `rgba(214,190,140,${p.life})`
      c.beginPath()
      c.arc(p.x, p.y - (0.6 - p.life) * 20, 5 + (0.6 - p.life) * 16, 0, Math.PI * 2)
      c.fill()
    }
  }

  onEvent(ev: BattleEvent): void {
    if (ev.type === 'strike') {
      this.heroLunge = 1
      this.enemyFlash = 1
      this.slash = 1
      const note = ev.crit ? 'CRITICAL! ' : ev.effective === 'strong' ? 'Super effective! ' : ev.effective === 'weak' ? 'Resisted… ' : ''
      this.float(0.7, 0.32, `${note}${ev.damage}`, ev.crit ? '#ffd42a' : ev.effective === 'strong' ? '#7fe0ff' : '#ffffff', ev.crit ? 46 : 38)
    } else if (ev.type === 'hurt') {
      this.enemyLunge = 1
      this.enemyAttack = 1
      this.heroFlash = 1
      this.shake = 1
      this.float(0.3, 0.36, `${ev.resisted ? 'Resisted! ' : ''}-${ev.damage}`, ev.resisted ? '#7fe0ff' : '#ff6b5b', 36)
    } else if (ev.type === 'surge') {
      this.shake = 0.6
      this.enemyLunge = 1
      this.float(0.7, 0.3, ev.text, '#ff6b5b', 44, 1.4)
    } else {
      this.float(0.3, 0.3, `${ev.item.emoji} ${ev.text}`, '#8ff08f', 24, 1.8)
    }
  }

  draw(stage: Stage, e: Engine, m: BattleMode, t: number, dt: number): void {
    const c = stage.ctx
    const V = stage.view
    const v = m.battle.view()
    const biome: Biome = e.save.where.kind === 'travel'
      ? e.world.route(e.save.where.route).terrain
      : e.save.where.kind === 'town' ? e.world.town(e.save.where.town).biome : 'plains'
    const pal = PALETTES[biome]
    this.dt = dt
    for (const k of ['shake', 'heroLunge', 'enemyLunge', 'heroFlash', 'enemyFlash', 'slash'] as const) this[k] = Math.max(0, this[k] - dt * 3.2)
    this.enemyAttack = Math.max(0, this.enemyAttack - dt * 1.5)

    c.save()
    if (this.shake > 0) c.translate((Math.random() - 0.5) * 14 * this.shake, (Math.random() - 0.5) * 10 * this.shake)
    const horizon = V.y + V.h * 0.46
    const sky = c.createLinearGradient(0, 0, 0, horizon)
    sky.addColorStop(0, m.enemy.boss ? '#3a1410' : pal.sky[0])
    sky.addColorStop(1, m.enemy.boss ? '#b9552a' : pal.sky[1])
    c.fillStyle = sky
    c.fillRect(-20, -20, stage.w + 40, horizon + 20)
    c.fillStyle = shade(pal.ground[0], -0.15)
    c.beginPath()
    c.moveTo(-20, horizon)
    for (let x = -20; x <= stage.w + 20; x += 30) c.lineTo(x, horizon - 30 - 22 * Math.sin(x / 140) - 12 * Math.sin(x / 57))
    c.lineTo(stage.w + 20, horizon + 10)
    c.closePath()
    c.fill()
    c.fillStyle = groundPattern(c, biome, stage.dpr, 0, horizon)
    c.fillRect(-20, horizon, stage.w + 40, stage.h - horizon + 20)
    // Haze toward the horizon, so the ground reads as distance.
    const haze = c.createLinearGradient(0, horizon, 0, stage.h)
    haze.addColorStop(0, 'rgba(255,255,255,0.3)')
    haze.addColorStop(0.35, 'rgba(255,255,255,0)')
    haze.addColorStop(1, 'rgba(0,0,0,0.14)')
    c.fillStyle = haze
    c.fillRect(-20, horizon, stage.w + 40, stage.h - horizon + 20)
    // A few trees or rocks from this biome along the horizon.
    const hr = new Rng(hashString(`battle:${biome}`))
    for (let i = 0; i < 7; i++) {
      const s = pickScenery(hr, biome, 0.7)
      drawScenery(c, biome, s, V.x + (i + hr.range(0.1, 0.9)) * (V.w / 7), horizon + hr.range(2, 16), s.size * 0.55)
    }
    c.fillStyle = 'rgba(255,255,255,0.12)'
    c.beginPath()
    c.ellipse(V.x + V.w * 0.5, V.y + V.h * 0.64, V.w * 0.42, V.h * 0.12, 0, 0, Math.PI * 2)
    c.fill()

    // Small views (a phone) get smaller sprites and slimmer overlays.
    const compact = V.w < 520 || V.h < 360
    if (v.style === 'hp') this.drawHp(c, V, e, m, v, t, compact)
    else this.drawContest(c, V, e, m, v, t, compact)

    this.fx = this.fx.filter((f) => (f.life -= dt) > 0)
    for (const f of this.fx) {
      const k = 1 - f.life / f.max
      c.globalAlpha = Math.min(1, (f.life / f.max) * 2)
      const fy = V.y + V.h * (f.ry + (compact ? 0.24 : 0)) - k * (compact ? 22 : 50)
      label(c, f.text, V.x + V.w * f.rx, fy, { size: f.size * (compact ? 0.5 : 1), color: f.color, stroke: '#1a1a2a', weight: 800, font: 'ui' })
      c.globalAlpha = 1
    }
    c.restore()

    const msgY = V.y + V.h - 36
    if (m.message && !compact) {
      c.save()
      c.font = `700 18px "Baloo 2", sans-serif`
      const w = Math.min(V.w - 40, c.measureText(m.message).width + 40)
      c.restore()
      glass(c, V.x + (V.w - w) / 2, msgY - 20, w, 40, 20)
      label(c, m.message, V.x + V.w / 2, msgY, { size: 18, color: '#fff8e6', maxWidth: w - 24 })
    }

    if (m.phase === 'intro') {
      const k = Math.min(1, m.t / 0.4)
      c.fillStyle = `rgba(10,8,20,${0.45 * k})`
      c.fillRect(0, 0, stage.w, stage.h)
      const by = V.y + V.h * (compact ? 0.45 : 0.3)
      label(c, cap(m.enemy.boss ? `${m.enemy.name}!` : STYLE_TEXT[v.style].intro(m.enemy.name)), V.x + V.w / 2, by, {
        size: clamp(V.w * 0.045, 15, 54), font: 'title', color: '#ffd42a', stroke: '#2a1000', weight: 900, maxWidth: V.w - 24,
      })
      label(c, `Get ready… ${Math.max(1, Math.ceil(CONFIG.battle.introSeconds - m.t))}`, V.x + V.w / 2, by + (compact ? 24 : 56), { size: compact ? 13 : 22, color: '#fff', stroke: '#1a1a2a' })
    } else if (m.phase === 'over' && m.result) {
      const o = m.battle.outcome
      c.fillStyle = 'rgba(10,8,20,0.45)'
      c.fillRect(0, 0, stage.w, stage.h)
      const title = o === 'won' ? 'VICTORY!' : o === 'lost' ? 'DEFEATED' : 'ESCAPED'
      const by = V.y + V.h * (compact ? 0.42 : 0.26)
      label(c, title, V.x + V.w / 2, by, {
        size: clamp(V.w * 0.07, 22, 84), font: 'title', color: o === 'won' ? '#ffd42a' : o === 'lost' ? '#ff6b5b' : '#cfc6ad', stroke: '#2a1000', weight: 900,
      })
      m.result.lines.slice(1).forEach((line, i) => {
        label(c, line, V.x + V.w / 2, by + (compact ? 28 + i * 17 : 64 + i * 32), { size: compact ? 13 : 22, color: '#fff', stroke: '#1a1a2a', maxWidth: V.w - 24 })
      })
    }
  }

  private sizes(V: Rect, m: BattleMode, compact: boolean): { hs: number; es: number; pad: number; top: number } {
    const hs = compact ? clamp(V.h * 0.36, 40, 150) : clamp(V.h * 0.24, 90, 210)
    const es = m.enemy.boss
      ? (compact ? clamp(V.h * 0.5, 60, 240) : clamp(V.h * 0.46, 180, 400))
      : (compact ? clamp(V.h * (0.28 + m.enemy.tier * 0.03), 40, 170) : clamp(V.h * (0.2 + m.enemy.tier * 0.035), 90, 260))
    return { hs, es, pad: compact ? 8 : 18, top: V.y + (compact ? 8 : 16) }
  }

  private drawBuffs(c: CanvasRenderingContext2D, v: View, x: number, y: number, compact: boolean): void {
    v.buffs.forEach((b, i) => {
      const bx = x + 18 + i * (compact ? 54 : 76)
      emoji(c, BUFF_ICON[b.kind], bx, y, compact ? 18 : 26)
      label(c, `${Math.ceil(b.left)}s`, bx + (compact ? 14 : 20), y, { size: compact ? 11 : 14, color: '#fff', stroke: '#1a1a2a', align: 'left' })
    })
  }

  /** Strike until it falls: HP plates, the enemy's attack timer, and the strike meter. */
  private drawHp(c: CanvasRenderingContext2D, V: Rect, e: Engine, m: BattleMode, v: View, t: number, compact: boolean): void {
    const { hs, es, pad, top } = this.sizes(V, m, compact)
    const hx = V.x + V.w * 0.28
    const hy = V.y + V.h * (compact ? 0.8 : 0.66)
    const ex = V.x + V.w * 0.7
    const ey = V.y + V.h * (compact ? 0.7 : 0.6)

    drawHero(c, hx, hy, hs, t, { lunge: this.heroLunge * V.w * 0.08, flash: this.heroFlash, style: styleOf(e.save) })
    const ebob = Math.sin(t * 2.6) * es * 0.03
    const elunge = -this.enemyLunge * V.w * 0.07
    // A boss is drawn in full (bosses.ts); everyone else is their emoji.
    const drawn = !!m.enemy.boss && drawBoss(c, m.enemy, ex + elunge * 0.3, ey + es * 0.48, es * 1.08, t, { attack: this.enemyAttack, flash: this.enemyFlash })
    if (!drawn) {
      shadow(c, ex + elunge, ey + es * 0.44, es * 0.36, es * 0.09, 0.3)
      if (this.enemyFlash > 0) {
        c.fillStyle = `rgba(255,255,255,${0.5 * this.enemyFlash})`
        c.beginPath()
        c.arc(ex + elunge, ey + ebob, es * 0.5, 0, Math.PI * 2)
        c.fill()
      }
      emoji(c, m.enemy.emoji, ex + elunge + (this.enemyFlash > 0.5 ? 6 : 0), ey + ebob, es)
    }
    if (this.slash > 0) {
      c.save()
      c.strokeStyle = `rgba(255,255,255,${this.slash})`
      c.lineWidth = 8 * this.slash
      c.lineCap = 'round'
      c.beginPath()
      c.arc(ex, ey, es * 0.42, -2.4 + (1 - this.slash) * 1.4, -1.0 + (1 - this.slash) * 1.4)
      c.stroke()
      c.restore()
    }

    // Name plates: fixed cards along the top, clear of the sprites and the floating numbers.
    const cardW = compact ? (V.w - pad * 3) / 2 : Math.min(V.w * 0.38, 400)
    const ph = compact ? 50 : 74
    const plate = (x: number, name: string, hp: number, max: number, from: string, to: string): void => {
      glass(c, x, top, cardW, ph, compact ? 12 : 16)
      label(c, name, x + (compact ? 10 : 18), top + (compact ? 14 : 21), { size: compact ? 12 : 19, color: '#ffd42a', align: 'left', font: 'title', weight: 700, maxWidth: cardW - 20 })
      bar(c, x + (compact ? 8 : 16), top + (compact ? 26 : 37), cardW - (compact ? 16 : 32), compact ? 16 : 24, hp / max, from, to)
      label(c, `HP ${Math.ceil(hp)} / ${max}`, x + cardW / 2, top + (compact ? 34 : 49), { size: compact ? 11 : 15, color: '#fff', stroke: '#1a1a2a' })
    }
    plate(V.x + pad, `Hero · Level ${e.save.level}`, v.heroHp, v.heroMaxHp, '#ff6b5b', '#6fdc6f')
    const ecx = V.x + V.w - pad - cardW
    plate(ecx, `${m.enemy.boss ? '👑 ' : ''}${cap(m.enemy.name)}`, v.enemyHp, v.enemyMaxHp, '#ff3b2f', '#ff9a4a')
    if (!compact) label(c, 'attack', ecx + 18, top + ph + 14, { size: 13, color: '#e9dfc6', align: 'left' })
    bar(c, ecx + (compact ? 8 : 70), top + ph + (compact ? 4 : 8), cardW - (compact ? 16 : 88), compact ? 6 : 10, v.enemyCharge, '#ffb35b', '#ff3b2f')
    this.drawBuffs(c, v, V.x + pad, top + ph + (compact ? 16 : 18), compact)

    // The strike meter: this is what pedaling does.
    if (compact) bar(c, V.x + 12, V.y + V.h - 18, V.w - 24, 10, v.strike, '#ffd42a', '#e8890c')
    else {
      const mw = V.w * 0.3
      const mx = hx - mw / 2
      const my = hy + 22
      glass(c, mx - 14, my - 8, mw + 28, 58, 14)
      label(c, '⚔️ Next strike', mx, my + 6, { size: 15, color: '#ffd42a', align: 'left' })
      label(c, e.effort <= 0.05 ? 'Pedal!' : e.effort >= 1.25 ? 'Strong!' : 'Steady', mx + mw, my + 6, { size: 15, color: e.effort <= 0.05 ? '#ff6b5b' : '#e9dfc6', align: 'right' })
      bar(c, mx, my + 20, mw, 16, v.strike, '#ffd42a', '#e8890c')
      emoji(c, '🚴', mx + mw + 30, my + 22, 30 + Math.sin(t * 10 * Math.max(0.1, e.effort)) * 2)
    }
  }

  /** A tug of war or a race: the scene, a plate showing the contest, and your pull against theirs. */
  private drawContest(c: CanvasRenderingContext2D, V: Rect, e: Engine, m: BattleMode, v: View, t: number, compact: boolean): void {
    const { hs, es, pad, top } = this.sizes(V, m, compact)
    const tug = v.style === 'tug'
    const ground = V.y + V.h * (compact ? 0.8 : 0.66)
    const heroF = v.heroForce ?? 0
    const foeF = v.enemyForce ?? 0

    if (tug) {
      const mid = V.x + V.w * 0.5
      const reach = V.w * 0.2
      const knot = mid + (knotShare(v.rope) * 2 - 1) * reach
      const gap = V.w * 0.19
      c.save()
      c.strokeStyle = 'rgba(255,255,255,0.85)'
      c.lineWidth = compact ? 2 : 4
      c.setLineDash([10, 8])
      c.beginPath()
      c.moveTo(mid, ground - V.h * 0.1)
      c.lineTo(mid, ground + V.h * 0.12)
      c.stroke()
      c.restore()
      pennant(c, mid - reach, ground + V.h * 0.03, compact ? 18 : 34, '#ffd42a')
      pennant(c, mid + reach, ground + V.h * 0.03, compact ? 18 : 34, '#ff4a3a')
      const hx = knot - gap
      const ex = knot + gap
      const hand = { x: hx + hs * 0.24, y: ground - hs * 0.42 }
      const grip = { x: ex - es * 0.34, y: ground - es * 0.3 }
      const sag = (hand.y + grip.y) / 2 + 6 + Math.sin(t * 22) * (v.surging ? 2.5 : 0.6)
      c.save()
      c.lineCap = 'round'
      c.strokeStyle = '#8a6236'
      c.lineWidth = compact ? 3 : 7
      c.beginPath()
      c.moveTo(hand.x, hand.y)
      c.quadraticCurveTo(knot, sag, grip.x, grip.y)
      c.stroke()
      c.strokeStyle = 'rgba(255,230,170,0.55)'
      c.lineWidth = compact ? 1 : 2
      c.setLineDash([6, 6])
      c.beginPath()
      c.moveTo(hand.x, hand.y - 1)
      c.quadraticCurveTo(knot, sag - 1, grip.x, grip.y - 1)
      c.stroke()
      c.restore()
      const ky = (hand.y + sag * 2 + grip.y) / 4
      c.fillStyle = '#e8342a'
      c.beginPath()
      c.moveTo(knot - 8, ky)
      c.lineTo(knot + 8, ky)
      c.lineTo(knot, ky + (compact ? 14 : 26))
      c.closePath()
      c.fill()
      if (heroF > 1.2) this.puff(hx - hs * 0.15, ground, 1)
      if (v.surging) this.puff(ex + es * 0.2, ground + es * 0.05, -1)
      drawHero(c, hx, ground, hs, t, { walking: heroF > 0.05, speed: 2 + heroF * 3, lunge: -hs * 0.05, flash: this.heroFlash, style: styleOf(e.save) })
      shadow(c, ex, ground + es * 0.08, es * 0.36, es * 0.09, 0.3)
      c.save()
      c.translate(ex + this.enemyLunge * es * 0.1, ground - es * 0.38)
      c.rotate(v.surging ? 0.24 : 0.07)
      emoji(c, m.enemy.emoji, 0, Math.sin(t * (v.surging ? 18 : 3)) * (v.surging ? 4 : 3), es)
      c.restore()
    } else {
      // Side-on, with the camera following the runners: the track slides past, the gap shows who leads, and the
      // flag comes into view near the end. The enemy starts ahead, sprints, then stops to get its breath back.
      const heroP = v.heroPos ?? 0
      const foeP = v.enemyPos ?? 0
      const span = V.w * 1.6
      const cam = (heroP + foeP) / 2
      const X = (p: number): number => V.x + V.w / 2 + (p - cam) * span
      const top = ground - V.h * 0.12
      const bottom = ground + V.h * 0.05
      c.save()
      c.strokeStyle = 'rgba(255,255,255,0.35)'
      c.lineWidth = 2
      for (const y of [top, bottom]) {
        c.beginPath()
        c.moveTo(Math.max(V.x, X(0)), y)
        c.lineTo(Math.min(V.x + V.w, X(1)), y)
        c.stroke()
      }
      for (let k = Math.max(0, Math.floor((cam - 0.4) / 0.025)); k * 0.025 <= Math.min(1, cam + 0.4); k++) {
        c.fillStyle = k === 0 ? '#ffffff' : k % 4 === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)'
        c.fillRect(X(k * 0.025) - (k === 0 ? 3 : 1.5), top, k === 0 ? 6 : 3, bottom - top)
      }
      c.restore()
      if (X(1) < V.x + V.w + 60) chequeredFlag(c, X(1), ground + V.h * 0.03, compact ? 30 : 64)
      const esz = es * 0.6
      const ey = ground - V.h * 0.2
      const ex = clamp(X(foeP), V.x + esz * 0.5, V.x + V.w - esz * 0.5)
      const sprinting = v.surging ?? false
      if (sprinting) this.puff(ex - esz * 0.3, ey + esz * 0.4, -1)
      shadow(c, ex, ey + esz * 0.44, esz * 0.36, esz * 0.08, 0.25)
      c.save()
      c.translate(ex, ey - Math.abs(Math.sin(t * (sprinting ? 16 : 2 + foeF * 3))) * esz * (sprinting ? 0.14 : 0.04))
      c.scale(-1, 1)
      c.rotate(sprinting ? -0.12 : 0)
      emoji(c, m.enemy.emoji, 0, 0, esz)
      c.restore()
      // Stopped to get its breath back.
      if (!sprinting && foeF < 0.5) emoji(c, '💦', ex + esz * 0.45, ey - esz * 0.45 + Math.sin(t * 5) * 3, esz * 0.32)
      const hx = clamp(X(heroP), V.x + hs * 0.3, V.x + V.w - hs * 0.3)
      if (heroF > 1.2) this.puff(hx - hs * 0.2, ground, -1)
      drawHero(c, hx, ground, hs * 0.85, t, { walking: heroF > 0.05, speed: 4 + heroF * 4, flash: this.heroFlash, style: styleOf(e.save) })
    }
    this.drawPuffs(c)

    // One wide plate across the top: the contest at a glance.
    const w = compact ? V.w - pad * 2 : Math.min(V.w * 0.8, 820)
    const x = V.x + (V.w - w) / 2
    const ph = compact ? 50 : 80
    glass(c, x, top, w, ph, compact ? 12 : 16)
    label(c, `${tug ? 'Tug of war' : 'Race'} · ${m.enemy.name}`, x + w / 2, top + (compact ? 13 : 20), { size: compact ? 12 : 19, color: '#ffd42a', font: 'title', weight: 700, maxWidth: w - 20 })
    const bx = x + (compact ? 12 : 30)
    const bw = w - (compact ? 24 : 60)
    const bh = compact ? 12 : 20
    const by = top + (compact ? 26 : 38)
    if (tug) {
      c.save()
      c.beginPath()
      c.roundRect(bx, by, bw, bh, bh / 2)
      c.clip()
      c.fillStyle = '#e8a90c'
      c.fillRect(bx, by, bw / 2, bh)
      c.fillStyle = '#c8392e'
      c.fillRect(bx + bw / 2, by, bw / 2, bh)
      c.fillStyle = 'rgba(255,255,255,0.18)'
      c.fillRect(bx, by, bw, bh * 0.35)
      c.restore()
      c.fillStyle = '#ffffff'
      c.fillRect(bx + bw / 2 - 1, by - 3, 2, bh + 6)
      const kx = bx + bw * knotShare(v.rope)
      c.fillStyle = '#fff8e6'
      c.strokeStyle = '#1a1a2a'
      c.lineWidth = 2
      c.beginPath()
      c.arc(kx, by + bh / 2, bh * 0.72, 0, Math.PI * 2)
      c.fill()
      c.stroke()
      c.fillStyle = '#e8342a'
      c.beginPath()
      c.arc(kx, by + bh / 2, bh * 0.36, 0, Math.PI * 2)
      c.fill()
      if (!compact) {
        label(c, '◀ You win here', bx, by + bh + 14, { size: 13, color: '#ffd42a', align: 'left' })
        label(c, `${m.enemy.name} wins here ▶`, bx + bw, by + bh + 14, { size: 13, color: '#ff9a8a', align: 'right' })
      }
    } else {
      bar(c, bx, by, bw, bh, 0, '#ffffff', '#ffffff')
      emoji(c, '🏁', bx + bw, by + bh / 2, bh * 1.3)
      const pip = (f: number, color: string): number => {
        const px = bx + bw * clamp(f, 0, 1)
        c.fillStyle = color
        c.strokeStyle = '#1a1a2a'
        c.lineWidth = 2
        c.beginPath()
        c.arc(px, by + bh / 2, bh * 0.62, 0, Math.PI * 2)
        c.fill()
        c.stroke()
        return px
      }
      const epx = pip(v.enemyPos ?? 0, '#c8392e')
      emoji(c, m.enemy.emoji, epx, by + bh / 2, bh * 1.0)
      pip(v.heroPos ?? 0, '#ffd42a')
      if (!compact) label(c, 'You', bx + bw * clamp(v.heroPos ?? 0, 0, 1), by + bh + 14, { size: 13, color: '#ffd42a' })
    }
    this.drawBuffs(c, v, x, top + ph + (compact ? 14 : 18), compact)

    // Your pull (or speed) against theirs: this is what pedaling does.
    if (compact) {
      bar(c, V.x + 12, V.y + V.h - 18, V.w - 24, 10, heroF / Math.max(0.5, heroF + foeF), '#ffd42a', '#e8890c')
      return
    }
    const mw = V.w * 0.34
    const mx = V.x + V.w * 0.5 - mw / 2
    const my = V.y + V.h - 132
    const scale = Math.max(1.6, heroF, foeF)
    glass(c, mx - 14, my - 12, mw + 28, 78, 14)
    label(c, tug ? '💪 Your pull' : '🏃 Your speed', mx, my + 2, { size: 14, color: '#ffd42a', align: 'left' })
    label(c, v.surging ? (tug ? 'It heaves! Pull harder!' : 'It sprints! Go go go!') : e.effort <= 0.05 ? 'Pedal!' : e.effort >= 1.25 ? 'Strong!' : 'Steady',
      mx + mw, my + 2, { size: 14, color: v.surging || e.effort <= 0.05 ? '#ff6b5b' : '#e9dfc6', align: 'right' })
    bar(c, mx, my + 14, mw, 14, heroF / scale, '#ffd42a', '#e8890c')
    label(c, `${m.enemy.name}'s ${tug ? 'pull' : 'speed'}`, mx, my + 42, { size: 12, color: '#e9dfc6', align: 'left' })
    bar(c, mx, my + 50, mw, 9, foeF / scale, '#ffb35b', '#ff3b2f')
  }
}

/**
 * Where the tug of war's knot sits: 0 at the hero's end (left, the gold pennant, "◀ You win here") to 1 at the
 * enemy's (right, red). The engine's rope is +1 when the hero wins, and a winner drags the knot to their own side.
 */
export const knotShare = (rope: number | undefined): number => (1 - clamp(rope ?? 0, -1, 1)) / 2

/** A little flag on a pole, standing on (x, y). */
function pennant(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  c.strokeStyle = '#4a3020'
  c.lineWidth = Math.max(2, s * 0.08)
  c.beginPath()
  c.moveTo(x, y)
  c.lineTo(x, y - s)
  c.stroke()
  c.fillStyle = color
  c.beginPath()
  c.moveTo(x, y - s)
  c.lineTo(x + s * 0.6, y - s * 0.82)
  c.lineTo(x, y - s * 0.64)
  c.closePath()
  c.fill()
}

/** The finish line's chequered flag, standing on (x, y). */
function chequeredFlag(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.strokeStyle = '#4a3020'
  c.lineWidth = Math.max(2, s * 0.06)
  c.beginPath()
  c.moveTo(x, y)
  c.lineTo(x, y - s * 1.2)
  c.stroke()
  const cell = s * 0.16
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      c.fillStyle = (i + j) % 2 ? '#1a1a1a' : '#ffffff'
      c.fillRect(x + i * cell, y - s * 1.2 + j * cell, cell, cell)
    }
  }
}
