/**
 * One ship's night: it appears on the horizon, sails in, comes under the lamp's watch (approach, then the channel
 * between the rocks), and docks. While on watch it drifts toward the rocks whenever the lamp is too dim for it, and
 * comes back when the lamp is bright. On the rocks it loses hull; with no hull left it runs aground and waits for a tug.
 *
 * Drift is in channel half-widths: 0 = on the leading line, 1 = touching the rocks.
 */
import { Config } from '../config.ts'
import { smoothstep } from '../rng.ts'
import { FLEET, type ShipKind } from './fleet.ts'
import type { ShipPlan } from './schedule.ts'

export type ShipState =
  | 'due' // not in sight yet
  | 'inbound' // on the horizon, sailing in
  | 'approach' // on watch, open water
  | 'channel' // on watch, between the rocks
  | 'harbor' // past the rocks, heading for its mooring
  | 'moored'
  | 'aground'
  | 'towed' // a tug is bringing it in
  | 'leaving' // making room in the harbour
  | 'gone'

/** DRIFT_LINE read at a deficit: where a ship settles with the lamp this far below its need. */
export function driftLine(deficit: number): number {
  const c = Config.DRIFT_LINE
  if (deficit <= c[0]![0]) return c[0]![1]
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = c[i]!
    if (deficit <= x1) {
      const [x0, y0] = c[i - 1]!
      return y0 + ((y1 - y0) * (deficit - x0)) / (x1 - x0)
    }
  }
  return c[c.length - 1]![1]
}

export interface DriftEnv {
  /** How far the lamp's power is below this ship's need (pedal units; negative = above). */
  deficit: number
  /** Storm push this moment, −0.3..1 (0 without a storm). */
  gust: number
}

export class Ship {
  state: ShipState = 'due'
  /** Path progress: 0 horizon, 1 watch starts, 2 channel, 3 channel's end, 4 moored. */
  u = 0
  drift = 0
  driftVel = 0
  maxDrift = 0
  hull = 1
  scraped = false
  onRocks = false
  /** 0–3 once the watch is over (0 = aground). */
  stars: number | null = null
  calmUntil = -1
  hail: { opened: number; answered: boolean; missed: boolean } | null = null
  mooring = -1
  mooredAt = -1
  /** When it ran aground / the tug started / it started leaving (night time). */
  groundedAt = -1
  towStart = -1
  leaveStart = -1
  warned = false
  /** Last scrape event (night time), so they come at most every 0.8 s. */
  scrapeAt = -9

  readonly plan: ShipPlan

  constructor(plan: ShipPlan) { this.plan = plan }

  get id(): number { return this.plan.id }
  get name(): string { return this.plan.name }
  get kind(): ShipKind { return FLEET[this.plan.kind] }
  get watching(): boolean { return this.state === 'approach' || this.state === 'channel' }
  get visible(): boolean { return this.state !== 'due' && this.state !== 'gone' }

  /** The lamp target this ship asks for at t: it climbs from rest over the first seconds of the watch. */
  needAt(t: number): number {
    const p = this.plan
    return Config.REST_TARGET + (p.need - Config.REST_TARGET) * smoothstep(p.watchStart, p.watchStart + Config.TARGET_RAMP, t)
  }

  /** Where it should be on the timetable at t (ships that ran aground or left follow their own clocks). */
  scheduledState(t: number): { state: ShipState; u: number } {
    const p = this.plan
    const hu = Config.HEADS_UP
    if (t < p.watchStart - hu) return { state: 'due', u: 0 }
    if (t < p.watchStart) return { state: 'inbound', u: (t - (p.watchStart - hu)) / hu }
    if (t < p.approachEnd) return { state: 'approach', u: 1 + (t - p.watchStart) / (p.approachEnd - p.watchStart) }
    if (t < p.watchEnd) return { state: 'channel', u: 2 + (t - p.approachEnd) / (p.watchEnd - p.approachEnd) }
    if (t < p.watchEnd + Config.HARBOR_TIME) return { state: 'harbor', u: 3 + (t - p.watchEnd) / Config.HARBOR_TIME }
    return { state: 'moored', u: 4 }
  }

  /**
   * Drift for one step on watch. Returns 'scrape' while on the rocks and 'aground' when the hull gives out.
   */
  stepDrift(t: number, dt: number, env: DriftEnv): 'ok' | 'scrape' | 'aground' {
    const channel = this.state === 'channel'
    let want: number
    if (t < this.calmUntil) {
      want = -Config.RECOVER
    } else {
      const line = driftLine(env.deficit)
      if (line > this.drift) {
        want = Math.min(Config.DRIFT_MAX_OUT, (line - this.drift) / Config.DRIFT_TIME_OUT)
        if (!channel) want *= Config.APPROACH_DRIFT
      } else {
        want = -Math.min(Config.DRIFT_MAX_BACK, (this.drift - line) / Config.DRIFT_TIME_BACK + Config.SURPLUS_BACK * Math.max(0, -env.deficit))
      }
      want += Config.GUST * env.gust * (env.deficit > 0 ? 1 : 0.3)
    }
    this.driftVel += (want - this.driftVel) * (1 - Math.exp(-dt / Config.DRIFT_TAU))
    this.drift += this.driftVel * dt
    if (this.drift <= 0) {
      this.drift = 0
      if (this.driftVel < 0) this.driftVel = 0
    }
    const cap = channel ? Config.DRIFT_CAP : Config.APPROACH_CAP
    if (this.drift >= cap) {
      this.drift = cap
      if (this.driftVel > 0) this.driftVel = 0
    }
    this.maxDrift = Math.max(this.maxDrift, this.drift)
    this.onRocks = channel && this.drift >= 1
    if (!this.onRocks) return 'ok'
    this.scraped = true
    const hard = (this.drift - 1) / (Config.DRIFT_CAP - 1)
    this.hull -= Config.SCRAPE_RATE * (0.25 + 0.75 * hard) * dt
    if (this.hull > 0) return 'scrape'
    this.hull = 0
    return 'aground'
  }

  /** Stars for a finished watch. */
  score(): number {
    if (this.scraped) return 1
    return this.maxDrift <= Config.STAR3_DRIFT ? 3 : 2
  }
}
