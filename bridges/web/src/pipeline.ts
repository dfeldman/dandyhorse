// Device control pipeline (PLAN.md §9.4). Pure functions, no DOM.
import type { Commanded, DeviceRanges, DeviceType, Limits, Metrics, Range } from './types'
import { emptyCommanded } from './types'

export const SIM_DEFAULTS = { wind: 0, crr: 0.004, cw: 0.51 } as const

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) [lo, hi] = [hi, lo]
  return Math.min(hi, Math.max(lo, v))
}

/** Limit the change from `prev` to `target` to `rate * dt`. A null prev starts from 0 (the safe choice on a belt). */
export function slew(target: number, prev: number | null, rate: number, dt: number): number {
  const from = prev ?? 0
  if (!(rate > 0) || !Number.isFinite(rate)) return target // no rate limit configured
  if (!(dt > 0)) return from
  const maxDelta = rate * dt
  return from + clamp(target - from, -maxDelta, maxDelta)
}

/**
 * Slew toward the target and land on the device's grid only at the end. Rounding every intermediate value to a grid
 * coarser than one tick's slew budget stalls or speeds up: 0.25 % per tick on the Horizon's 0.5 % incline grid
 * rounded back to where it was going down (a downhill never flattened the treadmill) and rounded up going up (twice
 * the configured rate). Intermediate values stay inside the range but off the grid; the device driver rounds when it
 * writes, so the machine still moves in its own steps at the configured rate.
 */
export function slewFeasible(target: number, prev: number | null, rate: number, dt: number, range: Range | null | undefined): number {
  const goal = feasible(target, range)
  const s = slew(goal, prev, rate, dt)
  return s === goal || !range ? s : clamp(s, range.min, range.max)
}

/** Round to the device resolution and clamp into the supported range. */
export function feasible(v: number, range: Range | null | undefined): number {
  if (!range) return v
  let out = v
  if (range.step > 0) out = Math.round(out / range.step) * range.step
  return clamp(out, range.min, range.max)
}

export interface ProcessOptions {
  ranges?: DeviceRanges
  /**
   * May the bridge command belt speed on this treadmill? Off unless the device is a simulator or the user switched
   * speed control on for it (PLAN.md §9.4). Some firmware runs the belt to maximum on a speed change while moving
   * (Horizon 7.0AT, §9.5), so this is opt-in per machine. Incline and E-STOP are not affected.
   */
  allowSpeed?: boolean
}

/** Speed control is allowed for simulators, and for real treadmills whose saved preferences switch it on. */
export function speedAllowed(protocol: string | null | undefined, prefs: { speedControl?: unknown } | null | undefined): boolean {
  return protocol === 'sim' || prefs?.speedControl === true
}

/**
 * requested -> commanded for one poll.
 * Null requested => null commanded (no command). Metrics irrelevant to the device type are null.
 */
export function process(
  deviceType: DeviceType,
  requested: Partial<Metrics>,
  limits: Limits,
  previousCommanded: Commanded | null,
  dtSeconds: number,
  opts: ProcessOptions = {},
): Commanded {
  const out = emptyCommanded()
  const prev = previousCommanded
  const ranges = opts.ranges ?? {}

  if (deviceType === 'treadmill') {
    if (requested.speed != null && opts.allowSpeed === true) {
      let s = requested.speed * limits.speedScale
      s = clamp(s, limits.minSpeed, limits.maxSpeed)
      s = slewFeasible(s, prev?.speed ?? null, limits.maxSpeedChangePerSecond, dtSeconds, ranges.speed)
      out.speed = round(s, 4)
    }
    if (requested.incline != null) {
      let i = requested.incline * limits.inclineScale
      i = clamp(i, limits.minIncline, limits.maxIncline)
      i = slewFeasible(i, prev?.incline ?? null, limits.maxInclineChangePerSecond, dtSeconds, ranges.incline)
      out.incline = round(i, 4)
    }
    return out
  }

  // bike: ERG takes precedence over simulation
  if (requested.power != null) {
    let p = requested.power + limits.powerOffset
    p = Math.max(0, p)
    p = feasible(p, ranges.power)
    out.power = round(p, 2)
    return out
  }
  const anySim = requested.grade != null || requested.wind != null || requested.crr != null || requested.cw != null
  if (anySim) {
    const g = (requested.grade ?? 0) * limits.difficulty
    out.grade = round(clamp(g, -limits.gradeCap, limits.gradeCap), 4)
    out.wind = requested.wind ?? SIM_DEFAULTS.wind
    out.crr = requested.crr ?? SIM_DEFAULTS.crr
    out.cw = requested.cw ?? SIM_DEFAULTS.cw
  }
  return out
}

export const GAME_HOLD_S = 10
export const GAME_RAMP_S = 30
export const SERVER_HOLD_MS = 10_000
export const SERVER_RAMP_MS = 30_000

/**
 * What to do when an input goes quiet. A silent server and a silent game (frozen, crashed, throttled in a
 * hidden tab) are treated alike: keep the last target for a while, then bring a treadmill belt to 0.
 * Bikes only hold: resistance with no belt is never dangerous.
 */
export function staleAction(deviceType: DeviceType, sinceServerMs: number, gameAgeS: number | null): 'normal' | 'hold' | 'ramp' {
  const serverRamp = sinceServerMs > SERVER_RAMP_MS
  const gameRamp = gameAgeS != null && gameAgeS > GAME_RAMP_S
  if (deviceType === 'treadmill' && (serverRamp || gameRamp)) return 'ramp'
  if (sinceServerMs > SERVER_HOLD_MS || (gameAgeS != null && gameAgeS > GAME_HOLD_S)) return 'hold'
  return 'normal'
}

/**
 * One step of the "lost server" ramp on a treadmill: bring speed toward 0 at the slew rate.
 * Most treadmill games never command speed (the user picks it on the machine, PLAN.md §7.3); a belt the
 * bridge never took over is left alone, so a silent game only freezes the incline.
 */
export function rampDown(prev: Commanded | null, limits: Limits, dtSeconds: number): Commanded {
  const out = emptyCommanded()
  out.incline = prev?.incline ?? null
  if (prev?.speed == null) return out
  out.speed = round(slew(0, prev.speed, limits.maxSpeedChangePerSecond, dtSeconds), 4)
  return out
}

export function commandedEqual(a: Commanded | null, b: Commanded | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  for (const k of Object.keys(a) as (keyof Commanded)[]) {
    if (a[k] !== b[k]) return false
  }
  return true
}

function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
