/**
 * Everything the game knows about the person riding it comes through here, and nothing else in the game
 * reaches for an input. Standalone that is the keyboard; on Dandyhorse it will be one more implementation
 * backed by the platform's session (see INTEGRATION.md), and no other file will change.
 *
 * The one rule: `measured()` is what the machine MEASURED, never what the game asked for. A trainer told to
 * hold 8% may be holding 5%; a treadmill told to incline may have refused. The ride model is fed the truth and
 * the request is only ever a request.
 */

export interface Measured {
  /** watts at the pedals, or null when there is no reading yet (never a zero standing in for one) */
  power: number | null
  /** ground speed the machine is actually running at, m/s — a treadmill's belt */
  speed: number | null
  /** crank rpm, or null */
  cadence: number | null
  /** beats per minute, or null */
  heartRate: number | null
}

export const NO_READING: Measured = { power: null, speed: null, cadence: null, heartRate: null }

export interface Controls {
  /** what the machine is doing right now */
  measured(): Measured
  /** the machine has stopped and the session is on hold */
  paused(): boolean
  /** seconds of actual riding so far, pauses excluded */
  elapsedSeconds(): number
  /** the game asking the machine for a grade, in percent. The platform clamps and scales it. */
  request(gradePercent: number): void
  /** true once the session is over and the ride should stop */
  ended(): boolean
}

/**
 * The keyboard, for developing without a machine. Up/down set the effort — watts on a bike, belt speed on a
 * treadmill — and space is the thing this game has to get right: it drops the power to zero without stopping
 * the bike. Hold it on a descent and you coast; hold it on a treadmill and you stop, because that is what
 * happens.
 */
export class LocalControls implements Controls {
  private watts = 180
  private belt = 2.8
  private coasting = false
  private held = false
  private started = 0
  private paused_ = false
  private grade = 0

  private readonly deviceType: () => 'bike' | 'treadmill'

  constructor(deviceType: () => 'bike' | 'treadmill') {
    this.deviceType = deviceType
    this.started = performance.now()
    addEventListener('keydown', (e) => this.key(e, true))
    addEventListener('keyup', (e) => this.key(e, false))
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const bike = this.deviceType() === 'bike'
    if (e.code === 'Space') { this.coasting = down; e.preventDefault(); return }
    if (!down) { this.held = false; return }
    const big = e.shiftKey ? 4 : 1
    if (e.code === 'ArrowUp') { bike ? (this.watts += 15 * big) : (this.belt += 0.15 * big); e.preventDefault() }
    else if (e.code === 'ArrowDown') { bike ? (this.watts -= 15 * big) : (this.belt -= 0.15 * big); e.preventDefault() }
    else if (e.code === 'KeyP') this.paused_ = !this.paused_
    this.watts = Math.max(0, Math.min(600, this.watts))
    this.belt = Math.max(0, Math.min(6.5, this.belt))
  }

  measured(): Measured {
    const bike = this.deviceType() === 'bike'
    const power = this.coasting ? 0 : this.watts
    return {
      power: bike ? power : null,
      speed: bike ? null : this.coasting ? 0 : this.belt,
      cadence: bike ? (power > 10 ? 85 : 0) : null,
      heartRate: null,
    }
  }

  paused(): boolean { return this.paused_ }
  elapsedSeconds(): number { return (performance.now() - this.started) / 1000 }
  request(gradePercent: number): void { this.grade = gradePercent }
  /** what the machine was last asked for, so the HUD can show request against reality */
  requested(): number { return this.grade }
  ended(): boolean { return false }

  /** what the keyboard is set to, for the HUD */
  setting(): { watts: number; belt: number; coasting: boolean } {
    return { watts: this.watts, belt: this.belt, coasting: this.coasting }
  }
}
