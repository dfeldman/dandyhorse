/**
 * The programmes: Manual, Steady, Hills, Intervals, Pyramid, Random and Heart rate, as a console has them.
 * Pure functions — `build()` turns a programme, a length and a level into a list of segments, and nothing here
 * knows about machines, time or the screen.
 *
 * A segment is relative, never absolute, because the player sets the absolute part with the ± buttons:
 *   `effort` multiplies the base pace (treadmill) or base power (bike). 1.00 is the base.
 *   `grade`  adds percent to the base incline (treadmill) or base grade (bike).
 *   `hrr`    replaces both on a heart-rate programme: a fraction of heart-rate reserve to hold.
 * `drive.ts` turns those into what one particular machine is asked for.
 *
 * Every programme fits any length: the warm-up and cool-down are a share of the workout inside fixed bounds,
 * and the middle is filled with a whole number of cycles, stretched to land exactly on the end. So there are
 * never part-segments and never a silent gap — `tests/program.test.ts` pins both for 5–120 minutes.
 */
import { Config } from './config.ts'
import { clamp, mulberry32 } from './rng.ts'

export const PROGRAM_IDS = ['manual', 'steady', 'hills', 'intervals', 'pyramid', 'random', 'heartrate'] as const
export type ProgramId = (typeof PROGRAM_IDS)[number]

export type SegmentKind = 'warmup' | 'steady' | 'work' | 'recover' | 'cooldown'

export interface Segment {
  /** Seconds of exercise from the start of the workout (paused time never counts). */
  t0: number
  t1: number
  kind: SegmentKind
  /** What the banner says: 'Warm up', 'Climb', 'Push', 'Recover'. */
  label: string
  /** Factor on the base pace or power. */
  effort: number
  /** Percent of incline or grade on top of the base. */
  grade: number
  /** Heart-rate programmes: the fraction of heart-rate reserve to hold, instead of `effort`. */
  hrr?: number
}

export interface Program {
  id: ProgramId
  name: string
  /** One line in the picker. */
  blurb: string
  /** Whether the level control does anything. */
  levelled: boolean
  /** The console moves the base by itself to hold a heart rate. */
  heartRate: boolean
  /** Whether the programme touches the pace, the hill, or both — the picker shows a little icon per programme. */
  drives: ('pace' | 'hill')[]
}

export const PROGRAMS: Record<ProgramId, Program> = {
  manual: { id: 'manual', name: 'Manual', blurb: 'Nothing changes but what you change. The ± buttons are the whole programme.', levelled: false, heartRate: false, drives: [] },
  steady: { id: 'steady', name: 'Steady', blurb: 'Warm up, hold one pace, cool down. The plain hour.', levelled: false, heartRate: false, drives: ['pace'] },
  hills: { id: 'hills', name: 'Hills', blurb: 'Rolling climbs to 6 %, at whatever pace you set.', levelled: true, heartRate: false, drives: ['hill'] },
  intervals: { id: 'intervals', name: 'Intervals', blurb: 'A minute hard, ninety seconds easy, over and over.', levelled: true, heartRate: false, drives: ['pace', 'hill'] },
  pyramid: { id: 'pyramid', name: 'Pyramid', blurb: 'Up one step at a time to the peak, then back down.', levelled: true, heartRate: false, drives: ['pace'] },
  random: { id: 'random', name: 'Random', blurb: 'A different shape every time, from the seed. No two workouts alike.', levelled: true, heartRate: false, drives: ['pace', 'hill'] },
  heartrate: { id: 'heartrate', name: 'Heart rate', blurb: 'Pick a zone; the console moves the pace to hold you there. Needs a heart-rate strap.', levelled: true, heartRate: true, drives: ['pace'] },
}

export interface Workout {
  program: ProgramId
  level: number
  /** Seconds. */
  duration: number
  segments: Segment[]
}

export interface BuildOptions {
  level?: number
  seed?: number
}

// --- how a level scales a programme --------------------------------------------------------------------

/** Level 1–10 → how far the programme swings from the base. 5 is the printed profile. */
export function levelScale(level: number): number {
  const L = clamp(level, Config.LEVEL_RANGE[0], Config.LEVEL_RANGE[1])
  const lo = Config.LEVEL_SCALE[1] as number
  const mid = Config.LEVEL_SCALE[5] as number
  const hi = Config.LEVEL_SCALE[10] as number
  return L <= 5 ? lo + ((L - 1) / 4) * (mid - lo) : mid + ((L - 5) / 5) * (hi - mid)
}

/** Heart-rate programmes read the level as the zone itself: level 1 = 40 % of reserve, level 10 = 80 %. */
export function levelHrr(level: number): number {
  const L = clamp(level, Config.LEVEL_RANGE[0], Config.LEVEL_RANGE[1])
  return 0.4 + ((L - 1) / 9) * 0.4
}

// --- the shapes -----------------------------------------------------------------------------------------

/** One step of a programme's middle, with its nominal length in seconds. */
interface Step {
  secs: number
  kind: SegmentKind
  label: string
  effort: number
  grade: number
  hrr?: number
}

const step = (secs: number, kind: SegmentKind, label: string, effort: number, grade: number, hrr?: number): Step =>
  hrr === undefined ? { secs, kind, label, effort, grade } : { secs, kind, label, effort, grade, hrr }

/** How the middle is filled: `cycle` repeats a whole number of times, `once` is stretched to fit exactly. */
interface Shape {
  fill: 'cycle' | 'once'
  steps: Step[]
}

/** The middle of each programme at level 5. Lengths are nominal; `build` stretches them onto the clock. */
function shapeOf(id: ProgramId, level: number, middle: number, seed: number): Shape {
  switch (id) {
    case 'manual':
      return { fill: 'once', steps: [step(middle, 'steady', 'Manual', 1, 0)] }
    case 'steady':
      return { fill: 'once', steps: [step(middle, 'steady', 'Steady', 1, 0)] }
    case 'hills':
      // A rolling six minutes: up to 6 % and back, then a flat minute before the next one.
      return {
        fill: 'cycle',
        steps: [
          step(45, 'recover', 'Flat', 1, 0),
          step(45, 'work', 'Climbing', 1, 1.5),
          step(45, 'work', 'Climbing', 1, 3),
          step(45, 'work', 'Climbing', 1, 4.5),
          step(45, 'work', 'Summit', 1, 6),
          step(45, 'work', 'Over the top', 1, 4.5),
          step(45, 'recover', 'Descending', 1, 3),
          step(45, 'recover', 'Descending', 1, 1.5),
        ],
      }
    case 'intervals':
      return {
        fill: 'cycle',
        steps: [step(60, 'work', 'Push', 1.35, 1), step(90, 'recover', 'Recover', 0.8, 0)],
      }
    case 'pyramid':
      return {
        fill: 'once',
        steps: [0.85, 0.95, 1.05, 1.15, 1.25, 1.35, 1.25, 1.15, 1.05, 0.95, 0.85].map((e, i, all) =>
          step(120, e >= 1 ? 'work' : 'recover', i === 5 ? 'Peak' : i < all.length / 2 ? 'Up a step' : 'Down a step', e, 0),
        ),
      }
    case 'random':
      return { fill: 'once', steps: randomSteps(middle, seed) }
    case 'heartrate': {
      const hrr = levelHrr(level)
      return { fill: 'once', steps: [step(middle, 'steady', 'Hold the zone', 1, 0, hrr)] }
    }
  }
}

/**
 * Random: alternating harder and easier blocks of 45–90 s that fill the middle exactly. The last block is
 * stretched rather than cut, so nothing lands shorter than 20 s.
 */
function randomSteps(middle: number, seed: number): Step[] {
  const rand = mulberry32(seed)
  const steps: Step[] = []
  let used = 0
  let hard = false
  while (middle - used > 20) {
    const secs = Math.min(45 + Math.round(rand() * 45), middle - used)
    if (hard) {
      const effort = 1.1 + rand() * 0.25
      const grade = Math.round(rand() * 10) / 2 // 0–5 in half percents
      steps.push(step(secs, 'work', grade > 2 ? 'Climb' : 'Push', effort, grade))
    } else {
      steps.push(step(secs, 'recover', 'Easy', 0.75 + rand() * 0.2, rand() < 0.3 ? 1 : 0))
    }
    used += secs
    hard = !hard
  }
  if (steps.length === 0) return [step(middle, 'steady', 'Easy', 1, 0)]
  const last = steps[steps.length - 1]!
  last.secs += middle - used // absorb the remainder (< 20 s) into the last block
  return steps
}

// --- the builder ------------------------------------------------------------------------------------------

/** Warm-up and cool-down lengths for a workout of `duration` seconds, squeezed on a short one. */
export function ends(duration: number, id: ProgramId): { warmup: number; cooldown: number } {
  if (id === 'manual') return { warmup: 0, cooldown: 0 }
  const w = Config.WARMUP
  const c = Config.COOLDOWN
  let warmup = clamp(duration * w.share, w.min, w.max)
  let cooldown = clamp(duration * c.share, c.min, c.max)
  const room = duration * (1 - Config.MIDDLE_MIN_SHARE)
  if (warmup + cooldown > room) {
    const k = room / (warmup + cooldown)
    warmup *= k
    cooldown *= k
  }
  return { warmup: Math.round(warmup), cooldown: Math.round(cooldown) }
}

/** Build the whole workout. `duration` is seconds of exercise; the segments tile it exactly. */
export function build(program: ProgramId, duration: number, opts: BuildOptions = {}): Workout {
  const level = clamp(Math.round(opts.level ?? Config.LEVEL_DEFAULT), Config.LEVEL_RANGE[0], Config.LEVEL_RANGE[1])
  const total = Math.max(60, Math.round(duration))
  const seed = (opts.seed ?? 1) >>> 0
  const { warmup, cooldown } = ends(total, program)
  const middle = total - warmup - cooldown
  const shape = shapeOf(program, level, middle, seed)
  const p = PROGRAMS[program]
  const scale = p.levelled ? levelScale(level) : 1

  const out: Segment[] = []
  let t = 0
  const push = (secs: number, s: Omit<Segment, 't0' | 't1'>): void => {
    if (secs <= 0) return
    out.push({ ...s, t0: t, t1: t + secs })
    t += secs
  }

  // The ends never take the level: a warm-up is a warm-up at every level.
  if (warmup > 0) {
    const hrr = p.heartRate ? Math.max(0.3, levelHrr(level) - 0.15) : undefined
    push(warmup, { kind: 'warmup', label: 'Warm up', effort: 0.75, grade: 0, ...(hrr === undefined ? {} : { hrr }) })
  }

  // The middle: a whole number of cycles, or one pass, stretched to land exactly on the cool-down.
  const nominal = shape.steps.reduce((a, s) => a + s.secs, 0)
  const reps = shape.fill === 'cycle' ? Math.max(1, Math.round(middle / nominal)) : 1
  const k = middle / (nominal * reps)
  for (let r = 0; r < reps; r++) {
    for (const s of shape.steps) {
      const secs = Math.round(s.secs * k)
      const hrr = s.hrr
      push(secs, {
        kind: s.kind,
        label: s.label,
        effort: 1 + (s.effort - 1) * scale,
        grade: s.grade * scale,
        ...(hrr === undefined ? {} : { hrr }),
      })
    }
  }
  // Rounding each step can leave the middle a second or two out; give it to the last one.
  const wantedEnd = warmup + middle
  const lastMiddle = out[out.length - 1]
  if (lastMiddle && t !== wantedEnd && out.length > (warmup > 0 ? 1 : 0)) {
    lastMiddle.t1 = wantedEnd
    t = wantedEnd
  }

  if (cooldown > 0) {
    const hrr = p.heartRate ? 0.3 : undefined
    push(cooldown, { kind: 'cooldown', label: 'Cool down', effort: 0.6, grade: 0, ...(hrr === undefined ? {} : { hrr }) })
  }
  const last = out[out.length - 1]
  if (last) last.t1 = total // the whole thing ends on the clock, whatever the rounding did

  return { program, level, duration: total, segments: out }
}

// --- reading a workout ------------------------------------------------------------------------------------

/** The segment covering `t` seconds of exercise, or the last one once the clock has run out. */
export function segmentAt(w: Workout, t: number): Segment {
  const segs = w.segments
  for (const s of segs) if (t < s.t1) return s
  return segs[segs.length - 1]!
}

export function indexAt(w: Workout, t: number): number {
  const segs = w.segments
  for (let i = 0; i < segs.length; i++) if (t < segs[i]!.t1) return i
  return segs.length - 1
}

/** The highest effort and grade the workout reaches, for scaling the profile chart. */
export function peaks(w: Workout): { effort: number; grade: number } {
  return {
    effort: w.segments.reduce((a, s) => Math.max(a, s.effort), 1),
    grade: w.segments.reduce((a, s) => Math.max(a, s.grade), 0),
  }
}
