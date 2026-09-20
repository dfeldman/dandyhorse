/**
 * The whole night, headless: the clock, the lamp, the ships on their timetable, the weather, the horn and the score.
 * The renderer and HUD only read this and drain its events; tests and the balance tool drive it directly.
 */
import { Config, type Difficulty, type WeatherMode } from '../config.ts'
import { Lamp } from './lamp.ts'
import { buildSchedule } from './schedule.ts'
import { Ship } from './ship.ts'
import { WeatherPlan, type WeatherKind } from './weather.ts'

export type ButtonId = 'horn'

export interface StepInput {
  /** 0–100, 50 = steady pace; null = no reading (the lamp holds the last one). */
  pedal: number | null
  presses: ButtonId[]
}

export type TootReason = 'hail' | 'empty' | 'nobody' | 'busy'

export type NightEvent =
  | { type: 'lit' }
  | { type: 'sighted'; ship: Ship }
  | { type: 'watch'; ship: Ship }
  | { type: 'channel'; ship: Ship }
  | { type: 'drifting'; ship: Ship }
  | { type: 'scrape'; ship: Ship }
  | { type: 'aground'; ship: Ship }
  | { type: 'safe'; ship: Ship; stars: number; points: number; streak: number }
  | { type: 'docked'; ship: Ship }
  | { type: 'tow'; ship: Ship }
  | { type: 'leave'; ship: Ship }
  | { type: 'hail'; ship: Ship }
  | { type: 'hailAnswered'; ship: Ship; points: number }
  | { type: 'hailMissed'; ship: Ship }
  | { type: 'horn'; ships: Ship[] }
  | { type: 'toot'; reason: TootReason }
  | { type: 'steam'; charges: number }
  | { type: 'weather'; kind: WeatherKind }
  | { type: 'dawn' }
  | { type: 'done' }

export interface NightOptions {
  seed: number
  /** Workout length (s). */
  duration: number
  difficulty?: Difficulty
  weather?: WeatherMode
}

export type NightPhase = 'night' | 'dawn' | 'done'

export class Night {
  readonly seed: number
  readonly duration: number
  readonly difficulty: Difficulty
  readonly weather: WeatherPlan
  readonly ships: Ship[]
  readonly lamp = new Lamp()
  readonly moorings: (Ship | null)[] = new Array(Config.MOORINGS).fill(null)
  time = 0
  phase: NightPhase = 'night'
  points = 0
  streak = 0
  bestStreak = 0
  hailsAnswered = 0
  hailsSeen = 0
  blasts = 0
  lit = false
  weatherKind: WeatherKind = 'clear'
  private hornCooldown = 0
  private events: NightEvent[] = []

  constructor(opts: NightOptions) {
    this.seed = opts.seed
    this.duration = opts.duration
    this.difficulty = opts.difficulty ?? 'normal'
    this.weather = new WeatherPlan(opts.seed, opts.duration, opts.weather ?? 'mixed')
    const diff = Config.DIFFICULTY[this.difficulty] ?? 1
    const plans = buildSchedule(opts.seed, opts.duration, diff, this.weather, this.difficulty === 'hard')
    this.ships = plans.map((p) => new Ship(p))
  }

  // --- reading ----------------------------------------------------------------------------------------------

  get remaining(): number { return Math.max(0, this.duration - this.time) }
  get progress(): number { return Math.min(1, this.time / this.duration) }
  get watching(): Ship[] { return this.ships.filter((s) => s.watching) }

  /** What the lamp must reach right now: the neediest ship on watch, else the rest target. */
  get target(): number {
    let t: number = Config.REST_TARGET
    for (const s of this.ships) if (s.watching) t = Math.max(t, s.needAt(this.time))
    return t
  }

  /** Ships whose watch hasn't started yet, soonest first. */
  upcoming(n = 3): Ship[] {
    return this.ships.filter((s) => s.plan.watchStart > this.time).slice(0, n)
  }

  /** The next ship's need, shown as a ghost mark on the gauge in the seconds before its watch. */
  ghost(): { need: number; in: number } | null {
    const next = this.upcoming(1)[0]
    if (!next) return null
    const dt = next.plan.watchStart - this.time
    return dt <= Config.GHOST_TIME ? { need: next.plan.need, in: dt } : null
  }

  /** The night's clock as "HH:MM" (dusk to dawn). */
  clock(): string {
    const minutes = Math.floor(Config.NIGHT_START_HOUR * 60 + Config.NIGHT_HOURS * 60 * this.progress + 1e-6)
    const h = Math.floor(minutes / 60) % 24
    const m = minutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  get starsEarned(): number { return this.ships.reduce((a, s) => a + (s.stars ?? 0), 0) }
  get starsDone(): number { return this.ships.filter((s) => s.stars !== null).length * 3 }
  get starsMax(): number { return this.ships.length * 3 }
  get shipsHome(): number { return this.ships.filter((s) => s.stars !== null && s.stars > 0).length }
  get shipsAground(): number { return this.ships.filter((s) => s.stars === 0).length }

  takeEvents(): NightEvent[] { return this.events.splice(0) }

  // --- running ----------------------------------------------------------------------------------------------

  step(dt: number, input: StepInput): void {
    if (this.phase === 'done') return
    for (const b of input.presses) if (b === 'horn') this.horn()
    this.time += dt
    const t = this.time
    this.hornCooldown = Math.max(0, this.hornCooldown - dt)

    const gained = this.lamp.step(dt, input.pedal, this.target)
    if (gained > 0) this.emit({ type: 'steam', charges: this.lamp.charges })
    if (!this.lit && this.lamp.brightness > 0.95 && this.lamp.power > 10) {
      this.lit = true
      this.emit({ type: 'lit' })
    }

    const kind = this.weather.kindAt(t)
    if (kind !== this.weatherKind) {
      this.weatherKind = kind
      this.emit({ type: 'weather', kind })
    }
    const storm = this.weather.mix(t).storm
    const gust = storm > 0 ? storm * this.weather.gust(t) : 0

    for (const ship of this.ships) this.stepShip(ship, t, dt, gust)

    if (this.phase === 'night' && t >= this.duration - Config.DAWN_TIME) {
      this.phase = 'dawn'
      this.emit({ type: 'dawn' })
    }
    if (t >= this.duration) {
      this.phase = 'done'
      this.emit({ type: 'done' })
    }
  }

  private emit(e: NightEvent): void { this.events.push(e) }

  private stepShip(ship: Ship, t: number, dt: number, gust: number): void {
    switch (ship.state) {
      case 'gone':
      case 'moored':
        return
      case 'aground':
        if (t - ship.groundedAt >= Config.TOW_DELAY) {
          ship.state = 'towed'
          ship.towStart = t
          this.moor(ship, t)
          this.emit({ type: 'tow', ship })
        }
        return
      case 'towed':
        ship.u = 4 * Math.min(1, (t - ship.towStart) / Config.TOW_TIME)
        if (t - ship.towStart >= Config.TOW_TIME) this.dock(ship, t)
        return
      case 'leaving':
        if (t - ship.leaveStart >= Config.LEAVE_TIME) ship.state = 'gone'
        return
      default:
        break
    }

    const was = ship.state
    const next = ship.scheduledState(t)
    ship.u = next.u
    if (next.state !== was) {
      ship.state = next.state
      if (was === 'due') this.emit({ type: 'sighted', ship })
      if (next.state === 'approach' || (next.state === 'channel' && was !== 'approach')) this.emit({ type: 'watch', ship })
      if (next.state === 'channel') this.emit({ type: 'channel', ship })
      if (next.state === 'harbor' || (next.state === 'moored' && ship.stars === null)) this.finishWatch(ship, t)
      if (next.state === 'moored') this.dock(ship, t)
    }

    if (ship.watching) {
      const r = ship.stepDrift(t, dt, { deficit: ship.needAt(t) - this.lamp.power, gust })
      if (!ship.warned && ship.drift >= Config.WARN_DRIFT) {
        ship.warned = true
        this.emit({ type: 'drifting', ship })
      } else if (ship.warned && ship.drift < Config.WARN_DRIFT * 0.4) {
        ship.warned = false
      }
      if (r === 'scrape' && t - ship.scrapeAt >= 0.8) {
        ship.scrapeAt = t
        this.emit({ type: 'scrape', ship })
      } else if (r === 'aground') {
        this.ground(ship, t)
      }
      this.stepHail(ship, t)
    }
  }

  private stepHail(ship: Ship, t: number): void {
    const at = ship.plan.hailAt
    if (at === null) return
    if (!ship.hail && t >= at && ship.state !== 'aground') {
      ship.hail = { opened: t, answered: false, missed: false }
      this.hailsSeen++
      this.emit({ type: 'hail', ship })
    } else if (ship.hail && !ship.hail.answered && !ship.hail.missed && t - ship.hail.opened > Config.HAIL_WINDOW) {
      ship.hail.missed = true
      this.emit({ type: 'hailMissed', ship })
    }
  }

  private openHails(): Ship[] {
    return this.ships.filter((s) => s.hail && !s.hail.answered && !s.hail.missed)
  }

  private finishWatch(ship: Ship, t: number): void {
    const stars = ship.score()
    ship.stars = stars
    ship.onRocks = false
    this.closeHail(ship)
    if (stars === 3) {
      this.streak++
      this.bestStreak = Math.max(this.bestStreak, this.streak)
    } else {
      this.streak = 0
    }
    const points = stars * Config.STAR_POINTS + (stars === 3 ? Config.STREAK_POINTS * Math.min(Config.STREAK_CAP, this.streak - 1) : 0)
    this.points += points
    this.moor(ship, t)
    this.emit({ type: 'safe', ship, stars, points, streak: this.streak })
  }

  private ground(ship: Ship, t: number): void {
    ship.state = 'aground'
    ship.stars = 0
    ship.groundedAt = t
    ship.onRocks = true
    this.streak = 0
    this.closeHail(ship)
    this.emit({ type: 'aground', ship })
  }

  private closeHail(ship: Ship): void {
    if (ship.hail && !ship.hail.answered && !ship.hail.missed) {
      ship.hail.missed = true
      this.emit({ type: 'hailMissed', ship })
    }
  }

  /** Give a ship a mooring as it heads in; if the harbour is full the longest-moored ship sails out. */
  private moor(ship: Ship, t: number): void {
    if (ship.mooring >= 0) return
    let slot = this.moorings.indexOf(null)
    if (slot < 0) {
      let oldest = -1
      for (let i = 0; i < this.moorings.length; i++) {
        const m = this.moorings[i]!
        if (m.state !== 'moored') continue
        if (oldest < 0 || m.mooredAt < this.moorings[oldest]!.mooredAt) oldest = i
      }
      if (oldest < 0) return // everyone is still arriving; this one anchors off (renderer keeps it at the channel's end)
      const leaver = this.moorings[oldest]!
      leaver.state = 'leaving'
      leaver.leaveStart = t
      this.emit({ type: 'leave', ship: leaver })
      slot = oldest
    }
    this.moorings[slot] = ship
    ship.mooring = slot
  }

  private dock(ship: Ship, t: number): void {
    ship.state = 'moored'
    ship.u = 4
    ship.mooredAt = t
    if (ship.mooring < 0) this.moor(ship, t)
    this.emit({ type: 'docked', ship })
  }

  /**
   * End the night now, wherever it had got to: the session ended from a bridge, the console or the pause menu
   * (INTEGRATION.md §6). Ships still at sea keep whatever stars they had earned.
   */
  finishNow(): void {
    if (this.phase === 'done') return
    this.phase = 'done'
    this.emit({ type: 'done' })
  }

  // --- the horn ---------------------------------------------------------------------------------------------

  private horn(): void {
    if (this.phase === 'done') return
    if (this.hornCooldown > 0) {
      this.emit({ type: 'toot', reason: 'busy' })
      return
    }
    this.hornCooldown = Config.HORN_COOLDOWN
    const hails = this.openHails()
    for (const s of hails) {
      s.hail!.answered = true
      this.hailsAnswered++
      this.points += Config.HAIL_POINTS
      this.emit({ type: 'hailAnswered', ship: s, points: Config.HAIL_POINTS })
    }
    const watched = this.watching
    const needy = watched.some((s) => s.drift >= Config.HORN_MIN_DRIFT)
    if (needy && this.lamp.spend()) {
      for (const s of watched) {
        s.drift = Math.max(0, s.drift - Config.HORN_KICK)
        s.driftVel = Math.min(s.driftVel, -0.05)
        s.calmUntil = this.time + Config.HORN_CALM
      }
      this.blasts++
      this.emit({ type: 'horn', ships: watched })
      return
    }
    this.emit({ type: 'toot', reason: hails.length ? 'hail' : needy ? 'empty' : 'nobody' })
  }

  /** What the platform adapter would send each second. */
  snapshot() {
    return {
      phase: this.phase,
      time: Math.round(this.time),
      remaining: Math.round(this.remaining),
      clock: this.clock(),
      target: Math.round(this.target),
      power: Math.round(this.lamp.power * 10) / 10,
      brightness: Math.round(this.lamp.brightness * 100) / 100,
      steam: Math.round(this.lamp.steam * 100) / 100,
      weather: this.weatherKind,
      points: this.points,
      stars: this.starsEarned,
      starsMax: this.starsMax,
      shipsHome: this.shipsHome,
      shipsAground: this.shipsAground,
      watching: this.watching.map((s) => ({ name: s.name, need: s.plan.need, drift: Math.round(s.drift * 100) / 100, hull: Math.round(s.hull * 100) / 100 })),
      next: this.upcoming(1).map((s) => ({ name: s.name, need: s.plan.need, in: Math.round(s.plan.watchStart - this.time) }))[0] ?? null,
    }
  }
}
