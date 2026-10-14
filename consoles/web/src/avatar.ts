// The player's avatar: an AvatarSpec (avatarkit, the sibling repo) kept in their profile, as `users.profile.avatar`
// (PLAN.md §8.1 lists "avatar" among the profile JSON's contents). It travels with the account, so the same
// person appears in every game on any device.
//
// `PUT /api/me` replaces the whole profile object, so a save reads the profile back first and changes only the
// avatar: a bio edited in another tab meanwhile survives.
import { api } from './api'
import { loadMe } from './session'
import type { Me } from './types'

/** where the designer kept the avatar before it was stored on the profile; read once, then cleared */
export const LOCAL_KEY = 'dh.avatar'

type Profile = Record<string, unknown>

/** The profile with this avatar in it, leaving everything else alone. */
export function withAvatar(profile: Profile | undefined | null, avatar: unknown): Profile {
  return { ...(profile ?? {}), avatar }
}

/**
 * What the designer should open on: the profile's avatar, or one left in this browser by the version that saved
 * there (so nobody loses a look they made before). Undefined means the kit's own default.
 */
export function initialAvatar(profile: Profile | undefined | null, local: string | null): unknown {
  const saved = (profile ?? {}).avatar
  if (saved && typeof saved === 'object') return saved
  if (!local) return undefined
  try {
    const parsed: unknown = JSON.parse(local)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function readLocal(): string | null {
  try {
    return localStorage.getItem(LOCAL_KEY)
  } catch {
    return null
  }
}

function clearLocal(): void {
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    // a browser that refuses storage has nothing to clear
  }
}

/** The avatar to start the designer with (see initialAvatar). */
export async function loadAvatar(): Promise<unknown> {
  const me = await api<Me>('/api/me')
  return initialAvatar(me.profile, readLocal())
}

/** Store the avatar on the player's profile. Throws ApiError if the save fails; the designer shows the message. */
export async function saveAvatar(avatar: unknown): Promise<void> {
  const fresh = await api<Me>('/api/me')
  await api<Me>('/api/me', 'PUT', { profile: withAvatar(fresh.profile, avatar) })
  clearLocal()
  await loadMe()
}
