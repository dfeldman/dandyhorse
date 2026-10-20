/**
 * The workout: races back to back on new tracks, with championship points, until the time is up.
 * Each race's laps are chosen so it fits in the time that's left; the last one may be a single lap.
 */
import { Config } from '../config.ts'
import { rivals } from '../ghosts.ts'
import { makeRng } from '../rng.ts'
import { PLAYER_ID, Race, type RaceInput, type Result } from './race.ts'

export type SeriesPhase = 'race' | 'results' | 'standings' | 'over'

export interface Standing { id: string; name: string; color: string; points: number; wins: number }

export interface SeriesOptions {
  seed: number
  /** Workout length (s). */
  duration: number
  difficulty: number
  /** Force the laps per race (testing). */
  laps?: number
}

const TRACK_NAMES = [
  'Neon Harbor', 'Skyline Loop', 'Midnight Hills', 'Chrome Canyon', 'Lantern Row', 'Moonlight Mile',
  'Starlight Switchbacks', 'Glowtown Circuit', 'Velvet Heights', 'Afterglow Avenue', 'Comet Crescent', 'Owl Valley',
]

export class Series {
  readonly opts: SeriesOptions
  race: Race
  raceNumber = 1
  trackName: string
  phase: SeriesPhase = 'race'
  /** Seconds since the player took the flag (results → standings → next race). */
  private afterFinish = 0
  /** Active workout seconds (pauses excluded). */
  elapsed = 0
  readonly standings: Map<string, Standing>
  /** Every race's results, in order. */
  readonly history: { name: string; results: Result[] }[] = []
  /** Bumped whenever a new race (a new track) starts, so the renderer knows to rebuild. */
  version = 1
  private readonly names: string[]
  private speedSum = 0
  private speedTime = 0
  /** Driven by the platform's active seconds when set; otherwise by step(dt). */
  private externalClock: (() => number) | null = null

  constructor(opts: SeriesOptions) {
    this.opts = opts
    const rng = makeRng(opts.seed, 'names')
    this.names = [...TRACK_NAMES].sort(() => rng() - 0.5)
    this.standings = new Map()
    const all = [{ id: PLAYER_ID, name: 'You', color: '#ff2d2d' }, ...rivals()]
    for (const c of all) this.standings.set(c.id, { id: c.id, name: c.name, color: c.color, points: 0, wins: 0 })
    this.trackName = this.names[0]!
    this.race = this.makeRace(['blue', 'gold', PLAYER_ID, 'green'])
  }

  useClock(fn: () => number): void { this.externalClock = fn }

  get remaining(): number { return Math.max(0, this.opts.duration - this.elapsed) }

  /** Seconds since the player finished the current race, while its results and the standings show. */
  get sinceFinish(): number { return this.afterFinish }

  /** Standings, leader first (ties: more wins, then the player last so rivals don't look robbed). */
  table(): Standing[] {
    return [...this.standings.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || (a.id === PLAYER_ID ? 1 : 0) - (b.id === PLAYER_ID ? 1 : 0))
  }

  /** A lap at the player's recent average speed (s). */
  lapEstimate(length: number): number {
    const avg = this.speedTime > 20 ? this.speedSum / this.speedTime : Config.CRUISE_SPEED * 0.92
    return length / Math.max(15, avg)
  }

  private makeRace(grid: string[]): Race {
    const seed = (this.opts.seed * 7919 + this.raceNumber * 104729) >>> 0
    // build once to learn the length, then pick laps that fit (the track is cheap to build)
    const probe = new Race({ seed, laps: 1, difficulty: this.opts.difficulty, grid, clockOffset: this.elapsed })
    const laps = this.opts.laps ?? this.lapsFor(probe.track.length)
    if (laps === probe.laps) return probe
    return new Race({ seed, laps, difficulty: this.opts.difficulty, grid, clockOffset: this.elapsed })
  }

  private lapsFor(length: number): number {
    const lap = this.lapEstimate(length)
    const budget = this.remaining - Config.RACE_OVERHEAD
    return Math.max(1, Math.min(Config.MAX_LAPS, Math.floor(budget / lap)))
  }

  /** Is there time for another race of at least one lap? */
  private roomForAnother(): boolean {
    const lap = this.lapEstimate(this.race.track.length)
    return this.remaining >= lap * 0.75 + Config.INTRO_TIME + Config.COUNTDOWN_TIME
  }

  step(dt: number, input: RaceInput): void {
    if (this.externalClock) this.elapsed = this.externalClock()
    else this.elapsed += dt
    const race = this.race
    const wasFinished = race.phase === 'finished'
    race.step(dt, input)
    if (race.phase === 'racing') {
      this.speedSum += race.player.speed * dt
      this.speedTime += dt
    }
    if (race.phase !== 'finished') return
    if (!wasFinished) this.onFinish()
    this.afterFinish += dt
    if (this.phase === 'results' && this.afterFinish >= Config.RESULTS_TIME) this.phase = 'standings'
    if (this.phase === 'standings' && this.afterFinish >= Config.RESULTS_TIME + Config.STANDINGS_TIME) {
      if (this.roomForAnother()) this.nextRace()
      else this.phase = 'over'
    }
  }

  private onFinish(): void {
    const results = this.race.results!
    for (const r of results) {
      const s = this.standings.get(r.id)!
      s.points += r.points
      if (r.place === 1) s.wins++
    }
    this.history.push({ name: this.trackName, results })
    this.phase = 'results'
    this.afterFinish = 0
  }

  /** End the workout now (the platform ended the session, or time ran out in a menu). */
  finishNow(): void {
    this.phase = 'over'
  }

  private nextRace(): void {
    this.raceNumber++
    this.trackName = this.names[(this.raceNumber - 1) % this.names.length]!
    // reverse standings: the leader starts at the back
    const grid = this.table().map((s) => s.id).reverse()
    this.race = this.makeRace(grid)
    this.phase = 'race'
    this.afterFinish = 0
    this.version++
  }

  /** The car ids of the current standings, for the platform's score. */
  get playerPoints(): number { return this.standings.get(PLAYER_ID)!.points }
}
