import type { HeroClass, HeroLook } from '../engine/save.ts'
import { shade, shadow } from './stage.ts'

/** Who to draw: the class sets the silhouette (helmet, hat or hood), the look the build and colours. */
export interface HeroStyle {
  cls: HeroClass | null
  look: HeroLook
}

export interface HeroPose {
  walking?: boolean
  /** Seen from behind (walking up the road). */
  back?: boolean
  /** 0–1 red flash when hit. */
  flash?: number
  /** Horizontal offset for an attack lunge. */
  lunge?: number
  /** Walk cycle speed. */
  speed?: number
  style?: HeroStyle
}

export const styleOf = (s: { heroClass: HeroClass | null; look: HeroLook }): HeroStyle => ({ cls: s.heroClass, look: s.look })

const DEFAULT: HeroStyle = { cls: null, look: { body: 'sturdy', skin: 'medium-light', outfit: 'blue', hair: 'brown', hairLength: 'short' } }
const OUTFIT: Record<HeroLook['outfit'], [string, string]> = {
  blue: ['#5a8cf0', '#2c52ad'], red: ['#f0725a', '#b0322a'], green: ['#62c46e', '#2c8a45'],
  purple: ['#a57ae8', '#5a3aa8'], gold: ['#f2c85a', '#b8862c'], black: ['#6a6a80', '#2a2a38'],
}
const HAIR: Record<HeroLook['hair'], string | null> = {
  brown: '#6b4226', blond: '#e8c86a', red: '#c0502a', black: '#2a2020', white: '#ecebf2', none: null,
}
/** How far down the hair falls (y, as a share of the hero's height; the feet are at 0). */
const HAIR_END: Record<HeroLook['hairLength'], number> = { short: -0.74, shoulder: -0.6, long: -0.42 }
/** Width and height for each build. */
const BUILD: Record<HeroLook['body'], [number, number]> = { sturdy: [1.06, 0.98], slim: [0.88, 1], tall: [0.94, 1.1] }
const CAPE: Record<HeroClass, string> = { knight: '#a82a22', mage: '#3a2a6a', ranger: '#35632e' }
/** Face colours for the five emoji skin tones. */
const SKIN: Record<HeroLook['skin'], string> = {
  light: '#f7dcc6', 'medium-light': '#f2c9a0', medium: '#d6a47a', 'medium-dark': '#a8714a', dark: '#6b4430',
}
/** Where the right hand holds the class's weapon, facing us (share of height). */
const GRIP: Record<HeroClass, [number, number]> = { knight: [0.26, -0.42], mage: [0.27, -0.46], ranger: [0.4, -0.52] }

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fill()
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath()
  c.arc(x, y, r, 0, Math.PI * 2)
  c.fill()
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const d = i % 2 ? r * 0.45 : r
    c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d)
  }
  c.closePath()
  c.fill()
}

/**
 * A lock of hair beside the face, from `top` down to `bottom`: full where it leaves the head, swelling a little
 * over the shoulder and tapering to a soft point. Side −1 is the left.
 */
function lock(c: CanvasRenderingContext2D, side: 1 | -1, inner: number, outer: number, top: number, bottom: number): void {
  const w = outer - inner
  const long = bottom - top
  const tip = inner + w * 0.55 + long * 0.08
  c.beginPath()
  c.moveTo(side * inner, top)
  c.bezierCurveTo(side * (inner - w * 0.1), top + long * 0.45, side * (tip - w * 0.35), bottom - long * 0.15, side * tip, bottom)
  c.bezierCurveTo(side * (tip + w * 0.45), bottom - long * 0.2, side * (outer + w * 0.35), top + long * 0.4, side * outer, top)
  c.closePath()
  c.fill()
}

/** A sleeve from the shoulder to the hand. */
function arm(c: CanvasRenderingContext2D, color: string, x0: number, y0: number, x1: number, y1: number, w: number): void {
  c.strokeStyle = color
  c.lineWidth = w
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(x0, y0)
  c.lineTo(x1, y1)
  c.stroke()
}

/**
 * The hero: a knight (helmet, plume, cape and sword), a mage (pointed hat, robe and staff) or a ranger (hood,
 * cloak and bow), in the chosen build and colours. (x, y) is the feet; `s` the height.
 */
export function drawHero(c: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, o: HeroPose = {}): void {
  const style = o.style ?? DEFAULT
  const cls = style.cls ?? 'knight'
  const [wide, tall] = BUILD[style.look.body]
  const [light, dark] = OUTFIT[style.look.outfit]
  const hair = HAIR[style.look.hair]
  const skin = SKIN[style.look.skin] ?? SKIN['medium-light']
  const len = style.look.hairLength ?? 'short'
  const phase = t * (o.speed ?? 9)
  const bob = o.walking ? Math.abs(Math.sin(phase)) * s * 0.05 : Math.sin(t * 2) * s * 0.012
  const step = o.walking ? Math.sin(phase) : 0
  const lunge = o.lunge ?? 0
  shadow(c, x + lunge, y, s * 0.26 * wide, s * 0.07, 0.28)
  c.save()
  c.translate(x + lunge, y - bob)
  c.scale(wide, tall)

  // Legs; a mage's robe hides all but the boots.
  c.fillStyle = '#3a2a1c'
  if (cls === 'mage') {
    rr(c, -s * 0.13, -s * 0.08 + step * s * 0.02, s * 0.1, s * 0.08, s * 0.03)
    rr(c, s * 0.03, -s * 0.08 - step * s * 0.02, s * 0.1, s * 0.08, s * 0.03)
  } else {
    rr(c, -s * 0.14, -s * 0.22 + step * s * 0.03, s * 0.1, s * 0.22, s * 0.04)
    rr(c, s * 0.04, -s * 0.22 - step * s * 0.03, s * 0.1, s * 0.22, s * 0.04)
  }

  // A cape or cloak behind; a mage's robe reaches the ground instead.
  const sway = o.walking ? Math.sin(phase + 1) * s * 0.03 : Math.sin(t * 1.5) * s * 0.01
  if (cls === 'mage') {
    const g = c.createLinearGradient(0, -s * 0.68, 0, 0)
    g.addColorStop(0, o.back ? dark : light)
    g.addColorStop(1, dark)
    c.fillStyle = g
    c.beginPath()
    c.moveTo(-s * 0.18, -s * 0.68)
    c.lineTo(s * 0.18, -s * 0.68)
    c.quadraticCurveTo(s * 0.23, -s * 0.3, s * 0.28 + sway * 0.5, -s * 0.05)
    c.lineTo(-s * 0.28 + sway * 0.5, -s * 0.05)
    c.quadraticCurveTo(-s * 0.23, -s * 0.3, -s * 0.18, -s * 0.68)
    c.fill()
    if (!o.back) {
      c.fillStyle = '#e8c46a'
      c.fillRect(-s * 0.2, -s * 0.42, s * 0.4, s * 0.04)
      c.fillStyle = 'rgba(255,240,170,0.85)'
      star(c, -s * 0.08, -s * 0.24, s * 0.035)
      star(c, s * 0.09, -s * 0.14, s * 0.025)
    }
  } else {
    c.fillStyle = o.back ? shade(CAPE[cls], 0.12) : CAPE[cls]
    c.beginPath()
    c.moveTo(-s * 0.2, -s * 0.64)
    c.lineTo(s * 0.2, -s * 0.64)
    c.lineTo(s * 0.28 + sway, -s * (cls === 'ranger' ? 0.1 : 0.15))
    c.quadraticCurveTo(sway, -s * 0.06, -s * 0.28 + sway, -s * (cls === 'ranger' ? 0.1 : 0.15))
    c.closePath()
    c.fill()
    if (!o.back) {
      const g = c.createLinearGradient(0, -s * 0.68, 0, -s * 0.2)
      g.addColorStop(0, light)
      g.addColorStop(1, dark)
      c.fillStyle = g
      rr(c, -s * 0.19, -s * 0.68, s * 0.38, s * 0.48, s * 0.13)
      if (cls === 'knight') {
        c.fillStyle = '#e8b33a'
        c.fillRect(-s * 0.19, -s * 0.35, s * 0.38, s * 0.05)
        c.fillStyle = '#ffd42a'
        dot(c, 0, -s * 0.52, s * 0.05)
      } else {
        c.fillStyle = '#6b4226'
        c.fillRect(-s * 0.19, -s * 0.35, s * 0.38, s * 0.045)
        c.strokeStyle = '#6b4226'
        c.lineWidth = s * 0.035
        c.beginPath()
        c.moveTo(-s * 0.14, -s * 0.64)
        c.lineTo(s * 0.14, -s * 0.36)
        c.stroke()
      }
    }
  }

  // Arms, and what the right hand holds: a sword, a staff or a bow (and a quiver, seen from behind).
  const sleeve = o.back && cls !== 'mage' ? shade(CAPE[cls], 0.05) : dark
  const left: [number, number] = [-s * 0.26, -s * 0.4 - step * s * 0.03]
  const right: [number, number] = o.back ? [s * 0.26, -s * 0.4 + step * s * 0.03] : [s * GRIP[cls][0], s * GRIP[cls][1] + step * s * 0.015]
  arm(c, sleeve, -s * 0.23, -s * 0.6, left[0], left[1], s * 0.1)
  arm(c, sleeve, s * 0.23, -s * 0.6, right[0], right[1], s * 0.1)
  const [gx, gy] = right
  if (!o.back && cls === 'knight') {
    c.fillStyle = '#dfe4ee'
    c.beginPath()
    c.moveTo(gx - s * 0.02, gy - s * 0.06)
    c.lineTo(gx - s * 0.02, gy - s * 0.44)
    c.lineTo(gx, gy - s * 0.5)
    c.lineTo(gx + s * 0.02, gy - s * 0.44)
    c.lineTo(gx + s * 0.02, gy - s * 0.06)
    c.closePath()
    c.fill()
    c.fillStyle = '#aeb6c4'
    c.fillRect(gx, gy - s * 0.44, s * 0.02, s * 0.38)
    c.fillStyle = '#6b4226'
    c.fillRect(gx - s * 0.015, gy - s * 0.04, s * 0.03, s * 0.09)
    c.fillStyle = '#c99a2e'
    rr(c, gx - s * 0.075, gy - s * 0.075, s * 0.15, s * 0.03, s * 0.012)
    dot(c, gx, gy + s * 0.06, s * 0.022)
  } else if (!o.back && cls === 'mage') {
    c.fillStyle = '#7a5230'
    rr(c, gx - s * 0.02, -s * 1.02, s * 0.04, s * 0.98, s * 0.02)
    const orb = c.createRadialGradient(gx, -s * 1.06, 0, gx, -s * 1.06, s * 0.09)
    orb.addColorStop(0, '#ffffff')
    orb.addColorStop(0.45, '#8fe0ff')
    orb.addColorStop(1, 'rgba(90,160,255,0)')
    c.fillStyle = orb
    dot(c, gx, -s * 1.06, s * 0.09)
  } else if (!o.back && cls === 'ranger') {
    const r = s * 0.3
    const a = Math.PI * 0.42
    const cx = gx - r
    c.strokeStyle = '#8a5a2a'
    c.lineWidth = s * 0.035
    c.lineCap = 'round'
    c.beginPath()
    c.arc(cx, gy, r, -a, a)
    c.stroke()
    c.strokeStyle = 'rgba(255,255,255,0.75)'
    c.lineWidth = s * 0.01
    c.beginPath()
    c.moveTo(cx + Math.cos(a) * r, gy - Math.sin(a) * r)
    c.lineTo(cx + Math.cos(a) * r, gy + Math.sin(a) * r)
    c.stroke()
  } else if (o.back && cls === 'ranger') {
    c.fillStyle = '#7a5230'
    rr(c, s * 0.02, -s * 0.72, s * 0.1, s * 0.34, s * 0.03)
    c.fillStyle = '#f2efe6'
    for (const dx of [0.04, 0.07, 0.1]) dot(c, s * dx, -s * 0.74, s * 0.02)
  }
  c.fillStyle = skin
  dot(c, left[0], left[1], s * 0.045)
  dot(c, right[0], right[1], s * 0.045)

  // Head: a ranger's hood goes behind the face; then ears, the face, hair, and a helmet or hat on top.
  if (cls === 'ranger') {
    c.fillStyle = CAPE.ranger
    dot(c, 0, -s * 0.81, s * 0.22)
    rr(c, -s * 0.2, -s * 0.8, s * 0.4, s * 0.16, s * 0.06)
    if (o.back) {
      c.beginPath()
      c.moveTo(-s * 0.07, -s * 1.0)
      c.lineTo(0, -s * 1.1)
      c.lineTo(s * 0.07, -s * 1.0)
      c.fill()
    }
  }
  if (!(cls === 'ranger' && o.back)) {
    const faceR = cls === 'ranger' ? s * 0.145 : s * 0.17
    if (cls !== 'ranger') {
      c.fillStyle = shade(skin, -0.06)
      for (const d of [-1, 1]) dot(c, d * s * 0.165, -s * 0.745, s * 0.034)
    }
    const fg = c.createRadialGradient(-s * 0.05, -s * 0.87, s * 0.02, 0, -s * 0.8, faceR)
    fg.addColorStop(0, shade(skin, 0.12))
    fg.addColorStop(1, shade(skin, -0.08))
    c.fillStyle = fg
    dot(c, 0, -s * 0.8, faceR)
  }
  if (hair) {
    const end = s * HAIR_END[len]
    c.fillStyle = hair
    if (cls === 'ranger') {
      // The hood hides all but a fringe, and any hair long enough to fall out of it.
      if (o.back) {
        if (len !== 'short') rr(c, -s * 0.05, -s * 0.66, s * 0.1, end + s * 0.62, s * 0.05)
      } else {
        c.beginPath()
        c.ellipse(0, -s * 0.9, s * 0.13, s * 0.05, 0, Math.PI, Math.PI * 2)
        c.fill()
        if (len !== 'short') for (const d of [-1, 1] as const) lock(c, d, s * 0.095, s * 0.16, -s * 0.8, end + s * 0.04)
      }
    } else if (o.back) {
      // From behind: hair down the back, rounded at the ends.
      const top = cls === 'mage' ? -s * 0.9 : -s * 0.8
      const h = end - top + (cls === 'mage' ? s * 0.06 : s * 0.02)
      c.beginPath()
      c.roundRect(-s * 0.16, top, s * 0.32, h, [s * 0.08, s * 0.08, s * 0.14, s * 0.14])
      c.fill()
    } else {
      for (const d of [-1, 1] as const) lock(c, d, s * 0.13, s * 0.215, -s * 0.86, end)
      if (cls === 'mage') {
        c.beginPath()
        c.ellipse(0, -s * 0.85, s * 0.15, s * 0.035, 0, 0, Math.PI * 2)
        c.fill()
      }
    }
  }
  if (cls === 'knight') {
    const hg = c.createLinearGradient(0, -s * 1, 0, -s * 0.78)
    hg.addColorStop(0, '#f7f9fd')
    hg.addColorStop(1, '#9aa3b5')
    c.fillStyle = hg
    c.beginPath()
    c.arc(0, -s * 0.8, s * 0.185, Math.PI, 0)
    if (o.back) {
      c.lineTo(s * 0.185, -s * 0.7)
      c.lineTo(-s * 0.185, -s * 0.7)
    }
    c.closePath()
    c.fill()
    c.fillStyle = '#7f889b'
    rr(c, -s * 0.195, -s * 0.815, s * 0.39, s * 0.035, s * 0.015)
    c.fillStyle = 'rgba(255,255,255,0.55)'
    c.beginPath()
    c.ellipse(-s * 0.07, -s * 0.92, s * 0.05, s * 0.025, -0.5, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#e8342a'
    c.beginPath()
    c.ellipse(-s * 0.03, -s * 1.02, s * 0.05, s * 0.11, -0.4, 0, Math.PI * 2)
    c.fill()
  } else if (cls === 'mage') {
    c.fillStyle = dark
    c.beginPath()
    c.ellipse(0, -s * 0.9, s * 0.27, s * 0.06, 0, 0, Math.PI * 2)
    c.fill()
    c.beginPath()
    c.moveTo(-s * 0.17, -s * 0.91)
    c.quadraticCurveTo(-s * 0.06, -s * 1.2, s * 0.13, -s * 1.42)
    c.quadraticCurveTo(s * 0.03, -s * 1.15, s * 0.17, -s * 0.91)
    c.closePath()
    c.fill()
    c.fillStyle = '#e8c46a'
    c.fillRect(-s * 0.16, -s * 0.97, s * 0.32, s * 0.04)
    if (!o.back) star(c, -s * 0.02, -s * 1.08, s * 0.045)
  }

  // The face: eyes set wide and low with a glint, brows where the forehead shows, rosy cheeks and a smile.
  if (!o.back) {
    const k = cls === 'ranger' ? 0.86 : 1
    const ey = -s * (cls === 'ranger' ? 0.775 : cls === 'mage' ? 0.75 : 0.745)
    const ex = s * 0.07 * k
    if (cls !== 'knight') {
      c.strokeStyle = hair ?? shade(skin, -0.45)
      c.lineWidth = s * 0.014
      c.lineCap = 'round'
      for (const d of [-1, 1]) {
        c.beginPath()
        c.moveTo(d * (ex - s * 0.026 * k), ey - s * 0.048 * k)
        c.quadraticCurveTo(d * ex, ey - s * 0.062 * k, d * (ex + s * 0.026 * k), ey - s * 0.05 * k)
        c.stroke()
      }
    }
    c.fillStyle = '#1e1410'
    for (const d of [-1, 1]) {
      c.beginPath()
      c.ellipse(d * ex, ey, s * 0.022 * k, s * 0.03 * k, 0, 0, Math.PI * 2)
      c.fill()
    }
    c.fillStyle = 'rgba(255,255,255,0.9)'
    for (const d of [-1, 1]) dot(c, d * ex + s * 0.008 * k, ey - s * 0.011 * k, s * 0.008 * k)
    c.fillStyle = 'rgba(255,110,110,0.35)'
    for (const d of [-1, 1]) {
      c.beginPath()
      c.ellipse(d * (ex + s * 0.035 * k), ey + s * 0.045 * k, s * 0.03 * k, s * 0.018 * k, 0, 0, Math.PI * 2)
      c.fill()
    }
    c.strokeStyle = shade(skin, -0.5)
    c.lineWidth = s * 0.013 * k
    c.lineCap = 'round'
    c.beginPath()
    c.arc(0, ey + s * 0.035 * k, s * 0.028 * k, Math.PI * 0.2, Math.PI * 0.8)
    c.stroke()
  }
  c.restore()

  if (o.flash && o.flash > 0) {
    c.save()
    c.fillStyle = `rgba(255,60,60,${0.45 * o.flash})`
    c.beginPath()
    c.ellipse(x + lunge, y - s * 0.5 * tall, s * 0.36 * wide, s * 0.56 * tall, 0, 0, Math.PI * 2)
    c.fill()
    c.restore()
  }
}
