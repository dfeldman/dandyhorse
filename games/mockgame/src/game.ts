/**
 * The game loop: 1 Hz `setstate` ticks plus a continuous `getstate` long-poll.
 *
 * Everything the server needs to know about the game's world goes out in `tick()`; everything the
 * game learns about the physical world (belt speed, power, bridge answers, session status) comes in
 * through `handleState()`. The UI is driven purely by the `GameEvents` callbacks.
 *
 * Pauses: the server, not the game, decides when the session is paused (no exercise-device data
 * for ~5 s, or the user pressed Pause on a bridge) and when it resumes. The game only follows
 * `getstate.sessionStatus`: while it is `paused` both loops keep running (the long-poll must see
 * the resume; the tick keeps the prompt alive and asks the device to stand still), but the world
 * is frozen: no distance, no laps, no achievements, no active-time clock.
 */
import * as api from '@dandyhorse/gamekit'
import { SessionClient, type GameState, type InputAnswer, type Prompt, type SessionSummary, type StartPayload } from '@dandyhorse/gamekit'
import { bikeParams, bikeSpeedFromPower, treadmillDistance, type BikeParams } from './physics.ts'
import { makeRoute, type Route, type RoutePoint } from './route.ts'

export const GAME_ID = 'mockgame'
export const ROUTE_NAME = 'Loop'
export type Variant = 'treadmill' | 'bike'

/** Treadmill target-speed pattern (m/s) by route grade. */
const TREADMILL_FLAT = 2.0
const TREADMILL_UP = 1.6
const TREADMILL_DOWN = 2.4
const TREADMILL_GEAR_STEP = 0.2 // m/s per gear (treadmill-speed variant only)
const TREADMILL_INCLINE_STEP = 1 // percent incline per gear when the user owns the speed
const BIKE_GEAR_STEP = 0.5 // percent grade per gear (upshift = easier)
const MAX_DT = 3 // seconds; a background tab may pause timers, don't teleport on resume
const SPEED_ACHIEVEMENT = 10 // m/s

const GEAR_PROMPT: Prompt = { promptId: 'gear', prompt: 'Gear', choices: ['Downshift', 'Upshift'], persistent: true }

/** Everything the UI renders about the game's own world (as opposed to the server's `GameState`). */
export interface GameModel {
  variant: Variant
  controlsSpeed: boolean // treadmill-speed variant: the game commands the belt; otherwise the user does
  /** Total meters this session (virtual: from actual belt speed or computed from power). */
  distance: number
  distanceOnLoop: number
  lap: number
  previousLaps: number
  /** m/s the rider moved at during the last tick. */
  virtualSpeed: number
  point: RoutePoint
  gear: number
  /** What the last tick requested from the device. */
  target: { speed: number | null; incline: number | null; grade: number | null }
  openPrompt: Prompt | null
  lastAnswer: InputAnswer | null
  lastDirection: string | null
  earned: string[]
  score: number
  ticks: number
  lastError: string | null
  showMinimap: boolean
  /** The server has paused the session (getstate.sessionStatus === 'paused'). */
  paused: boolean
  /**
   * Seconds of un-paused exercise, counted by the game itself. Drives the advisory countdown so
   * paused time never counts down (the server's `elapsed` is wall clock and includes pauses).
   */
  activeSeconds: number
}

/** What the end screen gets. `summary` is null when the session ended elsewhere. */
export interface EndInfo {
  status: string
  reason: string | null
  summary: SessionSummary | null
  pausedSeconds: number | null
}

export interface GameEvents {
  onState(state: GameState): void
  onModel(model: GameModel): void
  onLog(line: string): void
  onEnded(info: EndInfo): void
  /** The session picture for History (a PNG data URL), rendered by the UI at the end; null to skip. */
  onImage?(): string | null
}

export class Game {
  readonly route: Route
  readonly model: GameModel
  readonly sessionId: string
  private readonly bike: BikeParams
  /** All server talk lives in the gamekit SessionClient: polling, ticks, pauses, inputs, ending. */
  private readonly client: SessionClient
  /** performance.now() of the last simulated tick; null while paused (and before the first tick). */
  private lastTickAt: number | null = null
  private activeClockSeeded = false
  private promptCounter = 0
  /** Prompts answered this session, one of the two numbers the reference game counts (PLAN.md §18.2). */
  private promptsAnswered = 0
  private readonly earnedSet = new Set<string>()
  private achievementQueue: string[] = []
  /** Achievements in the tick in flight: re-queued if that setstate fails. */
  private sentAch: string[] = []

  constructor(
    readonly start: StartPayload,
    private readonly events: GameEvents,
  ) {
    this.sessionId = start.sessionId
    this.route = makeRoute(start.seed)
    this.bike = bikeParams(start.bodyData?.weight)
    const variant: Variant = start.deviceType === 'bike' ? 'bike' : 'treadmill'
    const savedLaps = start.saveState?.laps
    const showMinimap = start.preferences.game.showMinimap
    this.model = {
      variant,
      controlsSpeed: variant === 'bike' || start.variant === 'treadmill-speed',
      distance: 0,
      distanceOnLoop: 0,
      lap: 0,
      previousLaps: typeof savedLaps === 'number' ? savedLaps : 0,
      virtualSpeed: 0,
      point: this.route.pointAt(0),
      gear: 0,
      target: { speed: null, incline: null, grade: null },
      openPrompt: null,
      lastAnswer: null,
      lastDirection: null,
      earned: [],
      score: 0,
      ticks: 0,
      lastError: null,
      showMinimap: typeof showMinimap === 'boolean' ? showMinimap : true,
      paused: false,
      activeSeconds: 0,
    }
    this.client = new SessionClient({
      sessionId: this.sessionId,
      buildTick: () => this.buildTick(),
      onTick: (ok) => { if (!ok) this.achievementQueue = [...this.sentAch, ...this.achievementQueue]; this.sentAch = [] },
      onState: (s) => this.handleState(s),
      onInput: (i) => this.applyInput(i),
      onPause: (p) => this.onPause(p),
      onResume: (secs) => this.onResume(secs),
      onEnded: (e) => this.endedLocally(e.status, e.reason, e.summary),
      onError: (ctx, e) => this.fail(ctx, e),
      sessionImage: () => this.events.onImage?.() ?? null,
    })
  }

  // --- lifecycle --------------------------------------------------------------

  run(): void {
    if (this.client.isRunning) return
    this.log(`session ${this.sessionId} active: ${this.model.variant}, seed ${this.start.seed}, loop ${this.route.length.toFixed(0)} m`)
    this.client.start()
  }

  stop(): void {
    this.client.stop()
  }

  get ended(): boolean {
    return this.client.isEnded
  }

  private log(line: string): void {
    this.events.onLog(line)
  }

  private fail(context: string, e: unknown): void {
    const msg = e instanceof api.ApiError ? `${e.status} ${e.code}: ${e.message}` : String(e)
    this.model.lastError = `${context}: ${msg}`
    this.log(`${context} failed: ${msg}`)
  }

  private endedLocally(status: string, reason: string | null, summary: SessionSummary | null): void {
    this.stop()
    this.model.paused = false // an ended session is not paused, even if it ended during a pause
    this.log(`session ${status} (${reason ?? 'no reason'})`)
    this.events.onModel(this.model)
    const pausedSeconds = summary?.pausedSeconds ?? this.client.latest?.pausedSeconds ?? null
    this.events.onEnded({ status, reason, summary, pausedSeconds })
  }

  // --- server state (via SessionClient) -------------------------------------------

  private handleState(state: GameState): void {
    if (!this.activeClockSeeded && state.elapsed !== null) {
      // Seed our active clock once, so a reloaded page joins a session already under way with the
      // right countdown. Assign, don't add: from here on tick() counts it itself.
      this.activeClockSeeded = true
      this.model.activeSeconds = Math.max(0, state.elapsed - (state.pausedSeconds ?? 0))
    }
    this.model.openPrompt = this.client.prompt // the client expires one-shot prompts by timeout
    this.events.onState(state)
  }

  private onPause(p: api.PauseInfo): void {
    this.model.paused = true
    this.log(`paused: ${p.reason} (${p.message})`)
    // The next tick freezes the world and asks the device for speed 0 / grade 0.
    this.events.onModel(this.model)
  }

  private onResume(secs: number): void {
    this.model.paused = false
    this.log(`resumed after ${secs.toFixed(1)} s`)
    // Integrate from now, not from the last tick before the pause: the first active tick has dt ≈ 0.
    this.lastTickAt = performance.now()
    this.events.onModel(this.model)
  }

  // --- setstate tick (the SessionClient calls buildTick about once a second) -------------------

  requestTick(): Promise<void> {
    return this.client.requestTick()
  }

  private buildTick(): api.TickBody {
    const m = this.model
    if (m.paused) this.freeze()
    else this.advance()
    const body = this.buildSetState()
    m.openPrompt = this.client.prompt
    // Achievements: each id at most once (none are earned while paused; the queue may hold older ones).
    this.sentAch = this.achievementQueue
    this.achievementQueue = []
    body.achievements = this.sentAch
    // What this ride counted (PLAN.md §18.2). The reference game demonstrates the contract: the numbers it
    // sends are the ones metadata.json declares, and `laps` is also a progress counter, so a later player
    // racing this session can be told how many laps it had done by any given second.
    this.client.countStats({ laps: m.previousLaps + m.lap, prompts: this.promptsAnswered })
    body.custom = { ...(body.custom ?? {}), laps: m.previousLaps + m.lap }
    m.ticks++
    this.events.onModel(m)
    return body
  }

  /** Paused: the world stands still. Forget the tick time so no dt builds up over the pause. */
  private freeze(): void {
    this.lastTickAt = null
    this.model.virtualSpeed = 0
  }

  /** Active: move the rider by what the device measured since the last tick. */
  private advance(): void {
    const m = this.model
    const now = performance.now()
    const wall = this.lastTickAt === null ? 0 : Math.max(0, (now - this.lastTickAt) / 1000)
    this.lastTickAt = now
    m.activeSeconds += wall // the clock takes real time: a throttled tab was still exercising
    const dt = Math.min(MAX_DT, wall) // physics is clamped: don't teleport after a throttled gap

    // 1. How fast are we really going? Treadmill: the belt. Bike: physics on measured power.
    const s = this.client.latest
    let speed: number
    if (m.variant === 'treadmill') {
      speed = s?.speed.actual ?? 0
      m.distance += treadmillDistance(speed, dt)
    } else {
      const power = s?.power.actual
      speed = power === null || power === undefined ? 0 : bikeSpeedFromPower(power, m.point.grade, this.bike)
      m.distance += speed * dt
    }
    m.virtualSpeed = speed

    // 2. Where does that put us on the loop?
    const lap = Math.floor(m.distance / this.route.length)
    if (lap > m.lap) {
      m.lap = lap
      this.earn('first_lap')
      this.log(`lap ${lap} done (total with history: ${m.previousLaps + lap})`)
      void this.saveLaps()
    }
    m.distanceOnLoop = m.distance - lap * this.route.length
    m.point = this.route.pointAt(m.distance)
    if (speed > SPEED_ACHIEVEMENT) this.earn('speed_10ms')
    m.score = lap * 1000 + Math.floor(m.distanceOnLoop)
  }

  /** 3. What we tell the server: where we are and what we want from the device. */
  private buildSetState(): api.TickBody {
    const m = this.model
    const grade = m.point.grade
    const body: api.TickBody = {
      x: m.point.x, // frozen while paused, since advance() did not run
      y: m.point.y,
      z: m.point.z,
      route: ROUTE_NAME,
      score: m.score,
      custom: { lap: m.lap, distanceOnLoop: m.distanceOnLoop, virtualSpeed: m.virtualSpeed, gear: m.gear, lastDirection: m.lastDirection },
    }
    // While paused we ask for a standing belt (incline kept) or a flat, zero-speed bike. When the
    // device comes back, the bridge's first command is then "stand still / flat"; the belt only
    // starts again once we see `active` and restore the real request on the next tick.
    if (m.variant === 'treadmill') {
      if (m.controlsSpeed) {
        const base = grade > 2 ? TREADMILL_UP : grade < -2 ? TREADMILL_DOWN : TREADMILL_FLAT
        body.speed = m.paused ? 0 : Math.max(0, base + m.gear * TREADMILL_GEAR_STEP)
        body.incline = Math.min(15, Math.max(0, grade))
      } else {
        // The usual treadmill game (PLAN.md §7.3): only the incline is driven; the belt speed is the
        // user's own choice on the machine, so `speed` is never sent. Gears shift the incline instead.
        body.incline = Math.min(15, Math.max(0, grade + m.gear * TREADMILL_INCLINE_STEP))
      }
      m.target = { speed: body.speed ?? null, incline: body.incline, grade: null }
    } else {
      body.grade = m.paused ? 0 : grade - m.gear * BIKE_GEAR_STEP
      body.speed = m.virtualSpeed // the server integrates distance from the virtual speed; 0 while paused
      m.target = { speed: body.speed, incline: null, grade: body.grade }
    }
    return body
  }

  /** Seconds of un-paused exercise right now (between ticks too), for the advisory countdown. */
  activeSecondsNow(): number {
    const m = this.model
    if (m.paused || this.ended || this.lastTickAt === null) return m.activeSeconds
    return m.activeSeconds + (performance.now() - this.lastTickAt) / 1000
  }

  // --- achievements, save state, preferences ------------------------------------

  private earn(id: string): void {
    if (this.earnedSet.has(id)) return
    this.earnedSet.add(id)
    this.achievementQueue.push(id)
    this.model.earned.push(id)
    this.log(`achievement ${id}${this.start.debug ? ' (debug session: server will not persist it)' : ''}`)
  }

  earnManual(): void {
    this.earn(`manual_${this.model.earned.filter((a) => a.startsWith('manual_')).length + 1}`)
    void this.requestTick()
  }

  private async saveLaps(): Promise<void> {
    const laps = this.model.previousLaps + this.model.lap
    try {
      await api.putSave(GAME_ID, this.start.variant, { ...(this.start.saveState ?? {}), laps })
      this.log(`putsave laps=${laps}`)
    } catch (e) {
      this.fail('putsave', e)
    }
  }

  async setShowMinimap(show: boolean): Promise<void> {
    this.model.showMinimap = show
    this.events.onModel(this.model)
    try {
      await api.putPreferences(GAME_ID, { ...this.start.preferences.game, showMinimap: show })
      this.log(`putpreferences showMinimap=${show}`)
    } catch (e) {
      this.fail('putpreferences', e)
    }
  }

  // --- prompts and answers -------------------------------------------------------

  openOneShot(): void {
    this.promptCounter++
    this.openPrompt({ promptId: `p${this.promptCounter}`, prompt: 'Which way?', choices: ['Left', 'Right', 'Straight'], timeout: 15 })
  }

  openGears(): void {
    this.openPrompt({ ...GEAR_PROMPT })
  }

  closeGears(): void {
    if (this.model.openPrompt?.promptId === GEAR_PROMPT.promptId) this.closePrompt('closed by game')
  }

  private openPrompt(p: Prompt): void {
    this.model.openPrompt = p
    this.log(`prompt ${p.promptId} opened: ${p.prompt} [${p.choices.join(', ')}]${p.persistent ? ' (persistent)' : ''}`)
    this.client.openPrompt(p) // the server only shows a prompt once a setstate carried it
  }

  private closePrompt(why: string): void {
    const p = this.model.openPrompt
    if (!p) return
    this.model.openPrompt = null
    this.log(`prompt ${p.promptId} ${why}`)
    this.client.closePrompt()
  }

  /** The game's own on-screen button. The answer is applied when it echoes back through onInput. */
  async answer(choice: string): Promise<void> {
    const p = this.model.openPrompt
    if (!p) return
    const ok = await this.client.answer(choice)
    if (!ok) this.log(`answerinput ${p.promptId}=${choice} not accepted (prompt not live on the server yet, or already answered)`)
  }

  private applyInput(input: InputAnswer): void {
    const m = this.model
    m.lastAnswer = input
    const p = m.openPrompt
    if (!p || p.promptId !== input.promptId) {
      this.log(`ignored answer ${input.promptId}=${input.choice} via ${input.source}: prompt not open`)
      return
    }
    if (p.persistent) {
      // Persistent gears: every tap is applied.
      if (input.choice === 'Upshift') m.gear++
      else if (input.choice === 'Downshift') m.gear--
      const effect =
        m.variant === 'treadmill'
          ? m.controlsSpeed
            ? `target speed ${m.gear >= 0 ? '+' : ''}${(m.gear * TREADMILL_GEAR_STEP).toFixed(1)} m/s`
            : `incline ${m.gear >= 0 ? '+' : ''}${(m.gear * TREADMILL_INCLINE_STEP).toFixed(0)} %`
          : `grade ${-m.gear * BIKE_GEAR_STEP >= 0 ? '+' : ''}${(-m.gear * BIKE_GEAR_STEP).toFixed(1)} %`
      this.log(`${input.choice} via ${input.source}: gear ${m.gear} (${effect})`)
    } else {
      m.lastDirection = input.choice
      m.openPrompt = null
      this.promptsAnswered++
      this.client.prompt = null
      this.log(`prompt ${p.promptId} answered "${input.choice}" via ${input.source}`)
    }
    void this.requestTick()
    this.events.onModel(m)
  }

  // --- ending ---------------------------------------------------------------------

  async complete(): Promise<void> {
    await this.end('complete', undefined)
  }

  async discard(): Promise<void> {
    await this.end('discarded', 'user_discarded')
  }

  private async end(status: 'complete' | 'discarded', reason: string | undefined): Promise<void> {
    // The game's own line for the player's timeline (PLAN.md §18.2); the server writes a plain one for a
    // game that sends none, which is what a discarded ride gets.
    const message = status === 'complete' ? this.message() : undefined
    await this.client.end(status, reason, { message }) // uploads the image first, then endsession → onEnded
  }

  /** What this ride leaves on the profile. */
  private message(): string {
    const laps = this.model.previousLaps + this.model.lap
    const answered = this.promptsAnswered
    const asked = answered > 0 ? ` ${answered} question${answered === 1 ? '' : 's'} answered on the way.` : ''
    if (laps >= 1) return `${laps} lap${laps === 1 ? '' : 's'} of the mock route.${asked}`
    return `A turn round the mock route.${asked}`
  }

}
