/**
 * The track, seen from above. Deliberately plain — a 400 m oval drawn to scale, you going round it, and the
 * pace marker showing where the programme meant you to be — and then made as good-looking as a plain thing
 * can be: a lit surface, real lane numbers, a chequered finish, and a ring round the outside that fills as
 * the goal is met.
 *
 * The oval never changes, so it is drawn once onto an off-screen canvas and blitted each frame; only the
 * markers, their trails and the progress ring are redrawn. A frame costs a fraction of a millisecond, which
 * matters when the same machine is also talking to a treadmill.
 */
import { Config } from '../config.ts'
import { extent, laneLineRadius, laneRadius, lapLength, LANES, ovalAt, pointAt, samples, STRAIGHT } from '../track.ts'
import { zoneColour } from '../zones.ts'

const COLOUR = {
  backdropTop: '#141b26',
  backdropBottom: '#0d1219',
  surface: '#9c4b34',
  surfaceLit: '#b65d42',
  surfaceShade: '#7c3a28',
  infield: '#1d3a2a',
  infieldLit: '#264c36',
  /** The kerb: the one line on a track that is properly painted. */
  kerb: '#f2ece6',
  /** Lane lines are thin and quiet, so the surface reads as a surface and not as stripes. */
  lane: '#f2ece63d',
  laneNumber: '#f2ece676',
  you: '#ff6a3d',
  pacer: '#56bdf7',
  ring: '#ff7a4f',
  ringTrack: '#ffffff0b',
}

/** How long the fading trail behind a marker is, in metres of track. */
const TRAIL = 30
/** How far outside lane 8 the goal ring runs, in metres. */
const RING_OUT = 3.2

export interface TrackFrame {
  /** Metres run, and where the programme's pace marker has got to (null hides it). */
  you: number
  pacer: number | null
  /** Heart-rate zone 1–5, or 0: the ring round the runner takes its colour. */
  zone: number
  /** 0–1 of the goal, drawn as a ring outside the track. */
  progress: number
  /** Dim everything: the workout is paused or has not started. */
  dim: boolean
}

export interface TrackView {
  /** Re-measure and redraw the fixed part. Call on resize. */
  layout(): void
  draw(f: TrackFrame): void
  readonly canvas: HTMLCanvasElement
}

export function createTrackView(canvas: HTMLCanvasElement): TrackView {
  let dpr = 1
  let w = 0
  let h = 0
  let scale = 1
  let ox = 0
  let oy = 0
  const back = document.createElement('canvas')

  /** Track metres → canvas pixels. y is flipped: the world has y up, the canvas has it down. */
  const px = (x: number, y: number): [number, number] => [ox + x * scale, oy - y * scale]

  function layout(): void {
    dpr = Math.min(3, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    w = Math.max(1, Math.round(rect.width))
    h = Math.max(1, Math.round(rect.height))
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const e = extent()
    const pad = 14
    // The progress ring sits outside lane 8, so it has to be inside the fit or it gets clipped.
    const halfW = e.halfWidth + RING_OUT + 2
    const halfH = e.halfHeight + RING_OUT + 2
    scale = Math.min((w - 2 * pad) / (2 * halfW), (h - 2 * pad) / (2 * halfH))
    ox = w / 2
    oy = h / 2
    back.width = canvas.width
    back.height = canvas.height
    drawFixed()
  }

  function drawFixed(): void {
    const g = back.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)

    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, COLOUR.backdropTop)
    sky.addColorStop(1, COLOUR.backdropBottom)
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)

    // The surface: fill out to the outside of lane 8, then cut the infield back out of it.
    ringPath(g, laneLineRadius(LANES + 1))
    const lit = g.createLinearGradient(0, oy - h / 2, 0, oy + h / 2)
    lit.addColorStop(0, COLOUR.surfaceLit)
    lit.addColorStop(0.55, COLOUR.surface)
    lit.addColorStop(1, COLOUR.surfaceShade)
    g.fillStyle = lit
    g.fill()

    ringPath(g, laneLineRadius(1))
    const grass = g.createLinearGradient(0, oy - h / 2, 0, oy + h / 2)
    grass.addColorStop(0, COLOUR.infieldLit)
    grass.addColorStop(1, COLOUR.infield)
    g.fillStyle = grass
    g.fill()

    // Lane lines. A lane is 1.22 m wide, so at any sensible size the line has to be about a pixel or the
    // track turns into a set of stripes. The kerb is the exception: on a real track it is a raised white rail.
    for (let n = 1; n <= LANES + 1; n++) {
      ringPath(g, laneLineRadius(n))
      const kerb = n === 1
      g.lineWidth = kerb ? Math.max(1.5, scale * 0.5) : Math.max(0.75, scale * 0.16)
      g.strokeStyle = kerb ? COLOUR.kerb : COLOUR.lane
      g.stroke()
    }

    drawMarks(g)
    drawLaneNumbers(g)
    drawInfield(g)
  }

  /** The painted marks across the track, and the chequered finish. */
  function drawMarks(g: CanvasRenderingContext2D): void {
    const inR = laneLineRadius(1)
    const outR = laneLineRadius(LANES + 1)
    for (const m of [lapLength(1) / 4, lapLength(1) / 2, (3 * lapLength(1)) / 4]) {
      const a = pointAt(m, 1)
      const inner = offset(a, inR - laneRadius(1))
      const outer = offset(a, outR - laneRadius(1))
      g.beginPath()
      g.moveTo(...px(inner.x, inner.y))
      g.lineTo(...px(outer.x, outer.y))
      g.lineWidth = Math.max(1, scale * 0.25)
      g.strokeStyle = COLOUR.lane
      g.stroke()
    }

    // The finish line, chequered across all eight lanes as on a real track.
    const f = pointAt(0, 1)
    const nx = Math.sin(f.heading)
    const ny = -Math.cos(f.heading)
    const squares = 16
    const depth = 1.4 // metres along the track
    for (let i = 0; i < squares; i++) {
      const r0 = inR - laneRadius(1) + ((outR - inR) * i) / squares
      const r1 = inR - laneRadius(1) + ((outR - inR) * (i + 1)) / squares
      const p0 = { x: f.x + nx * r0, y: f.y + ny * r0 }
      const p1 = { x: f.x + nx * r1, y: f.y + ny * r1 }
      const dx = Math.cos(f.heading) * depth
      const dy = Math.sin(f.heading) * depth
      g.beginPath()
      g.moveTo(...px(p0.x, p0.y))
      g.lineTo(...px(p1.x, p1.y))
      g.lineTo(...px(p1.x + dx, p1.y + dy))
      g.lineTo(...px(p0.x + dx, p0.y + dy))
      g.closePath()
      g.fillStyle = i % 2 === 0 ? COLOUR.kerb : '#2b231f'
      g.fill()
    }
  }

  /** Lane numbers painted on the home straight, the way they are on a track. */
  function drawLaneNumbers(g: CanvasRenderingContext2D): void {
    const size = Math.max(7, scale * 3.4)
    if (size < 8) return
    g.font = `600 ${size}px system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = COLOUR.laneNumber
    // The home straight runs along y = −r in every lane, so one x puts the whole row square.
    const at = 12 // metres before the finish line
    for (let n = 1; n <= LANES; n++) {
      const [x, y] = px(STRAIGHT / 2 - at, -laneRadius(n))
      g.fillText(String(n), x, y)
    }
  }

  /** What is written on the grass: how long a lap is, and which way round. */
  function drawInfield(g: CanvasRenderingContext2D): void {
    const size = Math.max(9, scale * 4.6)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 ${size * 0.6}px system-ui, sans-serif`
    g.letterSpacing = '0.22em'
    g.fillStyle = '#ffffff2b'
    g.fillText('400 METRES', ox, oy - laneLineRadius(1) * scale * 0.58)
    g.letterSpacing = '0px'

    // Which way round, on the grass just inside the back straight rather than on the track itself.
    const p = ovalAt(0.5, laneLineRadius(1) - 7)
    arrow(g, px(p.x, p.y), p.heading, Math.max(5, scale * 3), '#ffffff30')
  }

  function offset(p: { x: number; y: number; heading: number }, d: number): { x: number; y: number } {
    return { x: p.x + Math.sin(p.heading) * d, y: p.y - Math.cos(p.heading) * d }
  }

  /** The path round one lane line: two straights and two semicircles, closed. */
  function ringPath(g: CanvasRenderingContext2D, r: number): void {
    const hx = STRAIGHT / 2
    g.beginPath()
    g.moveTo(...px(-hx, -r))
    g.lineTo(...px(hx, -r))
    // Canvas angles run clockwise on screen, so a counter-clockwise world arc is drawn the other way.
    g.arc(ox + hx * scale, oy, r * scale, Math.PI / 2, -Math.PI / 2, true)
    g.lineTo(...px(-hx, r))
    g.arc(ox - hx * scale, oy, r * scale, -Math.PI / 2, Math.PI / 2, true)
    g.closePath()
  }

  function arrow(g: CanvasRenderingContext2D, at: [number, number], heading: number, size: number, colour: string): void {
    const [x, y] = at
    g.save()
    g.translate(x, y)
    g.rotate(-heading)
    g.beginPath()
    g.moveTo(size, 0)
    g.lineTo(-size * 0.75, size * 0.62)
    g.lineTo(-size * 0.35, 0)
    g.lineTo(-size * 0.75, -size * 0.62)
    g.closePath()
    g.fillStyle = colour
    g.fill()
    g.restore()
  }

  function trail(g: CanvasRenderingContext2D, d: number, lane: number, colour: string, alpha: number): void {
    const steps = 16
    g.lineCap = 'round'
    for (let i = 0; i < steps; i++) {
      const t0 = d - (TRAIL * i) / steps
      const t1 = d - (TRAIL * (i + 1)) / steps
      if (t1 < 0) break
      const a = pointAt(t0, lane)
      const b = pointAt(t1, lane)
      g.beginPath()
      g.moveTo(...px(a.x, a.y))
      g.lineTo(...px(b.x, b.y))
      g.globalAlpha = alpha * 0.55 * (1 - i / steps) ** 1.5
      g.strokeStyle = colour
      g.lineWidth = Math.max(1.5, scale * 1.6)
      g.stroke()
    }
    g.globalAlpha = 1
  }

  /** The progress ring: a thin arc outside lane 8 that closes as the goal is met. */
  function progressRing(g: CanvasRenderingContext2D, done: number): void {
    const r = laneLineRadius(LANES + 1) + RING_OUT
    const width = Math.max(2, scale * 0.95)
    const draw = (from: number, to: number, colour: string, alpha: number): void => {
      if (to <= from) return
      g.beginPath()
      const steps = Math.max(2, Math.round((to - from) * 120))
      for (let i = 0; i <= steps; i++) {
        const p = ovalAt(from + ((to - from) * i) / steps, r)
        if (i === 0) g.moveTo(...px(p.x, p.y))
        else g.lineTo(...px(p.x, p.y))
      }
      g.globalAlpha = alpha
      g.strokeStyle = colour
      g.lineWidth = width
      g.lineCap = 'round'
      g.stroke()
      g.globalAlpha = 1
    }
    draw(0, 1, COLOUR.ringTrack, 1)
    draw(0, Math.min(1, Math.max(0, done)), COLOUR.ring, 0.95)
  }

  /**
   * A marker: a dark rim, the colour, and a white core. The rim is what makes it legible on terracotta —
   * a plain orange dot on a red-brown track is nearly invisible, which is the whole reason for it.
   */
  function marker(g: CanvasRenderingContext2D, d: number, lane: number, colour: string, r: number, ring: string | null): void {
    const p = pointAt(d, lane)
    const [x, y] = px(p.x, p.y)
    if (ring) {
      g.beginPath()
      g.arc(x, y, r + 5, 0, Math.PI * 2)
      g.strokeStyle = ring
      g.lineWidth = 2.5
      g.stroke()
    }
    g.save()
    g.shadowColor = colour
    g.shadowBlur = r * 3
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fillStyle = colour
    g.fill()
    g.restore()
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.strokeStyle = 'rgba(8, 11, 15, 0.75)'
    g.lineWidth = 1.5
    g.stroke()
    g.beginPath()
    g.arc(x, y, Math.max(1.2, r * 0.36), 0, Math.PI * 2)
    g.fillStyle = '#fff'
    g.fill()
  }

  function draw(f: TrackFrame): void {
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.drawImage(back, 0, 0)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const alpha = f.dim ? 0.45 : 1
    progressRing(g, f.progress)
    const r = Math.max(4.5, scale * 2.4)
    if (f.pacer !== null) {
      trail(g, f.pacer, Config.TARGET_LANE, COLOUR.pacer, alpha)
      g.globalAlpha = alpha * 0.9
      marker(g, f.pacer, Config.TARGET_LANE, COLOUR.pacer, r * 0.78, null)
      g.globalAlpha = 1
    }
    trail(g, f.you, Config.PLAYER_LANE, COLOUR.you, alpha)
    g.globalAlpha = alpha
    marker(g, f.you, Config.PLAYER_LANE, COLOUR.you, r, f.zone > 0 ? zoneColour(f.zone) : null)
    g.globalAlpha = 1
  }

  layout()
  return { layout, draw, canvas }
}

/** The lane lines as polylines, for anything else that draws the oval (the session image). */
export function outline(lane: number, steps = 240): { x: number; y: number }[] {
  return samples(steps, lane).map((p) => ({ x: p.x, y: p.y }))
}
