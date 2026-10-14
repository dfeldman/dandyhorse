/**
 * Heart-rate zones, the five every machine and watch shows, as shares of maximum heart rate. Pure.
 *
 * The boundaries (50/60/70/80/90 % of max) and the names are the common convention — Polar's, and what
 * Technogym, Life Fitness and Matrix all print on the console — so a number here means what the player
 * already thinks it means. Zone 0 is "below zone 1": sitting down, or no reading yet.
 */

export interface Zone {
  /** 1–5. */
  n: number
  name: string
  what: string
  /** Share of maximum heart rate this zone starts at. */
  from: number
  to: number
  colour: string
}

export const ZONES: Zone[] = [
  { n: 1, name: 'Very light', what: 'Warm up, recover', from: 0.5, to: 0.6, colour: '#5d8fc9' },
  { n: 2, name: 'Light', what: 'Build endurance', from: 0.6, to: 0.7, colour: '#4ed38a' },
  { n: 3, name: 'Moderate', what: 'Improve aerobic fitness', from: 0.7, to: 0.8, colour: '#f0c040' },
  { n: 4, name: 'Hard', what: 'Raise your threshold', from: 0.8, to: 0.9, colour: '#f5883a' },
  { n: 5, name: 'Maximum', what: 'All-out, in short bursts', from: 0.9, to: 1.06, colour: '#e8453c' },
]

/** The lowest heart rate the strip shows: the bottom of zone 1. */
export const ZONE_FLOOR = ZONES[0]!.from
export const ZONE_CEILING = ZONES[ZONES.length - 1]!.to

/** Which zone a heart rate is in: 1–5, or 0 below zone 1. `null` when there is nothing to read. */
export function zoneOf(hr: number | null, maxHr: number): number {
  if (hr === null || maxHr <= 0) return 0
  const f = hr / maxHr
  for (const z of ZONES) if (f < z.to) return f < z.from ? (z.n === 1 ? 0 : z.n - 1) : z.n
  return 5
}

export function zoneColour(n: number): string {
  return ZONES[n - 1]?.colour ?? '#3c4757'
}

export function zoneName(n: number): string {
  return ZONES[n - 1]?.name ?? 'Resting'
}

/** The bpm a zone runs from and to, for the strip's labels. */
export function zoneRange(n: number, maxHr: number): [number, number] {
  const z = ZONES[n - 1]
  return z ? [Math.round(z.from * maxHr), Math.round(z.to * maxHr)] : [0, 0]
}

/**
 * One minute of recovery after a hard effort: how far the heart rate falls. The standard reading of it —
 * under 12 bpm is the number sports medicine flags, and a fit person drops 30 or more.
 */
export function recoveryVerdict(drop: number): { label: string; note: string; good: number } {
  if (drop >= 40) return { label: 'Excellent', note: 'Your heart settled very quickly.', good: 1 }
  if (drop >= 30) return { label: 'Very good', note: 'A strong recovery.', good: 0.85 }
  if (drop >= 21) return { label: 'Good', note: 'A healthy drop.', good: 0.65 }
  if (drop >= 12) return { label: 'Fair', note: 'Room to improve with regular work.', good: 0.4 }
  return { label: 'Slow', note: 'A drop under 12 bpm is worth mentioning to a doctor if it keeps up.', good: 0.15 }
}
