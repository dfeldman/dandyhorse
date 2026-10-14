/**
 * The whole route, from above, with everywhere worth knowing about marked on it.
 *
 * The HUD's elevation profile answers "how much climbing is left"; this answers the other question a rider
 * asks on a long route, which is "where AM I" — the shape of the thing, which way it bends, which side of the
 * river it is on, how far the next town is in a straight line rather than along the road.
 *
 * **It cannot be navigated and does not need to be.** Whoever is riding this has both hands on the bars and
 * no mouse, so there is nothing to click, drag or zoom: one key shows it, the same key hides it, and it draws
 * everything at a scale that fits. What would otherwise need panning is solved by drawing it twice — the whole
 * route at once, and the ten kilometres around the rider underneath — so the far view gives the shape and the
 * near view gives the detail, and neither asks for a pointer.
 *
 * It is a canvas rather than anything in the scene, because it is a map and not a place.
 */
import type { Route } from '../route/route.ts'

/** The same symbols the gates over the road carry, so the map and the world agree (render/markers.ts). */
const GLYPH: Record<string, string> = {
  start: '▶', finish: '★', summit: '▲', town: '■', hairpin: '↩', viewpoint: '●', water: '≈',
}
const COLOUR: Record<string, string> = {
  start: '#2f6f4f', finish: '#b5432d', summit: '#4a5d7e', town: '#8a6a3a',
  hairpin: '#7b5ea8', viewpoint: '#2d6cb5', water: '#20808d',
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`minimap: #${id} is missing from index.html`)
  return node as T
}

export class Minimap {
  private readonly root = el('map')
  private readonly canvas = el<HTMLCanvasElement>('mapCanvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly route: Route
  /** the route's shape, sampled once: x and z every so many metres */
  private readonly shape: number[] = []
  private readonly step: number
  /**
   * The canvas is drawn at twice the size it is shown at, so everything in it has to be twice as big.
   *
   * That is what a backing store of 640 by 760 in a box 320 by 380 means, and it is worth having: the lines
   * come out crisp on any screen. Forgetting it once produced a map whose labels were five pixels tall and
   * unreadable, so the factor is worked out here rather than guessed at each drawing call.
   */
  private readonly grain: number
  private on = false
  private lastDrawn = Number.NaN

  constructor(route: Route) {
    this.route = route
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('minimap: no 2d context')
    this.ctx = ctx
    this.grain = this.canvas.width / Math.max(1, parseFloat(getComputedStyle(this.canvas).width) || this.canvas.width / 2)
    /**
     * Sampled once, at whatever spacing gives about two thousand points.
     *
     * The Katy is three hundred and eighty-six kilometres long and the map is six hundred pixels wide, so a
     * point every two hundred metres is already finer than the screen can show. Asking the route for its pose
     * two thousand times at startup costs a few milliseconds; asking it every frame the map is open would cost
     * that every frame.
     */
    this.step = Math.max(20, route.length / 2000)
    for (let s = 0; s <= route.length; s += this.step) {
      const p = route.poseAt(s)
      this.shape.push(p.x, p.z)
    }
  }

  get open(): boolean { return this.on }

  toggle(s: number): void {
    this.on = !this.on
    this.root.classList.toggle('on', this.on)
    if (this.on) { this.lastDrawn = Number.NaN; this.update(s) }
  }

  /** Redraw, but only when the rider has actually moved somewhere worth redrawing for. */
  update(s: number): void {
    if (!this.on) return
    if (Number.isFinite(this.lastDrawn) && Math.abs(s - this.lastDrawn) < 25) return
    this.lastDrawn = s
    const c = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    c.clearRect(0, 0, w, h)
    /**
     * The local view is the one that gets used, so it gets the room.
     *
     * The first layout gave the overview more than half the panel and squeezed the ten kilometres around the
     * rider into a strip underneath, which is backwards: the shape of the whole route is a glance, and it can
     * be a small one. Underneath both, the next few places are simply listed with their distances — a sentence
     * can be read at a glance off a bike in a way that a crowd of labels on a line cannot.
     */
    const split = Math.round(h * 0.22)
    const listH = Math.round(76 * this.grain)
    this.drawWhole(0, 0, w, split, s)
    /**
     * A rule between the two, and a name on each.
     *
     * They are two maps of the same route at two scales, and without anything to say so they read as one map
     * that has come apart — which is how it was first reported: "the minimap shows two disconnected segments".
     * A line and two labels are the whole fix.
     */
    c.strokeStyle = 'rgba(246,243,234,0.18)'
    c.lineWidth = 1 * this.grain
    c.beginPath()
    c.moveTo(10 * this.grain, split + 4 * this.grain)
    c.lineTo(w - 10 * this.grain, split + 4 * this.grain)
    c.stroke()
    this.drawNear(0, split + 10 * this.grain, w, h - split - 10 * this.grain - listH, s)
    this.drawNext(0, h - listH, w, listH, s)
  }

  /** The route end to end, fitted to the box, with the ridden part picked out. */
  private drawWhole(x0: number, y0: number, w: number, h: number, s: number): void {
    const c = this.ctx
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < this.shape.length; i += 2) {
      minX = Math.min(minX, this.shape[i]); maxX = Math.max(maxX, this.shape[i])
      minZ = Math.min(minZ, this.shape[i + 1]); maxZ = Math.max(maxZ, this.shape[i + 1])
    }
    const pad = 26 * this.grain
    const scale = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ))
    // north up: the world's z runs north, and a canvas's y runs down, so z is negated
    const px = (wx: number): number => x0 + w / 2 + (wx - (minX + maxX) / 2) * scale
    const py = (wz: number): number => y0 + h / 2 - (wz - (minZ + maxZ) / 2) * scale

    const done = Math.floor(s / this.step)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = 'rgba(246,243,234,0.30)'
    c.lineWidth = 3 * this.grain
    c.beginPath()
    for (let i = 0; i < this.shape.length; i += 2) {
      const X = px(this.shape[i]), Y = py(this.shape[i + 1])
      if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y)
    }
    c.stroke()

    c.strokeStyle = '#e0a21c'
    c.lineWidth = 3 * this.grain
    c.beginPath()
    for (let i = 0; i <= done * 2 && i < this.shape.length; i += 2) {
      const X = px(this.shape[i]), Y = py(this.shape[i + 1])
      if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y)
    }
    c.stroke()

    /**
     * Landmarks, thinned so they can be read.
     *
     * The Katy has sixty-three of them over three hundred kilometres, which at this scale is a line of
     * overlapping dots. Anything within a few pixels of one already drawn is dropped — except the ends and the
     * summits, which are the ones somebody is looking for.
     */
    /**
     * Only the ends are labelled here.
     *
     * Labelling every town at this scale produced a tangle of overlapping names that said nothing — the Katy
     * has sixty-three of them along one line. The overview's job is the SHAPE of the route and where on it the
     * rider is, so it marks the start and the finish by name and everything else as a small dot.
     */
    for (const landmark of this.route.manifest.landmarks) {
      const i = Math.min(this.shape.length / 2 - 1, Math.floor(landmark.s / this.step))
      const X = px(this.shape[i * 2]), Y = py(this.shape[i * 2 + 1])
      const end = landmark.kind === 'start' || landmark.kind === 'finish'
      c.fillStyle = COLOUR[landmark.kind] ?? '#8a6a3a'
      c.beginPath()
      c.arc(X, Y, (end ? 4.5 : 1.8) * this.grain, 0, Math.PI * 2)
      c.fill()
      if (end) this.label(landmark.name, X, Y, x0, w)
    }

    this.rider(px(this.shape[Math.min(done, this.shape.length / 2 - 1) * 2]), py(this.shape[Math.min(done, this.shape.length / 2 - 1) * 2 + 1]))

    c.fillStyle = 'rgba(246,243,234,0.55)'
    c.font = `${Math.round(11 * this.grain)}px system-ui, sans-serif`
    c.textAlign = 'left'
    c.fillText(`THE WHOLE ROUTE · ${(this.route.length / 1000).toFixed(0)} km · north up`, x0 + 10 * this.grain, y0 + h - 8 * this.grain)
  }

  /**
   * The road around the rider, drawn the way a bike computer draws it: close in, and turned so that the way
   * the rider is going is straight up the panel.
   *
   * The first version was ten kilometres across and north-up, and it was reported — twice — as impossible to
   * understand: at that scale the next few minutes of riding were a short sliver in an empty box, and with
   * north up the rider had to turn the map in their head to know whether the next bend went left or right.
   * Heading-up at three kilometres across answers the only questions anybody asks of it while riding: what
   * does the road do next, and where is the next place.
   */
  private drawNear(x0: number, y0: number, w: number, h: number, s: number): void {
    const c = this.ctx
    const behind = 250
    const ahead = 1400
    const here = this.route.poseAt(s)
    const ang = Math.atan2(here.hx, here.hz)
    const cos = Math.cos(ang), sin = Math.sin(ang)
    /**
     * Zoomed to fit the road, not to a fixed distance.
     *
     * On the Katy a kilometre and a half of trail is nearly a straight line; on the Alpe it is three hairpins
     * stacked into a space a few hundred metres across, and at a fixed scale that became an illegible white
     * scribble. So the next stretch of road is measured in the rotated frame first and the scale chosen to fit
     * it — a straight trail shows a long way ahead, a hairpin stack fills the pane.
     */
    let minR = 0, maxR = 0, maxF = 1, minF = 0
    for (let d = Math.max(0, s - behind); d <= Math.min(this.route.length, s + ahead); d += 25) {
      const p = this.route.poseAt(d)
      const dx = p.x - here.x, dz = p.z - here.z
      const r = dx * cos - dz * sin
      const f = dx * sin + dz * cos
      minR = Math.min(minR, r); maxR = Math.max(maxR, r); minF = Math.min(minF, f); maxF = Math.max(maxF, f)
    }
    const pad = 30 * this.grain
    const scale = Math.min((w / 2 - pad) / Math.max(40, -minR, maxR), (h - pad * 2) / Math.max(80, maxF - minF))
    const ox = x0 + w / 2
    const oy = y0 + pad + maxF * scale
    const at = (wx: number, wz: number): [number, number] => {
      const dx = wx - here.x, dz = wz - here.z
      const right = dx * cos - dz * sin
      const fwd = dx * sin + dz * cos
      return [ox + right * scale, oy - fwd * scale]
    }

    c.save()
    c.beginPath()
    c.rect(x0, y0, w, h)
    c.clip()

    const trace = (from: number, to: number, style: string, width: number): void => {
      c.strokeStyle = style
      c.lineWidth = width * this.grain
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.beginPath()
      let first = true
      const step = 20
      for (let d = Math.max(0, from); d <= Math.min(this.route.length, to); d += step) {
        const p = this.route.poseAt(d)
        const [X, Y] = at(p.x, p.z)
        if (first) { c.moveTo(X, Y); first = false } else c.lineTo(X, Y)
      }
      c.stroke()
    }
    // behind, faint; ahead, bold — the road to come is the thing being read
    trace(s - behind, s, 'rgba(224,162,28,0.55)', 4)
    trace(s, s + ahead, 'rgba(246,243,234,0.95)', 6)

    // places on the road ahead: a dot, and the name of the next two
    let named = 0
    for (const landmark of this.route.manifest.landmarks) {
      if (landmark.s < s - behind || landmark.s > s + ahead) continue
      const p = this.route.poseAt(landmark.s)
      const [X, Y] = at(p.x, p.z)
      // numbered to match the list below, instead of a name that would lie across the road
      const n = landmark.s >= s ? ++named : 0
      c.fillStyle = COLOUR[landmark.kind] ?? '#8a6a3a'
      c.strokeStyle = 'rgba(16,22,29,0.9)'
      c.lineWidth = 2 * this.grain
      c.beginPath()
      c.arc(X, Y, (n && n <= 3 ? 10 : 5) * this.grain, 0, Math.PI * 2)
      c.fill()
      c.stroke()
      if (n && n <= 3) {
        c.fillStyle = '#f6f3ea'
        c.font = `bold ${Math.round(12 * this.grain)}px system-ui, sans-serif`
        c.textAlign = 'center'
        c.fillText(String(n), X, Y + 4 * this.grain)
      }
    }

    // the rider, as an arrow pointing the way they are going — which is always up
    c.fillStyle = '#c8482f'
    c.strokeStyle = '#f6f3ea'
    c.lineWidth = 2 * this.grain
    c.beginPath()
    c.moveTo(ox, oy - 12 * this.grain)
    c.lineTo(ox + 8 * this.grain, oy + 8 * this.grain)
    c.lineTo(ox, oy + 3 * this.grain)
    c.lineTo(ox - 8 * this.grain, oy + 8 * this.grain)
    c.closePath()
    c.fill()
    c.stroke()
    c.restore()

    c.fillStyle = 'rgba(246,243,234,0.55)'
    c.font = `${Math.round(11 * this.grain)}px system-ui, sans-serif`
    c.textAlign = 'left'
    c.fillText('THE ROAD AHEAD · your direction up', x0 + 10 * this.grain, y0 + h - 8 * this.grain)
  }

  /** The next three places, in words, with how far each one is. */
  private drawNext(x0: number, y0: number, w: number, h: number, s: number): void {
    const c = this.ctx
    const next = this.route.manifest.landmarks.filter((l) => l.s > s).slice(0, 3)
    c.strokeStyle = 'rgba(246,243,234,0.18)'
    c.lineWidth = 1 * this.grain
    c.beginPath()
    c.moveTo(10 * this.grain, y0 + 2 * this.grain)
    c.lineTo(w - 10 * this.grain, y0 + 2 * this.grain)
    c.stroke()
    const line = 21 * this.grain
    next.forEach((l, k) => {
      const y = y0 + 20 * this.grain + k * line
      c.fillStyle = COLOUR[l.kind] ?? '#8a6a3a'
      c.beginPath()
      c.arc(x0 + 18 * this.grain, y - 4 * this.grain, 8 * this.grain, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#f6f3ea'
      c.font = `bold ${Math.round(11 * this.grain)}px system-ui, sans-serif`
      c.textAlign = 'center'
      c.fillText(String(k + 1), x0 + 18 * this.grain, y)
      c.fillStyle = 'rgba(246,243,234,0.95)'
      c.font = `${Math.round(13 * this.grain)}px system-ui, sans-serif`
      c.textAlign = 'left'
      c.fillText(l.name, x0 + 32 * this.grain, y)
      const d = l.s - s
      c.textAlign = 'right'
      c.fillStyle = 'rgba(246,243,234,0.6)'
      c.fillText(d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`, w - 12 * this.grain, y)
    })
    if (!next.length) {
      c.fillStyle = 'rgba(246,243,234,0.6)'
      c.font = `${Math.round(13 * this.grain)}px system-ui, sans-serif`
      c.textAlign = 'left'
      c.fillText('Nothing further — the end of the route.', x0 + 14 * this.grain, y0 + 20 * this.grain)
    }
  }

  /** A label beside its dot, on whichever side has room, so no name runs off the panel. */
  private label(text: string, x: number, y: number, x0: number, w: number): void {
    const c = this.ctx
    c.fillStyle = 'rgba(246,243,234,0.95)'
    c.font = `${Math.round(12 * this.grain)}px system-ui, sans-serif`
    const gap = 9 * this.grain
    // long names are shortened rather than allowed to cross the map
    let t = text
    while (t.length > 8 && c.measureText(t).width > w * 0.55) t = t.slice(0, -2)
    if (t !== text) t = `${t.trimEnd()}…`
    const wide = c.measureText(t).width
    const right = x + gap + wide < x0 + w - 4 * this.grain
    c.textAlign = right ? 'left' : 'right'
    c.fillText(t, right ? x + gap : x - gap, y + 4 * this.grain)
  }

  private rider(x: number, y: number): void {
    const c = this.ctx
    c.fillStyle = '#c8482f'
    c.strokeStyle = '#f6f3ea'
    c.lineWidth = 2 * this.grain
    c.beginPath()
    c.arc(x, y, 5 * this.grain, 0, Math.PI * 2)
    c.fill()
    c.stroke()
  }
}
