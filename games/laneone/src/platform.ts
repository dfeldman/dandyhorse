/**
 * Lane One on Dandyhorse (INTEGRATION.md): `Machine` over gamekit's `SessionClient`. One instance per page.
 *
 *   machine ─► bridge ─► server ─► getstate (1 Hz) ─► read()            speed, incline, grade, power, cadence, HR
 *   console ─► Workout ─► command() ─► setstate (1 Hz) ─► bridge ─► machine
 *   phone taps ─► getstate.inputs ─► the ± buttons                       (a persistent prompt, §5)
 *
 * The field names in `Readings` and `Dials` are the platform's metric names, so reading and commanding are copies.
 * What goes on the wire is exactly `targetsFor()`'s `command` (src/drive.ts): never a belt speed unless the
 * player chose "the machine" at launch, never a grade beside a power. A bike adds its virtual speed, as the
 * contract asks, so History's distance matches the console's.
 */
import {
  SessionClient,
  persistentPrompt,
  putSave,
  rivalHud,
  steadyHeartRate,
  steadyWatts as platformSteady,
  units as dhUnits,
  type EndInfo,
  type GameState,
  type InputAnswer,
  type Json,
  type Rival,
  type StartPayload,
  type TickBody,
} from '@dandyhorse/gamekit'
import { EMPTY, type Bests, type BestsStore } from './bests.ts'
import { Config } from './config.ts'
import type { Dials, DriveWho } from './drive.ts'
import type { Machine, Readings } from './machine.ts'
import { DEFAULT_BODY, type Body, type DeviceType } from './physics.ts'
import { PROGRAM_IDS, type ProgramId } from './program.ts'
import { pointAt } from './track.ts'
import type { UnitSystem } from './units.ts'
import { GOALS } from './ui/setup.ts'
import type { Goal, GoalKind, Workout } from './workout.ts'

export const GAME_ID = 'laneone'
export const PROMPT_ID = 'console'

const NO_DIALS: Dials = { speed: null, incline: null, power: null, grade: null }

// --- the launch options (metadata.json `options`) -----------------------------------------------------

const LEVELS: Record<string, number> = { easy: 3, normal: 5, hard: 7, 'very hard': 9 }
const GOAL_WORDS: Record<string, GoalKind> = {
  'the clock runs out': 'time',
  'a distance is done': 'distance',
  'the calories are burnt': 'calories',
}

export interface LaunchChoice {
  program: ProgramId
  level: number
  who: DriveWho
  goal: Goal
  duration: number
}

/**
 * What the console's launch dialog chose, in the game's own terms. The server fills defaults in, but a stray value
 * still falls back rather than throwing. A distance or calorie goal takes the middle of the setup screen's chips
 * (5 km or 5 mi, or the middle calorie figure): a launched session starts hands-free, with no screen to answer.
 */
export function launchChoice(start: Pick<StartPayload, 'options' | 'requestedDuration' | 'unitSystem'>): LaunchChoice {
  const o = (start.options ?? {}) as Record<string, unknown>
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
  const program = (PROGRAM_IDS as readonly string[]).includes(str('programme') ?? '') ? (str('programme') as ProgramId) : 'steady'
  const level = LEVELS[str('level') ?? ''] ?? Config.LEVEL_DEFAULT
  const who: DriveWho = str('drive') === 'the machine' ? 'machine' : 'you'
  const duration = start.requestedDuration && start.requestedDuration > 0 ? start.requestedDuration : Config.DEFAULT_MINUTES * 60
  const kind = GOAL_WORDS[str('goal') ?? ''] ?? 'time'
  const list = GOALS[kind].choices(start.unitSystem)
  const goal: Goal = kind === 'time' ? { kind, value: duration } : { kind, value: list[Math.min(2, list.length - 1)]![1] }
  return { program, level, who, goal, duration }
}

/** The phone's buttons: the same four as the on-screen cluster, or two on a bike holding ERG. */
export function consoleChoices(device: DeviceType, who: DriveWho): string[] {
  if (device === 'treadmill') return ['Speed −', 'Speed +', 'Incline −', 'Incline +']
  return who === 'machine' ? ['Power −', 'Power +'] : ['Power −', 'Power +', 'Grade −', 'Grade +']
}

/** A phone tap as a step of a dial, in the player's display units turned into the game's (m/s, %, W). */
export function stepFor(choice: string, sys: UnitSystem): { dial: 'speed' | 'incline' | 'power' | 'grade'; delta: number } | null {
  const m = /^(Speed|Incline|Power|Grade) ([−+-])$/.exec(choice)
  if (!m) return null
  const sign = m[2] === '+' ? 1 : -1
  const dial = m[1]!.toLowerCase() as 'speed' | 'incline' | 'power' | 'grade'
  const size = dial === 'speed' ? dhUnits.speedToSI(Config.STEP.speed[sys], sys) : Config.STEP[dial]
  return { dial, delta: sign * size }
}

/** The metrics of a tick: what `targetsFor()` put on the wire, and nothing else (a null field is not sent). */
export function commandMetrics(d: Dials): Pick<TickBody, 'speed' | 'incline' | 'power' | 'grade'> {
  const out: Pick<TickBody, 'speed' | 'incline' | 'power' | 'grade'> = {}
  if (d.speed !== null) out.speed = d.speed
  if (d.incline !== null) out.incline = d.incline
  // power wins over grade on the wire; drive.ts never sets both, and this keeps it so
  if (d.power !== null) out.power = d.power
  else if (d.grade !== null) out.grade = d.grade
  return out
}

/** What the platform needs from the page once the workout exists. */
export interface LaneHooks {
  workout: Workout
  /** History's picture (640×360 data URL), or null. */
  sessionImage(): string | null
  /** A phone tap, already turned into a step. */
  onStep(dial: 'speed' | 'incline' | 'power' | 'grade', delta: number): void
}

export class DandyhorseMachine implements Machine {
  readonly device: DeviceType
  readonly harness = false
  readonly start: StartPayload
  readonly choice: LaunchChoice

  private readonly log: (line: string) => void
  private readonly client: SessionClient
  private hooks: LaneHooks | null = null
  private latest: GameState | null = null
  private asked: Dials = NO_DIALS
  private endedInfo: EndInfo | null = null
  private finishing = false
  /** The encouragement for this workout; no rival box here (PLAN.md §18.3). */
  private voice: Rival | null = null
  /** Seconds spent inside the programme's tolerance, counted a tick at a time. */
  private onTargetSeconds = 0
  private readonly bodyData: Body
  private readonly steady: number
  private readonly heart: { resting: number; max: number }
  private sent: string[] = []
  private readonly pending: string[] = []
  private readonly already = new Set<string>()
  private save: { bests: Partial<Record<DeviceType, Bests>> }

  constructor(start: StartPayload, log: (line: string) => void) {
    this.start = start
    this.log = log
    this.device = start.deviceType
    this.choice = launchChoice(start)
    const b = start.bodyData ?? {}
    this.bodyData = {
      weight: typeof b.weight === 'number' && b.weight > 0 ? b.weight : DEFAULT_BODY.weight,
      age: typeof b.age === 'number' && b.age > 0 ? b.age : DEFAULT_BODY.age,
      sex: b.sex === 'f' || b.sex === 'female' ? 'f' : 'm',
    }
    const prefs = { global: start.preferences.global, device: start.preferences.device }
    this.steady = platformSteady(prefs, this.device, this.bodyData.weight).watts
    const g = (start.preferences.global ?? {}) as Record<string, unknown>
    const heart = steadyHeartRate(start.preferences.global, start.bodyData)
    const maxHr = typeof g.maxHr === 'number' && g.maxHr > 100 ? g.maxHr : Math.round(208 - 0.7 * this.bodyData.age)
    this.heart = { resting: heart.resting, max: maxHr }
    const raw = (start.saveState ?? {}) as Record<string, unknown>
    this.save = { bests: raw.bests && typeof raw.bests === 'object' ? (raw.bests as Partial<Record<DeviceType, Bests>>) : {} }
    // the server keeps them as "<gameId>:<id>"; ones earned in an earlier session are not sent again
    for (const id of Object.keys(start.achievements ?? {})) if (id.startsWith(`${GAME_ID}:`)) this.already.add(id.slice(GAME_ID.length + 1))

    this.client = new SessionClient({
      sessionId: start.sessionId,
      buildTick: () => this.buildTick(),
      onState: (s) => { this.latest = s },
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

  /** Called once the workout exists: starts the tick and poll loops and puts the ± buttons on the phone. */
  attach(hooks: LaneHooks): void {
    this.hooks = hooks
    this.client.start()
    this.client.openPrompt(persistentPrompt(PROMPT_ID, 'Console', consoleChoices(this.device, this.choice.who)))
    // The voice only (PLAN.md §18.3): a kilometre passed, halfway, the last stretch. A rival's box belongs
    // on a ride through somewhere, not beside a console of dials.
    if (!this.start.debug) {
      void rivalHud(this.start.sessionId, {
        voiceOnly: true,
        imperial: this.start.unitSystem === 'us',
        plannedSeconds: this.start.requestedDuration,
        words: { laps: 'lap' },
      }).then((r) => { this.voice = r })
    }
  }

  /** Bests in the save state, per variant (a lap on a bike is not a lap on a treadmill). Debug sessions keep none. */
  bestsStore(): BestsStore {
    return {
      load: (device) => this.save.bests[device] ?? { ...EMPTY },
      save: (device, b) => {
        this.save.bests[device] = { ...b }
        if (this.start.debug) return
        void putSave(GAME_ID, this.start.variant, this.save as unknown as Json).catch((e: unknown) => this.log(`putsave: ${String(e)}`))
      },
    }
  }

  // --- Machine ------------------------------------------------------------------------------------------

  read(): Readings {
    const s = this.latest
    const v = (m: { actual: number | null } | undefined): number | null => (typeof m?.actual === 'number' ? m.actual : null)
    return {
      speed: v(s?.speed),
      incline: v(s?.incline),
      grade: v(s?.grade),
      power: v(s?.power),
      cadence: v(s?.cadence),
      heartRate: v(s?.heartRate),
    }
  }

  command(d: Dials): void { this.asked = d }
  paused(): boolean { return this.client.paused }
  setPaused(p: boolean): void { if (p !== this.client.paused) void this.client.setPaused(p) }
  pauseMessage(): string | null { return this.latest?.pause?.message ?? null }
  update(): void {}
  steadyWatts(): number | null { return this.steady }
  body(): Body { return this.bodyData }
  unitSystem(): UnitSystem { return this.start.unitSystem }
  heartRateRange(): { resting: number; max: number } { return this.heart }

  // --- the end ------------------------------------------------------------------------------------------

  /** The session ended from a bridge or the console (or the server), or null while it runs. */
  ended(): EndInfo | null { return this.endedInfo }

  /**
   * The workout is over and its summary is up: send the last tick (with the end-of-workout achievements) and end the
   * session. `discard` for an End pressed in the first minute with nothing done.
   */
  finish(discard: boolean): void {
    if (this.finishing || this.endedInfo) return
    this.finishing = true
    void this.client.requestTick().then(() => {
      const message = discard ? undefined : this.message()
      this.voice?.remove()
      return this.client.end(discard ? 'discarded' : 'complete', undefined, { message })
    })
  }

  /** The line this workout leaves on the player's timeline (PLAN.md §18.2). */
  private message(): string {
    const s = this.hooks?.workout.state()
    const name = s?.plan.program ?? 'a workout'
    const minutes = Math.round(this.onTargetSeconds / 60)
    const laps = s?.laps ?? 0
    if (minutes >= 1) {
      return `${name}: ${minutes} minute${minutes === 1 ? '' : 's'} held on target`
        + (laps > 0 ? `, ${laps} lap${laps === 1 ? '' : 's'} of the track.` : '.')
    }
    return laps > 0 ? `${name}, ${laps} lap${laps === 1 ? '' : 's'} of the track.` : `${name}, done.`
  }

  // --- input and setstate ---------------------------------------------------------------------------------

  private onAnswer(a: InputAnswer): void {
    if (a.promptId !== PROMPT_ID || !this.hooks) return
    const step = stepFor(a.choice, this.start.unitSystem)
    if (step) this.hooks.onStep(step.dial, step.delta)
  }

  private buildTick(): TickBody | null {
    const w = this.hooks?.workout
    if (!w) return null
    const s = w.state()
    const at = pointAt(s.distance, Config.PLAYER_LANE)
    const body: TickBody = {
      ...commandMetrics(this.asked),
      // a bike also reports its computed virtual speed so the server integrates the same distance (GAME_AUTHORING.md);
      // a trainer cannot be told a speed. A treadmill's speed is only ever what targetsFor() commanded.
      ...(this.device === 'bike' && s.speed !== null ? { speed: Math.max(0, Math.round(s.speed * 100) / 100) } : {}),
      route: s.plan.program,
      score: Math.round(s.distance),
      // the track's 2-D y is the platform's z, and the platform's y is up: metres climbed (INTEGRATION.md §7)
      x: at.x,
      y: s.elevation,
      z: -at.y,
      custom: {
        programme: s.plan.program, level: s.plan.level, segment: s.segmentIndex, laps: s.laps,
        lapDistance: Math.round(s.lapDistance), zone: s.zone, timeInZone: s.timeInZone.map((t) => Math.round(t)),
        base: s.base, goal: s.goal, onTarget: s.onTarget, drive: s.mode.who,
      },
    }
    // What the workout has come to (PLAN.md §18.2). The tick is about a second, so counting the ticks spent
    // inside the tolerance is the time spent there — which is the only number a programme is really about.
    if (s.onTarget) this.onTargetSeconds += 1
    this.client.countStats({
      segments: s.segmentIndex, laps: s.laps,
      onTarget: this.onTargetSeconds, programme: s.plan.program,
    })
    body.custom = { ...body.custom, laps: s.laps }
    // No rival box here: Lane One is a console of dials, and somebody else's past ride beside them would be
    // noise. The voice still calls out the milestones (PLAN.md §18.3).
    this.voice?.update(this.client.latest?.activeSeconds ?? 0,
                       { distance: this.client.latest?.distance ?? 0, progress: { laps: s.laps } })
    for (const id of w.takeAchievements()) if (!this.already.has(id)) { this.already.add(id); this.pending.push(id) }
    if (this.pending.length) { this.sent = this.pending.splice(0); body.achievements = this.sent }
    return body
  }
}
