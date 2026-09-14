/**
 * Unit conversion and formatting for display. The API and your game model stay SI; convert at the screen.
 * `sys` is the user's preference from the start payload (`unitSystem`): 'metric' or 'us'.
 */
import type { UnitSystem } from './types.ts'

export const KM_PER_M = 0.001
export const MI_PER_M = 1 / 1609.344
export const KMH_PER_MS = 3.6
export const MPH_PER_MS = 2.2369362920544
export const FT_PER_M = 3.280839895013123
export const LB_PER_KG = 2.2046226218487757
export const J_PER_KCAL = 4184

export interface Quantity {
  value: number | null
  unit: string
  /** Number with the unit appended, or a dash when null. */
  text: string
}

function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

function fmt(v: number | null | undefined, digits: number, unit: string): Quantity {
  if (v === null || v === undefined || Number.isNaN(v)) return { value: null, unit, text: '—' }
  const r = round(v, digits)
  return { value: r, unit, text: `${r.toFixed(digits)} ${unit}`.trim() }
}

/** Distance in m → km or mi. */
export function distance(m: number | null, sys: UnitSystem, digits = 2): Quantity {
  return sys === 'us' ? fmt(m == null ? null : m * MI_PER_M, digits, 'mi') : fmt(m == null ? null : m * KM_PER_M, digits, 'km')
}
/** Short distance in m → m or ft (elevation, position). */
export function length(m: number | null, sys: UnitSystem, digits = 0): Quantity {
  return sys === 'us' ? fmt(m == null ? null : m * FT_PER_M, digits, 'ft') : fmt(m, digits, 'm')
}
/** Speed in m/s → km/h or mph. */
export function speed(ms: number | null, sys: UnitSystem, digits = 1): Quantity {
  return sys === 'us' ? fmt(ms == null ? null : ms * MPH_PER_MS, digits, 'mph') : fmt(ms == null ? null : ms * KMH_PER_MS, digits, 'km/h')
}
/** Pace in s per km or per mile ("5:30 /km"); null or zero speed gives a dash. */
export function pace(ms: number | null, sys: UnitSystem): Quantity {
  const unit = sys === 'us' ? '/mi' : '/km'
  if (ms == null || !(ms > 0)) return { value: null, unit, text: '—' }
  const secs = sys === 'us' ? 1609.344 / ms : 1000 / ms
  return { value: round(secs, 0), unit, text: `${clock(secs)} ${unit}` }
}
/** Mass in kg → kg or lb. */
export function mass(kg: number | null, sys: UnitSystem, digits = 1): Quantity {
  return sys === 'us' ? fmt(kg == null ? null : kg * LB_PER_KG, digits, 'lb') : fmt(kg, digits, 'kg')
}
/** Energy in J → kcal (both systems). */
export function energy(j: number | null, digits = 0): Quantity {
  return fmt(j == null ? null : j / J_PER_KCAL, digits, 'kcal')
}
export const power = (w: number | null, digits = 0): Quantity => fmt(w, digits, 'W')
export const heartRate = (bpm: number | null, digits = 0): Quantity => fmt(bpm, digits, 'bpm')
export const cadence = (rpm: number | null, digits = 0): Quantity => fmt(rpm, digits, 'rpm')
export const percent = (p: number | null, digits = 1): Quantity => fmt(p, digits, '%')

/** From display back to SI (settings screens). */
export const speedToSI = (v: number, sys: UnitSystem): number => (sys === 'us' ? v / MPH_PER_MS : v / KMH_PER_MS)
export const distanceToSI = (v: number, sys: UnitSystem): number => (sys === 'us' ? v / MI_PER_M : v / KM_PER_M)

/** Seconds → m:ss, or h:mm:ss over an hour; negative values get a leading minus. */
export function clock(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  const neg = seconds < 0
  const total = Math.abs(Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
  return neg ? `-${body}` : body
}

/** Unit label for a kind of quantity in the user's system. */
export function unitLabel(kind: 'speed' | 'distance' | 'length' | 'mass' | 'pace', sys: UnitSystem): string {
  const metric = { speed: 'km/h', distance: 'km', length: 'm', mass: 'kg', pace: '/km' }
  const us = { speed: 'mph', distance: 'mi', length: 'ft', mass: 'lb', pace: '/mi' }
  return (sys === 'us' ? us : metric)[kind]
}
