// The Fitness setting: the player's steady pace, which effort-paced games (Kingdom Trek) divide the workout by
// (games/kingdomtrek/INTEGRATION.md §3). The rules mirror how libs/gamekit/src/effort.ts reads the preferences
// (steadyWatts(), steadyHeartRate()) so the Fitness panel can say what the game will use: keep the two in step.
// Pure helpers (no DOM, unit-tested).
import type { GlobalPreferences, SteadyPace, UnitSystem } from './types'
import * as u from './units'

/** When the player has set nothing: "Regular". */
export const DEFAULT_STEADY_WATTS = 130
/** Steady from FTP when only FTP is set: the middle of the endurance zone. */
export const FTP_TO_STEADY = 0.65
export const DEFAULT_RESTING_HR = 60

export interface FitnessLevel {
  id: string
  label: string
  watts: number
  /** About the same effort on a treadmill for a 75 kg person (INTEGRATION.md §3.3). */
  treadmill: { kmh: number; incline: number; gait: 'walk' | 'jog' | 'run' }
}

/** The four big buttons (gamekit FITNESS_LEVELS). */
export const FITNESS_LEVELS: FitnessLevel[] = [
  { id: 'starting', label: 'Starting out', watts: 100, treadmill: { kmh: 5, incline: 5, gait: 'walk' } },
  { id: 'regular', label: 'Regular', watts: 130, treadmill: { kmh: 6, incline: 6, gait: 'walk' } },
  { id: 'fit', label: 'Fit', watts: 160, treadmill: { kmh: 8, incline: 0, gait: 'jog' } },
  { id: 'veryfit', label: 'Very fit', watts: 200, treadmill: { kmh: 10, incline: 0, gait: 'run' } },
]

/** A number from a form field or a stored preference, else null (a cleared number input gives '', not null). */
export function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Above zero, else null: the game ignores zero and negative steady values. */
export function positiveOrNull(v: unknown): number | null {
  const n = numberOrNull(v)
  return n !== null && n > 0 ? n : null
}

/** "a 5 km/h walk up 5%", "jogging at 8 km/h", in the player's units. */
export function levelHint(l: FitnessLevel, sys: UnitSystem): string {
  const s = u.speed(l.treadmill.kmh / u.KMH_PER_MS, sys, 1).text
  if (l.treadmill.gait === 'walk') return `a ${s} walk up ${l.treadmill.incline}%`
  return l.treadmill.gait === 'jog' ? `jogging at ${s}` : `running at ${s}`
}

/** A stored steady pace as the game reads it: null without a speed above 0; a missing or negative incline is 0. */
export function paceOf(v: unknown): SteadyPace | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const speed = positiveOrNull(o.speed)
  return speed === null ? null : { speed, incline: Math.max(0, numberOrNull(o.incline) ?? 0) }
}

/** A steady pace from form fields (speed in km/h or mph, incline in %), in m/s; null when the speed is blank. */
export function paceFromForm(speed: unknown, incline: unknown, sys: UnitSystem): SteadyPace | null {
  const ms = u.speedToSI(positiveOrNull(speed), sys)
  return ms === null ? null : { speed: ms, incline: Math.max(0, numberOrNull(incline) ?? 0) }
}

/** "6.0 km/h at 3%". */
export function paceText(p: SteadyPace, sys: UnitSystem): string {
  const s = u.speed(p.speed, sys, 1)
  return `${(s.value ?? 0).toFixed(1)} ${s.unit} at ${+p.incline.toFixed(1)}%`
}

/** Steady watts from the global preferences, as the game reads them on a bike (and on a treadmill with no pace). */
export function globalSteadyWatts(prefs: GlobalPreferences): { watts: number; source: 'watts' | 'ftp' | 'default' } {
  const watts = positiveOrNull(prefs.steadyWatts)
  if (watts !== null) return { watts, source: 'watts' }
  const ftp = positiveOrNull(prefs.ftp)
  if (ftp !== null) return { watts: FTP_TO_STEADY * ftp, source: 'ftp' }
  return { watts: DEFAULT_STEADY_WATTS, source: 'default' }
}

/**
 * What the game will use as steady, from the global preferences (a machine's own setting wins on that machine):
 * "145 W", "160 W (Fit)", "0.65 × your FTP = 163 W", "130 W (Regular, the default: pick yours)", and with a
 * treadmill pace "145 W; on a treadmill, 6.0 km/h at 3%". Same order as gamekit steadyWatts(): on a treadmill
 * steadyPace, then steadyWatts, 0.65 × ftp, 130 W; on a bike the same without the pace.
 */
export function steadyText(prefs: GlobalPreferences, sys: UnitSystem): string {
  const s = globalSteadyWatts(prefs)
  const level = FITNESS_LEVELS.find((l) => l.watts === s.watts)
  const watts = s.source === 'default' ? `${u.power(s.watts).text} (Regular, the default: pick yours)`
    : s.source === 'ftp' ? `${FTP_TO_STEADY} × your FTP = ${u.power(s.watts).text}`
    : level ? `${u.power(s.watts).text} (${level.label})`
    : u.power(s.watts).text
  const pace = paceOf(prefs.steadyPace)
  return pace ? `${watts}; on a treadmill, ${paceText(pace, sys)}` : watts
}

export interface SteadyHeart {
  resting: number
  steady: number
  source: 'set' | 'zones' | 'max' | 'age' | 'default'
}

/** The top of zone `i` (0 = zone 1) from `hrZones`: an array of zones, each its top bpm or `{max}`. */
function zoneTop(zones: unknown, i: number): number | null {
  if (!Array.isArray(zones)) return null
  const z: unknown = zones[i]
  return positiveOrNull(z && typeof z === 'object' ? (z as Record<string, unknown>).max : z)
}

/**
 * Resting and steady heart rate as the game reads them (gamekit steadyHeartRate()): `restingHr` (30–110, else 60);
 * `steadyHr` if above resting + 5, else the top of zone 2 from `hrZones`, else resting + 0.6 × (max − resting) with
 * `maxHr`, or 208 − 0.7 × age, or 180. Resting 60 and max 180 give 132.
 */
export function steadyHeartRate(prefs: GlobalPreferences, age?: number | null): SteadyHeart {
  const r = numberOrNull(prefs.restingHr)
  const resting = r !== null && r >= 30 && r <= 110 ? r : DEFAULT_RESTING_HR
  const set = positiveOrNull(prefs.steadyHr)
  if (set !== null && set > resting + 5) return { resting, steady: set, source: 'set' }
  const z2 = zoneTop(prefs.hrZones, 1)
  if (z2 !== null && z2 > resting + 5) return { resting, steady: z2, source: 'zones' }
  const max = positiveOrNull(prefs.maxHr)
  const years = positiveOrNull(age)
  const top = max ?? (years !== null ? 208 - 0.7 * years : 180)
  return { resting, steady: resting + 0.6 * (top - resting), source: max !== null ? 'max' : years !== null ? 'age' : 'default' }
}
