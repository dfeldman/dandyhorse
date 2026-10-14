/**
 * The heads-up display, and the one piece of it that matters: the whole route drawn end to end with the rider
 * on it. On a 386 km trail a session is a short bright segment on a long grey line, and that is exactly what
 * the rider should see — not a lap counter, not a countdown, but where this hour fits into the route.
 *
 * The other rule here is honesty about the machine. The game asks for the route's grade; the machine may not
 * be able to give it. When the two differ the HUD says both rather than showing the one it wishes were true.
 */
import type { RideState } from '../sim/ride.ts'
import type { Route } from '../route/route.ts'
import type { RouteProgress } from '../sim/progress.ts'

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`hud: #${id} is missing from index.html`)
  return node as T
}

/**
 * A distance, with the unit it should be read in. Under a kilometre it is metres — which matters, because the
 * alternative is a number that runs 0 to 999 under a label saying km and looks like the rider is flying.
 */
const distance = (m: number): { value: string; unit: string } =>
  m < 1000 ? { value: m.toFixed(0), unit: 'm' } : { value: (m / 1000).toFixed(m < 100000 ? 2 : 1), unit: 'km' }

/** The same distance as one string, for prose. */
const km = (m: number): string => { const d = distance(m); return `${d.value} ${d.unit}` }
const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m ${String(s % 60).padStart(2, '0')} s`
}

/** The same symbols the gates over the road carry, so the screen and the world agree (render/markers.ts). */
const GLYPH: Record<string, string> = {
  start: '▶', finish: '★', summit: '▲', town: '■', hairpin: '↩', viewpoint: '●', water: '≈',
}
/** and the colour each place is painted with on its gate over the road (render/markers.ts) */
const TINT: Record<string, string> = {
  start: '#2f6f4f', finish: '#b5432d', summit: '#4a5d7e', town: '#8a6a3a',
  hairpin: '#7b5ea8', viewpoint: '#2d6cb5', water: '#20808d',
}

export class Hud {
  private readonly root = el('hud')
  private readonly vSpeed = el('vSpeed')
  private readonly uSpeed = el('uSpeed')
  private readonly vDist = el('vDist')
  private readonly uDist = el('uDist')
  private readonly vEle = el('vEle')
  private readonly vGrade = el('vGrade')
  private readonly vEffort = el('vEffort')
  private readonly uEffort = el('uEffort')
  private readonly effortK = el('effortK')
  private readonly wName = el('wName')
  private readonly wSub = el('wSub')
  private readonly wNext = el('wNext')
  private readonly mReq = el('mReq')
  private readonly mNote = el('mNote')
  private readonly rName = el('rName')
  private readonly rDone = el('rDone')
  private readonly rEnd = el('rEnd')
  private readonly banner = el('banner')
  private readonly profile = el<HTMLCanvasElement>('profile')
  private readonly ctx: CanvasRenderingContext2D
  private lastMark = ''

  private readonly route: Route
  private readonly deviceType: 'bike' | 'treadmill'
  private readonly previous: RouteProgress | null

  constructor(route: Route, deviceType: 'bike' | 'treadmill', previous: RouteProgress | null) {
    this.route = route
    this.deviceType = deviceType
    this.previous = previous
    const ctx = this.profile.getContext('2d')
    if (!ctx) throw new Error('hud: no 2d context for the profile')
    this.ctx = ctx
    this.root.classList.add('on')
    this.rName.textContent = route.manifest.name
    this.rEnd.textContent = km(route.length)
    this.effortK.textContent = deviceType === 'bike' ? 'Power' : 'Pace'
    this.uEffort.textContent = deviceType === 'bike' ? 'W' : 'km/h'
    this.uDist.textContent = 'km'
    this.uSpeed.textContent = 'km/h'
    this.drawProfile(0)
  }

  update(state: RideState, sessionSeconds: number): void {
    // Speed, first and largest. It is the number a rider on a trainer looks at most and it was the one thing
    // the readout did not say — on a bike the effort column shows watts, and on a treadmill the km/h shown
    // there is the belt's, which is not the same as how fast the ride is moving down a hill.
    this.vSpeed.textContent = (state.speed * 3.6).toFixed(1)
    const ridden = distance(state.s)
    this.vDist.textContent = ridden.value
    this.uDist.textContent = ridden.unit
    this.vEle.textContent = this.route.poseAt(state.s).y.toFixed(0)
    this.vGrade.textContent = (state.grade * 100).toFixed(1)
    this.vEffort.textContent = this.deviceType === 'bike' ? (state.power ?? 0).toFixed(0) : (state.speed * 3.6).toFixed(1)

    const biome = this.route.biomeAt(state.s)
    const passed = this.route.manifest.landmarks.filter((m) => m.s <= state.s)
    const here = passed[passed.length - 1]
    const next = this.route.manifest.landmarks.find((m) => m.s > state.s)
    this.wName.textContent = here?.name ?? this.route.manifest.name
    this.wSub.textContent = `${biome} · ${this.route.surfaceAt(state.s)} · ${clock(sessionSeconds)} this session`
    this.wNext.textContent = next ? `next: ${next.name} in ${km(next.s - state.s)}` : 'the last of it'

    // the request, and whether the machine could take it
    this.mReq.textContent = `${state.request.toFixed(1)}%`
    const note: string[] = []
    if (state.coasting) note.push('coasting')
    if (state.braking) note.push('braking for the bend')
    if (this.deviceType === 'treadmill' && state.grade < -0.005) note.push('most belts will not tilt down — the descent is free here')
    this.mNote.textContent = note.join(' · ')

    const done = state.s / this.route.length
    this.rDone.textContent = `${(done * 100).toFixed(done < 0.1 ? 1 : 0)}%`
    const mark = `${Math.round(state.s / 25)}`
    if (mark !== this.lastMark) {
      this.lastMark = mark
      this.drawProfile(state.s)
    }
  }

  /** The route, end to end, with where this session started and where the rider is now. */
  private drawProfile(s: number): void {
    const c = this.ctx
    const w = this.profile.width
    const h = this.profile.height
    const pad = 4
    c.clearRect(0, 0, w, h)

    const n = 320
    const lo = this.route.manifest.stats.minElevation
    const hi = Math.max(lo + 1, this.route.manifest.stats.maxElevation)
    const yOf = (e: number): number => h - pad - ((e - lo) / (hi - lo)) * (h - pad * 2)

    c.beginPath()
    c.moveTo(0, h)
    for (let i = 0; i <= n; i++) {
      const at = (i / n) * this.route.length
      c.lineTo((i / n) * w, yOf(this.route.poseAt(at).y))
    }
    c.lineTo(w, h)
    c.closePath()
    c.fillStyle = 'rgba(16,22,29,0.13)'
    c.fill()

    // what has been ridden, over however many sessions
    const cut = (s / this.route.length) * w
    c.save()
    c.beginPath()
    c.rect(0, 0, cut, h)
    c.clip()
    c.beginPath()
    c.moveTo(0, h)
    for (let i = 0; i <= n; i++) {
      const at = (i / n) * this.route.length
      c.lineTo((i / n) * w, yOf(this.route.poseAt(at).y))
    }
    c.lineTo(w, h)
    c.closePath()
    c.fillStyle = 'rgba(200,72,47,0.55)'
    c.fill()
    c.restore()

    // where this session picked the route up, so an hour's work is visible as an hour's work
    const from = this.previous ? (Math.min(this.previous.s, this.route.length) / this.route.length) * w : 0
    if (from > 1) {
      c.strokeStyle = 'rgba(16,22,29,0.35)'
      c.setLineDash([4, 4])
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(from, 0)
      c.lineTo(from, h)
      c.stroke()
      c.setLineDash([])
    }

    // landmarks worth a tick
    c.fillStyle = 'rgba(16,22,29,0.4)'
    for (const m of this.route.manifest.landmarks) {
      if (m.kind === 'town' && this.route.manifest.landmarks.length > 20 && m.s % 1 !== 0) continue
      const x = (m.s / this.route.length) * w
      c.fillRect(x, h - 5, 1.5, 5)
    }

    c.fillStyle = '#c8482f'
    c.beginPath()
    c.arc(cut, yOf(this.route.poseAt(s).y), 4.5, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = '#f6f3ea'
    c.lineWidth = 2
    c.stroke()
  }

  /**
   * Passing a place: the symbol off its gate, the name, and what it is.
   *
   * Deliberately separate from `say`, which is the quiet corner banner for things the rider needs to know.
   * This one is the reward, and it behaves like one — it interrupts nothing, it cannot be dismissed because
   * it does not wait, and the CSS animation plays it out. Restarting the animation needs the class off and
   * the element reflowed, or two landmarks a hundred metres apart would show only the first.
   */
  celebrate(name: string, kind: string, note: string): void {
    const glyph = GLYPH[kind] ?? '◆'
    const node2 = el('pGlyph')
    node2.textContent = glyph
    // the symbol in the place's own colour, the same one its gate over the road is painted (render/markers.ts)
    node2.style.color = TINT[kind] ?? '#8a6a3a'
    el('pName').textContent = name
    el('pSub').textContent = note
    // A celebration takes the screen: the quiet corner banner is dismissed rather than left to sit under it.
    // The first landmark of a route is often metres from its start, so the "back on the Katy Trail" notice and
    // the arrival at Clinton were landing on top of each other in the first second of every ride.
    this.hideBanner()
    const node = el('passed')
    node.classList.remove('on')
    void node.offsetWidth
    node.classList.add('on')
  }

  say(title: string, body: string, forMs = 4000): void {
    el('bTitle').textContent = title
    el('bBody').textContent = body
    this.banner.classList.add('on')
    if (forMs > 0) setTimeout(() => this.banner.classList.remove('on'), forMs)
  }

  hideBanner(): void { this.banner.classList.remove('on') }
}

export { clock, distance, km }
