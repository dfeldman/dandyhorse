/**
 * A simulated treadmill or bike trainer: enough of a real machine that the console can be built and judged
 * without one. It is the standalone half of the `Machine` seam (src/machine.ts).
 *
 * What it models, because each one changes how the console has to behave:
 * - **The belt takes time.** Speed ramps at BELT_RATE and the incline motor at INCLINE_RATE, so a programme
 *   step is not instant and the console must show "asked for" beside "actual".
 * - **A trainer in ERG takes time too**, and never lands exactly on the number.
 * - **Heart rate lags**, ~25 s up and ~45 s down, which is the whole reason a heart-rate programme has to
 *   adjust slowly (Config.HR.ADJUST_EVERY).
 * - **The player is a separate thing from the machine.** In `who: 'you'` mode the belt runs at whatever the
 *   player set, not at what the console asked for; the harness slider is that setting. `auto` makes the
 *   simulated player follow the console's advice with a human lag, which is what makes a screenshot look
 *   alive; touching the slider turns it off.
 */
import { Config } from '../config.ts'
import type { Dials } from '../drive.ts'
import type { Machine, Readings } from '../machine.ts'
import { DEFAULT_BODY, treadmillWatts, type Body, type DeviceType } from '../physics.ts'
import { clamp } from '../rng.ts'
import type { UnitSystem } from '../units.ts'

/** Belt acceleration, m/s per second (about 0.34 mph/s — a middling treadmill). */
const BELT_RATE = 0.15
/** Incline motor, percent per second (0 → 15 % in about half a minute). */
const INCLINE_RATE = 0.5
/** ERG: watts per second the trainer will move, and how close it settles. */
const ERG_RATE = 25
/** Trainer grade change, percent per second. */
const GRADE_RATE = 2
/** Heart rate: seconds to close ~63 % of the gap, climbing and recovering. */
const HR_UP = 25
const HR_DOWN = 45
/** Heart rate at the player's steady pace, as a fraction of reserve. */
const HR_AT_STEADY = 0.6
/** How fast the simulated player follows the console's advice (seconds to close ~63 % of the gap). */
const HUMAN_LAG = 6

export interface SimOptions {
  device: DeviceType
  steadyWatts?: number
  body?: Partial<Body>
  unitSystem?: UnitSystem
  resting?: number
  maxHr?: number
  /** Start with the simulated player following the console's advice. */
  auto?: boolean
  /** Hold the player's own setting and hide the slider: `?speed=`, `?power=` (screenshots and tests). */
  fixed?: number | null
  /** The machine reports no heart rate (no strap). */
  noHeartRate?: boolean
}

export class SimMachine implements Machine {
  readonly device: DeviceType
  readonly harness: boolean
  /** The simulated player follows the console's advice until the slider is touched. */
  auto: boolean
  /** What the player has set: belt speed (m/s) on a treadmill, effort in watts on a bike. */
  private want: number
  private asked: Dials = { speed: null, incline: null, power: null, grade: null }
  private belt = 0
  private incline = 0
  private grade = 0
  private watts = 0
  private cadence = 0
  private hr: number
  private isPaused = false
  private readonly steady: number
  private readonly bodyData: Body
  private readonly units: UnitSystem
  private readonly restingHr: number
  private readonly maxHr: number
  private readonly noHr: boolean
  private readonly listeners: ((v: number) => void)[] = []
  private phase = 0

  constructor(opts: SimOptions) {
    this.device = opts.device
    this.steady = opts.steadyWatts ?? Config.BASE_POWER
    this.bodyData = { ...DEFAULT_BODY, ...opts.body }
    this.units = opts.unitSystem ?? 'metric'
    this.restingHr = opts.resting ?? Config.HR.DEFAULT_RESTING
    this.maxHr = opts.maxHr ?? Math.round(208 - 0.7 * this.bodyData.age)
    this.noHr = opts.noHeartRate ?? false
    this.hr = this.restingHr
    this.harness = opts.fixed === undefined || opts.fixed === null
    this.auto = this.harness && (opts.auto ?? true)
    this.want = opts.fixed ?? (this.device === 'treadmill' ? Config.BASE_SPEED : this.steady)
  }

  // --- the harness -------------------------------------------------------------------------------------

  /** The slider's range, in the machine's own unit (m/s of belt, or watts). */
  range(): [number, number] {
    return this.device === 'treadmill' ? Config.SPEED_RANGE : [0, Math.round(this.steady * 2.5)]
  }

  /** What the player has set. */
  setting(): number {
    return this.want
  }

  /** The player moves the machine's own controls (or pedals harder). Turns auto-follow off. */
  set(v: number, byHand = true): void {
    const [lo, hi] = this.range()
    this.want = clamp(v, lo, hi)
    if (byHand) this.auto = false
    for (const fn of this.listeners) fn(this.want)
  }

  onChange(fn: (v: number) => void): void {
    this.listeners.push(fn)
  }

  /** What the console is telling the player to do by hand, so auto-follow can chase it. */
  advise(target: number | null): void {
    this.advice = target
  }
  private advice: number | null = null

  // --- Machine ------------------------------------------------------------------------------------------

  read(): Readings {
    if (this.device === 'treadmill') {
      return {
        speed: this.belt,
        incline: this.incline,
        grade: null,
        power: null,
        cadence: null,
        heartRate: this.noHr ? null : Math.round(this.hr),
      }
    }
    return {
      speed: null, // a trainer reports no speed; the console computes a virtual one from power
      incline: null,
      grade: this.grade,
      power: Math.max(0, Math.round(this.watts)),
      cadence: this.watts > 5 ? Math.round(this.cadence) : 0,
      heartRate: this.noHr ? null : Math.round(this.hr),
    }
  }

  command(d: Dials): void {
    this.asked = d
  }

  paused(): boolean {
    return this.isPaused
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused
  }

  pauseMessage(): string | null {
    return this.isPaused ? 'Paused. Press Resume to carry on.' : null
  }

  steadyWatts(): number {
    return this.steady
  }

  body(): Body {
    return this.bodyData
  }

  unitSystem(): UnitSystem {
    return this.units
  }

  heartRateRange(): { resting: number; max: number } {
    return { resting: this.restingHr, max: this.maxHr }
  }

  // --- the model -----------------------------------------------------------------------------------------

  update(dt: number): void {
    if (dt <= 0) return
    this.phase += dt
    if (this.auto && this.advice !== null) {
      // A human moves toward the advice over a few seconds, and overshoots a little on the way.
      this.set(this.want + (this.advice - this.want) * (1 - Math.exp(-dt / HUMAN_LAG)), false)
    }
    if (this.device === 'treadmill') this.stepTreadmill(dt)
    else this.stepBike(dt)
    this.stepHeart(dt)
  }

  private stepTreadmill(dt: number): void {
    // The belt goes where it was told, if it was told; otherwise where the player set it.
    const target = this.isPaused ? 0 : (this.asked.speed ?? this.want)
    this.belt = approach(this.belt, target, BELT_RATE * dt)
    this.incline = approach(this.incline, this.asked.incline ?? this.incline, INCLINE_RATE * dt)
  }

  private stepBike(dt: number): void {
    this.grade = approach(this.grade, this.isPaused ? 0 : (this.asked.grade ?? this.grade), GRADE_RATE * dt)
    // ERG: the trainer holds the watts and the rider just turns the pedals. Otherwise the rider chooses.
    const erg = this.asked.power
    const target = this.isPaused ? 0 : (erg ?? this.want)
    const rate = erg !== null && erg !== undefined ? ERG_RATE : 60
    this.watts = approach(this.watts, target, rate * dt)
    // A little life: real power wanders a few percent with each pedal stroke.
    const wobble = 1 + 0.025 * Math.sin(this.phase * 3.1) + 0.015 * Math.sin(this.phase * 7.7)
    this.watts = Math.max(0, this.watts * wobble)
    const wantCadence = this.watts <= 5 ? 0 : 72 + Math.min(20, this.watts / 12)
    this.cadence = approach(this.cadence, wantCadence, 40 * dt)
  }

  private stepHeart(dt: number): void {
    // Bike-equivalent watts on either machine, by the same formula the platform's EffortMeter uses, so a
    // walk and a ride raise the heart rate by comparable amounts.
    const load = this.device === 'treadmill' ? (treadmillWatts(this.belt, this.incline, this.bodyData.weight) ?? 0) : this.watts
    const fraction = clamp((load / Math.max(1, this.steady)) * HR_AT_STEADY, 0, 1.05)
    const target = this.restingHr + fraction * (this.maxHr - this.restingHr)
    const tau = target > this.hr ? HR_UP : HR_DOWN
    this.hr += (target - this.hr) * (1 - Math.exp(-dt / tau))
  }
}

function approach(v: number, target: number, maxStep: number): number {
  const d = target - v
  if (Math.abs(d) <= maxStep) return target
  return v + Math.sign(d) * maxStep
}
