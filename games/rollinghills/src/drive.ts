/**
 * Pure functions between the platform state and the game: what we read from the machine and what
 * we ask of it. Kept free of DOM and Babylon so they can be unit tested.
 *
 * The rule that must never break: on a treadmill the game NEVER commands belt speed. It asks for
 * incline only; the user picks the speed on the machine and the game reads it back.
 */
import type { DeviceType, GameState, TickBody } from '@dandyhorse/gamekit'
import type { Measured } from './globals.d.ts'

/** What the machine measures. `null` stays `null`: unknown is never 0. */
export function measured(state: GameState | null, deviceType: DeviceType): Measured {
  if (!state) return { power: null, speed: null, heartRate: null, machineGrade: null }
  return {
    power: state.power.actual,
    speed: state.speed.actual,
    heartRate: state.heartRate.actual,
    machineGrade: deviceType === 'bike' ? state.grade.actual : state.incline.actual,
  }
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
