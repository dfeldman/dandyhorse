/**
 * The contract between the TypeScript adapter (src/) and the classic game scripts (public/js/).
 * The scripts read window.RH_START at load and define window.RollingHills.boot(platform).
 */
import type { DeviceType, UnitSystem } from '@dandyhorse/gamekit'

export interface RhStart {
  seed: number
  route: string
  timeOfDay: string
  shadows: boolean
  deviceType: DeviceType
  duration: number
  weightKg: number | null
  debug: boolean
}

export interface Measured {
  power: number | null
  speed: number | null
  heartRate: number | null
  /** What the machine reports it is doing: grade (bike) or incline (treadmill), percent. */
  machineGrade: number | null
}

export interface EndedInfo {
  status: string
  reason: string | null
}

export interface Formatted { value: string; unit: string }

/** What the game reads from the platform (all calls are synchronous, per frame). */
export interface RhPlatform {
  fmt: { speed: (ms: number | null) => Formatted; distance: (m: number | null) => Formatted }
  bests: Record<string, number>
  measured: () => Measured
  paused: () => boolean
  pauseMessage: () => string | null
  activeSeconds: () => number
  ended: () => EndedInfo | null
  saveBest: (key: string, seconds: number) => void
  achievement: (id: string) => void
  finish: () => void
}

/** What the adapter reads back from the game once a second. */
export interface RhTick {
  /** Percent, the trail grade the game asks the machine for (smoothed, stepped). */
  request: number
  /** Virtual speed, m/s. */
  v: number
  grade: number
  pos: { x: number; y: number; z: number }
  dist: number
  laps: number
  started: boolean
  finished: boolean
  area: string
  weather: string
  segment: string | null
}

export interface RhHandle {
  tick: () => RhTick
  sessionImage: () => string | null
}

declare global {
  interface Window {
    RH_START?: RhStart
    RollingHills?: { boot: (platform: RhPlatform) => RhHandle }
    BABYLON?: unknown
  }
}
