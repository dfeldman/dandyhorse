/**
 * What a bot's legs do (PLAN.md §18.8).
 *
 * Deliberately thin: no energy budget, no glycogen, no heart model. A bot rides at a target power that
 * wanders as a random walk (so the trace looks like a person, not like noise), fades a little each minute
 * of the session, and was weaker months ago than it is today. That is enough for the numbers the platform
 * keeps — distance, climbing, calories, how often they crashed — to be real, because the bot really plays
 * the game and the game really decides what happens.
 */

export interface FitnessModel {
  /** Target power now, in watts. */
  watts: number
  /** Standard deviation of the random walk around it, in watts. */
  variability: number
  /** Fraction of its power the rider loses each minute of a session (0.005 = half a percent). */
  fatiguePerMinute: number
  /** Fraction gained per month of training, applied backwards for an older session. */
  skillPerMonth: number
}

/** A seeded generator, so a backfill can be run again and produce the same history. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    // xorshift32: small, fast, and good enough for a wandering number
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 0x1_0000_0000
  }
}

/** Two uniforms into one normal (Box–Muller), for a walk that drifts rather than jumps. */
export function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/**
 * The rider's power as it was `monthsAgo` months back: `skillPerMonth` of improvement undone for each
 * month. A bot who gains 1% a month was riding at about 89% of today's power a year ago.
 */
export function wattsAt(model: FitnessModel, monthsAgo: number): number {
  return model.watts / (1 + model.skillPerMonth) ** Math.max(0, monthsAgo)
}

/** One rider's legs for one session. `power(t)` is what the trainer would read at t seconds in. */
export class Legs {
  private readonly base: number
  private readonly model: FitnessModel
  private readonly rng: () => number
  /** The walk's current offset from the target, in watts. */
  private drift = 0
  private last = 0

  constructor(model: FitnessModel, monthsAgo: number, seed: number) {
    this.model = model
    this.base = wattsAt(model, monthsAgo)
    this.rng = makeRng(seed)
  }

  /** The power at `seconds` into the session. Call it in order; it integrates the walk between calls. */
  power(seconds: number): number {
    const dt = Math.max(0, Math.min(10, seconds - this.last))
    this.last = seconds
    // An Ornstein–Uhlenbeck step: pulled back towards the target, nudged at random. `pull` sets how long an
    // excursion lasts — about half a minute, which is what a rider's effort actually looks like.
    const pull = 1 / 30
    this.drift += (-this.drift * pull + gaussian(this.rng) * this.model.variability * Math.sqrt(pull)) * dt
    const fade = (1 - this.model.fatiguePerMinute) ** (seconds / 60)
    // A standing start: nobody is at full power in the first few seconds.
    const warm = Math.min(1, 0.55 + seconds / 40)
    return Math.max(0, (this.base * fade + this.drift) * warm)
  }
}

/** A plausible cadence for a power, so the trainer's trace is not a flat line. */
export function cadenceFor(watts: number, rng: () => number): number {
  return Math.round(Math.max(55, Math.min(105, 72 + watts / 14 + gaussian(rng) * 3)))
}


/**
 * The wheel speed a trainer would report for this power, in m/s.
 *
 * A real trainer measures the flywheel, and games that do not compute a virtual speed of their own (Night
 * Racer, Night Watch) let the platform integrate that reading into the session's distance. A bot that
 * reported only watts would finish those games having gone nowhere. Rolling resistance and drag on the flat,
 * for a 75 kg rider and bike: P ≈ 3.5·v + 0.21·v³, inverted by bisection because a cubic is not worth it.
 */
export function speedFor(watts: number): number {
  const power = (v: number): number => 3.5 * v + 0.21 * v * v * v
  if (watts <= 0) return 0
  let lo = 0
  let hi = 25
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (power(mid) < watts) lo = mid
    else hi = mid
  }
  return Math.round(((lo + hi) / 2) * 100) / 100
}
