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
 * The machine the user actually has: a type connected right now, else the first owned type the variant supports,
 * else the type of the most recently seen saved device the variant supports (heart rate monitors never match), else
 * the variant's first.
 */
export function defaultDeviceType(variantTypes: DeviceType[], hints: MachineHints): DeviceType {
  const fits = (t: string): t is DeviceType => (variantTypes as string[]).includes(t)
  const connected = hints.connected.find(fits)
  if (connected) return connected
  const owned = hints.owned.find(fits)
  if (owned) return owned
  let recent: { type: DeviceType; at: number } | null = null
  for (const d of hints.saved) {
    if (!fits(d.type)) continue
    const t = d.lastSeenAt ? Date.parse(d.lastSeenAt) : NaN
    const at = Number.isNaN(t) ? -Infinity : t
    if (!recent || at > recent.at) recent = { type: d.type, at }
  }
  return recent?.type ?? variantTypes[0] ?? 'treadmill'
}
