/**
 * The workout: the clock, the programme cursor, the base the ± buttons hold, the numbers a console shows, and
 * the laps and splits round the track. It owns no DOM and no canvas; the UI reads `state()` and calls the
 * handful of commands below, which is also exactly what the platform adapter will do.
 *
 * Time is **active seconds**: a pause stops the clock, the distance, the calories and the programme, because
 * paused time is not exercise (GAME_AUTHORING.md, "Paused"). Everything is integrated from what the machine
 * actually measures, never from what was asked for.
 */
import { WHEN, type AchievementId } from './achievements.ts'
import { Config } from './config.ts'
import { defaultBase, onTarget, pausedCommand, powerTolerance, targetsFor, TOLERANCE, type Base, type Dials, type DriveWho, type Mode, type Targets } from './drive.ts'
import type { Machine, Readings } from './machine.ts'
import { NO_READINGS } from './machine.ts'
import { bikeParams, bikeSpeedFromPower, energyRate, treadmillWatts, type BikeParams, type EnergySource } from './physics.ts'
import { build, PROGRAMS, segmentAt, indexAt, type ProgramId, type Segment, type Workout as Plan } from './program.ts'
import { clamp } from './rng.ts'
import { lapLength } from './track.ts'
import { ZONES, zoneOf } from './zones.ts'

export type Phase = 'setup' | 'running' | 'paused' | 'done'

/**
 * What ends the workout. A console offers all three, and they behave the way people expect: the programme
 * always runs on its own clock, and the goal decides when you stop. Finish a 5 km early and the workout
 * ends mid-programme; finish it late and the programme's cool-down holds until you are there.
 */
export type GoalKind = 'time' | 'distance' | 'calories'

export interface Goal {
  kind: GoalKind
  /** Seconds, metres, or kilocalories. */
  value: number
}

/** How far through the goal you are, and how much is left in the goal's own unit. */
export interface GoalProgress {
  kind: GoalKind
  /** 0 at the start, 1 when it is met. */
  done: number
  /** Seconds, metres or kcal still to go; never below zero. */
  left: number
  /** Seconds to go at the pace of the last minute, or null when it can't be guessed yet. */
  eta: number | null
}

/** One second of the workout, kept for the rolling chart. */
export interface TrendPoint {
  t: number
  speed: number | null
  power: number | null
  heartRate: number | null
  incline: number | null
  /**
   * How hard you were working, in bike-equivalent watts on either machine — a treadmill's speed and
   * incline through `treadmillWatts`, a trainer's measured power. One scale, because a hills programme
   * changes the hill and not the pace: a chart of belt speed would be a flat line through a whole climb.
   */
  effort: number | null
  /** The same, for what the console was asking for. */
  target: number | null
}

/** How long the rolling chart remembers, in seconds. */
export const TREND_SECONDS = 600

export interface Split {
  /** 1 for the first lap. */
  lap: number
  /** The workout ended part-way round: this one is not a lap time and never counts as a best. */
  partial: boolean
  /** Seconds this lap took. */
  seconds: number
  /** Active seconds at the end of the lap. */
  at: number
  avgSpeed: number
  avgHeartRate: number | null
  avgPower: number | null
}

export interface Stat {
  n: number
  sum: number
  max: number
}

export interface Stats {
  speed: Stat
  power: Stat
  heartRate: Stat
  cadence: Stat
}

const emptyStat = (): Stat => ({ n: 0, sum: 0, max: 0 })
export const avgOf = (s: Stat): number | null => (s.n > 0 ? s.sum / s.n : null)
export const maxOf = (s: Stat): number | null => (s.n > 0 ? s.max : null)

export interface WorkoutState {
  phase: Phase
  goal: Goal
  progress: GoalProgress
  /** Seconds spent in each heart-rate zone, index 0 = zone 1. */
  timeInZone: number[]
  /** The zone the player is in now: 1–5, or 0 when below zone 1 or with no strap. */
  zone: number
  /** Active seconds since the start. */
  elapsed: number
  /** Seconds left of the requested duration; negative once it has run over. */
  remaining: number
  distance: number
  /** Whole laps of the track. */
  laps: number
  /** Metres into the current lap. */
  lapDistance: number
  /** Where you would be if you had run the programme exactly: the pace marker out in lane 3. */
  targetDistance: number
  /** The speed the world moves at: the belt, or the bike's computed virtual speed. */
  speed: number | null
  /** Metabolic energy, J. */
  energy: number
  /** Mechanical work at the pedals, J. Bikes only; a treadmill measures no force. */
  work: number | null
  energySource: EnergySource
  /** Metres climbed, from the incline actually run. */
  elevation: number
  segment: Segment
  segmentIndex: number
  /** Seconds left of this segment. */
  segmentRemaining: number
  next: Segment | null
  targets: Targets
  base: Base
  readings: Readings
  /** The player is doing what the console asked (only meaningful when something is asked by hand). */
  onTarget: boolean
  /** Heart-rate programmes: the bpm being held, and whether the console moved the base this second. */
  heartRateTarget: number | null
  autoAdjusted: boolean
  splits: Split[]
  stats: Stats
  plan: Plan
  mode: Mode
  /** Ids earned so far this workout. */
  achievements: string[]
}

export interface WorkoutOptions {
  machine: Machine
  program: ProgramId
  /** Seconds. The programme is built to this; with a distance or calorie goal it is the estimate. */
  duration: number
  level?: number
  seed?: number
  who?: DriveWho
  /** What ends the workout. Time, to the requested duration, unless said otherwise. */
  goal?: Goal
}

export class Workout {
  readonly machine: Machine
  readonly mode: Mode
  plan: Plan
  private phase: Phase = 'setup'
  private t = 0
  private dist = 0
  private targetDist = 0
  private joules = 0
  private workJoules = 0
  private climb = 0
  private source: EnergySource = 'none'
  private base: Base
  /** Where the player last put the base by hand; a heart-rate programme may only stray so far from it. */
  private anchor: Base
  private readings: Readings = NO_READINGS
  private virtualSpeed = 0
  private readonly bike: BikeParams
  private readonly lap: number
  private lapsDone = 0
  private lapStartT = 0
  private lapStat: Stats = freshStats()
  private stats: Stats = freshStats()
  private splits: Split[] = []
  private sampleDue = 0
  /** A pause the player asked for here, as distinct from one the machine or the server is in. */
  private wantPause = false
  private machineWasPaused = false
  private hrAdjustDue = Config.HR.ADJUST_EVERY
  private adjustedAt = -99
  private seed: number
  readonly goal: Goal
  private readonly earnedSet = new Set<string>()
  private pendingAchievements: string[] = []
  private readonly zoneTime = ZONES.map(() => 0)
  private readonly history: TrendPoint[] = []

  constructor(opts: WorkoutOptions) {
    this.machine = opts.machine
    this.mode = { device: opts.machine.device, who: opts.who ?? 'you' }
    this.seed = opts.seed ?? 1
    this.plan = build(opts.program, opts.duration, { level: opts.level ?? Config.LEVEL_DEFAULT, seed: this.seed })
    this.base = defaultBase(this.mode.device, opts.machine.steadyWatts() ?? Config.BASE_POWER)
    this.anchor = { ...this.base }
    this.bike = bikeParams(opts.machine.body().weight)
    this.lap = lapLength(Config.PLAYER_LANE)
    this.goal = opts.goal ?? { kind: 'time', value: this.plan.duration }
  }

  // --- commands -----------------------------------------------------------------------------------------

  start(): void {
    if (this.phase === 'setup') this.phase = 'running'
  }

  pause(): void {
    if (this.phase !== 'running') return
    this.wantPause = true
    this.phase = 'paused' // show it at once; tick() reconciles with what the machine says
    this.machine.setPaused(true)
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.wantPause = false
    this.machine.setPaused(false)
    // The phase does not flip here: on the platform the server is still paused for a moment, and it decides.
  }

  togglePause(): void {
    if (this.phase === 'running') this.pause()
    else if (this.phase === 'paused') this.resume()
  }

  /** End the workout and show the summary. */
  stop(): void {
    if (this.phase === 'done') return
    this.closeLap(true)
    this.phase = 'done'
    this.wantPause = false
    this.machine.setPaused(false)
  }

  get ended(): boolean {
    return this.phase === 'done'
  }

  /** Change the programme before the start, or mid-workout (a console lets you; the clock keeps running). */
  setProgram(program: ProgramId, level = this.plan.level): void {
    if (this.phase === 'done') return
    this.plan = build(program, this.plan.duration, { level, seed: this.seed })
  }

  setLevel(level: number): void {
    this.setProgram(this.plan.program, clamp(Math.round(level), Config.LEVEL_RANGE[0], Config.LEVEL_RANGE[1]))
  }

  setDuration(seconds: number): void {
    if (this.phase !== 'setup') return
    this.plan = build(this.plan.program, seconds, { level: this.plan.level, seed: this.seed })
  }

  /**
   * A ± button. The player is moving the number they can see — what the console is asking for right now —
   * so a 0.1 press is always 0.1 on the screen, and the rest of the programme shifts by the same amount
   * underneath. That is what a console does, and it is what makes a programme that starts too hard
   * recoverable without stopping.
   */
  adjustTarget(dial: keyof Base, delta: number): void {
    this.setBase(dial, this.base[dial] + delta / this.slope(dial))
  }

  /** A one-touch key: put what the console is asking for at this value now. */
  setTarget(dial: keyof Base, value: number): void {
    const seg = this.segment()
    if (dial === 'speed' || dial === 'power') this.setBase(dial, value / this.slope(dial))
    else this.setBase(dial, value - seg.grade)
  }

  /** What one unit of base is worth on screen in this segment: a factor for pace and power, 1 for a hill. */
  private slope(dial: keyof Base): number {
    if (dial !== 'speed' && dial !== 'power') return 1
    const seg = this.segment()
    const erg = dial === 'power' && this.mode.who === 'machine'
    return Math.max(0.2, seg.effort * (erg ? 1 + Math.max(0, seg.grade) * Config.GRADE_TO_POWER : 1))
  }

  /** Move the base itself. Mostly internal; `adjustTarget` and `setTarget` are what the buttons call. */
  adjust(dial: keyof Base, delta: number): void {
    this.setBase(dial, this.base[dial] + delta)
  }

  setBase(dial: keyof Base, value: number): void {
    const range = Config.BASE_RANGE[dial]
    this.base[dial] = clamp(value, range[0], range[1])
    this.anchor[dial] = this.base[dial] // the player has spoken: the auto-adjust window moves with them
  }

  // --- the loop ------------------------------------------------------------------------------------------

  /** One step of `dt` wall-clock seconds. Call it every frame; it does nothing useful before `start()`. */
  tick(dt: number): void {
    this.readings = this.machine.read()
    if (this.phase === 'setup' || this.phase === 'done') {
      this.machine.command(this.idleCommand())
      return
    }
    // The machine (on the platform, the server) is the authority on whether we are paused; our own Pause is
    // an extra reason to be. A Play pressed somewhere else lifts our pause too, as the contract asks.
    const machinePaused = this.machine.paused()
    if (this.machineWasPaused && !machinePaused) this.wantPause = false
    this.machineWasPaused = machinePaused
    this.phase = this.wantPause || machinePaused ? 'paused' : 'running'
    if (this.phase === 'paused') {
      this.machine.command(pausedCommand(this.base, this.mode))
      this.machine.advise?.(null)
      return
    }

    const step = Math.max(0, dt)
    this.t += step
    this.integrate(step)
    this.runHeartRateProgramme(step)

    const targets = this.targets()
    this.targetDist += this.paceOf(targets) * step
    this.machine.command(targets.command)
    this.machine.advise?.(targets.manual === 'speed' ? targets.want.speed : targets.manual === 'power' ? targets.want.power : null)

    if (this.progress().done >= 1) this.stop()
  }

  /**
   * How far through the goal we are. The estimate comes from the last minute of real pace, so it settles
   * down quickly and doesn't swing about on a single slow step.
   */
  progress(): GoalProgress {
    const g = this.goal
    if (g.kind === 'time') {
      const left = Math.max(0, g.value - this.t)
      return { kind: g.kind, done: g.value <= 0 ? 1 : this.t / g.value, left, eta: left }
    }
    if (g.kind === 'distance') {
      const left = Math.max(0, g.value - this.dist)
      return { kind: g.kind, done: g.value <= 0 ? 1 : this.dist / g.value, left, eta: this.etaFor(left, this.recentRate((p) => p.speed)) }
    }
    const kcal = this.joules / 4184
    const left = Math.max(0, g.value - kcal)
    return { kind: g.kind, done: g.value <= 0 ? 1 : kcal / g.value, left, eta: this.etaFor(left, this.kcalRate()) }
  }

  private etaFor(left: number, rate: number | null): number | null {
    return rate !== null && rate > 0 ? left / rate : null
  }

  /** The average of a reading over the last minute of history, or null when nothing was read. */
  private recentRate(of: (p: TrendPoint) => number | null): number | null {
    const from = this.t - 60
    let sum = 0
    let n = 0
    for (let i = this.history.length - 1; i >= 0; i--) {
      const p = this.history[i]!
      if (p.t < from) break
      const v = of(p)
      if (v !== null) {
        sum += v
        n++
      }
    }
    return n > 0 ? sum / n : null
  }

  /** kcal per second over the last minute, from the energy actually counted. */
  private kcalRate(): number | null {
    const from = Math.max(0, this.t - 60)
    if (this.t - from < 5) return null
    return this.joulesSince(from) / 4184 / (this.t - from)
  }

  private joulesSince(from: number): number {
    // The energy total is monotonic, so the last minute's share is close enough from the running average.
    return this.t <= 0 ? 0 : this.joules * ((this.t - from) / this.t)
  }

  /** Distance, laps, calories, climb and the running averages, all from what the machine measured. */
  private integrate(dt: number): void {
    const r = this.readings
    const speed = this.mode.device === 'treadmill' ? r.speed : this.virtual(r)
    this.virtualSpeed = speed ?? 0
    if (speed !== null && speed > 0) {
      this.dist += speed * dt
      const incline = r.incline ?? r.grade
      if (incline !== null && incline > 0) this.climb += speed * dt * (incline / 100)
    }
    if (r.power !== null && r.power > 0) this.workJoules += r.power * dt
    const rate = energyRate(this.mode.device, { speed: speed, incline: r.incline ?? r.grade, power: r.power, heartRate: r.heartRate }, this.machine.body())
    this.joules += rate.watts * dt
    if (rate.source !== 'none') this.source = rate.source

    // Averages are sampled at 1 Hz, so a fast frame rate doesn't weight them.
    this.sampleDue -= dt
    if (this.sampleDue <= 0) {
      this.sampleDue += 1
      sample(this.stats, this.lapStat, { ...r, speed })
      this.remember(speed)
    }
    // Time in zone takes the real step, not the sample, so it adds up to the workout's length.
    const z = zoneOf(r.heartRate, this.machine.heartRateRange().max)
    if (z > 0) this.zoneTime[z - 1] = (this.zoneTime[z - 1] ?? 0) + dt
    while (this.dist - this.lapsDone * this.lap >= this.lap) this.closeLap(false)
    this.checkAchievements()
  }

  // --- achievements ---------------------------------------------------------------------------------------

  /**
   * Ids earned since the last call, each at most once. On the platform these go straight into a tick's
   * `achievements`; standalone the summary screen shows them.
   */
  takeAchievements(): string[] {
    const out = this.pendingAchievements
    this.pendingAchievements = []
    return out
  }

  /** Everything earned this workout, for the summary. */
  achievements(): string[] {
    return [...this.earnedSet]
  }

  private earn(id: AchievementId): void {
    if (this.earnedSet.has(id)) return
    this.earnedSet.add(id)
    this.pendingAchievements.push(id)
  }

  /** The ones that can be seen while the workout runs. Called once a tick; each fires at most once. */
  private checkAchievements(): void {
    if (this.lapsDone >= 1) this.earn('first-lap')
    if (this.dist >= WHEN.TEN_K) this.earn('ten-k')
    if (this.t >= WHEN.THE_HOUR) this.earn('the-hour')
    if (this.climb >= WHEN.CLIMB) this.earn('hill-climber')
    const hard = (this.zoneTime[3] ?? 0) + (this.zoneTime[4] ?? 0)
    if (hard >= WHEN.HARD_SECONDS) this.earn('zone-four')
    if (this.evenSplits()) this.earn('even-splits')
  }

  /** Five full laps in a row within five seconds of each other. */
  private evenSplits(): boolean {
    const full = this.splits.filter((x) => !x.partial)
    if (full.length < WHEN.EVEN_LAPS) return false
    const last = full.slice(-WHEN.EVEN_LAPS).map((x) => x.seconds)
    return Math.max(...last) - Math.min(...last) <= WHEN.EVEN_SPREAD
  }

  /**
   * The two that can only be known once it is over: finishing the programme, and the recovery reading.
   * `main.ts` (and, on the platform, the adapter) calls this before the summary.
   */
  earnAtEnd(info: { early: boolean; recoveryDrop: number | null }): void {
    if (!info.early && this.progress().done >= 1) this.earn('programme-done')
    if (info.recoveryDrop !== null && info.recoveryDrop >= WHEN.RECOVERY_DROP) this.earn('good-recovery')
  }

  /** One second of the workout for the rolling chart, oldest dropped. */
  private remember(speed: number | null): void {
    const t = this.targets()
    const r = this.readings
    const kg = this.machine.body().weight
    const tread = this.mode.device === 'treadmill'
    this.history.push({
      t: this.t,
      speed,
      power: r.power,
      heartRate: r.heartRate,
      incline: r.incline ?? r.grade,
      effort: tread ? treadmillWatts(r.speed, r.incline, kg) : r.power,
      target: tread ? treadmillWatts(t.want.speed, t.want.incline, kg) : t.want.power,
    })
    while (this.history.length > 0 && this.t - this.history[0]!.t > TREND_SECONDS) this.history.shift()
  }

  /** The last ten minutes, oldest first. */
  trend(): readonly TrendPoint[] {
    return this.history
  }

  /** How fast the programme means you to be going: the pace marker's speed, m/s. */
  private paceOf(t: Targets): number {
    if (this.mode.device === 'treadmill') return t.want.speed ?? 0
    return bikeSpeedFromPower(t.want.power ?? 0, t.want.grade ?? 0, this.bike)
  }

  /** A bike trainer reports watts, not speed; the console shows the speed those watts would carry you at. */
  private virtual(r: Readings): number | null {
    if (r.power === null) return null
    return bikeSpeedFromPower(r.power, r.grade ?? 0, this.bike)
  }

  private closeLap(partial: boolean): void {
    if (partial && this.dist - this.lapsDone * this.lap < 1) return
    const seconds = this.t - this.lapStartT
    if (seconds <= 0) return
    if (!partial) this.lapsDone++
    this.splits.push({
      partial,
      lap: partial ? this.lapsDone + 1 : this.lapsDone,
      seconds,
      at: this.t,
      avgSpeed: avgOf(this.lapStat.speed) ?? 0,
      avgHeartRate: avgOf(this.lapStat.heartRate),
      avgPower: avgOf(this.lapStat.power),
    })
    this.lapStartT = this.t
    this.lapStat = freshStats()
  }

  /**
   * Heart-rate programmes: hold the target by nudging the base, slowly. A console moves in small steps on a
   * long timer because heart rate lags by half a minute; chasing it faster only makes it swing.
   */
  private runHeartRateProgramme(dt: number): void {
    const seg = this.segment()
    const hrr = seg.hrr
    if (hrr === undefined) return
    this.hrAdjustDue -= dt
    if (this.hrAdjustDue > 0) return
    this.hrAdjustDue += Config.HR.ADJUST_EVERY
    const hr = this.readings.heartRate
    const target = this.heartRateTarget()
    if (hr === null || target === null) return
    const error = target - hr
    if (Math.abs(error) <= Config.HR.DEADBAND) return
    const dial: keyof Base = this.mode.device === 'treadmill' ? 'speed' : 'power'
    const [lo, hi] = Config.HR.AUTHORITY
    const k = 1 + Math.sign(error) * Config.HR.ADJUST_STEP
    const range = dial === 'speed' ? Config.SPEED_RANGE : Config.POWER_RANGE
    this.base[dial] = clamp(clamp(this.base[dial] * k, this.anchor[dial] * lo, this.anchor[dial] * hi), range[0], range[1])
    this.adjustedAt = this.t
  }

  /** The bpm a heart-rate segment is holding, or null. */
  heartRateTarget(): number | null {
    const hrr = this.segment().hrr
    if (hrr === undefined) return null
    const { resting, max } = this.machine.heartRateRange()
    return Math.round(resting + hrr * (max - resting))
  }

  /** What a machine is told before the start and after the end: the hill only, and nothing that moves. */
  private idleCommand(): Dials {
    return pausedCommand(this.base, this.mode)
  }

  // --- reading it ------------------------------------------------------------------------------------------

  segment(): Segment {
    return segmentAt(this.plan, this.t)
  }

  targets(): Targets {
    return targetsFor(this.segment(), this.base, this.mode)
  }

  state(): WorkoutState {
    const i = indexAt(this.plan, this.t)
    const seg = this.plan.segments[i]!
    const targets = targetsFor(seg, this.base, this.mode)
    const r = this.readings
    const hit =
      targets.manual === 'speed'
        ? onTarget(targets.want.speed, r.speed, TOLERANCE.speed)
        : targets.manual === 'power'
          ? onTarget(targets.want.power, r.power, powerTolerance(targets.want.power ?? 0))
          : true
    return {
      phase: this.phase,
      goal: this.goal,
      progress: this.progress(),
      timeInZone: this.zoneTime,
      zone: zoneOf(r.heartRate, this.machine.heartRateRange().max),
      elapsed: this.t,
      remaining: this.plan.duration - this.t,
      distance: this.dist,
      laps: this.lapsDone,
      lapDistance: this.dist - this.lapsDone * this.lap,
      targetDistance: this.targetDist,
      speed: this.mode.device === 'treadmill' ? r.speed : this.virtualSpeed,
      energy: this.joules,
      work: this.mode.device === 'bike' ? this.workJoules : null,
      energySource: this.source,
      elevation: this.climb,
      segment: seg,
      segmentIndex: i,
      segmentRemaining: Math.max(0, seg.t1 - this.t),
      next: this.plan.segments[i + 1] ?? null,
      targets,
      base: { ...this.base },
      readings: r,
      onTarget: hit,
      heartRateTarget: this.heartRateTarget(),
      autoAdjusted: this.t - this.adjustedAt < 3,
      splits: this.splits,
      stats: this.stats,
      plan: this.plan,
      mode: this.mode,
      achievements: [...this.earnedSet],
    }
  }

  /** Everything the summary screen and the session image need. */
  summary(): Summary {
    return {
      program: PROGRAMS[this.plan.program].name,
      level: this.plan.level,
      duration: this.t,
      requested: this.plan.duration,
      distance: this.dist,
      laps: this.lapsDone,
      energy: this.joules,
      work: this.mode.device === 'bike' ? this.workJoules : null,
      elevation: this.climb,
      avgSpeed: avgOf(this.stats.speed),
      maxSpeed: maxOf(this.stats.speed),
      avgPower: avgOf(this.stats.power),
      maxPower: maxOf(this.stats.power),
      avgHeartRate: avgOf(this.stats.heartRate),
      maxHeartRate: maxOf(this.stats.heartRate),
      avgCadence: avgOf(this.stats.cadence),
      splits: this.splits,
      targetDistance: this.targetDist,
      timeInZone: [...this.zoneTime],
      goal: this.goal,
      trend: [...this.history],
      achievements: [...this.earnedSet],
    }
  }
}

export interface Summary {
  program: string
  level: number
  duration: number
  requested: number
  distance: number
  laps: number
  energy: number
  work: number | null
  elevation: number
  avgSpeed: number | null
  maxSpeed: number | null
  avgPower: number | null
  maxPower: number | null
  avgHeartRate: number | null
  maxHeartRate: number | null
  avgCadence: number | null
  splits: Split[]
  /** How far the programme asked for, to compare with `distance`. */
  targetDistance: number
  timeInZone: number[]
  goal: Goal
  trend: TrendPoint[]
  achievements: string[]
}

function freshStats(): Stats {
  return { speed: emptyStat(), power: emptyStat(), heartRate: emptyStat(), cadence: emptyStat() }
}

function sample(all: Stats, lap: Stats, r: Readings): void {
  const add = (s: Stat, v: number | null): void => {
    if (v === null) return
    s.n++
    s.sum += v
    if (v > s.max) s.max = v
  }
  for (const [k, v] of [['speed', r.speed], ['power', r.power], ['heartRate', r.heartRate], ['cadence', r.cadence]] as const) {
    add(all[k], v)
    add(lap[k], v)
  }
}
