/**
 * The last few minutes, as a chart: what you have actually been doing against what the console asked for,
 * with heart rate over the top. It is the readout that answers "am I fading?", which no single number can.
 *
 * Two scales share one box — effort on the left and heart rate on the right — because they are read
 * together and there is only so much room. The heart-rate line takes the colour of the zone it is in, so it
 * agrees with the zone strip without a legend.
 *
 * Effort is in bike-equivalent watts on both machines (`treadmillWatts` for a belt), which is the platform's
 * own way of putting a walk and a ride on one scale. It also means a hills programme, which changes the
 * incline and not the pace, draws as hills rather than as a flat line.
 */
import type { TrendPoint } from '../workout.ts'
import { zoneColour } from '../zones.ts'

const GRID = '#1d2632'
const AXIS = '#4d5a6b'
const YOU = '#ff6a3d'
const YOU_FILL = 'rgba(255, 106, 61, 0.16)'
const TARGET = '#56bdf7'

export interface TrendOptions {
  /** How many seconds to show. */
  window: number
  maxHr: number
}

export interface TrendView {
  layout(): void
  draw(points: readonly TrendPoint[], now: number): void
}

export function createTrendView(canvas: HTMLCanvasElement, opts: TrendOptions): TrendView {
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

  const valueOf = (p: TrendPoint): number | null => p.effort

  function draw(points: readonly TrendPoint[], now: number): void {
    const g = canvas.getContext('2d')
    if (!g) return
    if (canvas.width === 0) layout()
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const padTop = 4
    const padBottom = 13
    const padRight = 30
    const padLeft = 32
    const plotW = Math.max(1, w - padLeft - padRight)
    const plotH = Math.max(1, h - padTop - padBottom)
    const from = now - opts.window
    const x = (t: number): number => padLeft + ((t - from) / opts.window) * plotW

    const visible = points.filter((p) => p.t >= from)

    // The scale comes from what is on screen, not from the whole buffer: a sprint ten minutes ago must not
    // flatten the last six minutes into a line along the bottom.
    let top = 0
    for (const p of visible) {
      const v = valueOf(p)
      if (v !== null) top = Math.max(top, v)
      if (p.target !== null) top = Math.max(top, p.target)
    }
    top = top > 0 ? top * 1.2 : 1
    const y = (v: number): number => padTop + plotH - (v / top) * plotH

    g.strokeStyle = GRID
    g.lineWidth = 1
    for (let i = 0; i <= 2; i++) {
      const yy = Math.round(padTop + (plotH * i) / 2) + 0.5
      g.beginPath()
      g.moveTo(padLeft, yy)
      g.lineTo(padLeft + plotW, yy)
      g.stroke()
    }

    if (visible.length >= 2) {
      // What you did, as an area.
      g.beginPath()
      let started = false
      for (const p of visible) {
        const v = valueOf(p)
        if (v === null) continue
        const px = x(p.t)
        if (!started) {
          g.moveTo(px, y(v))
          started = true
        } else g.lineTo(px, y(v))
      }
      if (started) {
        const last = visible[visible.length - 1]!
        g.lineTo(x(last.t), padTop + plotH)
        g.lineTo(x(visible[0]!.t), padTop + plotH)
        g.closePath()
        g.fillStyle = YOU_FILL
        g.fill()
      }
      line(g, visible, (p) => valueOf(p), x, y, YOU, 2)
      // What was asked for, dashed, so it reads as an instruction rather than a measurement.
      g.setLineDash([4, 4])
      line(g, visible, (p) => p.target, x, y, TARGET, 1.5)
      g.setLineDash([])

      // Heart rate on its own scale, 40 bpm to max, coloured by the zone it ends in.
      const hy = (bpm: number): number => padTop + plotH - ((bpm - 40) / Math.max(1, opts.maxHr - 40)) * plotH
      const lastHr = [...visible].reverse().find((p) => p.heartRate !== null)?.heartRate ?? null
      if (lastHr !== null) {
        const zone = Math.min(5, Math.max(1, Math.ceil((lastHr / opts.maxHr - 0.5) * 10)))
        line(g, visible, (p) => p.heartRate, x, hy, zoneColour(zone), 1.8)
      }
    }

    // Axis words, small and out of the way.
    g.font = '500 10px ui-monospace, Menlo, monospace'
    g.fillStyle = AXIS
    g.textBaseline = 'middle'
    g.textAlign = 'right'
    g.fillText(`${Math.round(top)}W`, padLeft - 4, padTop + 5)
    g.textAlign = 'left'
    g.fillText(`${opts.maxHr}`, padLeft + plotW + 4, padTop + 5)
    g.fillText('bpm', padLeft + plotW + 4, padTop + plotH - 4)
    g.textAlign = 'center'
    g.textBaseline = 'top'
    g.fillText(`last ${Math.round(opts.window / 60)} min`, padLeft + plotW / 2, padTop + plotH + 2)
  }

  layout()
  return { layout, draw }
}

function line(
  g: CanvasRenderingContext2D,
  points: readonly TrendPoint[],
  of: (p: TrendPoint) => number | null,
  x: (t: number) => number,
  y: (v: number) => number,
  colour: string,
  width: number,
): void {
  g.beginPath()
  let pen = false
  for (const p of points) {
    const v = of(p)
    if (v === null) {
      pen = false // a gap in the readings is drawn as a gap, not bridged
      continue
    }
    const px = x(p.t)
    const py = y(v)
    if (!pen) {
      g.moveTo(px, py)
      pen = true
    } else g.lineTo(px, py)
  }
  g.strokeStyle = colour
  g.lineWidth = width
  g.lineJoin = 'round'
  g.stroke()
}
