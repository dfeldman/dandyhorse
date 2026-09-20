/**
 * Night Racer on Dandyhorse (INTEGRATION.md): the platform side of `Controls`. One instance per page.
 *
 *   machine ─► getstate (1 Hz) ─► pedal() = 50 × EffortMeter        (50 is the player's steady pace)
 *   phone taps ─► getstate.inputs ─► takePresses() ─► Turbo / Oil   (a persistent prompt)
 *   game ─► setstate (1 Hz): grade, position, score, custom         ─► History and the trainer
 *
 * The on-screen buttons go out through `client.answer()` and come back through `onInput`, so a tap on the
 * screen and a tap on the phone take exactly the same path (the platform's rule that every prompt has the
 * same buttons on screen).
 */
import {
  EffortMeter, SessionClient, persistentPrompt, putSave,
  type EndInfo, type GameState, type InputAnswer, type Json, type StartPayload, type TickBody,
} from '@dandyhorse/gamekit'
import { Config, type Difficulty } from './config.ts'
import type { Controls } from './controls.ts'
import { clamp } from './rng.ts'
import type { ButtonId } from './sim/car.ts'
import { PLAYER_ID, type RaceEvent } from './sim/race.ts'
import type { Series } from './sim/series.ts'

export const GAME_ID = 'nightracer'
const PROMPT_ID = 'items'
/** The phone's buttons. An answer is the label, so keep both directions. */
const BUTTONS: readonly { id: ButtonId; label: string }[] = [
  { id: 'turbo', label: '🚀 Turbo' },
  { id: 'oil', label: '🛢 Oil' },
]
const LABELS = BUTTONS.map((b) => b.label)

/** The road as the trainer feels it (INTEGRATION.md §4): half the grade, smoothed, climbs only. */
const GRADE_SCALE = 0.5
const GRADE_MAX = 6
/** Seconds of smoothing on the grade, at the 1 Hz tick. */
const GRADE_TAU = 2
/** The standings show for this long before the session ends. */
const END_DELAY_MS = 4000

const seconds = (): number => performance.now() / 1000

const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
const HILLS = ['feel', 'flat'] as const

/** A launch option, checked against its enum: the server fills defaults in, but never trust a stray value. */
function option<T extends string>(options: Json, key: string, allowed: readonly T[], fallback: T): T {
  const v = (options as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

const numberOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** What the platform needs from the page. */
export interface RacerHooks {
  series: Series
  /** The session's picture for History: a PNG/JPEG data URL read back from the last frame. */
  sessionImage(): string | null
}

/** What the game saves between sessions. */
interface Save {
  wins: number
  /** Best championship points, by workout length in minutes. */
  best: Record<string, number>
  lastSeed: number
}

function parseSave(v: Json | null): Save {
  const o = (v ?? {}) as Record<string, unknown>
  const best = o.best && typeof o.best === 'object' ? (o.best as Record<string, unknown>) : {}
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(best)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n
  return { wins: numberOr(o.wins, 0), best: out, lastSeed: numberOr(o.lastSeed, 0) }
}

export class Platform implements Controls {
  /** The platform supplies the pedal, so the HUD draws no slider. */
  readonly harness = false
  readonly start: StartPayload
  readonly duration: number
  readonly difficulty: Difficulty
  /** Whether the trainer follows the road's climbs (the `hills` option; bike only). */
  readonly hills: boolean

  private readonly log: (line: string) => void
  private readonly client: SessionClient
  private readonly meter: EffortMeter
  private hooks: RacerHooks | null = null
  private latest: GameState | null = null
  private receivedAt = 0
  private endedInfo: EndInfo | null = null
  private finishing = false
  /** Taps waiting for the game to take them. */
  private readonly queue: ButtonId[] = []
  private promptOpen = false
  private smoothGrade = 0

  // achievements
  private readonly earned = new Set<string>()
  private readonly pending: string[] = []
  private sent: string[] = []
  private winStreak = 0
  private spunThisRace = 0
  private seenRace = 1

  // save state
  private save: Save
  private saveDirty = false

  constructor(start: StartPayload, log: (line: string) => void) {
    this.start = start
    this.log = log
    this.duration = start.requestedDuration ?? Config.DEFAULT_MINUTES * 60
    this.difficulty = option(start.options, 'difficulty', DIFFICULTIES, 'normal')
    this.hills = option(start.options, 'hills', HILLS, 'feel') === 'feel'
    this.save = parseSave(start.saveState)
    for (const id of Object.keys(start.achievements ?? {})) this.earned.add(id.replace(`${GAME_ID}.`, ''))

    // Effort is the machine against the player's own steady pace, so a walker and a runner both reach 50 at
    // their comfortable pace. Default smoothing: the car has its own inertia and nothing here punishes lag.
    this.meter = new EffortMeter({
      deviceType: start.deviceType,
      bodyData: start.bodyData,
      preferences: { global: start.preferences.global, device: start.preferences.device },
    })
    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s; this.receivedAt = Date.now(); this.meter.update(s, seconds()) },
      onInput: (a) => this.onAnswer(a),
      onPause: (p) => this.log(`paused: ${p.reason} — ${p.message}`),
      onResume: (secs) => this.log(`resumed after ${secs.toFixed(0)} s`),
      onEnded: (e) => {
        this.endedInfo = e
        this.log(`ended: ${e.status} (${e.reason ?? 'no reason'})`)
      },
      onError: (ctx, err) => this.log(`${ctx}: ${err instanceof Error ? err.message : String(err)}`),
      onTick: (ok) => { if (!ok) this.pending.unshift(...this.sent); this.sent = [] },
      sessionImage: () => this.hooks?.sessionImage() ?? null,
    })
  }

  /** The seed the workout runs on: the session's, so the same seed races the same tracks. */
  get seed(): number { return this.start.seed >>> 0 }

  /** Called once the world exists; starts the tick and poll loops. */
  attach(hooks: RacerHooks): void {
    this.hooks = hooks
    this.save.lastSeed = this.seed
    this.saveDirty = true
    this.client.start()
  }

  // --- Controls -------------------------------------------------------------------------------

  pedal = (): number | null => (this.latest ? Math.min(Config.PEDAL_MAX, 50 * this.meter.value(seconds())) : null)

  takePresses = (): ButtonId[] => this.queue.splice(0)

  /** An on-screen button: send it as an answer so it takes the phone's path. */
  press = (b: ButtonId): void => {
    if (this.paused()) return
    const label = BUTTONS.find((x) => x.id === b)?.label
    if (this.promptOpen && label) void this.client.answer(label)
    else this.queue.push(b) // no prompt open (between races): don't eat the press
  }

  paused = (): boolean => this.client.paused

  /** The server's own words for why the session is paused; show them as-is. */
  pauseMessage = (): string | null => this.latest?.pause?.message ?? null

  togglePause = (): void => { void this.client.setPaused(!this.client.paused) }

  /** The platform keeps the clock, so pauses don't count against the workout. */
  activeSeconds = (): number => {
    const s = this.latest
    if (!s) return 0
    const base = s.activeSeconds ?? Math.max(0, (s.elapsed ?? 0) - (s.pausedSeconds ?? 0))
    return s.sessionStatus === 'active' ? base + Math.max(0, Date.now() - this.receivedAt) / 1000 : base
  }

  update = (_dt: number): void => {}

  // --- the page tells us what happened --------------------------------------------------------

  /** Every frame: keep the phone's buttons in step with the race. */
  sync(): void {
    const series = this.hooks?.series
    if (!series || this.client.isEnded) return
    // The buttons are live during the countdown (the rocket start) and the race itself, and nowhere else.
    const want = series.phase === 'race' && (series.race.phase === 'countdown' || series.race.phase === 'racing')
    if (want === this.promptOpen) return
    this.promptOpen = want
    if (want) this.client.openPrompt(persistentPrompt(PROMPT_ID, 'Items', [...LABELS]))
    else this.client.closePrompt()
  }

  /** Every race event, for the achievements that only an event can see. */
  event(e: RaceEvent): void {
    switch (e.type) {
      case 'rocket':
        if (e.car === PLAYER_ID) this.achievement('rocket')
        break
      case 'spin':
        if (e.by === PLAYER_ID && e.car !== PLAYER_ID && ++this.spunThisRace >= 2) this.achievement('oil-slick')
        break
      case 'finish':
        if (e.place === 1) {
          this.achievement('first-win')
          if (++this.winStreak >= 3) this.achievement('hat-trick')
        } else {
          this.winStreak = 0
        }
        break
      default:
        break
    }
  }

  /** The workout is over: show the standings, send the last tick, then end the session. */
  finish(): void {
    if (this.finishing) return
    this.finishing = true
    const series = this.hooks?.series
    if (series) {
      this.achievement('full-workout')
      if (series.table()[0]?.id === PLAYER_ID) this.achievement('champion')
      this.recordResult(series)
    }
    setTimeout(() => void this.client.requestTick().then(() => this.client.end('complete')), END_DELAY_MS)
  }

  /** The session ended from a bridge or the console: stop, but keep whatever was earned. */
  ended(): EndInfo | null { return this.endedInfo }

  // --- save state -----------------------------------------------------------------------------

  private recordResult(series: Series): void {
    const points = series.playerPoints
    const key = String(Math.round(this.duration / 60))
    this.save.wins += series.table().find((s) => s.id === PLAYER_ID)?.wins ?? 0
    if (points > (this.save.best[key] ?? 0)) this.save.best[key] = points
    this.saveDirty = true
    this.writeSave()
  }

  private writeSave(): void {
    if (!this.saveDirty || this.start.debug) return
    this.saveDirty = false
    void putSave(GAME_ID, this.start.variant, this.save as unknown as Json)
      .catch((e: unknown) => this.log(`putsave: ${String(e)}`))
  }

  // --- achievements ---------------------------------------------------------------------------

  private achievement(id: string): void {
    if (this.earned.has(id)) return
    this.earned.add(id)
    this.pending.push(id)
  }

  // --- prompt answers -------------------------------------------------------------------------

  /** An answer from the phone or from our own on-screen button: they arrive the same way. */
  private onAnswer(a: InputAnswer): void {
    if (a.promptId !== PROMPT_ID || this.paused()) return
    const b = BUTTONS.find((x) => x.label === a.choice)
    if (b) this.queue.push(b.id)
  }

  // --- setstate -------------------------------------------------------------------------------

  private buildTick(): TickBody | null {
    const series = this.hooks?.series
    if (!series) return null
    const race = series.race
    const p = race.player
    const pos = race.track.pointAt(p.dist, p.x, 0)
    const body: TickBody = {
      grade: this.gradeFor(race.track.poseAt(p.dist).grade),
      // No speed: the car's 150 km/h is not a distance anyone rode. The server integrates the machine's own
      // speed instead (INTEGRATION.md §7).
      x: pos.x, y: pos.y, z: pos.z,
      score: series.playerPoints,
      route: `${GAME_ID}-${this.seed}`,
      custom: {
        race: series.raceNumber, track: series.trackName, lap: race.playerLap, laps: race.laps,
        place: p.place, turbo: p.turbo, oil: p.oil, spinOuts: this.spunThisRace,
      },
    }
    if (this.pending.length) { this.sent = this.pending.splice(0); body.achievements = this.sent }
    // a new race: the oil count starts again
    if (series.raceNumber !== this.seenRace) { this.seenRace = series.raceNumber; this.spunThisRace = 0 }
    return body
  }

  /**
   * What the trainer feels: half the road's grade, climbs only, smoothed, and nothing at all while paused —
   * a device that reconnects should start still (docs/GAME_AUTHORING.md "Paused").
   */
  private gradeFor(roadGrade: number): number {
    const target = this.paused() || !this.hills || this.start.deviceType !== 'bike'
      ? 0
      : clamp(roadGrade * GRADE_SCALE, 0, GRADE_MAX)
    this.smoothGrade += (target - this.smoothGrade) * (1 - Math.exp(-1 / GRADE_TAU))
    return Math.round(this.smoothGrade * 100) / 100
  }
}
