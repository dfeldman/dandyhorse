/**
 * The DOM HUD: the night's clock and tally, the harbour board (ships on watch with their channel bars, ships due),
 * the lamp gauge (your power against the target, and a ghost of the next one), the horn button, callouts, one-time
 * hints, name tags over ships, and the logbook at dawn.
 */
import { Config } from '../config.ts'
import { clamp } from '../rng.ts'
import { FLEET } from '../sim/fleet.ts'
import type { Night, NightEvent } from '../sim/night.ts'
import type { Ship } from '../sim/ship.ts'
import { WEATHER_ICON, WEATHER_LABEL } from '../sim/weather.ts'

export interface TagPoint { id: number; x: number; y: number; visible: boolean; dist: number }

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

const G_MIN = 10
const G_MAX = 80
const gx = (p: number): number => clamp(((p - G_MIN) / (G_MAX - G_MIN)) * 100, 0, 100)

const mmss = (s: number): string => {
  s = Math.max(0, Math.ceil(s))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const pips = (level: number): string =>
  `<span class="pips">${'●'.repeat(level)}<span class="off">${'●'.repeat(4 - level)}</span></span>`

const starRow = (n: number): string => `${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span>`

const HINTS = {
  light: 'Pedal to light the lamp 💡',
  sighted: 'A ship! The board shows how bright she needs the lamp',
  watch: 'Keep your bar past the white line until she’s through the rocks',
  drift: 'She’s drifting toward the rocks — pedal harder to bring her back!',
  steam: 'Steam’s up ♨ Tap 📯 HORN to pull a drifting ship back on course',
  hail: 'She’s signalling 📡 Tap 📯 HORN to answer',
  ghost: 'Get ready — the dashed line is the next ship’s need',
} as const
export type HintId = keyof typeof HINTS

/**
 * Where the hints already seen and the best points per watch are kept. Standalone that is this browser; on
 * Dandyhorse it is the session's save state, so they follow the player from machine to machine.
 */
export interface HudStore {
  hints(): HintId[]
  saveHints(ids: HintId[]): void
  best(minutes: number, difficulty: string): number
  saveBest(minutes: number, difficulty: string, points: number): void
}

/** The default store: this browser. */
export const localStore: HudStore = {
  hints: () => {
    try { return JSON.parse(localStorage.getItem('nightwatch.hints') ?? '[]') as HintId[] } catch { return [] }
  },
  saveHints: (ids) => {
    try { localStorage.setItem('nightwatch.hints', JSON.stringify(ids)) } catch { /* private mode */ }
  },
  best: (minutes, difficulty) => {
    try { return Number(localStorage.getItem(`nightwatch.best.${minutes}.${difficulty}`) ?? 0) } catch { return 0 }
  },
  saveBest: (minutes, difficulty, points) => {
    try { localStorage.setItem(`nightwatch.best.${minutes}.${difficulty}`, String(points)) } catch { /* private mode */ }
  },
}

export interface HudOptions {
  harness: boolean
  onHorn: () => void
  onResume: () => void
  onPedal: (v: number) => void
  onAgain: () => void
  /** The platform's "End workout": shown in the pause card only when a session is running. */
  onEnd?: () => void
  /** Where hints and best scores are kept (this browser by default). */
  store?: HudStore
}

export class Hud {
  private readonly el = {
    clock: $('clock'), weather: $('weather'), nightFill: $('night-fill'), stars: $('stars'), home: $('home'), points: $('points'),
    cards: $('watch-cards'), rows: $('next-rows'), nextTitle: $('next-title'),
    lampStatus: $('lamp-status'), lampSub: $('lamp-sub'), lampGlow: $('lamp-glow'),
    zones: $('gauge-zones'), fill: $('gauge-fill'), target: $('gauge-target'), ghost: $('gauge-ghost'),
    horn: $<HTMLButtonElement>('btn-horn'), callouts: $('callouts'), hint: $('hint'), tags: $('tags'), vignette: $('vignette'),
    pause: $('pause'), logbook: $('logbook'), loading: $('loading'),
  }
  private readonly steamPips: HTMLElement[]
  private readonly tagEls = new Map<number, HTMLElement>()
  private lastTarget = -1
  private hintQueue: HintId[] = []
  private readonly hintsShown = new Set<HintId>()
  private readonly store: HudStore
  private hintUntil = 0
  private lastBoard = ''
  private lastStars = 0
  private readonly opts: HudOptions

  constructor(opts: HudOptions) {
    this.opts = opts
    this.steamPips = Array.from(this.el.horn.querySelectorAll<HTMLElement>('.steam b'))
    if (opts.harness) {
      document.body.classList.add('harness-on')
      $('harness').style.display = 'block'
      const slider = $<HTMLInputElement>('pedal')
      slider.addEventListener('input', () => opts.onPedal(Number(slider.value)))
    }
    this.el.horn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      opts.onHorn()
    })
    $('resume').addEventListener('click', () => opts.onResume())
    $('again').addEventListener('click', () => opts.onAgain())
    if (opts.onEnd) {
      const end = $('end-watch')
      end.hidden = false
      end.addEventListener('click', opts.onEnd)
    }
    this.store = opts.store ?? localStore
    for (const h of this.store.hints()) this.hintsShown.add(h)
  }

  hideLoading(): void {
    this.el.loading.style.opacity = '0'
    setTimeout(() => { this.el.loading.style.display = 'none' }, 700)
  }

  setPedalSlider(v: number): void { ($<HTMLInputElement>('pedal')).value = String(Math.round(v)) }

  // --- events ---------------------------------------------------------------------------------------------

  event(e: NightEvent, night: Night): void {
    switch (e.type) {
      case 'lit': this.callout('The lamp is lit!', 'good small'); break
      case 'sighted':
        this.hint('sighted')
        break
      case 'watch':
        this.callout(`${FLEET[e.ship.plan.kind].emoji} ${e.ship.name}!`, 'cool small')
        this.hint('watch')
        break
      case 'drifting': this.hint('drift'); break
      case 'aground':
        this.callout(`🆘 ${e.ship.name} is aground!`, 'bad')
        break
      case 'safe':
        this.callout(`<span class="stars">${starRow(e.stars)}</span><br>${e.stars === 3 ? 'Safe harbour!' : e.stars === 2 ? 'Home safe' : 'Home… just'}` +
          (e.streak >= 2 && e.stars === 3 ? `<div class="small">🔥 ${e.streak} in a row</div>` : ''), e.stars === 3 ? 'good' : 'cool')
        this.bump(this.el.stars)
        break
      case 'tow': this.callout('⛴ The tug brings her in', 'cool small'); break
      case 'hail': this.hint('hail'); break
      case 'hailAnswered': this.callout(`📡 Answered! +${e.points}`, 'good small'); break
      case 'horn': this.tap(); break
      case 'toot':
        this.tap()
        if (e.reason === 'empty') this.nope('No steam yet — push past the line to build it')
        if (e.reason === 'busy') this.nope('')
        break
      case 'steam':
        this.hint('steam')
        break
      case 'weather':
        if (e.kind !== 'clear') this.callout(`${WEATHER_ICON[e.kind]} ${WEATHER_LABEL[e.kind]} rolling in`, 'cool small')
        else this.callout('The sky clears', 'cool small')
        break
      case 'dawn': this.callout('🌅 Dawn is coming', 'good small'); break
      case 'done': this.showLogbook(night); break
      default: break
    }
  }

  private callout(html: string, cls: string): void {
    const div = document.createElement('div')
    div.className = `callout pop ${cls}`
    div.innerHTML = html
    this.el.callouts.appendChild(div)
    while (this.el.callouts.children.length > 2) this.el.callouts.firstElementChild!.remove()
    setTimeout(() => div.remove(), 2500)
  }

  private bump(el: HTMLElement): void {
    el.classList.remove('bump')
    void el.offsetWidth
    el.classList.add('bump')
  }

  private tap(): void {
    const b = this.el.horn
    b.classList.remove('tap')
    void b.offsetWidth
    b.classList.add('tap')
    setTimeout(() => b.classList.remove('tap'), 120)
  }

  private nope(msg: string): void {
    const b = this.el.horn
    b.classList.remove('nope')
    void b.offsetWidth
    b.classList.add('nope')
    if (msg) this.showHintText(msg, 3)
  }

  hint(id: HintId): void {
    if (this.hintsShown.has(id) || this.hintQueue.includes(id)) return
    this.hintQueue.push(id)
  }

  private showHintText(text: string, seconds: number): void {
    this.el.hint.textContent = text
    this.el.hint.classList.add('on')
    this.hintUntil = performance.now() + seconds * 1000
  }

  private pumpHints(): void {
    const now = performance.now()
    if (now < this.hintUntil) return
    if (this.hintQueue.length === 0) {
      this.el.hint.classList.remove('on')
      return
    }
    const id = this.hintQueue.shift()!
    this.hintsShown.add(id)
    this.store.saveHints([...this.hintsShown])
    this.showHintText(HINTS[id], 6)
  }

  // --- per frame --------------------------------------------------------------------------------------------

  /** The platform's pause message, shown as-is; null keeps the standalone wording. */
  setPauseMessage(msg: string | null): void {
    if (msg) $('pause-sub').textContent = msg
  }

  update(night: Night, pedal: number, tags: TagPoint[], paused: boolean): void {
    const e = this.el
    e.pause.classList.toggle('on', paused && night.phase !== 'done')
    e.clock.textContent = night.clock()
    const kind = night.weatherKind
    e.weather.textContent = kind === 'clear' ? '' : `${WEATHER_ICON[kind]} ${WEATHER_LABEL[kind]}`
    e.nightFill.style.left = `${night.progress * 100}%`
    const stars = night.starsEarned
    if (stars !== this.lastStars) this.lastStars = stars
    e.stars.textContent = `★ ${stars}`
    e.home.textContent = `⚓ ${night.shipsHome}`
    e.points.textContent = `${night.points.toLocaleString()} pts`

    this.updateBoard(night)
    this.updateLamp(night, pedal)
    this.updateHorn(night)
    this.updateTags(night, tags)
    if (!night.lit && night.time > 3) this.hint('light')
    if (night.ghost() && night.ships[0] && night.upcoming(1)[0] !== night.ships[0]) this.hint('ghost')
    this.pumpHints()
    const onRocks = night.ships.some((s) => s.watching && s.onRocks)
    e.vignette.classList.toggle('on', onRocks)
  }

  private updateBoard(night: Night): void {
    const watching = night.watching
    const cards = watching.map((s) => this.card(s, night)).join('')
    const next = night.upcoming(3)
    const rows = next.map((s) => {
      const eta = s.plan.watchStart - night.time
      const k = FLEET[s.plan.kind]
      return `<div class="row${eta < Config.GHOST_TIME + 8 ? ' soon' : ''}"><span class="emo">${k.emoji}</span><span class="nm">${s.name}</span>` +
        `${s.plan.weather !== 'clear' ? `<span class="wx">${WEATHER_ICON[s.plan.weather]}</span>` : ''}${pips(s.plan.level)}<span class="need">${s.plan.need}</span><span class="eta">${mmss(eta)}</span></div>`
    }).join('')
    const html = cards + '|' + (rows || '<div class="board-empty">No more ships tonight</div>')
    if (html === this.lastBoard) return
    this.lastBoard = html
    const [c, r] = html.split('|')
    this.el.cards.innerHTML = c!
    this.el.rows.innerHTML = r!
    this.el.nextTitle.style.display = next.length ? 'block' : 'none'
  }

  private card(s: Ship, night: Night): string {
    const k = FLEET[s.plan.kind]
    const d = Math.min(s.drift, Config.DRIFT_CAP) / Config.DRIFT_CAP
    const left = 50 + s.plan.side * d * 46
    const p = s.plan
    const prog = clamp((night.time - p.watchStart) / (p.watchEnd - p.watchStart), 0, 1)
    const phase = s.state === 'approach' ? 'Approach' : 'Channel'
    const hearts = Math.ceil(s.hull * 3 - 1e-6)
    const hailOpen = s.hail && !s.hail.answered && !s.hail.missed
    const danger = s.drift >= Config.WARN_DRIFT
    return `<div class="card watch${danger ? ' danger' : ''}${hailOpen ? ' hail' : ''}">` +
      `<div class="c-top"><span class="emo">${k.emoji}</span><span class="nm">${s.name}</span>${pips(p.level)}<span class="need">${p.need}</span></div>` +
      `<div class="channel"><span class="rocks l">🪨</span><span class="rocks r">🪨</span><div class="boat" style="left:${left.toFixed(1)}%">${s.onRocks ? '💥' : ''}</div></div>` +
      `<div class="c-bot"><span>${phase}</span><div class="prog"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>` +
      `<span class="hull">${s.scraped ? '♥'.repeat(Math.max(0, hearts)) + '♡'.repeat(3 - Math.max(0, hearts)) : ''}</span></div>` +
      `<div class="hail-chip">📡 Signalling! Tap 📯</div></div>`
  }

  private updateLamp(night: Night, pedal: number): void {
    const e = this.el
    const lamp = night.lamp
    const target = night.target
    const power = lamp.power
    const b = lamp.brightness
    e.lampGlow.style.opacity = String(0.15 + 0.85 * b)
    e.lampGlow.style.transform = `scale(${0.5 + 0.7 * b})`
    if (Math.abs(target - this.lastTarget) > 0.2) {
      this.lastTarget = target
      const t = gx(target)
      const a = gx(target - 13), w = gx(target - 7), g = gx(target - 2)
      e.zones.style.background = `linear-gradient(90deg, rgba(255,60,60,.35) 0%, rgba(255,60,60,.6) ${a}%, rgba(255,190,60,.6) ${w}%, rgba(90,255,150,.6) ${g}%, rgba(90,255,150,.6) ${t}%, rgba(255,210,90,.5) ${Math.min(100, t + 8)}%, rgba(255,240,180,.5) 100%)`
      e.target.style.left = `${t}%`
      e.target.firstElementChild!.textContent = String(Math.round(target))
    }
    e.fill.style.width = `calc(${gx(power)}% - 3px)`
    const deficit = target - power
    const watching = night.watching
    const lead = watching.reduce<Ship | null>((m, s) => (!m || s.plan.need > m.plan.need ? s : m), null)
    let cls = 'good'
    if (deficit > 7) cls = 'bad'
    else if (deficit > 2) cls = 'warn'
    else if (power > Math.max(target, Config.STEAM_FLOOR) + 3 && lamp.steam < Config.STEAM_MAX) cls = 'steam'
    e.fill.className = cls === 'good' ? '' : cls
    const ghost = night.ghost()
    if (ghost) {
      e.ghost.classList.add('on')
      e.ghost.style.left = `${gx(ghost.need)}%`
      e.ghost.firstElementChild!.textContent = `next ${ghost.need} · ${Math.ceil(ghost.in)}s`
    } else {
      e.ghost.classList.remove('on')
    }
    let status: string, sub: string
    if (night.phase === 'done') { status = 'Morning!'; sub = 'The lamp can rest' }
    else if (!night.lit) { status = 'Light the lamp!'; sub = 'Pedal to spin it up' }
    else if (lead) {
      const n = lead.name
      if (cls === 'bad') { status = 'BRIGHTER!'; sub = `${n} can’t see the rocks!` }
      else if (cls === 'warn') { status = 'A little brighter'; sub = `${n} is wandering off the line` }
      else if (cls === 'steam') { status = 'Blazing! ♨'; sub = 'Extra effort is building steam' }
      else { status = 'Bright! ✓'; sub = `${n} can see the way in` }
    } else if (ghost) {
      status = `Get ready: ${ghost.need}`
      sub = `${night.upcoming(1)[0]?.name ?? 'A ship'} needs the light in ${Math.ceil(ghost.in)}s`
      cls = ghost.need - power > 7 ? 'warn' : 'good'
    } else if (cls === 'steam') { status = 'Building steam ♨'; sub = 'Or ease off and rest — your choice' }
    else { status = 'Resting'; sub = 'An easy pace keeps the lamp lit' ; cls = deficit > 7 ? 'warn' : '' }
    e.lampStatus.textContent = status
    e.lampStatus.className = cls
    e.lampSub.textContent = sub
    void pedal
  }

  private updateHorn(night: Night): void {
    const lamp = night.lamp
    for (let i = 0; i < this.steamPips.length; i++) this.steamPips[i]!.style.height = `${clamp(lamp.steam - i, 0, 1) * 100}%`
    const hail = night.watching.some((s) => s.hail && !s.hail.answered && !s.hail.missed)
    const needy = night.watching.some((s) => s.drift >= 0.4)
    const b = this.el.horn
    b.classList.toggle('hail', hail)
    b.classList.toggle('hot', !hail && needy && lamp.charges > 0)
    b.classList.toggle('ready', !hail && !needy && lamp.charges > 0)
    b.querySelector('.now')!.textContent = hail ? 'ANSWER!' : 'NOW!'
  }

  private updateTags(night: Night, tags: TagPoint[]): void {
    const seen = new Set<number>()
    for (const t of tags) {
      const ship = night.ships.find((s) => s.id === t.id)
      if (!ship || !t.visible) continue
      seen.add(t.id)
      let el = this.tagEls.get(t.id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'tag'
        this.el.tags.appendChild(el)
        this.tagEls.set(t.id, el)
      }
      const hailOpen = ship.hail && !ship.hail.answered && !ship.hail.missed
      let cls = 'tag'
      let label = ship.name
      if (ship.state === 'inbound') { cls += ' far'; label = `🔭 ${ship.name}` }
      else if (ship.state === 'aground') { cls += ' aground'; label = `🆘 ${ship.name}` }
      else if (ship.watching) cls += ship.drift >= Config.WARN_DRIFT ? ' danger' : ' watch'
      else if (ship.state === 'harbor') label = `${'★'.repeat(ship.stars ?? 0)} ${ship.name}`
      const html = `${label}${hailOpen ? '<span class="bubble">📡❓</span>' : ''}`
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html }
      if (el.className !== cls) el.className = cls
      el.style.left = `${t.x.toFixed(0)}px`
      el.style.top = `${t.y.toFixed(0)}px`
      el.style.display = ''
    }
    for (const [id, el] of this.tagEls) if (!seen.has(id)) el.style.display = 'none'
  }

  private showLogbook(night: Night): void {
    const rows = night.ships.map((s) => {
      const k = FLEET[s.plan.kind]
      const hail = s.plan.hailAt === null || !s.hail ? '' : s.hail.answered ? '📡✓' : '<span class="missed">📡</span>'
      const st = s.stars ?? 0
      return `<tr><td>${k.emoji}</td><td>${s.name}</td><td class="st">${st === 0 ? '🆘' : starRow(st)}</td><td class="hl">${hail}</td></tr>`
    }).join('')
    $('log-table').innerHTML = rows
    const pct = night.starsMax ? Math.round((night.starsEarned / night.starsMax) * 100) : 0
    $('log-sub').textContent = pct >= 90 ? 'A perfect watch. The whole town slept soundly.' : pct >= 70 ? 'A fine watch, keeper.' : pct >= 45 ? 'A long night — most of them made it home.' : 'A rough night on the rocks. Tomorrow will be better.'
    $('log-totals').innerHTML = [
      [`${night.shipsHome}/${night.ships.length}`, 'ships home'],
      [`${night.starsEarned}/${night.starsMax}`, 'stars'],
      [night.points.toLocaleString(), 'points'],
      [`${night.hailsAnswered}/${night.hailsSeen}`, 'hails answered'],
      [String(night.blasts), 'horn blasts'],
      [String(night.bestStreak), 'best streak'],
    ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('')
    const minutes = Math.round(night.duration / 60)
    const best = this.store.best(minutes, night.difficulty)
    if (night.points > best) this.store.saveBest(minutes, night.difficulty, night.points)
    $('log-best').textContent = night.points > best ? (best > 0 ? `🏆 New best! (was ${best.toLocaleString()})` : '🏆 Your first logged watch!') : `Best for this watch: ${best.toLocaleString()} pts`
    this.el.logbook.classList.add('on')
    if (night.starsEarned >= night.starsMax * 0.6) this.callout('🎆', 'good')
  }
}
