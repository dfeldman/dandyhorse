/**
 * Night Watch on Dandyhorse (INTEGRATION.md): the platform side of `Controls`. One instance per page.
 *
 *   machine ─► getstate (1 Hz) ─► pedal() = 50 × EffortMeter     (50 is the player's steady pace)
 *   phone taps ─► getstate.inputs ─► takePresses() ─► the horn    (a persistent prompt)
 *   game ─► setstate (1 Hz): score, custom                        ─► History
 *
 * Both variants are read-only: the game never drives the belt or the trainer, so it sends no targets at all
 * (INTEGRATION.md §4). The on-screen horn goes out through `client.answer()` and comes back through
 * `onInput`, so a tap on the screen and a tap on the phone take exactly the same path.
 */
import {
  EffortMeter,
  SessionClient,
  persistentPrompt,
  putSave,
  rivalHud,
  type EndInfo,
  type GameState,
  type InputAnswer,
  type Json,
  type Rival,
  type StartPayload,
  type TickBody,
} from '@dandyhorse/gamekit'
import { Config, type Difficulty, type WeatherMode } from './config.ts'
import type { Controls } from './controls.ts'
import type { ButtonId, Night } from './sim/night.ts'
import type { NightEvent } from './sim/night.ts'
import type { HintId, HudStore } from './ui/hud.ts'

export const GAME_ID = 'nightwatch'
const PROMPT_ID = 'horn'
const HORN_LABEL = '📯 Horn'
/** The logbook shows for this long before the session ends. */
const END_DELAY_MS = 6000
/** Answered hails needed before "all hands" means anything. */
const ALL_HANDS_MIN = 3

const seconds = (): number => performance.now() / 1000

const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
const WEATHERS = ['calm', 'mixed', 'wild'] as const

/** A launch option, checked against its enum: the server fills defaults in, but never trust a stray value. */
function option<T extends string>(options: Json, key: string, allowed: readonly T[], fallback: T): T {
  const v = (options as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/** What the platform needs from the page. */
export interface WatchHooks {
  night: Night
  /** The session's picture for History: a PNG/JPEG data URL read back from the last frame. */
  sessionImage(): string | null
}

/** What the game saves between sessions: best points per length and difficulty, and the hints already seen. */
interface Save {
  best: Record<string, number>
  hints: string[]
}

function parseSave(v: Json | null): Save {
  const o = (v ?? {}) as Record<string, unknown>
  const best = o.best && typeof o.best === 'object' ? (o.best as Record<string, unknown>) : {}
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(best)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n
  const hints = Array.isArray(o.hints) ? o.hints.filter((h): h is string => typeof h === 'string') : []
  return { best: out, hints }
}

export class Platform implements Controls {
  /** The platform supplies the pedal, so the HUD draws no slider. */
  readonly harness = false
  readonly start: StartPayload
  readonly duration: number
  readonly difficulty: Difficulty
  readonly weather: WeatherMode

  private readonly log: (line: string) => void
  private readonly client: SessionClient
  private readonly meter: EffortMeter
  private hooks: WatchHooks | null = null
  private latest: GameState | null = null
  private endedInfo: EndInfo | null = null
  private finishing = false
  /** The night was ended before dawn (the pause menu, or a bridge). */
  private cutShort = false
  /** Taps waiting for the game to take them. */
  private readonly queue: ButtonId[] = []
  private promptOpen = false

  // achievements
  /** Another keeper's night to stand against, and the voice for this one (PLAN.md §18.3). */
  private rival: Rival | null = null
  private readonly earned = new Set<string>()
  private readonly pending: string[] = []
  private sent: string[] = []
  /** Ships that met a storm while they were on watch. */
  private readonly stormed = new Set<number>()

  // save state
  private save: Save
  private saveDirty = false

  constructor(start: StartPayload, log: (line: string) => void) {
    this.start = start
    this.log = log
    this.duration = start.requestedDuration ?? Config.DEFAULT_MINUTES * 60
    this.difficulty = option(start.options, 'difficulty', DIFFICULTIES, 'normal')
    this.weather = option(start.options, 'weather', WEATHERS, 'mixed')
    this.save = parseSave(start.saveState)
    // the server stores them as "<gameId>:<id>" (servers/.../sessions/lifecycle.py)
    const mine = `${GAME_ID}:`
    for (const id of Object.keys(start.achievements ?? {})) if (id.startsWith(mine)) this.earned.add(id.slice(mine.length))

    // Effort is the machine against the player's own steady pace, which is what a ship's "need" is measured in
    // (INTEGRATION.md §3). Default smoothing: the lamp's flywheel and the ships' drift add their own lag.
    this.meter = new EffortMeter({
      deviceType: start.deviceType,
      bodyData: start.bodyData,
      preferences: { global: start.preferences.global, device: start.preferences.device },
    })
    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s; this.meter.update(s, seconds()) },
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

  /** The seed the night runs on: the session's, so the same seed and length give the same timetable. */
  get seed(): number { return this.start.seed >>> 0 }

  /** Called once the night exists; starts the tick and poll loops. */
  attach(hooks: WatchHooks): void {
    this.hooks = hooks
    this.client.start()
    this.promptOpen = true
    this.client.openPrompt(persistentPrompt(PROMPT_ID, 'Horn', [HORN_LABEL]))
    // Another keeper who stood this same watch (PLAN.md §18.3): the route is the seed and the night's
    // length, so the timetable they faced was the one this player faces. A debug night is not raced.
    if (!this.start.debug) {
      // The route name carries the seed and the night's length, and a seed is fresh every launch, so
      // matching on it would find nobody. A different timetable is still a night at the lamp.
      void rivalHud(this.start.sessionId, {
        anyRoute: true,
        imperial: this.start.unitSystem === 'us',
        plannedSeconds: this.duration,
        labels: { shipsHome: 'Ships home', stars: 'Stars' },
        words: { shipsHome: 'ship', stars: 'star' },
        corner: 'bottom-left',
        log: this.log,
      }).then((r) => { this.rival = r })
    }
  }

  // --- Controls -------------------------------------------------------------------------------

  pedal = (): number | null => (this.latest ? Math.min(Config.PEDAL_MAX, 50 * this.meter.value(seconds())) : null)

  takePresses = (): ButtonId[] => this.queue.splice(0)

  /** The on-screen horn: send it as an answer so it takes the phone's path. */
  press = (b: ButtonId): void => {
    if (this.paused()) return
    if (this.promptOpen) void this.client.answer(HORN_LABEL)
    else this.queue.push(b) // after dawn: nothing to eat it, but don't lose it either
  }

  paused = (): boolean => this.client.paused

  /** The server's own words for why the session is paused; show them as-is. */
  pauseMessage = (): string | null => this.latest?.pause?.message ?? null

  togglePause = (): void => { void this.client.setPaused(!this.client.paused) }

  update = (_dt: number): void => {}

  // --- the page tells us what happened --------------------------------------------------------

  /** Every frame: note the weather each watching ship meets, and close the horn at dawn. */
  sync(): void {
    const night = this.hooks?.night
    if (!night || this.client.isEnded) return
    if (night.weatherKind === 'storm') for (const s of night.watching) this.stormed.add(s.id)
    const want = night.phase !== 'done'
    if (want === this.promptOpen) return
    this.promptOpen = want
    if (want) this.client.openPrompt(persistentPrompt(PROMPT_ID, 'Horn', [HORN_LABEL]))
    else this.client.closePrompt()
  }

  /** Every night event, for the achievements that only an event can see. */
  event(e: NightEvent): void {
    if (e.type !== 'safe' || e.stars < 3) return
    this.achievement('safe-harbour')
    if (e.ship.plan.bigOne) this.achievement('big-one')
    if (this.stormed.has(e.ship.id)) this.achievement('storm-keeper')
  }

  /**
   * End the night now, before dawn: "End workout" in the pause menu, or the session ending from a bridge. The
   * logbook shows as it stands, and the achievements that mean "a whole night" are not earned.
   */
  finishEarly(): void {
    this.cutShort = true
    this.hooks?.night.finishNow()
  }

  /** Dawn: the logbook shows, then the session ends. */
  finish(): void {
    if (this.finishing) return
    this.finishing = true
    const night = this.hooks?.night
    if (night) {
      // every one of these means "a whole night", so none is earned by ending early
      const whole = !this.cutShort && night.time >= night.duration
      if (whole) this.achievement('full-watch')
      if (night.ships.length && night.ships.every((s) => s.stars === 3)) this.achievement('perfect-night')
      if (whole && night.hailsSeen >= ALL_HANDS_MIN && night.hailsAnswered === night.hailsSeen) this.achievement('all-hands')
      if (whole && night.blasts === 0 && night.shipsAground === 0) this.achievement('steady-hand')
      this.recordBest(night)
    }
    setTimeout(() => void this.client.requestTick().then(() => {
      const message = this.message()
      this.rival?.remove()
      return this.client.end('complete', undefined, { message })
    }), END_DELAY_MS)
  }

  /** The line this night leaves on the player's timeline (PLAN.md §18.2). */
  private message(): string {
    const night = this.hooks?.night
    if (!night) return 'A night at the lamp.'
    const s = night.snapshot()
    const home = s.shipsHome
    const lost = s.shipsAground
    const theirs = this.rival?.theirs()?.progress.shipsHome
    const who = this.rival?.player?.firstName || this.rival?.player?.username
    const ships = `${home} ship${home === 1 ? '' : 's'} brought home`
    const aground = lost > 0 ? `, ${lost} aground` : ' and not one aground'
    if (who && typeof theirs === 'number') {
      if (home > theirs) return `${ships}${aground} — ${theirs} was all ${who} managed.`
      if (home < theirs) return `${ships}${aground}. ${who} got ${theirs} home.`
      return `${ships}${aground}, the same as ${who}.`
    }
    return `${ships}${aground}. ${s.stars} star${s.stars === 1 ? '' : 's'} on the night.`
  }

  /** The session ended from a bridge or the console. */
  ended(): EndInfo | null { return this.endedInfo }

  // --- save state -----------------------------------------------------------------------------

  /** The HUD's store: on the platform, best scores and hints live in the save state, not in this browser. */
  store(): HudStore {
    return {
      hints: () => this.save.hints as HintId[],
      saveHints: (ids: HintId[]) => {
        this.save.hints = [...ids]
        this.saveDirty = true
        this.writeSave()
      },
      best: (minutes: number, difficulty: string) => this.save.best[`${minutes}.${difficulty}`] ?? 0,
      saveBest: (minutes: number, difficulty: string, points: number) => {
        const key = `${minutes}.${difficulty}`
        if (points <= (this.save.best[key] ?? 0)) return
        this.save.best[key] = points
        this.saveDirty = true
        this.writeSave()
      },
    }
  }

  private recordBest(night: Night): void {
    this.store().saveBest(Math.round(night.duration / 60), night.difficulty, night.points)
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
    if (a.choice === HORN_LABEL) this.queue.push('horn')
  }

  // --- setstate -------------------------------------------------------------------------------

  private buildTick(): TickBody | null {
    const night = this.hooks?.night
    if (!night) return null
    const s = night.snapshot()
    // No speed, no incline, no grade: both variants are read-only, so the server integrates the machine's own
    // speed and the player keeps the belt (INTEGRATION.md §4, §7).
    const body: TickBody = {
      score: night.points,
      route: `${GAME_ID}-${this.seed}-${Math.round(night.duration / 60)}`,
      custom: {
        clock: s.clock, stars: s.stars, starsMax: s.starsMax, shipsHome: s.shipsHome,
        shipsAground: s.shipsAground, weather: s.weather, target: s.target, watching: s.watching.length,
      },
    }
    // What the night has come to (PLAN.md §18.2).
    this.client.countStats({ shipsHome: s.shipsHome, shipsAground: s.shipsAground, stars: s.stars })
    body.custom = { ...body.custom, shipsHome: s.shipsHome }
    this.rival?.update(this.client.latest?.activeSeconds ?? 0,
                       { distance: this.client.latest?.distance ?? 0,
                         progress: { shipsHome: s.shipsHome, stars: s.stars } })
    if (this.pending.length) { this.sent = this.pending.splice(0); body.achievements = this.sent }
    return body
  }
}
