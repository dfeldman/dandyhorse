/** The DOM overlay: place, lap, timer, race board, speed and pace, the two big buttons, callouts, results. */
import { Config } from '../config.ts'
import type { ButtonId, Car } from '../sim/car.ts'
import { PLAYER_ID, type Race, type RaceEvent } from '../sim/race.ts'
import type { Series } from '../sim/series.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

export const ordinal = (n: number): string => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th')
const clock = (s: number): string => {
  const t = Math.max(0, Math.ceil(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export interface TagPoint { id: string; x: number; y: number; visible: boolean; dist: number }

export class Hud {
  private readonly place = $('place')
  private readonly lap = $('lap')
  private readonly raceName = $('race-name')
  private readonly timer = $('timer')
  private readonly timerBox = $('hud-timer')
  private readonly board = $('hud-board')
  private readonly speed = $('speed')
  private readonly speedUnit = $('speed-unit')
  private readonly paceFill = $('pace-fill')
  private readonly paceWord = $('pace-word')
  private readonly btnTurbo = $<HTMLButtonElement>('btn-turbo')
  private readonly btnOil = $<HTMLButtonElement>('btn-oil')
  private readonly turboSvg = $('turbo-svg')
  private readonly turboCount = $('turbo-count')
  private readonly oilCount = $('oil-count')
  private readonly oilRing = $('oil-ring')
  private readonly callouts = $('callouts')
  private readonly countdown = $('countdown')
  private readonly rocketHint = $('rocket-hint')
  private readonly warn = $('warn')
  private readonly draft = $('draft')
  private readonly boostChip = $('boost-chip')
  private readonly speedlines = $('speedlines')
  private readonly tags = $('tags')
  private readonly results = $('results')
  private readonly resultsCard = $('results-card')
  private readonly pause = $('pause')
  private readonly pauseMsg = $('pause-msg')
  private readonly fade = $('fade')
  private readonly introCard = $('intro-card')
  private introKey = ''
  private readonly tagEls = new Map<string, HTMLDivElement>()
  private lastPlace = 0
  private shown: string | null = null
  private boardKey = ''
  private readonly speedFmt: ((ms: number) => { value: string; unit: string }) | null

  constructor(opts: {
    onButton: (b: ButtonId) => void
    onResume: () => void
    harness: boolean
    pedal: number
    onPedal: (v: number) => void
    /** The platform's "End workout": shown in the pause card only when a session is running. */
    onEnd?: () => void
    /** How to write the speed (the platform formats it in the player's units; standalone is km/h). */
    speed?: (ms: number) => { value: string; unit: string }
  }) {
    this.speedFmt = opts.speed ?? null
    const tap = (btn: HTMLButtonElement, id: ButtonId): void => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        btn.classList.add('tap')
        opts.onButton(id)
      })
      const up = (): void => btn.classList.remove('tap')
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointerleave', up)
    }
    tap(this.btnTurbo, 'turbo')
    tap(this.btnOil, 'oil')
    $('btn-resume').addEventListener('click', opts.onResume)
    if (opts.onEnd) {
      const end = $('btn-end')
      end.hidden = false
      end.addEventListener('click', opts.onEnd)
    }
    if (opts.harness) {
      document.body.classList.add('harness-on')
      $('harness').style.display = 'block'
      const slider = $<HTMLInputElement>('pedal')
      slider.value = String(opts.pedal)
      slider.addEventListener('input', () => opts.onPedal(Number(slider.value)))
    }
    // three arcs for the turbo meter
    const segs = Config.TURBO_SEGMENTS
    const r = 62, gap = 0.12
    let svg = ''
    for (let i = 0; i < segs; i++) {
      const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2 + gap / 2
      const a1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI * 2 - gap / 2
      const arc = (a: number): string => `${68 + r * Math.cos(a)} ${68 + r * Math.sin(a)}`
      const d = `M ${arc(a0)} A ${r} ${r} 0 0 1 ${arc(a1)}`
      const len = r * (a1 - a0)
      svg += `<path d="${d}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="9" stroke-linecap="round"/>`
      svg += `<path id="turbo-seg-${i}" d="${d}" fill="none" stroke="#ffb02e" stroke-width="9" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len}" data-len="${len}"/>`
    }
    this.turboSvg.innerHTML = svg
  }

  setSyncing(v: boolean): void { this.fade.classList.toggle('clear', !v) }

  hideLoading(): void { $('loading').classList.add('gone') }

  nope(b: ButtonId): void {
    const el = b === 'turbo' ? this.btnTurbo : this.btnOil
    el.classList.remove('nope')
    void el.offsetWidth
    el.classList.add('nope')
  }

  callout(text: string, kind: 'good' | 'bad' | 'cool' | '' = 'good', small = false): void {
    const el = document.createElement('div')
    el.className = `callout pop-text ${kind} ${small ? 'small' : ''}`
    el.textContent = text
    this.callouts.append(el)
    while (this.callouts.children.length > 3) this.callouts.firstElementChild?.remove()
    setTimeout(() => el.remove(), 1700)
  }

  showCount(n: number | 'GO!'): void {
    const span = document.createElement('span')
    span.textContent = String(n)
    if (n === 'GO!') span.className = 'go'
    this.countdown.replaceChildren(span)
  }

  /** Callouts for race events that the player should notice. */
  event(e: RaceEvent, race: Race): void {
    const name = (id: string): string => race.car(id)?.name ?? id
    switch (e.type) {
      case 'countdown': this.showCount(e.n); break
      case 'go': this.showCount('GO!'); break
      case 'rocket': if (e.car === PLAYER_ID) this.callout('ROCKET START!', 'good'); break
      case 'tooEarly': this.callout('Too early! Tap at GO', 'bad', true); break
      case 'turboNotReady': this.nope('turbo'); break
      case 'noOil': this.nope('oil'); break
      case 'oilDrop': this.callout('Oil away!', 'cool', true); break
      case 'oilCharged': this.callout('+1 Oil', 'cool', true); break
      case 'spin':
        if (e.by === PLAYER_ID) this.callout(`${name(e.car)} SPUN OUT!`, 'good')
        break
      case 'dodge': this.callout(`${name(e.car)} dodged it`, '', true); break
      case 'overtake': this.callout(`Passed ${name(e.car)}!`, 'good', true); break
      case 'overtaken': this.callout(`${name(e.car)} got by`, 'bad', true); break
      case 'lap': this.callout(e.final ? 'FINAL LAP!' : `LAP ${e.lap}`, e.final ? 'bad' : 'good'); break
      case 'finish': this.callout(e.place === 1 ? 'YOU WIN!' : `${e.place}${ordinal(e.place)} PLACE`, 'good'); break
      case 'draft': break
      case 'bump': break
      case 'land': if (e.car === PLAYER_ID && e.air > 4.5) this.callout('AIRTIME!', 'cool', true); break
      case 'turbo': break
    }
  }

  update(series: Series, pedal: number, tagPoints: TagPoint[], paused: { on: boolean; message: string }): void {
    const race = series.race
    const p = race.player

    // place
    const place = race.phase === 'intro' || race.phase === 'countdown' ? p.place : p.place
    if (place !== this.lastPlace) {
      this.place.innerHTML = `${place}<sup>${ordinal(place)}</sup>`
      this.place.classList.remove('bump')
      void this.place.offsetWidth
      if (this.lastPlace) this.place.classList.add('bump')
      this.lastPlace = place
    }
    const lap = race.playerLap
    const lapText = p.finished ? 'FINISHED' : `LAP ${lap}/${race.laps}`
    if (this.lap.textContent !== lapText) this.lap.textContent = lapText
    this.lap.classList.toggle('final', !p.finished && lap === race.laps && race.phase === 'racing' && race.laps > 1)
    const rn = `Race ${series.raceNumber} · ${series.trackName}`
    if (this.raceName.textContent !== rn) this.raceName.textContent = rn

    // timer
    const left = series.remaining
    this.timer.textContent = series.phase === 'over' ? 'DONE' : left > 0 ? clock(left) : 'LAST RACE'
    this.timerBox.classList.toggle('low', left < 60)

    // board
    this.renderBoard(race)

    // speed and pace
    if (this.speedFmt) {
      const q = this.speedFmt(p.speed)
      this.speed.textContent = q.value
      this.speedUnit.textContent = q.unit
    } else {
      this.speed.textContent = String(Math.round(p.speed * 3.6))
    }
    this.paceFill.style.width = `${Math.min(100, pedal)}%`
    this.paceWord.textContent = pedal < 30 ? 'easy' : pedal < 44 ? 'cruising' : pedal < 57 ? 'steady' : pedal < 72 ? 'pushing' : 'flat out!'

    // buttons
    const racing = race.phase === 'racing' && !p.finished
    const full = Math.floor(p.turbo / 100)
    for (let i = 0; i < Config.TURBO_SEGMENTS; i++) {
      const seg = document.getElementById(`turbo-seg-${i}`)
      if (!seg) continue
      const fill = Math.max(0, Math.min(1, p.turbo / 100 - i))
      const len = Number(seg.dataset.len)
      seg.setAttribute('stroke-dashoffset', String(len * (1 - fill)))
      seg.setAttribute('stroke', fill >= 1 ? '#ffd42a' : '#ff8a2e')
    }
    this.turboCount.textContent = String(full)
    this.turboCount.style.display = full > 0 ? 'block' : 'none'
    const countdown = race.phase === 'countdown'
    this.btnTurbo.classList.toggle('ready', (racing && full > 0) || (countdown && race.countdown <= Config.ROCKET_WINDOW[0] && !race.rocketArmed))
    this.btnTurbo.classList.toggle('empty', racing && full === 0)
    this.rocketHint.classList.toggle('on', countdown && !race.rocketArmed)
    if (countdown && race.rocketArmed) this.rocketHint.classList.remove('on')

    const target = race.oilTarget()
    this.oilCount.textContent = String(p.oil)
    this.oilCount.style.display = p.oil > 0 ? 'block' : 'none'
    const ringLen = 389.6
    const recharge = p.oil >= Config.OIL_CHARGES ? 1 : p.oilTimer / Config.OIL_RECHARGE
    this.oilRing.setAttribute('stroke-dashoffset', String(ringLen * (1 - recharge)))
    this.btnOil.classList.toggle('ready', racing && p.oil > 0)
    this.btnOil.classList.toggle('hot', racing && p.oil > 0 && target !== null)
    this.btnOil.classList.toggle('empty', racing && p.oil === 0)
    const idle = !racing && !countdown
    this.btnOil.classList.toggle('idle', idle || countdown)
    this.btnTurbo.classList.toggle('idle', idle)

    // chips
    if (racing && target) {
      const gap = Math.round(p.dist - target.dist)
      this.warn.textContent = p.oil > 0 ? `⚠ ${target.name} on your tail (${gap} m) — OIL!` : `⚠ ${target.name} on your tail`
      this.warn.classList.add('on')
    } else this.warn.classList.remove('on')
    this.draft.classList.toggle('on', racing && p.drafting)
    this.boostChip.classList.toggle('on', p.boost > 0 && race.phase === 'racing')
    this.speedlines.classList.toggle('on', p.boost > 0)

    // tags
    const seen = new Set<string>()
    for (const t of tagPoints) {
      const car = race.car(t.id)
      if (!car || !t.visible) continue
      seen.add(t.id)
      let el = this.tagEls.get(t.id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'tag'
        this.tags.append(el)
        this.tagEls.set(t.id, el)
      }
      const emo = car.spin > 0 ? '💫 ' : car.boost > 0 ? '🔥 ' : ''
      const text = `${emo}${car.place}${ordinal(car.place)} ${car.name}`
      if (el.textContent !== text) el.textContent = text
      el.style.background = car.color + 'cc'
      el.style.left = `${t.x}px`
      el.style.top = `${t.y}px`
      const scale = Math.max(0.6, Math.min(1.15, 30 / Math.max(10, t.dist)))
      el.style.transform = `translate(-50%, -100%) scale(${scale.toFixed(2)})`
      el.style.opacity = t.dist > 180 ? '0' : '1'
    }
    for (const [id, el] of this.tagEls) el.style.display = seen.has(id) && race.phase !== 'intro' ? 'block' : 'none'

    // the title card while the camera sweeps the grid
    const intro = race.phase === 'intro' && race.phaseTime > 0.3 && !paused.on
    this.introCard.classList.toggle('on', intro)
    const ik = `${series.raceNumber}`
    if (intro && ik !== this.introKey) {
      this.introKey = ik
      $('intro-top').textContent = `Race ${series.raceNumber}`
      $('intro-name').textContent = series.trackName
      $('intro-sub').textContent = `${race.laps} lap${race.laps > 1 ? 's' : ''} · ${(race.track.length * race.laps / 1000).toFixed(1)} km`
    }

    // overlays
    this.renderOverlay(series)
    this.pause.classList.toggle('on', paused.on)
    if (paused.on) this.pauseMsg.textContent = paused.message
  }

  private renderBoard(race: Race): void {
    const order = race.order()
    const p = race.player
    const rows = order.map((c: Car, k) => {
      let gap = ''
      if (c !== p) {
        const d = c.dist - p.dist
        const secs = Math.abs(d) / Math.max(10, p.speed)
        gap = c.finished && race.results ? '' : `${d > 0 ? '+' : '−'}${secs.toFixed(1)}s`
      }
      const spin = c.spin > 0 ? '💫' : ''
      return { key: `${c.id}${k}${gap}${spin}`, html: `<div class="row ${c === p ? 'me' : ''}"><span class="n">${k + 1}</span><span class="chip" style="background:${c.color}"></span><span class="name">${c.name}${spin ? ` <span class="spin">${spin}</span>` : ''}</span><span class="gap">${gap}</span></div>` }
    })
    const key = rows.map((r) => r.key).join('|')
    if (key !== this.boardKey) {
      this.boardKey = key
      this.board.innerHTML = rows.map((r) => r.html).join('')
    }
  }

  private renderOverlay(series: Series): void {
    const race = series.race
    let want: string | null = null
    if (series.phase === 'results') want = `results-${series.raceNumber}`
    else if (series.phase === 'standings') want = `standings-${series.raceNumber}`
    else if (series.phase === 'over') want = 'over'
    if (want === this.shown) return
    this.shown = want
    this.results.classList.toggle('on', want !== null)
    if (!want) return
    if (series.phase === 'results' && race.results) {
      const me = race.results.find((r) => r.id === PLAYER_ID)!
      const title = me.place === 1 ? '🏆 You win!' : `${me.place}${ordinal(me.place)} place`
      const rows = race.results.map((r, i) => `<tr class="row-in ${r.id === PLAYER_ID ? 'me' : ''}" style="animation-delay:${0.15 + i * 0.12}s">
        <td class="num">${r.place}${ordinal(r.place)}</td><td><span class="chip-c" style="background:${r.color}"></span> ${r.name}</td>
        <td class="num">${r.time !== null ? clock(r.time) : '—'}</td><td class="num pts">+${r.points}</td></tr>`).join('')
      const p = race.player
      const extras = [
        p.stats.rocket ? '🚀 rocket start' : '',
        p.stats.overtakes ? `${p.stats.overtakes} pass${p.stats.overtakes > 1 ? 'es' : ''}` : '',
        p.stats.oilHits ? `🛢️ ${p.stats.oilHits} spin-out${p.stats.oilHits > 1 ? 's' : ''}` : '',
        p.stats.turbos ? `🔥 ${p.stats.turbos} turbo${p.stats.turbos > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · ')
      this.resultsCard.innerHTML = `<h2>Race ${series.raceNumber} · ${series.trackName}</h2><h1>${title}</h1><table>${rows}</table><div class="sub">${extras || 'Keep pedalling — the next race is coming up'}</div>`
    } else {
      const over = series.phase === 'over'
      const table = series.table()
      const leader = table[0]!
      const title = over ? (leader.id === PLAYER_ID ? '🏆 Champion!' : 'Final standings') : 'Championship'
      const rows = table.map((s, i) => `<tr class="row-in ${s.id === PLAYER_ID ? 'me' : ''}" style="animation-delay:${0.1 + i * 0.1}s">
        <td class="num">${i + 1}</td><td><span class="chip-c" style="background:${s.color}"></span> ${s.name}</td>
        <td class="num">${s.wins ? '🏆'.repeat(Math.min(s.wins, 5)) : ''}</td><td class="num pts">${s.points} pts</td></tr>`).join('')
      const sub = over
        ? `${series.history.length} race${series.history.length === 1 ? '' : 's'} · great workout!`
        : `Next: race ${series.raceNumber + 1} — the leader starts at the back`
      this.resultsCard.innerHTML = `<h2>${over ? 'Workout complete' : `After ${series.raceNumber} race${series.raceNumber > 1 ? 's' : ''}`}</h2><h1>${title}</h1><table>${rows}</table><div class="sub">${sub}</div>`
    }
  }
}
