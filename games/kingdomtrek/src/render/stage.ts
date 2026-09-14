/** The canvas, the free area beside the panel, and small drawing helpers (emoji sprites, labels, bars). */

export interface Rect { x: number; y: number; w: number; h: number }

export const FONT_UI = '"Baloo 2", "Trebuchet MS", system-ui, sans-serif'
export const FONT_TITLE = 'Cinzel, Georgia, "Times New Roman", serif'
const FONT_EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

export class Stage {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  w = 1
  h = 1
  dpr = 1
  /** Where scenes put what matters: below the HUD, left of the choice panel. */
  view: Rect = { x: 0, y: 0, w: 1, h: 1 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
  }

  begin(): CanvasRenderingContext2D {
    const c = this.ctx
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, this.w, this.h)
    return c
  }

  /** The panel sits on the right on wide screens and along the bottom on narrow ones (phones). */
  measure(hud: HTMLElement, panel: HTMLElement): void {
    const top = Math.round(hud.getBoundingClientRect().bottom)
    const p = panel.getBoundingClientRect()
    if (p.width > this.w * 0.6) this.view = { x: 0, y: top, w: this.w, h: Math.max(160, Math.round(p.top) - top) }
    else this.view = { x: 0, y: top, w: Math.max(240, Math.round(p.left)), h: Math.max(240, this.h - top) }
  }
}

// --- emoji as cached sprites --------------------------------------------------------------

const sprites = new Map<string, HTMLCanvasElement>()

/** Draw an emoji centred on (x, y), `size` px tall. Rendered once per size bucket, then blitted. */
export function emoji(c: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number): void {
  const px = Math.max(12, Math.min(480, Math.round(size / 8) * 8))
  const key = `${ch}@${px}`
  let img = sprites.get(key)
  if (!img) {
    img = document.createElement('canvas')
    const pad = Math.ceil(px * 0.3)
    const scale = 2
    img.width = img.height = (px + pad * 2) * scale
    const s = img.getContext('2d')!
    s.scale(scale, scale)
    s.font = `${px}px ${FONT_EMOJI}`
    s.textAlign = 'center'
    s.textBaseline = 'middle'
    s.fillText(ch, px / 2 + pad, px / 2 + pad + px * 0.05)
    sprites.set(key, img)
  }
  const full = (img.width / 2) * (size / px)
  c.drawImage(img, x - full / 2, y - full / 2, full, full)
}

// --- text, shapes, bars ------------------------------------------------------------------

export interface LabelOpts {
  size: number
  color?: string
  font?: 'ui' | 'title'
  weight?: number
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  stroke?: string
  shadow?: boolean
  maxWidth?: number
}

export function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, o: LabelOpts): void {
  c.save()
  c.font = `${o.weight ?? 700} ${o.size}px ${o.font === 'title' ? FONT_TITLE : FONT_UI}`
  c.textAlign = o.align ?? 'center'
  c.textBaseline = o.baseline ?? 'middle'
  if (o.shadow) {
    c.shadowColor = 'rgba(0,0,0,0.5)'
    c.shadowBlur = o.size * 0.3
    c.shadowOffsetY = o.size * 0.08
  }
  if (o.stroke) {
    c.lineWidth = Math.max(2, o.size * 0.18)
    c.lineJoin = 'round'
    c.strokeStyle = o.stroke
    c.strokeText(text, x, y, o.maxWidth)
  }
  c.fillStyle = o.color ?? '#fff'
  c.fillText(text, x, y, o.maxWidth)
  c.restore()
}

/** A rounded label plate centred on (x, y). */
export function pill(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, bg: string, fg: string, border?: string): void {
  c.save()
  c.font = `700 ${size}px ${FONT_UI}`
  const w = c.measureText(text).width + size * 1.2
  const h = size * 1.55
  c.beginPath()
  c.roundRect(x - w / 2, y - h / 2, w, h, h / 2)
  c.fillStyle = bg
  c.fill()
  if (border) {
    c.lineWidth = 2
    c.strokeStyle = border
    c.stroke()
  }
  c.fillStyle = fg
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(text, x, y + size * 0.06)
  c.restore()
}

export function shadow(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha = 0.25): void {
  c.save()
  c.fillStyle = `rgba(0,0,0,${alpha})`
  c.beginPath()
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  c.fill()
  c.restore()
}

export function bar(
  c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, from: string, to: string, bg = 'rgba(0,0,0,0.4)',
): void {
  c.save()
  c.beginPath()
  c.roundRect(x, y, w, h, h / 2)
  c.fillStyle = bg
  c.fill()
  const f = Math.max(0, Math.min(1, frac))
  if (f > 0) {
    const g = c.createLinearGradient(x, 0, x + w, 0)
    g.addColorStop(0, from)
    g.addColorStop(1, to)
    c.beginPath()
    c.roundRect(x, y, Math.max(h, w * f), h, h / 2)
    c.fillStyle = g
    c.fill()
  }
  c.beginPath()
  c.roundRect(x + 2, y + 2, w - 4, h * 0.35, h / 3)
  c.fillStyle = 'rgba(255,255,255,0.15)'
  c.fill()
  c.restore()
}

/** A dark glass card. */
export function glass(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 16): void {
  c.save()
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fillStyle = 'rgba(18,16,34,0.72)'
  c.fill()
  c.lineWidth = 1.5
  c.strokeStyle = 'rgba(255,212,42,0.45)'
  c.stroke()
  c.restore()
}

/** '#rrggbb' with an alpha. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Lighten (amt > 0) or darken (amt < 0) a '#rrggbb' colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number): number => Math.round(Math.max(0, Math.min(255, amt > 0 ? v + (255 - v) * amt : v * (1 + amt))))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
