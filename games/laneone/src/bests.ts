/**
 * Personal bests. Four numbers, per machine: the fastest lap, the longest workout, the most calories and the
 * biggest climb. They are what make the setup screen worth reading and give the summary something to say.
 *
 * Standalone they live in localStorage. On Dandyhorse they become save state, keyed by game and variant
 * (INTEGRATION.md §8), which is also what makes them follow the player from screen to screen.
 */
import type { DeviceType } from './physics.ts'

export interface Bests {
  /** Seconds for the fastest full lap of the track. */
  lap: number | null
  distance: number | null
  calories: number | null
  climb: number | null
  workouts: number
  /** Total metres over every workout, for the "you have run X" line. */
  totalDistance: number
}

export const EMPTY: Bests = { lap: null, distance: null, calories: null, climb: null, workouts: 0, totalDistance: 0 }

/** What a finished workout beat. Each key is set only when it is a new best. */
export interface Beaten {
  lap?: number
  distance?: number
  calories?: number
  climb?: number
}

const key = (device: DeviceType): string => `laneone.bests.${device}`

export function load(device: DeviceType): Bests {
  try {
    const raw = localStorage.getItem(key(device))
    if (!raw) return { ...EMPTY }
    const v = JSON.parse(raw) as Partial<Bests>
    return { ...EMPTY, ...v }
  } catch {
    return { ...EMPTY } // a private window, or storage turned off: bests just don't stick
  }
}

export function save(device: DeviceType, b: Bests): void {
  try {
    localStorage.setItem(key(device), JSON.stringify(b))
  } catch {
    /* nothing to do: the workout still happened */
  }
}

/**
 * Fold a finished workout into the bests. Returns the updated record and what it beat, so the summary can
 * say so. A lap only counts if it was a whole one.
 */
export function record(
  device: DeviceType,
  workout: { fastestLap: number | null; distance: number; calories: number; climb: number },
): { bests: Bests; beaten: Beaten } {
  const bests = load(device)
  const beaten: Beaten = {}
  const better = (was: number | null, now: number, lowerIsBetter = false): boolean =>
    now > 0 && (was === null || (lowerIsBetter ? now < was : now > was))

  if (workout.fastestLap !== null && better(bests.lap, workout.fastestLap, true)) {
    beaten.lap = workout.fastestLap
    bests.lap = workout.fastestLap
  }
  if (better(bests.distance, workout.distance)) {
    beaten.distance = workout.distance
    bests.distance = workout.distance
  }
  if (better(bests.calories, workout.calories)) {
    beaten.calories = workout.calories
    bests.calories = workout.calories
  }
  if (better(bests.climb, workout.climb)) {
    beaten.climb = workout.climb
    bests.climb = workout.climb
  }
  bests.workouts++
  bests.totalDistance += Math.max(0, workout.distance)
  save(device, bests)
  return { bests, beaten }
}
