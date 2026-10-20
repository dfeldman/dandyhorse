// Display-layer unit conversion. Storage/API are SI: m, s, kg, m/s, J, W, percent.
import type { UnitSystem } from './types'

export const KM_PER_M = 0.001
export const MI_PER_M = 1 / 1609.344
export const KMH_PER_MS = 3.6
export const MPH_PER_MS = 2.2369362920544
export const FT_PER_M = 3.280839895013123
export const LB_PER_KG = 2.2046226218487757
export const IN_PER_M = 39.37007874015748
export const J_PER_KCAL = 4184

export interface Quantity {
  value: number | null
  unit: string
  /** Text with the unit appended, or a dash when null. */
  text: string
}

export function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

function fmt(v: number | null, digits: number, unit: string): Quantity {
  if (v === null || v === undefined || Number.isNaN(v)) return { value: null, unit, text: '—' }
  const r = round(v, digits)
  return { value: r, unit, text: `${r.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`.trim() }
}

// --- to display -------------------------------------------------------------

/** Distance in m → km or mi. */
export function distance(m: number | null, sys: UnitSystem, digits = 2): Quantity {
  if (m === null) return fmt(null, digits, sys === 'us' ? 'mi' : 'km')
  return sys === 'us' ? fmt(m * MI_PER_M, digits, 'mi') : fmt(m * KM_PER_M, digits, 'km')
}

/** Short distance in m → m or ft (elevation, position). */
export function length(m: number | null, sys: UnitSystem, digits = 0): Quantity {
  if (m === null) return fmt(null, digits, sys === 'us' ? 'ft' : 'm')
  return sys === 'us' ? fmt(m * FT_PER_M, digits, 'ft') : fmt(m, digits, 'm')
}

/** Speed in m/s → km/h or mph. */
export function speed(ms: number | null, sys: UnitSystem, digits = 1): Quantity {
  if (ms === null) return fmt(null, digits, sys === 'us' ? 'mph' : 'km/h')
  return sys === 'us' ? fmt(ms * MPH_PER_MS, digits, 'mph') : fmt(ms * KMH_PER_MS, digits, 'km/h')
}

/** Mass in kg → kg or lb. */
export function mass(kg: number | null, sys: UnitSystem, digits = 1): Quantity {
  if (kg === null) return fmt(null, digits, sys === 'us' ? 'lb' : 'kg')
  return sys === 'us' ? fmt(kg * LB_PER_KG, digits, 'lb') : fmt(kg, digits, 'kg')
}

/** Height in m → cm or in. */
export function height(m: number | null, sys: UnitSystem, digits = 0): Quantity {
  if (m === null) return fmt(null, digits, sys === 'us' ? 'in' : 'cm')
  return sys === 'us' ? fmt(m * IN_PER_M, digits, 'in') : fmt(m * 100, digits, 'cm')
}

/** Energy in J → kcal (both systems). */
export function energy(j: number | null, _sys?: UnitSystem, digits = 0): Quantity {
  if (j === null) return fmt(null, digits, 'kcal')
  return fmt(j / J_PER_KCAL, digits, 'kcal')
}

export function power(w: number | null, digits = 0): Quantity {
  return fmt(w, digits, 'W')
}

export function heartRate(bpm: number | null, digits = 0): Quantity {
  return fmt(bpm, digits, 'bpm')
}

export function percent(p: number | null, digits = 1): Quantity {
  return fmt(p, digits, '%')
}

/** Acceleration limit m/s² → km/h/s or mph/s. */
export function accel(ms2: number | null, sys: UnitSystem, digits = 2): Quantity {
  if (ms2 === null) return fmt(null, digits, sys === 'us' ? 'mph/s' : 'km/h/s')
  return sys === 'us' ? fmt(ms2 * MPH_PER_MS, digits, 'mph/s') : fmt(ms2 * KMH_PER_MS, digits, 'km/h/s')
}

// --- from display (form inputs) --------------------------------------------

export function speedToSI(v: number | null, sys: UnitSystem): number | null {
  if (v === null || Number.isNaN(v)) return null
  return sys === 'us' ? v / MPH_PER_MS : v / KMH_PER_MS
}

export function massToSI(v: number | null, sys: UnitSystem): number | null {
  if (v === null || Number.isNaN(v)) return null
  return sys === 'us' ? v / LB_PER_KG : v
}

export function heightToSI(v: number | null, sys: UnitSystem): number | null {
  if (v === null || Number.isNaN(v)) return null
  return sys === 'us' ? v / IN_PER_M : v / 100
}

export function distanceToSI(v: number | null, sys: UnitSystem): number | null {
  if (v === null || Number.isNaN(v)) return null
  return sys === 'us' ? v / MI_PER_M : v / KM_PER_M
}

export function lengthToSI(v: number | null, sys: UnitSystem): number | null {
  if (v === null || Number.isNaN(v)) return null
  return sys === 'us' ? v / FT_PER_M : v
}

/** Unit labels for form fields. */
export function unitLabel(kind: 'speed' | 'mass' | 'height' | 'distance' | 'length' | 'accel', sys: UnitSystem): string {
  const metric = { speed: 'km/h', mass: 'kg', height: 'cm', distance: 'km', length: 'm', accel: 'km/h/s' }
  const us = { speed: 'mph', mass: 'lb', height: 'in', distance: 'mi', length: 'ft', accel: 'mph/s' }
  return (sys === 'us' ? us : metric)[kind]
}

// --- time -------------------------------------------------------------------

/** Seconds → mm:ss, or h:mm:ss over an hour. */
export function duration(s: number | null): string {
  if (s === null || s === undefined || Number.isNaN(s)) return '—'
  const total = Math.max(0, Math.round(s))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The options Intl refuses to see beside `dateStyle` or `timeStyle`. */
const COMPONENT_OPTS = ['weekday', 'era', 'year', 'month', 'day', 'hour', 'minute', 'second',
                        'timeZoneName', 'dayPeriod', 'fractionalSecondDigits'] as const

/**
 * ISO string or epoch seconds → localized date/time in a time zone; invalid zones fall back to local.
 *
 * The default is a medium date and a short time, but a caller that names the parts it wants ("3 Oct 2026")
 * gets only those: Intl throws if `dateStyle` is passed beside `day`, and a date on a page is never worth
 * an exception.
 */
export function dateTime(v: string | number | null, timeZone: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (v === null || v === undefined) return '—'
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const named = COMPONENT_OPTS.some((k) => opts[k] !== undefined)
  const base: Intl.DateTimeFormatOptions = named ? { ...opts }
    : { dateStyle: 'medium', timeStyle: 'short', ...opts }
  try {
    return new Intl.DateTimeFormat(undefined, { ...base, timeZone }).format(d)
  } catch {
    return new Intl.DateTimeFormat(undefined, base).format(d)
  }
}

/** "3 s ago", "2 min ago", … from an ISO string or epoch seconds. */
export function ago(v: string | number | null, now: number = Date.now()): string {
  if (v === null || v === undefined) return '—'
  const t = typeof v === 'number' ? v * 1000 : new Date(v).getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

/**
 * A leaderboard value as text, from the board's own `unit` (PLAN.md §18.7) — so the console can show a board
 * it has never heard of, including the ones a game declares for its own stats.
 */
export function boardValue(unit: string, v: number | null, sys: UnitSystem): string {
  if (v === null || v === undefined) return '—'
  switch (unit) {
    case 'distance':
      // Under a kilometre, say so in metres: three people on "0 km" is not a leaderboard.
      return Math.abs(v) < 1000 ? length(v, sys, 0).text : distance(v, sys, 1).text
    case 'elevation':
      return length(v, sys, 0).text
    case 'energy':
      return energy(v).text
    case 'duration':
      return duration(v)
    case 'power':
      return power(v).text
    case 'weeks':
      return `${round(v, 0)} week${v === 1 ? '' : 's'}`
    case 'count':
      return String(round(v, 0))
    default:
      return String(round(v, 1))
  }
}
