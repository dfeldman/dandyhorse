/**
 * Pure functions between the platform state and the game: what we read from the machine and what
 * we ask of it. Kept free of DOM and Babylon so they can be unit tested.
 *
 * The rule that must never break: on a treadmill the game NEVER commands belt speed. It asks for
 * incline only; the user picks the speed on the machine and the game reads it back.
 */
import type { DeviceType, EffortReadout, GameState, TickBody } from '@dandyhorse/gamekit'
import type { Measured } from './globals.d.ts'

/** What the machine measures. `null` stays `null`: unknown is never 0. */
export function measured(state: GameState | null, deviceType: DeviceType, effort: number | null = null): Measured {
  if (!state) return { power: null, speed: null, heartRate: null, machineGrade: null, effort: null }
  return {
    power: state.power.actual,
    speed: state.speed.actual,
    heartRate: state.heartRate.actual,
    machineGrade: deviceType === 'bike' ? state.grade.actual : state.incline.actual,
    effort,
  }
}

/**
 * The effort that turns the cranks, or null when nothing usable is reading.
 *
 * gamekit's EffortMeter falls back to heart rate and then cadence when the chosen source goes quiet. That is
 * right for a game paced by how hard you are working (Kingdom Trek), but wrong for a bike with physics under
 * it: a heart-rate strap reads high for a minute after you stop, so the bike would roll on your pulse, and
 * cadence can't see the resistance. So only the machine's own reading pedals: power on a bike, speed and
 * incline on a treadmill. Anything else means "not pedalling", exactly as a missing power reading did before.
 */
export function machineEffort(readout: EffortReadout, deviceType: DeviceType): number | null {
  const want = deviceType === 'treadmill' ? 'treadmill' : 'power'
  return readout.source === want ? readout.effort : null
}

/**
 * The watts the virtual rider pedals with: their effort against their own steady pace, times the platform's
 * default steady watts (gamekit's DEFAULT_STEADY_WATTS, passed in as `reference`).
 *
 * This is what makes the ride fit the rider. Effort is 1.0 at whatever pace that person can hold all day, on
 * either machine, so everyone riding at their own steady pace pedals the same virtual watts and holds the same
 * speed up the same hill. A rider whose steady pace IS the platform default rides exactly as they did before.
 */
export function virtualWatts(effort: number | null, reference: number): number {
  return effort == null ? 0 : Math.max(0, effort * reference)
}

/**
 * The metric part of a tick. Bike: grade (simulation mode) plus the virtual speed so the server
 * integrates distance from the world, not the trainer's flywheel. Treadmill: incline, nothing else.
 */
export function targets(deviceType: DeviceType, requestPercent: number, virtualSpeed: number): Pick<TickBody, 'grade' | 'incline' | 'speed'> {
  const r = Number.isFinite(requestPercent) ? requestPercent : 0
  if (deviceType === 'treadmill') return { incline: r }
  return { grade: r, speed: Math.max(0, virtualSpeed) }
}

/** Belt-and-braces: a treadmill tick with a speed in it is a bug; strip it and say so. */
export function guardTreadmill(deviceType: DeviceType, body: TickBody): TickBody {
  if (deviceType !== 'treadmill' || !('speed' in body)) return body
  const { speed: _speed, ...rest } = body
  console.warn('rollinghills: refusing to command treadmill speed')
  return rest
}

/**
 * Seconds of active (unpaused) time, interpolated between getstates: the server's activeSeconds
 * as of when we received it, plus the wall time since unless paused.
 */
export function activeSeconds(state: GameState | null, receivedAtMs: number, nowMs: number): number {
  if (!state) return 0
  const base = state.activeSeconds ?? Math.max(0, (state.elapsed ?? 0) - (state.pausedSeconds ?? 0))
  if (state.sessionStatus !== 'active') return base
  return base + Math.max(0, nowMs - receivedAtMs) / 1000
}

/**
 * What the world is built from: the launch options (route, time of day; PLAN.md §7.1, chosen in the console)
 * and the per-game preferences (shadows). Defaults applied here: the server stores only what was chosen or set.
 */
export interface Prefs { route: 'flat' | 'rolling' | 'hilly'; timeOfDay: 'day' | 'dusk' | 'night' | 'dawn'; shadows: boolean }
export function prefsWithDefaults(options: Record<string, unknown> | null | undefined, game: Record<string, unknown> | null | undefined): Prefs {
  const o = options ?? {}
  const g = game ?? {}
  const route = ['flat', 'rolling', 'hilly'].includes(String(o.route)) ? (o.route as Prefs['route']) : 'rolling'
  const timeOfDay = ['day', 'dusk', 'night', 'dawn'].includes(String(o.timeOfDay)) ? (o.timeOfDay as Prefs['timeOfDay']) : 'day'
  const shadows = typeof g.shadows === 'boolean' ? g.shadows : true
  return { route, timeOfDay, shadows }
}
