/**
 * The programme chart: every segment of the workout as a bar, the one you are in lit up, and a playhead.
 * It is the picture people actually steer by — how much is left, and how bad the next bit is.
 *
 * A bar's height is `intensity()`: 1.0 is the base the player dialled in, and a hill counts as the watts it
 * would cost. So the same programme has the same silhouette on a treadmill and on a bike.
 */
import { intensity } from '../drive.ts'
import type { Segment, Workout as Plan } from '../program.ts'

const COLOUR: Record<string, string> = {
  warmup: '#33475e',
  cooldown: '#33475e',
  steady: '#3f6d93',
  recover: '#3f6d93',
  work: '#c85a33',
}
const COLOUR_NOW: Record<string, string> = {
  warmup: '#5b7da3',
  cooldown: '#5b7da3',
  steady: '#6fb2e8',
  recover: '#6fb2e8',
  work: '#ff6a3d',
}
const GRID = '#1e2837'
const PLAYHEAD = '#e9edf4'
const TEXT = '#5a6675'

export interface ProfileView {
  layout(): void
  /** `t` is active seconds; pass null on the setup screen, where nothing is running yet. */
  draw(plan: Plan, t: number | null): void
}

export function createProfileView(canvas: HTMLCanvasElement, opts: { labels?: boolean } = {}): ProfileView {
  let dpr = 1
  let w = 0
  let h = 0

  function layout(): void {
    dpr = Math.min(3, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    w = Math.max(1, Math.round(rect.width))
    h = Math.max(1, Math.round(rect.height))
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }

  function draw(plan: Plan, t: number | null): void {
    const g = canvas.getContext('2d')
    if (!g) return
    if (canvas.width === 0) layout()
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const bottom = opts.labels ? h - 13 : h - 1
    const top = 3
    const peak = Math.max(1.25, ...plan.segments.map(intensity))
    const floor = 0.45
    const y = (v: number): number => bottom - ((v - floor) / (peak - floor)) * (bottom - top)
    const x = (secs: number): number => (secs / plan.duration) * w

    // A line at 1.0 — "the pace you set" — so a bar above it reads as "harder than you asked for".
    g.strokeStyle = GRID
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(0, Math.round(y(1)) + 0.5)
    g.lineTo(w, Math.round(y(1)) + 0.5)
    g.stroke()

    const now = t ?? -1
    for (const s of plan.segments) {
      const x0 = x(s.t0)
      const x1 = x(s.t1)
      const live = now >= s.t0 && now < s.t1
      const done = now >= s.t1
      const top0 = y(intensity(s))
      g.fillStyle = (live ? COLOUR_NOW : COLOUR)[s.kind] ?? COLOUR.steady!
      g.globalAlpha = done ? 0.4 : live ? 1 : 0.85
      g.fillRect(x0, top0, Math.max(1, x1 - x0 - 1), bottom - top0)
    }
    g.globalAlpha = 1

    if (t !== null) {
      const px = Math.round(x(t)) + 0.5
      g.strokeStyle = PLAYHEAD
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(px, top - 2)
      g.lineTo(px, bottom)
      g.stroke()
    }

    if (opts.labels) {
      g.fillStyle = TEXT
      g.font = '500 10px ui-monospace, Menlo, monospace'
      g.textBaseline = 'top'
      const minutes = plan.duration / 60
      const every = minutes <= 20 ? 5 : minutes <= 45 ? 10 : 15
      const rightEdge = w - 26 // "min" lives here; a number that would collide is left out
      for (let m = 0; m <= minutes + 0.01; m += every) {
        const px = x(m * 60)
        if (m > 0 && px > rightEdge) continue
        g.textAlign = m === 0 ? 'left' : 'center'
        g.fillText(`${m}`, Math.max(1, px), bottom + 3)
      }
      g.textAlign = 'right'
      g.fillText('min', w - 1, bottom + 3)
    }
  }

  layout()
  return { layout, draw }
}

/** The bar colour for a segment, so the banner and the chart agree. */
export function segmentColour(s: Segment): string {
  return COLOUR_NOW[s.kind] ?? COLOUR_NOW.steady!
}
