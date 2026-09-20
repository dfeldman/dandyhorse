/**
 * The game's whole input, abstracted so the platform can supply it later (INTEGRATION.md):
 *   pedal()        effort as 0–100, 50 = the player's steady pace (Dandyhorse: 50 × EffortMeter value)
 *   takePresses()  button taps since the last call (Dandyhorse: a persistent prompt's answers)
 *   press(b)       the on-screen button calls this, so it behaves exactly like a phone tap
 *   paused()       the world freezes while true (Dandyhorse: SessionClient.paused)
 *
 * LocalControls is the stand-in for now: ↑/↓ (or W/S) or the slider set the pedal, Space/H is the horn,
 * digits 1–9 jump the pedal to 10–90, P/Esc pauses. `?pedal=60` holds the pedal (screenshots and tests), and
 * window.setPedalInput(v) sets it from the console, as in the other games.
 */
import { Config } from './config.ts'
import { clamp } from './rng.ts'
import type { ButtonId } from './sim/night.ts'

export interface Controls {
  pedal(): number | null
  takePresses(): ButtonId[]
  press(b: ButtonId): void
  paused(): boolean
  togglePause(): void
  /** Called once a frame. */
  update(dt: number): void
  /** The keyboard/slider harness is showing (the HUD draws the slider). */
  readonly harness: boolean
}

declare global {
  interface Window { setPedalInput?: (v: number) => void }
}

const KEY_RATE = 40 // pedal units per second while an arrow is held

export class LocalControls implements Controls {
  readonly harness: boolean
  private value: number
  private keyDir = 0
  private readonly queue: ButtonId[] = []
  private isPaused = false
  private readonly listeners: ((v: number) => void)[] = []

  constructor(opts: { pedal?: number | null } = {}) {
    this.harness = opts.pedal === undefined || opts.pedal === null
    this.value = opts.pedal ?? 0
    window.setPedalInput = (v) => this.set(v)
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      if (e.repeat && (k === ' ' || k === 'h')) return
      if (k === 'arrowup' || k === 'w') { this.keyDir = 1; e.preventDefault() }
      else if (k === 'arrowdown' || k === 's') { this.keyDir = -1; e.preventDefault() }
      else if (k === ' ' || k === 'h') { this.press('horn'); e.preventDefault() }
      else if (k === 'p' || k === 'escape') this.togglePause()
      else if (/^[0-9]$/.test(k)) this.set(k === '0' ? 100 : Number(k) * 10)
    })
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase()
      if ((k === 'arrowup' || k === 'w') && this.keyDir === 1) this.keyDir = 0
      if ((k === 'arrowdown' || k === 's') && this.keyDir === -1) this.keyDir = 0
    })
  }

  /** The HUD's slider listens here. */
  onChange(fn: (v: number) => void): void { this.listeners.push(fn) }

  set(v: number): void {
    this.value = clamp(v, 0, Config.PEDAL_MAX)
    for (const fn of this.listeners) fn(this.value)
  }

  pedal(): number | null { return this.value }

  takePresses(): ButtonId[] { return this.queue.splice(0) }

  press(b: ButtonId): void { if (!this.isPaused) this.queue.push(b) }

  paused(): boolean { return this.isPaused }

  togglePause(): void { this.isPaused = !this.isPaused }

  update(dt: number): void {
    if (this.keyDir !== 0) this.set(this.value + this.keyDir * KEY_RATE * dt)
  }
}
