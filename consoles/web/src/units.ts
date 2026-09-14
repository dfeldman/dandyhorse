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

function round(v: number, digits: number): number {
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

/** ISO string or epoch seconds → localized date/time in a time zone; invalid zones fall back to local. */
export function dateTime(v: string | number | null, timeZone: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (v === null || v === undefined) return '—'
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const base: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', ...opts }
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

/** Leaderboard metric value → display text. */
export function metricValue(metric: string, v: number | null, sys: UnitSystem): string {
  switch (metric) {
    case 'distance':
      return distance(v, sys).text
    case 'energy':
      return energy(v).text
    case 'duration':
      return duration(v)
    case 'avg_power':
      return power(v).text
    default:
      return v === null ? '—' : String(round(v, 1))
  }
}
