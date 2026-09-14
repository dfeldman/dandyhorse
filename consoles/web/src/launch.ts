// The launch dialog's default machine for a variant that runs on several (pure, unit-tested).
import type { DeviceType } from './types'

export interface MachineHints {
  /** exercise-device types connected right now on a fresh bridge (status.ts connection()) */
  connected: string[]
  /** me.preferences.ownedDeviceTypes, in the user's order */
  owned: DeviceType[]
  /** saved devices (GET /api/devices) */
  saved: { type: string; lastSeenAt: string | null }[]
}

/**
 * The machine the user actually has:
 * - the one they own, when they own exactly one kind the variant supports (owner, 2026-09-13): what they ticked
 *   under "I own", or when they ticked nothing, the kinds of machine they have saved;
 * - else a type connected right now;
 * - else the first owned type the variant supports, in the user's order;
 * - else the type of the most recently seen saved device the variant supports (heart rate monitors never match);
 * - else the variant's first.
 */
export function defaultDeviceType(variantTypes: DeviceType[], hints: MachineHints): DeviceType {
  const fits = (t: string): t is DeviceType => (variantTypes as string[]).includes(t)
  const owned = [...new Set((hints.owned.length ? hints.owned : hints.saved.map((d) => d.type)).filter(fits))]
  if (owned.length === 1) return owned[0]!
  const connected = hints.connected.find(fits)
  if (connected) return connected
  const first = hints.owned.find(fits)
  if (first) return first
  let recent: { type: DeviceType; at: number } | null = null
  for (const d of hints.saved) {
    if (!fits(d.type)) continue
    const t = d.lastSeenAt ? Date.parse(d.lastSeenAt) : NaN
    const at = Number.isNaN(t) ? -Infinity : t
    if (!recent || at > recent.at) recent = { type: d.type, at }
  }
  return recent?.type ?? variantTypes[0] ?? 'treadmill'
}

/** A saved machine the user really has, not one of the bridge's simulators (address sim:bike, protocol sim). */
export function isRealMachine(d: { type: string; address: string | null; protocol: string | null }): boolean {
  return d.type !== 'hrm' && d.protocol !== 'sim' && !(d.address ?? '').startsWith('sim:')
}

/**
 * Debug is on by default only for someone with no real machine saved: the simulator needs it, and a debug
 * session earns no achievements and counts for no leaderboard, so a real rider's sessions must not be debug.
 */
export function defaultDebug(saved: { type: string; address: string | null; protocol: string | null }[]): boolean {
  return !saved.some(isRealMachine)
}
