import type { MetricName, UnitSystem } from './types'

const MPH = 2.236936
const KMH = 3.6

export function fmtSpeed(mps: number | null | undefined, u: UnitSystem, digits = 1): string {
  if (mps == null) return '–'
  return u === 'us' ? `${(mps * MPH).toFixed(digits)} mph` : `${(mps * KMH).toFixed(digits)} km/h`
}
export function speedUnit(u: UnitSystem): string {
  return u === 'us' ? 'mph' : 'km/h'
}
export function fmtDistance(m: number | null | undefined, u: UnitSystem): string {
  if (m == null) return '–'
  return u === 'us' ? `${(m / 1609.344).toFixed(2)} mi` : `${(m / 1000).toFixed(2)} km`
}
export function fmtEnergy(j: number | null | undefined): string {
  if (j == null) return '–'
  return `${Math.round(j / 4184)} kcal`
}
export function fmtElapsed(s: number | null | undefined): string {
  if (s == null) return '–'
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
export function fmtNum(v: number | null | undefined, digits = 0, unit = ''): string {
  if (v == null) return '–'
  return `${v.toFixed(digits)}${unit ? ' ' + unit : ''}`
}

/** Display a metric value in the user's unit system. */
export function fmtMetric(name: MetricName, v: number | null | undefined, u: UnitSystem): string {
  switch (name) {
    case 'speed': return fmtSpeed(v, u)
    case 'incline': return fmtNum(v, 1, '%')
    case 'grade': return fmtNum(v, 1, '%')
    case 'cadence': return fmtNum(v, 0, 'rpm')
    case 'power': return fmtNum(v, 0, 'W')
    case 'heartRate': return fmtNum(v, 0, 'bpm')
    case 'wind': return fmtNum(v, 1, 'm/s')
    case 'crr': return fmtNum(v, 4)
    case 'cw': return fmtNum(v, 2)
  }
}

export const METRIC_LABELS: Record<MetricName, string> = {
  speed: 'Speed', incline: 'Incline', cadence: 'Cadence', power: 'Power', grade: 'Grade', wind: 'Wind', crr: 'Crr', cw: 'Cw', heartRate: 'Heart rate',
}
