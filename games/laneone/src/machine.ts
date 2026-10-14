/**
 * The seam. Everything the console reads from the exercise machine, and everything it asks of it, goes through
 * `Machine`. Standalone that is `SimMachine` (src/sim/machine.ts), a treadmill or trainer modelled well enough
 * to feel real; on Dandyhorse it becomes one new file over gamekit's `SessionClient` (INTEGRATION.md §2).
 *
 * The field names are the platform's metric names on purpose, so the adapter is a copy, not a translation.
 * `null` means "the machine is not saying", and must never be shown or summed as 0.
 */
import type { Body, DeviceType } from './physics.ts'
import type { Dials } from './drive.ts'
import type { UnitSystem } from './units.ts'

export interface Readings {
  /** Belt or virtual speed, m/s. */
  speed: number | null
  /** Treadmill incline, percent. */
  incline: number | null
  /** Trainer grade, percent. */
  grade: number | null
  /** Watts at the pedals. */
  power: number | null
  /** Pedal rate, rpm. */
  cadence: number | null
  heartRate: number | null
}

export const NO_READINGS: Readings = { speed: null, incline: null, grade: null, power: null, cadence: null, heartRate: null }

export interface Machine {
  readonly device: DeviceType
  /** True while the keyboard-and-slider harness stands in for a real machine (the HUD shows it). */
  readonly harness: boolean
  /** What the machine measures now. */
  read(): Readings
  /** Ask the machine for these. A `null` field is not sent at all. */
  command(d: Dials): void
  /** The workout is frozen: standalone, the Pause button; on the platform, whatever the server says. */
  paused(): boolean
  /** A pause the player asked for. On the platform this is `SessionClient.setPaused`. */
  setPaused(paused: boolean): void
  /** A line to show while paused, written for the player, or null. */
  pauseMessage(): string | null
  /** Called once a frame with the wall-clock step. */
  update(dt: number): void
  /**
   * What the console is asking the player to do by hand this second (m/s of belt, or watts), or null. A real
   * machine cannot hear it — the player reads it off the screen — so the platform adapter ignores it. The
   * simulator uses it to make its simulated player follow along.
   */
  advise?(target: number | null): void

  // --- what the platform knows about the player --------------------------------------------------------
  /** The player's steady pace in watts, if it is known; the bike's base power starts here. */
  steadyWatts(): number | null
  body(): Body
  unitSystem(): UnitSystem
  /** Resting and maximum heart rate for the heart-rate programmes. */
  heartRateRange(): { resting: number; max: number }
}
