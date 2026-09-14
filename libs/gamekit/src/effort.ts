/**
 * Effort: one number from the workout, where 1.0 is the player's own steady pace, on any machine. For games that pace
 * their world by how hard the player works for them rather than by raw watts or speed (Kingdom Trek): a beginner at
 * 100 W and a fit rider at 200 W both earn 1.0 when they go at their comfortable pace.
 *
 *   effort = live ÷ steady
 *
 * - treadmill: speed and incline as bike-equivalent watts (treadmillWatts) ÷ steady watts;
 * - any other machine (a bike today; a rower or an elliptical when the platform has them): measured power ÷ steady
 *   watts;
 * - heart rate: heart-rate reserve, (hr − resting) ÷ (steady hr − resting);
 * - cadence ÷ 80 rpm, capped, as a last resort for a machine that reports neither power nor heart rate (a bike's
 *   pedaling rate; a rower's stroke rate would need its own).
 *
 * Steady comes from the player's preferences (steadyWatts, steadyPace, ftp, restingHr, steadyHr, maxHr, hrZones:
 * docs/GAME_AUTHORING.md "Effort"). Pure functions, plus EffortMeter, which follows getstate and applies what every
 * game should do alike: hold a reading between polls, smooth it, cap it, drop to 0 after 3 s without data, fall back
 * to another source when the chosen one reads nothing, and let the machine veto heart rate when you have stopped.
 */
import type { BodyData, DeviceType, GameState, Json, UnitSystem } from './types.ts'
import * as units from './units.ts'

export const DEFAULT_WEIGHT_KG = 75
/** When the player has set nothing: "Regular". */
export const DEFAULT_STEADY_WATTS = 130
/** The console's Fitness choice (steadyWatts). */
export const FITNESS_LEVELS = [
  { id: 'starting', label: 'Starting out', watts: 100 },
  { id: 'regular', label: 'Regular', watts: 130 },
  { id: 'fit', label: 'Fit', watts: 160 },
  { id: 'veryfit', label: 'Very fit', watts: 200 },
] as const
/** Steady from FTP when only FTP is set: the middle of the endurance zone. */
export const FTP_TO_STEADY = 0.65
export const DEFAULT_RESTING_HR = 60
/** Effort never goes above this, so a 1000 W spike or a glitch can't win a fight in a second. */
export const EFFORT_CAP = 3
/** Cadence can't see the resistance, so it earns at most this much. */
export const CADENCE_CAP = 1.5
export const STEADY_CADENCE = 80
/** A reading is held this long; with nothing newer, effort is 0. Never hold a stale number. */
export const HOLD_SECONDS = 3
/** Belt speeds below this are a stopped belt (m/s). */
const STOPPED_SPEED = 0.05

export type EffortSourceKind = 'power' | 'treadmill' | 'heartRate' | 'cadence' | 'none'
/** Smoothing time constants in seconds: a sprint on the bike still shows within 2–3 s; heart rate lags enough already. */
export const SMOOTHING: Record<EffortSourceKind, number> = { power: 3, treadmill: 1, cadence: 2, heartRate: 0, none: 0 }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const positive = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}

// --- treadmill ------------------------------------------------------------------------------------

/** Pure walking up to this speed, pure running from RUN_FROM, blended in between (m/s). */
const WALK_UP_TO = 1.6
const RUN_FROM = 2.2

/**
 * A treadmill reading as bike-equivalent watts, so one steady number works on both machines: the ACSM oxygen cost of
 * walking (0.1 ml/kg per metre + 1.8 × grade) or running (0.2 + 0.9 × grade) without the resting term, so a stopped
 * belt reads 0, × 20.9 J per ml × 0.24 (the pedaling efficiency the server assumes for bikes):
 *
 *   walking  W = m · v · (0.50 + 9.0 · g)      running  W = m · v · (1.00 + 4.5 · g)
 *
 * ACSM switches formulas at 1.8 m/s, which would double effort between 6.4 and 6.5 km/h; blending over 1.6–2.2 m/s
 * keeps it smooth. A decline counts as flat. 75 kg when the weight is unknown. Null when there is no speed.
 */
export function treadmillWatts(speed: number | null | undefined, inclinePct: number | null | undefined, weightKg?: number | null): number | null {
  const v0 = num(speed)
  if (v0 === null) return null
  const v = Math.max(0, v0)
  const g = Math.max(0, (num(inclinePct) ?? 0) / 100)
  const m = positive(weightKg) ?? DEFAULT_WEIGHT_KG
  const walk = m * v * (0.5 + 9.0 * g)
  const run = m * v * (1.0 + 4.5 * g)
  if (v <= WALK_UP_TO) return walk
  if (v >= RUN_FROM) return run
  const f = (v - WALK_UP_TO) / (RUN_FROM - WALK_UP_TO)
  return walk * (1 - f) + run * f
}

// --- steady pace ------------------------------------------------------------------------------------

/** A treadmill pace: belt speed in m/s and incline in percent. */
export interface SteadyPace {
  speed: number
  incline: number
}

export type SteadySource = 'device pace' | 'device' | 'pace' | 'watts' | 'ftp' | 'default'

export interface Steady {
  watts: number
  source: SteadySource
  /** Set when steady came from a treadmill pace (show it that way: treadmill users know their pace, not watts). */
  pace: SteadyPace | null
}

/** The start payload's `preferences` (the `device` block may be refreshed from getstate.devicePreferences). */
export interface EffortPreferences {
  global?: Json | null
  device?: Json | null
}

export function paceOf(v: unknown): SteadyPace | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const speed = positive(o.speed)
  return speed === null ? null : { speed, incline: Math.max(0, num(o.incline) ?? 0) }
}

/**
 * The player's steady pace in watts, most specific first. On a treadmill: the machine's `steadyPace`, the machine's
 * `steadyWatts`, the player's `steadyPace`, the player's `steadyWatts`. On a bike: the machine's `steadyWatts`, then
 * the player's. Then 0.65 × `ftp`, then 130 W. A pace is turned into watts with the same formula as the live reading,
 * at the same weight, so the weight cancels out of effort.
 */
export function steadyWatts(prefs: EffortPreferences, deviceType: DeviceType, weightKg?: number | null): Steady {
  const dev = prefs.device ?? {}
  const glo = prefs.global ?? {}
  const tread = deviceType === 'treadmill'
  const fromPace = (p: SteadyPace | null, source: SteadySource): Steady | null => {
    const w = p ? treadmillWatts(p.speed, p.incline, weightKg) : null
    return p && w !== null && w > 0 ? { watts: w, source, pace: p } : null
  }
  const watts = (v: unknown, source: SteadySource): Steady | null => {
    const w = positive(v)
    return w === null ? null : { watts: w, source, pace: null }
  }
  const ftp = positive(glo.ftp)
  return (tread ? fromPace(paceOf(dev.steadyPace), 'device pace') : null)
    ?? watts(dev.steadyWatts, 'device')
    ?? (tread ? fromPace(paceOf(glo.steadyPace), 'pace') : null)
    ?? watts(glo.steadyWatts, 'watts')
    ?? (ftp !== null ? { watts: FTP_TO_STEADY * ftp, source: 'ftp', pace: null } : null)
    ?? { watts: DEFAULT_STEADY_WATTS, source: 'default', pace: null }
}

// --- heart rate -------------------------------------------------------------------------------------

export interface SteadyHeart {
  resting: number
  steady: number
  source: 'set' | 'zones' | 'max' | 'age' | 'default'
}

/** The top of zone `i` (0 = zone 1) from `hrZones`: an array of zones, each its top bpm or `{max}`. */
function zoneTop(zones: unknown, i: number): number | null {
  if (!Array.isArray(zones)) return null
  const z: unknown = zones[i]
  return positive(z && typeof z === 'object' ? (z as Record<string, unknown>).max : z)
}

/**
 * Resting and steady heart rate: `restingHr` (60 by default); `steadyHr` if set, else the top of zone 2 from
 * `hrZones`, else resting + 0.6 × (max − resting) with `maxHr`, or 208 − 0.7 × age, or 180. Resting 60 and max 180
 * give 132.
 */
export function steadyHeartRate(global: Json | null | undefined, body?: BodyData | null): SteadyHeart {
  const g = global ?? {}
  const r = num(g.restingHr)
  const resting = r !== null && r >= 30 && r <= 110 ? r : DEFAULT_RESTING_HR
  const set = positive(g.steadyHr)
  if (set !== null && set > resting + 5) return { resting, steady: set, source: 'set' }
  const z2 = zoneTop(g.hrZones, 1)
  if (z2 !== null && z2 > resting + 5) return { resting, steady: z2, source: 'zones' }
  const max = positive(g.maxHr)
  const age = positive(body?.age)
  const top = max ?? (age !== null ? 208 - 0.7 * age : 180)
  return { resting, steady: resting + 0.6 * (top - resting), source: max !== null ? 'max' : age !== null ? 'age' : 'default' }
}

/** Heart-rate reserve: sitting still reads about 0, steady reads 1. */
export function heartRateEffort(hr: number | null | undefined, heart: SteadyHeart): number | null {
  const h = num(hr)
  if (h === null) return null
  return Math.max(0, (h - heart.resting) / Math.max(1, heart.steady - heart.resting))
}

// --- the meter ----------------------------------------------------------------------------------------

/** Which reading turns into effort: the machine (the default), or heart rate. The other is the fallback. */
export type EffortPreference = 'machine' | 'heartRate'

export interface Readings {
  power: number | null
  cadence: number | null
  speed: number | null
  /** Treadmill incline: actual, else commanded (a machine that doesn't report it but was told it). */
  incline: number | null
  heartRate: number | null
}

export interface EffortMeterOptions {
  deviceType: DeviceType
  prefer?: EffortPreference
  weightKg?: number | null
  bodyData?: BodyData | null
  preferences?: EffortPreferences
  /** Seconds of smoothing per source, over SMOOTHING (0: none). A game that needs the least lag, and smooths
   *  on its own, turns power's off (Flight Cycle: games/bikeplane/PLAYABILITY.md). */
  smoothing?: Partial<Record<EffortSourceKind, number>>
}

/** What the meter is doing right now, for a HUD. */
export interface EffortReadout extends Readings {
  /** Capped and smoothed; 0 when nothing reads. */
  effort: number
  source: EffortSourceKind
  /** Bike-equivalent watts of the treadmill reading. */
  watts: number | null
  /** Set when effort is not coming from the chosen source: "No power reading: using heart rate". */
  note: string | null
  /** False when the machine says you have stopped (heart rate then earns nothing); null when it doesn't say. */
  moving: boolean | null
  steady: Steady
  heart: SteadyHeart
}

const EMPTY: Readings = { power: null, cadence: null, speed: null, incline: null, heartRate: null }
const SOURCE_WORD: Record<EffortSourceKind, string> = { power: 'power', treadmill: 'treadmill', heartRate: 'heart rate', cadence: 'cadence', none: 'machine' }

export class EffortMeter {
  readonly deviceType: DeviceType
  readonly prefer: EffortPreference
  steady: Steady
  readonly heart: SteadyHeart
  private readonly weightKg: number | null
  private prefs: EffortPreferences
  /** Last usable raw effort per source, and when it was read. */
  private held = new Map<EffortSourceKind, { raw: number; at: number }>()
  /** Last non-null value of each reading, and when. */
  private seen = new Map<keyof Readings, { v: number; at: number }>()
  private smoothed = 0
  private lastAt: number | null = null
  private source: EffortSourceKind = 'none'
  private machineAt = -Infinity
  private machineMoving: boolean | null = null
  private readonly smoothing: Record<EffortSourceKind, number>

  constructor(opts: EffortMeterOptions) {
    this.deviceType = opts.deviceType
    this.smoothing = { ...SMOOTHING, ...opts.smoothing }
    this.prefer = opts.prefer ?? 'machine'
    this.weightKg = positive(opts.weightKg) ?? positive(opts.bodyData?.weight)
    this.prefs = { global: opts.preferences?.global ?? {}, device: opts.preferences?.device ?? {} }
    this.steady = steadyWatts(this.prefs, this.deviceType, this.weightKg)
    this.heart = steadyHeartRate(this.prefs.global, opts.bodyData)
  }

  /** Follow the machine that is connected now (getstate.devicePreferences); the start payload's may be empty. */
  setDevicePreferences(device: Json | null | undefined): void {
    if (!device || !Object.keys(device).length) return
    this.prefs = { ...this.prefs, device }
    this.steady = steadyWatts(this.prefs, this.deviceType, this.weightKg)
  }

  /** Feed one getstate (about once a second). `now`: seconds on any steady clock (the same one value() gets). */
  update(state: GameState, now: number): void {
    this.setDevicePreferences(state.devicePreferences)
    this.read({
      power: state.power?.actual ?? null,
      cadence: state.cadence?.actual ?? null,
      speed: state.speed?.actual ?? null,
      incline: state.incline?.actual ?? state.incline?.commanded ?? null,
      heartRate: state.heartRate?.actual ?? null,
    }, now)
  }

  /** Feed raw readings (SI units): tests, or a game with its own transport. */
  read(r: Partial<Readings>, now: number): void {
    const tread = this.deviceType === 'treadmill'
    const readings = { ...EMPTY, ...r }
    for (const k of Object.keys(EMPTY) as (keyof Readings)[]) {
      const v = num(readings[k])
      if (v !== null) this.seen.set(k, { v, at: now })
    }
    const raw: [EffortSourceKind, number | null][] = [
      ['power', !tread && readings.power != null ? Math.max(0, readings.power) / this.steady.watts : null],
      ['treadmill', tread ? ratio(treadmillWatts(readings.speed, readings.incline, this.weightKg), this.steady.watts) : null],
      ['cadence', !tread && readings.cadence != null ? Math.min(CADENCE_CAP, Math.max(0, readings.cadence) / STEADY_CADENCE) : null],
      ['heartRate', heartRateEffort(readings.heartRate, this.heart)],
    ]
    for (const [k, v] of raw) if (v !== null && Number.isFinite(v)) this.held.set(k, { raw: v, at: now })

    // The machine says whether you're moving: 0 W and 0 rpm, or a stopped belt.
    const machine = tread ? readings.speed != null : readings.power != null || readings.cadence != null
    if (machine) {
      this.machineAt = now
      this.machineMoving = tread ? (readings.speed ?? 0) > STOPPED_SPEED : (readings.power ?? 0) > 0 || (readings.cadence ?? 0) > 0
    }

    const src = this.pick(now)
    const target = src === 'none' ? 0 : this.held.get(src)!.raw
    const dt = this.lastAt === null ? Infinity : Math.max(0, now - this.lastAt)
    const tau = this.smoothing[src]
    this.smoothed = tau > 0 && Number.isFinite(dt) && src === this.source
      ? this.smoothed + (target - this.smoothed) * (1 - Math.exp(-dt / tau))
      : target
    this.lastAt = now
    this.source = src
  }

  /** Effort now: the last reading held between polls, 0 once it is older than 3 s, never above the cap. */
  value(now: number): number {
    if (this.source === 'none') return 0
    const h = this.held.get(this.source)
    if (!h || now - h.at > HOLD_SECONDS) return 0
    if (this.source === 'heartRate' && this.stopped(now)) return 0
    return Math.min(EFFORT_CAP, Math.max(0, this.smoothed))
  }

  readout(now: number): EffortReadout {
    const fresh = (k: keyof Readings): number | null => {
      const s = this.seen.get(k)
      return s && now - s.at <= HOLD_SECONDS ? s.v : null
    }
    const src = this.value(now) > 0 || this.fresh(this.source, now) ? this.source : 'none'
    const speed = fresh('speed')
    const incline = fresh('incline')
    return {
      effort: this.value(now),
      source: src,
      note: this.note(src),
      power: fresh('power'),
      cadence: fresh('cadence'),
      speed,
      incline,
      heartRate: fresh('heartRate'),
      watts: this.deviceType === 'treadmill' ? treadmillWatts(speed, incline, this.weightKg) : null,
      moving: now - this.machineAt <= HOLD_SECONDS ? this.machineMoving : null,
      steady: this.steady,
      heart: this.heart,
    }
  }

  private fresh(k: EffortSourceKind, now: number): boolean {
    const h = this.held.get(k)
    return !!h && now - h.at <= HOLD_SECONDS
  }

  /** The machine says you stopped (and it is still saying something). Heart rate stays up for a minute after. */
  private stopped(now: number): boolean {
    return now - this.machineAt <= HOLD_SECONDS && this.machineMoving === false
  }

  /** The preferred source while it reads (or read within the hold), else the next that does. */
  private pick(now: number): EffortSourceKind {
    const tread = this.deviceType === 'treadmill'
    const machine: EffortSourceKind = tread ? 'treadmill' : 'power'
    const order: EffortSourceKind[] = this.prefer === 'heartRate' ? ['heartRate', machine] : [machine, 'heartRate']
    if (!tread) order.push('cadence')
    return order.find((k) => this.fresh(k, now)) ?? 'none'
  }

  private note(src: EffortSourceKind): string | null {
    const want: EffortSourceKind = this.prefer === 'heartRate' ? 'heartRate' : this.deviceType === 'treadmill' ? 'treadmill' : 'power'
    if (src === want) return null
    const missing = want === 'treadmill' ? 'No treadmill reading' : `No ${SOURCE_WORD[want]} reading`
    if (src === 'none') return missing
    if (src === 'cadence') return `${missing}: using cadence, a rough guess`
    return `${missing}: using ${src === 'heartRate' ? 'heart rate' : 'the machine'}`
  }
}

function ratio(w: number | null, steady: number): number | null {
  return w === null ? null : w / steady
}

// --- words for a HUD ----------------------------------------------------------------------------------

const pct = (x: number): string => `${Math.round(x * 100)}%`
const incline = (x: number | null): string => `${+(x ?? 0).toFixed(1)}%`

/** "140 W · 108%", "6.0 km/h · 3% · 98%", "132 bpm · 100%", "85 rpm · 106%"; "—" with nothing to read. */
export function describeEffort(r: EffortReadout, sys: UnitSystem): string {
  switch (r.source) {
    case 'power': return `${units.power(r.power).text} · ${pct(r.effort)}`
    case 'treadmill': return `${units.speed(r.speed, sys).text} · ${incline(r.incline)} · ${pct(r.effort)}`
    case 'heartRate': return `${units.heartRate(r.heartRate).text} · ${pct(r.effort)}`
    case 'cadence': return `${units.cadence(r.cadence).text} · ${pct(r.effort)}`
    default: return '—'
  }
}

/** The steady pace in the player's terms: "132 bpm" on heart rate, "6.0 km/h · 3%" from a pace, else "130 W". */
export function describeSteady(r: EffortReadout, sys: UnitSystem): string {
  if (r.source === 'heartRate') return units.heartRate(r.heart.steady).text
  if (r.steady.pace) return `${units.speed(r.steady.pace.speed, sys).text} · ${incline(r.steady.pace.incline)}`
  return units.power(r.steady.watts).text
}
