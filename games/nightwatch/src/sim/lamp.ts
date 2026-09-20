/**
 * The lamp: the player's effort spins a flywheel (power), and the lamp is as bright as power is close to the
 * target. Effort above the target builds steam for the horn.
 */
import { Config } from '../config.ts'
import { clamp, smoothstep } from '../rng.ts'

export class Lamp {
  /** Flywheel speed, in pedal units. */
  power = 0
  /** Brightness against the current target, 0–1. */
  brightness = 0
  target: number = Config.REST_TARGET
  /** Horn charges, fractional while building. */
  steam: number = Config.STEAM_START
  private lastPedal = 0

  /** Brightness this power gives against a given need. */
  brightnessFor(need: number): number {
    return 1 - smoothstep(0, Config.LAMP_FADE, need - this.power)
  }

  /** Returns how many whole charges were gained this step. */
  step(dt: number, pedal: number | null, target: number): number {
    // no reading yet (or a dropout): hold the last pedal, never treat it as zero
    const p = clamp(pedal ?? this.lastPedal, 0, Config.PEDAL_MAX)
    this.lastPedal = p
    const tau = p > this.power ? Config.FLY_UP : Config.FLY_DOWN
    this.power += (p - this.power) * (1 - Math.exp(-dt / tau))
    this.target = target
    this.brightness = this.brightnessFor(target)
    const surplus = this.power - Math.max(target, Config.STEAM_FLOOR)
    const before = Math.floor(this.steam)
    if (surplus > 0 && this.steam < Config.STEAM_MAX) {
      this.steam = Math.min(Config.STEAM_MAX, this.steam + surplus * Config.STEAM_RATE * dt)
    }
    return Math.floor(this.steam) - before
  }

  spend(): boolean {
    if (this.steam < 1) return false
    this.steam -= 1
    return true
  }

  get charges(): number { return Math.floor(this.steam + 1e-9) }
}
