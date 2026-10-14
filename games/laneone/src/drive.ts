/**
 * What one particular machine is asked for. Pure, and tested, because this is the part that touches somebody's
 * treadmill: `tests/drive.test.ts` pins every clamp and every "never send this".
 *
 * Two ways to run, the launch option `drive` (INTEGRATION.md §3):
 *
 *   "you"      The machine is told only the hill — incline on a treadmill, grade on a bike. The pace is yours:
 *              the console shows the programme's target pace and you match it on the machine. This is the
 *              platform's default for treadmills, and the safe one: nobody is ever run faster than they chose.
 *   "machine"  The machine is told everything — belt speed and incline, or ERG watts. The programme runs itself
 *              and you just keep up. A bike in ERG has no hill to feel, so a programmed grade becomes watts.
 *
 * Ranges here are the console's own good manners; the bridge clamps again for the real device, and a machine
 * with no incline motor simply won't follow a hill (the console shows target against actual, so you can see it).
 */
import { Config } from './config.ts'
import type { DeviceType } from './physics.ts'
import type { Segment } from './program.ts'
import { clamp } from './rng.ts'

export type DriveWho = 'you' | 'machine'

export interface Mode {
  device: DeviceType
  who: DriveWho
}

/** The absolute workload the ± buttons hold. Only the two fields for the device in use are read. */
export interface Base {
  /** Treadmill belt speed, m/s. */
  speed: number
  /** Treadmill incline, percent. */
  incline: number
  /** Bike power, W. */
  power: number
  /** Bike grade, percent. */
  grade: number
}

export function defaultBase(device: DeviceType, steadyWatts = Config.BASE_POWER): Base {
  return {
    speed: Config.BASE_SPEED,
    incline: Config.BASE_INCLINE,
    power: device === 'bike' ? steadyWatts : Config.BASE_POWER,
    grade: Config.BASE_GRADE,
  }
}

/** Every metric the console might ask for; `null` is "not part of this machine" or "not sent". */
export interface Dials {
  speed: number | null
  incline: number | null
  power: number | null
  grade: number | null
}

export interface Targets {
  /** What the player should be doing, whether the machine is told or not. Drives the readouts. */
  want: Dials
  /** What goes on the wire. A `null` field is left out of setstate entirely. */
  command: Dials
  /** The dial the player has to move by hand, or null when the machine does it all. */
  manual: 'speed' | 'power' | null
}

const NONE: Dials = { speed: null, incline: null, power: null, grade: null }

/** What this segment means for this machine, given the base the player has dialled in. */
export function targetsFor(seg: Segment, base: Base, mode: Mode): Targets {
  const machine = mode.who === 'machine'
  if (mode.device === 'treadmill') {
    const speed = clamp(base.speed * seg.effort, Config.SPEED_RANGE[0], Config.SPEED_RANGE[1])
    const incline = clamp(base.incline + seg.grade, Config.INCLINE_RANGE[0], Config.INCLINE_RANGE[1])
    return {
      want: { ...NONE, speed, incline },
      // Never send `speed` unless the player asked the machine to drive it (GAME_AUTHORING.md, "What to drive").
      command: { ...NONE, incline, speed: machine ? speed : null },
      manual: machine ? null : 'speed',
    }
  }
  const grade = clamp(base.grade + seg.grade, Config.GRADE_RANGE[0], Config.GRADE_RANGE[1])
  if (machine) {
    // ERG: the trainer holds watts and there is no hill to feel, so the hill becomes watts.
    const power = clamp(base.power * seg.effort * (1 + seg.grade * Config.GRADE_TO_POWER), Config.POWER_RANGE[0], Config.POWER_RANGE[1])
    return { want: { ...NONE, power }, command: { ...NONE, power }, manual: null }
  }
  const power = clamp(base.power * seg.effort, Config.POWER_RANGE[0], Config.POWER_RANGE[1])
  return { want: { ...NONE, power, grade }, command: { ...NONE, grade }, manual: 'power' }
}

/**
 * What to ask for while the session is paused: a treadmill we drive stands still with its incline kept, a bike
 * goes flat, and a machine we don't drive is told nothing new (GAME_AUTHORING.md, "Paused").
 */
export function pausedCommand(base: Base, mode: Mode): Dials {
  if (mode.device === 'treadmill') {
    const incline = clamp(base.incline, Config.INCLINE_RANGE[0], Config.INCLINE_RANGE[1])
    return { ...NONE, incline, speed: mode.who === 'machine' ? 0 : null }
  }
  return { ...NONE, grade: 0 }
}

/**
 * One number for "how hard is this segment", for the profile chart: 1.0 is the base the player set, and a
 * programmed hill counts the same as the watts it would cost on a trainer. Device-independent on purpose —
 * the chart looks the same whichever machine you are on, which is what makes a programme recognisable.
 */
export function intensity(seg: Segment): number {
  // A heart-rate segment has no pace or hill of its own — the console finds those — so its height is the
  // zone it is holding: 40 % of reserve reads as 0.9, 60 % as 1.1, 80 % as 1.3.
  if (seg.hrr !== undefined) return 0.5 + seg.hrr
  return seg.effort * (1 + Math.max(0, seg.grade) * Config.GRADE_TO_POWER)
}

/** Is the player doing what the console asked? Used for the at-target tick beside the readout. */
export function onTarget(want: number | null, actual: number | null, tolerance: number): boolean {
  return want !== null && actual !== null && Math.abs(actual - want) <= tolerance
}

/** How close counts as on target: 0.15 m/s of belt, 10 % of the target watts, half a percent of hill. */
export const TOLERANCE = { speed: 0.15, power: 0.1, incline: 0.5, grade: 0.5 }

export function powerTolerance(want: number): number {
  return Math.max(10, want * TOLERANCE.power)
}
