/** A car's state, and the arithmetic that turns the player's pedal into speed. */
import { Config } from '../config.ts'
import { clamp } from '../rng.ts'

export type ButtonId = 'turbo' | 'oil'

export interface Car {
  id: string
  name: string
  color: string
  isPlayer: boolean
  /** Rival pace as a share of cruise speed (the player's is 1). */
  pace: number
  /** Chance a rival dodges an oil slick it sees in time. */
  dodge: number
  wobblePeriod: number
  wobblePhase: number
  /** Extra pace a rival finds on the run to the flag (share). */
  finale: number

  /** Race distance from the start line (m); negative on the grid. */
  dist: number
  prevDist: number
  /** Lateral offset from the centreline (m, + right). */
  x: number
  vx: number
  /** Lane the car is heading for, and the one it returns to. */
  lane: number
  homeLane: number
  laneHold: number
  speed: number
  /** What the car would do on an empty road (m/s), before following. */
  freeSpeed: number

  /** Turbo meter, 0–100 per charge. */
  turbo: number
  /** Seconds of boost left. */
  boost: number
  oil: number
  oilTimer: number
  /** Seconds of spin-out left, and the spin's yaw for the renderer. */
  spin: number
  spinYaw: number
  spunBy: string | null
  drafting: boolean
  blocked: number
  think: number

  /** Height above the road (m) when a crest throws the car; vertical speed. */
  air: number
  airVy: number
  onGround: boolean

  lap: number
  finished: boolean
  finishTime: number
  place: number
  /** Race clock at the start of each lap. */
  lapStarts: number[]
  /** Slicks this car has already decided about (id → will dodge). */
  seen: Map<number, boolean>
  stats: { overtakes: number; oilHits: number; turbos: number; spins: number; rocket: boolean }
}

export function newCar(init: Pick<Car, 'id' | 'name' | 'color' | 'isPlayer' | 'pace' | 'dodge' | 'wobblePeriod' | 'wobblePhase' | 'finale'>): Car {
  return {
    ...init,
    dist: 0, prevDist: 0, x: 0, vx: 0, lane: 0, homeLane: 0, laneHold: 0, speed: 0, freeSpeed: 0,
    turbo: 0, boost: 0, oil: 0, oilTimer: 0, spin: 0, spinYaw: 0, spunBy: null, drafting: false, blocked: 0, think: 0,
    air: 0, airVy: 0, onGround: true,
    lap: 0, finished: false, finishTime: 0, place: 0, lapStarts: [], seen: new Map(),
    stats: { overtakes: 0, oilHits: 0, turbos: 0, spins: 0, rocket: false },
  }
}

/** Effort from the pedal: 1 is the player's steady pace. */
export const effortOf = (pedal: number): number => clamp(pedal, 0, Config.PEDAL_MAX) / 50

/** The player's speed on a flat straight at this pedal (m/s). Pedal 50 = cruise. */
export function speedFor(pedal: number): number {
  const e = effortOf(pedal)
  return e <= 0 ? 0 : Config.CRUISE_SPEED * Math.pow(e, Config.SPEED_EXP)
}

/** The pedal that holds a given speed (the inverse of speedFor). */
export function pedalFor(speed: number): number {
  return 50 * Math.pow(Math.max(0, speed) / Config.CRUISE_SPEED, 1 / Config.SPEED_EXP)
}

/** Every car slows uphill and in tight bends, and gains a little downhill. */
export function terrainFactor(grade: number, curvature: number): number {
  const hill = clamp(1 - Config.HILL_EFFECT * grade, 0.82, 1.12)
  const k = Math.abs(curvature)
  const corner = 1 - Config.CORNER_SLOW * clamp((k - 1 / 160) / (1 / 50 - 1 / 160), 0, 1)
  return hill * corner
}
