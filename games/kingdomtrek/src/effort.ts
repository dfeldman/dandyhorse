/**
 * The player's workout as one number, effort, where 1.0 is their steady pace (INTEGRATION.md §3). On Dandyhorse it
 * comes from the machine or a heart-rate strap through gamekit's EffortMeter, measured against the steady pace in the
 * player's preferences. Standalone, the player is assumed to pedal steadily. Developers can override it (`[` and `]`,
 * or window.kingdomTrek.setEffort, feed and setTarget).
 */
import { EffortMeter, describeEffort, describeSteady } from '@dandyhorse/gamekit'
import type { DeviceType, EffortReadout, GameState, UnitSystem } from '@dandyhorse/gamekit'

/** Live readings in SI units: m/s, %, rpm, W, bpm. */
export interface EffortReading {
  speed?: number | null
  incline?: number | null
  cadence?: number | null
  power?: number | null
  heartRate?: number | null
}

/** Effort steps for the developer keys: up to 20× steady pace, so testing takes minutes, not hours. */
const LADDER = [0, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10, 20]

const seconds = (): number => performance.now() / 1000

export class EffortSource {
  private override: number | null = null
  /** The real workout: set on the platform, or by a developer's feed() or setTarget(). */
  private meter: EffortMeter | null = null
  private unitSystem: UnitSystem = 'metric'
  /** Lifetime Energy earned when this session started. */
  energyAtStart = 0

  /** Measure the real workout (the platform). */
  attach(meter: EffortMeter, unitSystem: UnitSystem): void {
    this.meter = meter
    this.unitSystem = unitSystem
  }

  /** Every getstate from the platform. */
  update(state: GameState): void {
    this.meter?.update(state, seconds())
  }

  /** Current effort; 1.0 is steady pace. */
  value(): number {
    if (this.override !== null) return this.override
    return this.meter ? this.meter.value(seconds()) : 1
  }

  /** Force an effort (developer tools, tests). null returns to the measured one (or steady pace, standalone). */
  set(effort: number | null): void {
    this.override = effort === null ? null : Math.max(0, Math.min(LADDER[LADDER.length - 1], effort))
  }

  /** One step up or down the developer ladder. */
  nudge(dir: 1 | -1): void {
    const v = this.value()
    const next = dir > 0 ? LADDER.find((x) => x > v + 1e-9) : [...LADDER].reverse().find((x) => x < v - 1e-9)
    this.set(next ?? v)
  }

  /** Developer: live readings, about once a second (each counts for 3 s). Effort then comes from them. */
  feed(reading: EffortReading): void {
    this.meter ??= new EffortMeter({ deviceType: reading.speed != null ? 'treadmill' : 'bike' })
    this.meter.read(reading, seconds())
  }

  /** Developer: the steady pace to measure against: {power} W, {speed, incline} on a treadmill, or {heartRate}. */
  setTarget(target: EffortReading): void {
    const deviceType: DeviceType = this.meter?.deviceType ?? (target.speed != null ? 'treadmill' : 'bike')
    const global = target.speed != null ? { steadyPace: { speed: target.speed, incline: target.incline ?? 0 } }
      : target.heartRate != null ? { steadyHr: target.heartRate }
        : target.power != null ? { steadyWatts: target.power } : {}
    this.meter = new EffortMeter({ deviceType, prefer: target.heartRate != null ? 'heartRate' : 'machine', preferences: { global } })
  }

  /** What the meter is doing; null standalone until a developer feeds it. */
  readout(): EffortReadout | null {
    return this.meter?.readout(seconds()) ?? null
  }

  /** HUD text: the steady pace, and the live reading with effort as a share of it ("140 W · 108%"). */
  describe(): { target: string; now: string } {
    const r = this.readout()
    const forced = this.override !== null ? `${Math.round(this.override * 100)}% (dev)` : null
    if (!r) return { target: 'Steady pace', now: forced ?? `${Math.round(this.value() * 100)}%` }
    return { target: `Steady ${describeSteady(r, this.unitSystem)}`, now: forced ?? describeEffort(r, this.unitSystem) }
  }
}

/** 83 → "1:23"; 3723 → "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
