// Pure helpers for the top-bar connection indicator and the status layer (no DOM, unit-tested).
import type { Bridge, BridgeDevice } from './types'

/** Device statuses that count as "connected" for the indicator. */
const LIVE = new Set(['connected', 'readonly', 'simulated'])

export function deviceTypeName(type: string | null | undefined): string {
  switch (type) {
    case 'treadmill': return 'treadmill'
    case 'bike': return 'bike trainer'
    case 'hrm': return 'heart rate monitor'
    default: return type || 'device'
  }
}

export interface Connection {
  /** true when an exercise device is live on any fresh bridge */
  connected: boolean
  /** "Connected treadmill" / "Connected bike trainer" / "Devices" (nothing connected yet: the device usually
   *  connects on the game screen or a phone, so this is not an alarm) */
  label: string
  /** a live heart rate monitor on any fresh bridge */
  hrm: boolean
  /** the exercise device, when connected */
  device: BridgeDevice | null
}

function isLive(d: BridgeDevice): boolean {
  return LIVE.has(d.status ?? '')
}

/** Bridges the server still considers present (fresh is omitted by older servers: treat as fresh). */
export function freshBridges(bridges: Bridge[]): Bridge[] {
  return bridges.filter((b) => b.fresh !== false)
}

export function connection(bridges: Bridge[]): Connection {
  const fresh = freshBridges(bridges)
  // The bridge in control first, then any other fresh bridge with a live exercise device.
  const owner = fresh.find((b) => b.roles?.fitness === 'owner' && b.devices.some((d) => d.role === 'fitness' && isLive(d)))
  const holder = owner ?? fresh.find((b) => b.devices.some((d) => d.role === 'fitness' && isLive(d)))
  const device = holder?.devices.find((d) => d.role === 'fitness' && isLive(d)) ?? null
  const hrm = fresh.some((b) => b.devices.some((d) => d.role === 'hrm' && isLive(d)))
  if (!device) return { connected: false, label: 'Devices', hrm, device: null }
  return { connected: true, label: `Connected ${deviceTypeName(device.type)}`, hrm, device }
}

/** Plain words for a bridge's standing on the exercise device. */
export function standing(b: Bridge): string {
  switch (b.roles?.fitness) {
    case 'owner': return 'in control'
    case 'standby': return 'standing by'
    case 'ignored': return b.ignoredReasons?.fitness ?? 'ignored'
    default: return ''
  }
}

/** Short status word for a device on a bridge. */
export function deviceStatusWord(d: BridgeDevice): string {
  switch (d.status) {
    case 'connected': return 'connected'
    case 'readonly': return 'read-only'
    case 'simulated': return 'simulator'
    case 'connecting': return 'connecting'
    case 'disconnected': return 'disconnected'
    default: return d.status ?? 'unknown'
  }
}

/** Initial letter for the placeholder tile when a session has no image. */
export function initialOf(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  return s ? s[0]!.toUpperCase() : '?'
}

/** A stable accent index (0..n-1) from a string, for placeholder tile colors. */
export function hueIndex(key: string, n: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return n > 0 ? h % n : 0
}
