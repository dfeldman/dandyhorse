/**
 * DOM rendering. Built once; updates touch text nodes only (no innerHTML rebuilds at 1 Hz).
 * All unit conversion for display lives here: the API and the game model are SI.
 */
import { METRIC_NAMES, type GameState, type MetricName, type StartPayload, type UnitSystem } from './api.ts'
import type { EndInfo, Game, GameModel } from './game.ts'
import type { Route } from './route.ts'

// --- units ------------------------------------------------------------------

const MPS_TO_KMH = 3.6
const MPS_TO_MPH = 2.236936
const M_TO_FT = 3.28084
const M_TO_MI = 1 / 1609.344

function fmtSpeed(mps: number | null, units: UnitSystem): string {
  if (mps === null) return 'null'
  const disp = units === 'us' ? `${(mps * MPS_TO_MPH).toFixed(1)} mph` : `${(mps * MPS_TO_KMH).toFixed(1)} km/h`
  return `${mps.toFixed(3)} m/s (${disp})`
}

function fmtDistance(m: number | null, units: UnitSystem): string {
  if (m === null) return 'null'
  const disp = units === 'us' ? `${(m * M_TO_MI).toFixed(3)} mi` : `${(m / 1000).toFixed(3)} km`
  return `${m.toFixed(1)} m (${disp})`
}

function fmtElevation(m: number | null, units: UnitSystem): string {
  if (m === null) return 'null'
  return units === 'us' ? `${m.toFixed(1)} m (${(m * M_TO_FT).toFixed(0)} ft)` : `${m.toFixed(1)} m`
}

function fmtEnergy(j: number | null): string {
  return j === null ? 'null' : `${j.toFixed(0)} J (${(j / 4184).toFixed(1)} kcal)`
}

const fmtNum = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? 'null' : v.toFixed(digits))
const fmtJson = (v: unknown) => (v === null || v === undefined ? 'null' : JSON.stringify(v))

function fmtClock(seconds: number): string {
  const neg = seconds < 0
  const s = Math.abs(Math.round(seconds))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${neg ? '-' : ''}${mm}:${ss.toString().padStart(2, '0')}`
}

const METRIC_UNITS: Record<MetricName, string> = {
  speed: 'm/s',
  incline: '%',
  cadence: 'rpm',
  power: 'W',
  grade: '%',
  wind: 'm/s',
  crr: '',
  cw: 'kg/m',
  heartRate: 'bpm',
}

// --- tiny DOM helpers -------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...children)
  return node
}

/** A text node wrapper that only writes to the DOM when the value changes. */
class Cell {
  private last = ''
  constructor(readonly node: HTMLElement) {}
  set(value: string): void {
    if (value === this.last) return
    this.last = value
    this.node.textContent = value
  }
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls }, label)
  b.addEventListener('click', onClick)
  return b
}

// --- the page -----------------------------------------------------------------

export class GameUi {
  private readonly units: UnitSystem
  private readonly cells = new Map<string, Cell>()
  private readonly logList = el('ul', { class: 'log' })
  private readonly promptBox = el('div', { class: 'prompt' })
  private promptId: string | null | undefined = undefined // undefined = never rendered
  private readonly countdown = el('div', { class: 'countdown' })
  private readonly answered = new Cell(el('span'))
  private readonly summary = new Cell(el('div', { class: 'summary' }))
  private readonly overlay = el('div', { class: 'overlay', hidden: '' })
  private readonly pauseLayer = el('div', { class: 'pause-layer', hidden: '' })
  private readonly pauseMessage = new Cell(el('p', { class: 'pause-message' }))
  private readonly pauseFor = new Cell(el('p', { class: 'pause-for' }))
  private readonly pauseHint = new Cell(el('p', { class: 'pause-hint' }))
  private ended = false
  private readonly minimap = el('canvas', { width: '380', height: '220' })
  private readonly profile = el('canvas', { width: '380', height: '90' })
  private readonly mapBox: HTMLElement
  private readonly gearButtons: HTMLButtonElement[] = []
  private latest: { state: GameState; at: number } | null = null
  private mapBackground: HTMLCanvasElement | null = null
  private profileBackground: HTMLCanvasElement | null = null
  private readonly routeSamples: { x: number; y: number; z: number }[]
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }

  constructor(
    root: HTMLElement,
    private readonly start: StartPayload,
    private readonly game: Game,
  ) {
    this.units = start.unitSystem === 'us' ? 'us' : 'metric'
    const route: Route = game.route
    this.routeSamples = route.samples(400)
    const xs = this.routeSamples.map((p) => p.x)
    const zs = this.routeSamples.map((p) => p.z)
    const ys = this.routeSamples.map((p) => p.y)
    this.bounds = {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    }
    this.mapBox = el('section', { class: 'maps' }, el('h3', {}, 'Route (x/z) and elevation profile'), this.minimap, this.profile)
    root.replaceChildren(this.build())
    this.drawBackgrounds()
    this.updateModel(game.model)
    // Both clocks run between getstates: the countdown and the "paused for N s" counter.
    setInterval(() => {
      this.updateCountdown()
      this.renderPause()
    }, 500)
  }

  private build(): HTMLElement {
    const s = this.start
    const consoleLink = `/consoles/web/#/sessions/${encodeURIComponent(s.sessionId)}`
    const header = el(
      'header',
      {},
      el('h1', {}, `Mock Game — ${s.variant}`),
      el('div', { class: 'meta' },
        `${s.username} (uid ${s.uid}) · ${s.deviceType} · ${s.unitSystem} · seed ${s.seed} · v${s.gameVersion}${s.debug ? ' · debug' : ''} · `,
        el('a', { href: consoleLink, target: '_blank' }, s.sessionId),
      ),
    )
    const payload = el('details', {}, el('summary', {}, 'Start payload (startsession response)'), el('pre', {}, JSON.stringify(s, null, 2)))

    // Status strip
    const status = el('section', { class: 'status' }, this.countdown, this.summary.node, el('div', { class: 'answered' }, 'last answer: ', this.answered.node))

    // Controls
    const minimapToggle = el('input', { type: 'checkbox' })
    minimapToggle.checked = this.game.model.showMinimap
    minimapToggle.addEventListener('change', () => void this.game.setShowMinimap(minimapToggle.checked))
    const closeGears = button('Close gears', () => this.game.closeGears())
    const controls = el(
      'section',
      { class: 'controls' },
      button('Prompt one-shot', () => this.game.openOneShot()),
      button('Prompt persistent gears', () => this.game.openGears()),
      closeGears,
      button('Earn achievement', () => this.game.earnManual()),
      button('Complete', () => void this.game.complete(), 'complete'),
      button('Discard', () => void this.game.discard(), 'discard'),
      el('label', {}, minimapToggle, ' show minimap (preferences.game.showMinimap)'),
    )
    this.gearButtons.push(closeGears)

    // State table
    const table = el('table', { class: 'state' })
    table.append(el('thead', {}, el('tr', {}, el('th', {}, 'field'), el('th', {}, 'requested'), el('th', {}, 'commanded'), el('th', {}, 'actual'))))
    const tbody = el('tbody')
    const single = (key: string, label = key) => {
      const td = el('td', { colspan: '3', class: 'value' })
      this.cells.set(key, new Cell(td))
      tbody.append(el('tr', {}, el('th', {}, label), td))
    }
    for (const k of ['sessionId', 'sessionStatus', 'endReason', 'seq', 'serverTime', 'elapsed', 'requestedDuration', 'pause', 'pausedSeconds']) single(k)
    for (const m of METRIC_NAMES) {
      const tr = el('tr', { class: 'metric' }, el('th', {}, `${m}${METRIC_UNITS[m] ? ` (${METRIC_UNITS[m]})` : ''}`))
      for (const col of ['requested', 'commanded', 'actual'] as const) {
        const td = el('td', { class: 'value' })
        this.cells.set(`${m}.${col}`, new Cell(td))
        tr.append(td)
      }
      tbody.append(tr)
    }
    for (const k of ['position', 'distance', 'energy', 'work', 'input', 'requestedInput', 'bridges', 'owner', 'devicePreferences', 'custom']) single(k)
    table.append(tbody)

    // Game model table (what we are sending)
    const model = el('table', { class: 'state model' })
    model.append(el('thead', {}, el('tr', {}, el('th', {}, 'game model'), el('th', { colspan: '3' }, 'value'))))
    const mbody = el('tbody')
    for (const k of ['paused', 'activeSeconds', 'lap', 'previousLaps', 'distance', 'distanceOnLoop', 'virtualSpeed', 'point', 'target', 'gear', 'lastDirection', 'earned', 'score', 'ticks', 'lastError']) {
      const td = el('td', { colspan: '3', class: 'value' })
      this.cells.set(`model.${k}`, new Cell(td))
      mbody.append(el('tr', {}, el('th', {}, k), td))
    }
    model.append(mbody)

    const main = el(
      'main',
      {},
      el('div', { class: 'left' }, status, this.promptBox, controls, this.mapBox, model, el('section', {}, el('h3', {}, 'Log'), this.logList)),
      el('div', { class: 'right' }, el('h3', {}, 'Latest getstate'), table),
    )
    const pauseBand = el(
      'div',
      { class: 'pause-band', role: 'status', 'aria-live': 'polite' },
      el('h2', {}, 'Paused'),
      this.pauseMessage.node,
      this.pauseFor.node,
      this.pauseHint.node,
    )
    this.pauseLayer.append(pauseBand)
    return el('div', { class: 'app' }, header, payload, main, this.pauseLayer, this.overlay)
  }

  // --- updates --------------------------------------------------------------------

  updateState(state: GameState): void {
    this.latest = { state, at: Date.now() }
    const c = (k: string, v: string) => this.cells.get(k)?.set(v)
    c('sessionId', state.sessionId)
    c('sessionStatus', state.sessionStatus)
    c('endReason', fmtJson(state.endReason))
    c('seq', String(state.seq))
    c('serverTime', fmtNum(state.serverTime, 3))
    c('elapsed', state.elapsed === null ? 'null' : `${state.elapsed.toFixed(1)} s (${fmtClock(state.elapsed)})`)
    c('requestedDuration', state.requestedDuration === null ? 'null' : `${state.requestedDuration} s`)
    c('pause', fmtJson(state.pause))
    c('pausedSeconds', state.pausedSeconds === null ? 'null' : `${state.pausedSeconds.toFixed(1)} s`)
    for (const m of METRIC_NAMES) {
      const metric = state[m]
      for (const col of ['requested', 'commanded', 'actual'] as const) {
        const v = metric ? metric[col] : null
        c(`${m}.${col}`, m === 'speed' || m === 'wind' ? fmtSpeed(v, this.units) : fmtNum(v, m === 'crr' ? 4 : 2))
      }
    }
    const p = state.position
    c('position', p ? `x ${p.x.toFixed(1)}  y ${fmtElevation(p.y, this.units)}  z ${p.z.toFixed(1)}` : 'null')
    c('distance', fmtDistance(state.distance, this.units))
    c('energy', fmtEnergy(state.energy))
    c('work', state.work === null ? 'null' : `${state.work.toFixed(0)} J`)
    c('input', fmtJson(state.input))
    c('requestedInput', fmtJson(state.requestedInput))
    c(
      'bridges',
      state.bridges.length === 0
        ? '[] (no bridge reporting)'
        : state.bridges
            .map((b) => {
              const age = b.lastSeen === null ? '?' : `${(state.serverTime - b.lastSeen).toFixed(1)} s ago`
              const devs = b.devices.map((d) => `  - ${d.role ?? '?'}${d.type ? `/${d.type}` : ''} "${d.name}" [${d.status ?? '?'}] ${d.protocol ?? ''} ${d.address}`)
              return [`${b.label || '(no label)'} (${b.bridgeId}) lastSeen ${age}`, ...devs].join('\n')
            })
            .join('\n'),
    )
    c('owner', fmtJson(state.owner))
    c('devicePreferences', fmtJson(state.devicePreferences))
    c('custom', fmtJson(state.custom))
    this.updateCountdown()
    this.renderPause()
  }

  updateModel(m: GameModel): void {
    const c = (k: string, v: string) => this.cells.get(`model.${k}`)?.set(v)
    c('paused', String(m.paused))
    c('activeSeconds', `${m.activeSeconds.toFixed(1)} s`)
    c('lap', String(m.lap))
    c('previousLaps', String(m.previousLaps))
    c('distance', fmtDistance(m.distance, this.units))
    c('distanceOnLoop', fmtDistance(m.distanceOnLoop, this.units))
    c('virtualSpeed', fmtSpeed(m.virtualSpeed, this.units))
    c('point', `x ${m.point.x.toFixed(1)}  y ${fmtElevation(m.point.y, this.units)}  z ${m.point.z.toFixed(1)}  grade ${m.point.grade.toFixed(2)} %`)
    c('target', m.variant === 'treadmill' ? `${m.controlsSpeed ? `speed ${fmtSpeed(m.target.speed, this.units)}, ` : 'speed: yours, '}incline ${fmtNum(m.target.incline)} %` : `grade ${fmtNum(m.target.grade)} %, speed ${fmtSpeed(m.target.speed, this.units)}`)
    c('gear', String(m.gear))
    c('lastDirection', m.lastDirection ?? 'null')
    c('earned', m.earned.length ? m.earned.join(', ') : '(none)')
    c('score', String(m.score))
    c('ticks', String(m.ticks))
    c('lastError', m.lastError ?? '')
    this.summary.set(`lap ${m.lap} (previous laps: ${m.previousLaps}) · ${fmtDistance(m.distanceOnLoop, this.units)} into the loop · ${fmtSpeed(m.virtualSpeed, this.units)} · score ${m.score}`)
    this.answered.set(m.lastAnswer ? `${m.lastAnswer.promptId} = "${m.lastAnswer.choice}" answered via ${m.lastAnswer.source}` : '(none yet)')
    this.mapBox.hidden = !m.showMinimap
    if (m.showMinimap) this.drawRider(m)
    this.renderPrompt(m)
  }

  private renderPrompt(m: GameModel): void {
    const p = m.openPrompt
    const id = p ? `${p.promptId}:${p.choices.join('|')}` : null
    const closeGears = this.gearButtons[0]
    if (closeGears) closeGears.disabled = p?.promptId !== 'gear'
    if (id === this.promptId) return
    this.promptId = id
    if (!p) {
      this.promptBox.replaceChildren(el('div', { class: 'muted' }, 'No open prompt.'))
      return
    }
    const buttons = p.choices.map((choice) => button(choice, () => void this.game.answer(choice), 'choice'))
    this.promptBox.replaceChildren(
      el('div', { class: 'prompt-title' }, `${p.prompt} (${p.promptId}${p.persistent ? ', persistent' : `, one-shot${p.timeout ? `, ${p.timeout} s` : ''}`})`),
      el('div', { class: 'choices' }, ...buttons),
    )
  }

  /**
   * Advisory countdown from the game's own active seconds, not the wall clock: paused time does
   * not count down. (getstate.elapsed is wall time since the start and includes every pause.)
   */
  private updateCountdown(): void {
    const duration = this.latest?.state.requestedDuration ?? this.start.requestedDuration
    const paused = this.game.model.paused
    this.countdown.classList.toggle('paused', paused)
    if (duration === null) {
      this.countdown.textContent = 'no requested duration'
      return
    }
    const remaining = duration - this.game.activeSecondsNow()
    this.countdown.textContent = `${fmtClock(remaining)}${paused ? ' (paused)' : ''}`
    this.countdown.classList.toggle('over', remaining < 0)
  }

  /**
   * The pause band follows the server's view: shown while `sessionStatus` is `paused`, with the
   * server's own `pause.message` as-is and a live counter interpolated from `pause.seconds`.
   */
  private renderPause(): void {
    const l = this.latest
    const paused = !this.ended && l !== null && l.state.sessionStatus === 'paused'
    this.pauseLayer.hidden = !paused
    if (!paused || l === null) return
    const p = l.state.pause // null only if the server paused without saying why; still show the band
    const seconds = (p?.seconds ?? 0) + (Date.now() - l.at) / 1000
    this.pauseMessage.set(p?.message ?? 'Waiting for exercise-device data.')
    this.pauseFor.set(`paused for ${Math.floor(seconds)} s`)
    // A user pause (Pause pressed on a bridge) only ends when they press Play; every other reason
    // clears by itself once device data flows again.
    // The server's message already says what to do for a user pause ("Press Play to continue").
    this.pauseHint.set(p?.reason === 'user' ? '' : 'The game resumes by itself when your device is back.')
  }

  log(line: string): void {
    const li = el('li', {}, `${new Date().toLocaleTimeString()} ${line}`)
    this.logList.prepend(li)
    while (this.logList.childElementCount > 40) this.logList.lastElementChild?.remove()
  }

  showEnded(info: EndInfo): void {
    this.ended = true
    this.pauseLayer.hidden = true // a session can end while paused (Discard, reaped): one overlay only
    const link = `/consoles/web/#/sessions/${encodeURIComponent(this.start.sessionId)}`
    this.overlay.replaceChildren(
      el('div', { class: 'overlay-card' },
        el('h2', {}, `Session ${info.status}`),
        el('p', {}, `reason: ${info.reason ?? 'unknown'}`),
        el('p', {}, `paused: ${info.pausedSeconds === null ? 'unknown' : `${info.pausedSeconds.toFixed(1)} s in total`}`),
        el('p', {}, el('a', { href: link }, 'Open this session in the console')),
        info.summary ? el('pre', {}, JSON.stringify(info.summary, null, 2)) : el('p', { class: 'muted' }, 'No summary (session ended elsewhere).'),
      ),
    )
    this.overlay.hidden = false
  }

  // --- canvases ---------------------------------------------------------------------

  private mapXY(x: number, z: number): [number, number] {
    const b = this.bounds
    const w = this.minimap.width
    const h = this.minimap.height
    const pad = 12
    const sx = (w - 2 * pad) / (b.maxX - b.minX || 1)
    const sz = (h - 2 * pad) / (b.maxZ - b.minZ || 1)
    const s = Math.min(sx, sz)
    const ox = (w - (b.maxX - b.minX) * s) / 2
    const oz = (h - (b.maxZ - b.minZ) * s) / 2
    return [ox + (x - b.minX) * s, h - (oz + (z - b.minZ) * s)]
  }

  private profileXY(distanceFraction: number, y: number): [number, number] {
    const b = this.bounds
    const w = this.profile.width
    const h = this.profile.height
    const pad = 8
    return [pad + distanceFraction * (w - 2 * pad), h - pad - ((y - b.minY) / (b.maxY - b.minY || 1)) * (h - 2 * pad)]
  }

  private drawBackgrounds(): void {
    const map = document.createElement('canvas')
    map.width = this.minimap.width
    map.height = this.minimap.height
    const g = map.getContext('2d')
    if (g) {
      g.fillStyle = '#141a22'
      g.fillRect(0, 0, map.width, map.height)
      g.strokeStyle = '#6fa8dc'
      g.lineWidth = 2
      g.beginPath()
      this.routeSamples.forEach((p, i) => {
        const [x, y] = this.mapXY(p.x, p.z)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.closePath()
      g.stroke()
      const [sx, sy] = this.mapXY(this.routeSamples[0]?.x ?? 0, this.routeSamples[0]?.z ?? 0)
      g.fillStyle = '#ffffff'
      g.fillRect(sx - 3, sy - 3, 6, 6)
      g.fillStyle = '#8899aa'
      g.font = '11px system-ui, sans-serif'
      g.fillText('start', sx + 6, sy - 4)
    }
    this.mapBackground = map

    const prof = document.createElement('canvas')
    prof.width = this.profile.width
    prof.height = this.profile.height
    const q = prof.getContext('2d')
    if (q) {
      q.fillStyle = '#141a22'
      q.fillRect(0, 0, prof.width, prof.height)
      q.beginPath()
      const n = this.routeSamples.length
      this.routeSamples.forEach((p, i) => {
        const [x, y] = this.profileXY(i / n, p.y)
        if (i === 0) q.moveTo(x, y)
        else q.lineTo(x, y)
      })
      const [lx, ly] = this.profileXY(1, this.routeSamples[0]?.y ?? 0)
      q.lineTo(lx, ly)
      q.lineTo(lx, prof.height)
      q.lineTo(0, prof.height)
      q.closePath()
      q.fillStyle = '#3d5a3d'
      q.fill()
      q.fillStyle = '#8899aa'
      q.font = '11px system-ui, sans-serif'
      q.fillText(`${fmtElevation(this.bounds.minY, this.units)} – ${fmtElevation(this.bounds.maxY, this.units)}`, 8, 12)
    }
    this.profileBackground = prof
  }

  /**
   * The session picture (PLAN.md §6.7): the route map with the rider's final position and a caption.
   * 640×360 PNG, well under the 1 MB limit.
   */
  sessionImage(): string | null {
    const m = this.game.model
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 360
    const g = c.getContext('2d')
    if (!g || !this.mapBackground) return null
    g.fillStyle = '#0a0f24'
    g.fillRect(0, 0, c.width, c.height)
    // map, scaled to fit the left ~2/3
    const mw = this.minimap.width
    const mh = this.minimap.height
    const s = Math.min(400 / mw, 300 / mh)
    g.drawImage(this.mapBackground, 20, 30, mw * s, mh * s)
    const [rx, ry] = this.mapXY(m.point.x, m.point.z)
    g.fillStyle = '#ff2d9b'
    g.beginPath()
    g.arc(20 + rx * s, 30 + ry * s, 7, 0, Math.PI * 2)
    g.fill()
    // caption
    g.fillStyle = '#f3f5ff'
    g.font = '900 28px system-ui, sans-serif'
    g.fillText('Mock Game', 440, 70)
    g.font = '600 18px system-ui, sans-serif'
    g.fillStyle = '#9ba7d8'
    const lines = [
      `${m.variant === 'bike' ? 'Bike' : 'Treadmill'} · lap ${m.lap}`,
      fmtDistance(m.distance, this.units),
      `score ${Math.round(m.score)}`,
    ]
    lines.forEach((t, i) => g.fillText(t, 440, 110 + i * 30))
    g.fillStyle = '#3b82ff'
    g.fillRect(440, 200, 160, 6)
    return c.toDataURL('image/png')
  }

  private drawRider(m: GameModel): void {
    const g = this.minimap.getContext('2d')
    if (g && this.mapBackground) {
      g.drawImage(this.mapBackground, 0, 0)
      const [x, y] = this.mapXY(m.point.x, m.point.z)
      g.fillStyle = '#ff5c5c'
      g.beginPath()
      g.arc(x, y, 5, 0, Math.PI * 2)
      g.fill()
    }
    const q = this.profile.getContext('2d')
    if (q && this.profileBackground) {
      q.drawImage(this.profileBackground, 0, 0)
      const [x, y] = this.profileXY(m.distanceOnLoop / this.game.route.length, m.point.y)
      q.fillStyle = '#ff5c5c'
      q.beginPath()
      q.arc(x, y, 4, 0, Math.PI * 2)
      q.fill()
    }
  }
}

// --- screens outside a session ----------------------------------------------------

export function showLoginRequired(root: HTMLElement, next: string): void {
  const href = `/login?uid=1&next=${encodeURIComponent(next)}`
  root.replaceChildren(
    el('div', { class: 'card' }, el('h2', {}, 'Not logged in (401)'), el('p', {}, 'The game needs the auth cookie. '), el('a', { href }, `Log in as uid 1 and come back`)),
  )
}

export function showAdHocStart(root: HTMLElement, onStart: (variant: 'treadmill' | 'bike') => void): void {
  root.replaceChildren(
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Mock Game — ad-hoc start'),
      el('p', { class: 'muted' }, 'No ?session= in the URL, so this creates a debug session directly (PLAN.md §5.2).'),
      el('div', { class: 'choices' }, button('Ad-hoc start (treadmill)', () => onStart('treadmill'), 'choice'), button('Ad-hoc start (bike)', () => onStart('bike'), 'choice')),
    ),
  )
}

export function showError(root: HTMLElement, message: string): void {
  root.replaceChildren(el('div', { class: 'card error' }, el('h2', {}, 'Error'), el('pre', {}, message)))
}
