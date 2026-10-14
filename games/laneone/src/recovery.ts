/**
 * The recovery test: the minute after a hard workout, and how far the heart rate falls in it.
 *
 * Gyms have had this button since the nineties (Life Fitness call it a fitness score, Polar an "own index")
 * and it is one of the few things a console can tell you that a stopwatch cannot. The reading is simple and
 * well established: stand still for a minute and watch the drop. It needs a strap; without one, the test is
 * never offered.
 */
import type { Machine } from './machine.ts'
import { recoveryVerdict } from './zones.ts'

export const RECOVERY_SECONDS = 60

export interface RecoveryResult {
  /** Heart rate when the minute began (the highest of the first few seconds). */
  start: number
  end: number
  drop: number
  label: string
  note: string
  /** 0–1, for a dial. */
  good: number
}

export class RecoveryTest {
  private readonly machine: Machine
  private readonly seconds: number
  private left: number
  private peak = 0
  private last: number | null = null
  private finished: RecoveryResult | null = null
  private abandoned = false

  constructor(machine: Machine, seconds = RECOVERY_SECONDS) {
    this.machine = machine
    this.seconds = seconds
    this.left = seconds
  }

  /** Whether it is worth offering: there has to be a strap saying something. */
  static available(machine: Machine): boolean {
    return machine.read().heartRate !== null
  }

  get remaining(): number {
    return Math.max(0, this.left)
  }

  get elapsed(): number {
    return this.seconds - this.remaining
  }

  get current(): number | null {
    return this.last
  }

  get startedAt(): number {
    return this.peak
  }

  get done(): boolean {
    return this.finished !== null || this.abandoned
  }

  result(): RecoveryResult | null {
    return this.finished
  }

  tick(dt: number): void {
    if (this.finished || this.abandoned) return
    const hr = this.machine.read().heartRate
    if (hr !== null) {
      this.last = hr
      // The first three seconds set the starting point, so a reading that is still climbing is caught.
      if (this.elapsed < 3) this.peak = Math.max(this.peak, hr)
    }
    this.left -= dt
    if (this.left > 0) return
    const end = this.last ?? this.peak
    const drop = Math.max(0, this.peak - end)
    this.finished = { start: this.peak, end, drop, ...recoveryVerdict(drop) }
  }

  /** Give up early: no result, and the summary just doesn't mention it. */
  abandon(): void {
    this.abandoned = true
    this.left = 0
    this.finished = null
  }
}
